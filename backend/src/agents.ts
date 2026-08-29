/**
 * The agent population: 10 shoppers, 2 per brief.
 *
 * Three of them really drive a browser through Browserbase via Stagehand. The
 * other seven are scripted — they exist so the Check screen reads as a
 * population rather than three tiles, and their pacing copies the prototype's.
 * Their failure *reasons* are pulled from the real audit so the console never
 * states something untrue about the store, but their pass/fail pattern is not a
 * measurement. Do not report them as one.
 *
 * Browserbase free tier is 3 concurrent browsers and 1 browser-hour total, so
 * REAL_AGENT_COUNT is 3 by design, not by accident.
 */

import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

import { logger, since } from "./log";
import { emitAgentEvent, publish } from "./store";
import type { Catalogue, Checks, Persona, Run, StageNumber } from "./types";

/**
 * Browserbase keys, pooled.
 *
 * Free tier allows three concurrent browsers per account, so several keys means
 * proportionally more real agents. Each key spends its own account's quota —
 * a teammate's hour runs out on their account, not yours.
 *
 * Set BROWSERBASE_API_KEYS to a comma-separated list, or BROWSERBASE_API_KEY
 * for a single one. Keys are only ever referenced by index in logs.
 */
const API_KEYS = (process.env.BROWSERBASE_API_KEYS ?? process.env.BROWSERBASE_API_KEY ?? "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

const CONCURRENT_PER_KEY = 3;

const REAL_AGENT_COUNT = Number(
  process.env.HAPPY2_REAL_AGENTS ?? API_KEYS.length * CONCURRENT_PER_KEY,
);
const STAGE_TIMEOUT_MS = 45_000;

/** Fixture pacing, so the scripted agents animate like the prototype. */
const START_GAP_TICKS = 4;
const STEP_TICKS = 7;
const MS_PER_TICK = 140;

const agentLog = logger("agents");

export const AGENT_IDS = Array.from(
  { length: 10 },
  (_, i) => `A${String(i + 1).padStart(2, "0")}`,
);

/** Agent i shops with persona i/2 — two agents per brief. */
export function personaIndexOf(agentIndex: number): number {
  return Math.floor(agentIndex / 2);
}

export async function runPopulation(
  run: Run,
  catalogue: Catalogue,
  checks: Checks,
  personas: Persona[],
): Promise<void> {
  const realIndices = pickRealAgents();
  agentLog.info("population starting", {
    real: realIndices.map((i) => AGENT_IDS[i]).join(",") || "none",
    scripted: AGENT_IDS.length - realIndices.length,
    keys: API_KEYS.length,
    capacity: API_KEYS.length * CONCURRENT_PER_KEY,
  });

  // Browsers stay open until every agent has settled, so each tile's live view
  // remains valid for the whole run instead of dying when its agent finishes.
  const open: OpenBrowser[] = [];

  const blockers = blockersFrom(checks);
  agentLog.info("blockers observed in the audit", {
    count: blockers.length,
    stages: blockers.map((b) => b.stage).join(",") || "none",
  });
  const scripted = AGENT_IDS.map((_, i) => i)
    .filter((i) => !realIndices.includes(i))
    .map((i) => runScriptedAgent(run, i, checks, blockers));

  const real = realIndices.map((i, slot) =>
    runRealAgent(run, i, catalogue, personas[personaIndexOf(i)]!, open, slot),
  );

  const startedAt = Date.now();
  await Promise.allSettled([...scripted, ...real]);

  await Promise.allSettled(
    open.map(async ({ stagehand, browser }) => {
      await stagehand.close().catch(() => {});
      await browser.close().catch(() => {});
    }),
  );

  // Tell the UI the live views are dead. Without this the tiles keep an iframe
  // pointed at a stopped session, which renders Browserbase's DevTools
  // "debugging connection was closed" page rather than falling back.
  if (open.length > 0) {
    run.sessionsClosed = true;
    publish(run, { type: "sessions_closed" });
  }

  agentLog.info("population settled", {
    ms: since(startedAt),
    browsersClosed: open.length,
  });
}

/** Spread the real agents across different briefs so the tiles differ. */
function pickRealAgents(): number[] {
  const wanted = Math.max(0, Math.min(AGENT_IDS.length, REAL_AGENT_COUNT));
  if (wanted === 0) return [];
  const stride = Math.max(1, Math.floor(AGENT_IDS.length / wanted));
  const picked: number[] = [];
  for (let i = 0; i < AGENT_IDS.length && picked.length < wanted; i += stride) {
    picked.push(i);
  }
  // A stride that does not divide evenly leaves room; fill it in order.
  for (let i = 0; i < AGENT_IDS.length && picked.length < wanted; i++) {
    if (!picked.includes(i)) picked.push(i);
  }
  return picked.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Real agents
// ---------------------------------------------------------------------------

/** Optional pacing, so a live view is watchable on stage. 0 in normal use. */
const STAGE_DELAY_MS = Number(process.env.HAPPY2_STAGE_DELAY_MS ?? 0);

/** Browsers are closed after the whole population settles, not per agent, so
 *  their live views stay valid for the length of the run. */
export interface OpenBrowser {
  stagehand: Stagehand;
  browser: Awaited<ReturnType<typeof browserbase.launch>>;
}

/**
 * One shopper, working the store the way a person would: land on the homepage,
 * find the catalogue, pick something that fits the brief, open it, choose a
 * variant, add it, and head for checkout.
 *
 * Every stage verdict is a checked post-condition — a changed URL, a product
 * link count, a cart line. `act()` resolves happily when it finds nothing to
 * click, so trusting it not to throw would mark empty stages as passes.
 */
async function runRealAgent(
  run: Run,
  agentIndex: number,
  catalogue: Catalogue,
  persona: Persona,
  open: OpenBrowser[],
  slot: number,
): Promise<void> {
  const agentId = AGENT_IDS[agentIndex]!;

  // Round-robin across the pool so no single account exceeds its concurrency.
  const keyIndex = API_KEYS.length > 0 ? slot % API_KEYS.length : -1;
  const apiKey = keyIndex >= 0 ? API_KEYS[keyIndex]! : undefined;

  if (!apiKey) {
    agentLog.warn(`${agentId} cannot run: no Browserbase key configured`);
    emitAgentEvent(run, agentId, 1, "fail", "BROWSERBASE_API_KEY is not set");
    return;
  }

  try {
    const launchedAt = Date.now();
    const browser = await browserbase.launch({ apiKey });
    const stagehand = await Stagehand.create({ browser });
    open.push({ stagehand, browser });

    if (browser.sessionId) {
      const liveViewUrl = await liveView(browser.sessionId, apiKey);
      run.sessions[agentId] = { sessionId: browser.sessionId, liveViewUrl };
      if (liveViewUrl) publish(run, { type: "session", agentId, liveViewUrl });
    }

    agentLog.info(`${agentId} browser ready`, {
      ms: since(launchedAt),
      // Index only — a key must never reach a log line.
      key: `${keyIndex + 1}/${API_KEYS.length}`,
      brief: persona.prompt.slice(0, 60),
      session: browser.sessionId
        ? `https://browserbase.com/sessions/${browser.sessionId}`
        : "none",
      liveView: run.sessions[agentId]?.liveViewUrl ? "available" : "unavailable",
    });

    const [page] = await browser.context.pages();
    if (!page) throw new Error("browserbase returned no page");
    const sh = stagehand;

    await page.goto(catalogue.origin);
    await dismissOverlays(sh);

    // 1 · discover — find the catalogue from the front page.
    if (
      !(await stage(run, agentId, 1, async () => {
        const from = await page.url();
        await sh.act(
          "Open the main shop, catalogue, or all-products section of this store.",
        );
        const url = await waitForNavigation(page, from);
        await dismissOverlays(sh);

        const links = await productLinkCount(page);
        // Leaving the homepage is not enough on its own — a store whose only
        // "catalogue" is the front page still has to list something.
        if (links < 3) {
          throw new Error(
            `no catalogue reachable — ${short(url)} lists ${links} product links`,
          );
        }
      }))
    ) {
      return;
    }

    // 2 · land — the listing has to be readable, not just present.
    if (
      !(await stage(run, agentId, 2, async () => {
        const seen = await sh.observe(
          "List the products offered on this page, with their names.",
        );
        const links = await productLinkCount(page);
        if (links === 0) throw new Error("listing page exposes no product links");
        agentLog.debug(`${agentId} sees ${links} products`, String(seen).slice(0, 80));
      }))
    ) {
      return;
    }

    // 3 · read — open the best match for the brief and get the facts off it.
    const facts = await stageValue(run, agentId, 3, async () => {
      const from = await page.url();
      await sh.act(
        `Click the product link for the item that best matches this shopper: ${persona.prompt}`,
      );
      let url = await waitForNavigation(page, from);

      // Some listings need a second click to get off a collection page.
      if (!/\/products?\//i.test(url)) {
        await sh.act("Open one of the product listings on this page.");
        url = await waitForNavigation(page, url);
      }
      await dismissOverlays(sh);

      if (!/\/products?\//i.test(url)) {
        throw new Error(`clicking through did not reach a product page (${short(url)})`);
      }

      const result = await sh.extract(
        "Extract the product title, its price, whether it is in stock, and any listed specifications.",
        z.object({
          title: z.string().nullable(),
          price: z.string().nullable(),
          inStock: z.boolean().nullable(),
          specs: z.array(z.string()),
        }),
      );
      const data = result.data;
      if (!data?.title || !data?.price) {
        throw new Error(
          `product page did not yield ${!data?.title ? "a title" : "a price"} an agent could read`,
        );
      }
      return data;
    });
    if (!facts) return;

    // 4 · select — a variant choice that actually did something.
    if (
      !(await stage(run, agentId, 4, () =>
        acted(
          sh,
          `Choose the size, colour or variant that matches this shopper: ${persona.prompt}`,
        ),
      ))
    ) {
      return;
    }

    // 5 · cart — confirmed by the cart itself, not by the model's say-so.
    if (
      !(await stage(run, agentId, 5, async () => {
        await acted(sh, "Add this product to the cart.");
        const count = await cartCount(page);
        if (count === 0) {
          throw new Error("add-to-cart ran but the cart is still empty");
        }
      }))
    ) {
      return;
    }

    // 6 · checkout — reaching it is the pass. No payment details, ever.
    await stage(run, agentId, 6, async () => {
      const from = await page.url();
      await acted(
        sh,
        "Go to the checkout page. Do not enter any payment information.",
      );
      const url = await waitForNavigation(page, from);
      if (!/checkout|payment/i.test(url)) {
        throw new Error(`checkout was not reachable (stopped at ${short(url)})`);
      }
    });
  } catch (err) {
    agentLog.error(`${agentId} aborted`, err);
    emitAgentEvent(run, agentId, 1, "fail", message(err));
  }
}

/**
 * Runs `act` and insists it actually did something.
 *
 * Stagehand resolves successfully when the model finds no element to act on —
 * it logs "No actionable element returned by the LLM" and returns an empty
 * action list. Treating that as a pass is how agents "select" nothing.
 */
async function acted(sh: Stagehand, instruction: string): Promise<void> {
  const result = await sh.act(instruction);
  const data = result.data;
  if (!data?.success || data.actions.length === 0) {
    throw new Error(data?.message?.trim() || "no actionable element on the page");
  }
}

/** Consent and newsletter overlays block everything behind them. */
async function dismissOverlays(sh: Stagehand): Promise<void> {
  try {
    await sh.act(
      "If a cookie consent, newsletter, or region popup is covering the page, dismiss or accept it. If there is none, do nothing.",
    );
  } catch {
    // Nothing to dismiss is the common case and not a failure.
  }
}

/** How many distinct product links the current page exposes. */
async function productLinkCount(page: { evaluate: <R>(fn: () => R) => Promise<R> }): Promise<number> {
  try {
    return await page.evaluate(() => {
      const hrefs = Array.from(
        document.querySelectorAll("a[href]"),
        (a) => (a as HTMLAnchorElement).href,
      );
      return new Set(hrefs.filter((h) => /\/products?\//i.test(h))).size;
    });
  } catch {
    return 0;
  }
}

/**
 * Lines in the cart. Uses Shopify's /cart.js where available and falls back to
 * reading a cart-count element, so a non-Shopify store still gets a verdict.
 */
async function cartCount(page: { evaluate: <R>(fn: () => R | Promise<R>) => Promise<R> }): Promise<number> {
  try {
    return await page.evaluate(async () => {
      try {
        const res = await fetch("/cart.js", { headers: { accept: "application/json" } });
        if (res.ok) {
          const cart = (await res.json()) as { item_count?: number };
          if (typeof cart.item_count === "number") return cart.item_count;
        }
      } catch {
        // fall through to the DOM
      }
      const el = document.querySelector(
        "[data-cart-count], .cart-count, [class*='cart-count'], [id*='cart-count']",
      );
      const n = Number((el?.textContent ?? "").replace(/\D/g, ""));
      return Number.isFinite(n) ? n : 0;
    });
  } catch {
    return 0;
  }
}

/**
 * Waits for the page to actually navigate.
 *
 * `act()` resolves as soon as it has issued the click, so reading `page.url()`
 * straight afterwards sees the old page and every product click looks like it
 * failed. Polls instead, and reports the URL it settled on.
 */
async function waitForNavigation(
  page: { url: () => Promise<string> },
  from: string,
  timeoutMs = 12_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let url = from;
  while (Date.now() < deadline) {
    url = await page.url();
    if (url !== from) {
      // Let the destination settle before anything reads the DOM.
      await sleep(1200);
      return page.url();
    }
    await sleep(400);
  }
  return url;
}

function short(url: string): string {
  return url.replace(/^https?:\/\//, "").slice(0, 60);
}

/** Runs one stage, emits pass/fail, and reports whether to keep going. */
async function stage(
  run: Run,
  agentId: string,
  n: StageNumber,
  work: () => Promise<unknown>,
): Promise<boolean> {
  return (await stageValue(run, agentId, n, work)) !== null;
}

async function stageValue<T>(
  run: Run,
  agentId: string,
  n: StageNumber,
  work: () => Promise<T>,
): Promise<T | null> {
  if (STAGE_DELAY_MS > 0) await sleep(STAGE_DELAY_MS);
  const startedAt = Date.now();
  try {
    const value = await withTimeout(work(), STAGE_TIMEOUT_MS);
    agentLog.info(`${agentId} stage ${n} pass`, { ms: since(startedAt) });
    emitAgentEvent(run, agentId, n, "pass");
    return value;
  } catch (err) {
    const reason = message(err);
    agentLog.warn(`${agentId} stage ${n} FAIL`, { ms: since(startedAt), reason });
    emitAgentEvent(run, agentId, n, "fail", reason);
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

function message(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/\s+/g, " ").trim().slice(0, 180);
}

/**
 * The embeddable live view for a running session.
 *
 * Not the dashboard link — the iframe-able debugger URL, valid only while the
 * session is alive (Browserbase 410s a stopped one).
 */
async function liveView(sessionId: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.browserbase.com/v1/sessions/${sessionId}/debug`,
      { headers: { "X-BB-API-Key": apiKey } },
    );
    if (!res.ok) {
      agentLog.warn("no live view for session", { sessionId, status: res.status });
      return null;
    }
    const body = (await res.json()) as {
      debuggerFullscreenUrl?: string;
      debuggerUrl?: string;
    };
    return body.debuggerFullscreenUrl ?? body.debuggerUrl ?? null;
  } catch (err) {
    agentLog.warn("live view lookup failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scripted agents — see the file header
// ---------------------------------------------------------------------------

/**
 * A stage an agent can actually fail at *on this store*, with the observed fact
 * that explains it. Derived from the audit, so a scripted agent never asserts
 * a problem the store does not have — on a well-prepared store this list is
 * short or empty and the scripted agents simply complete.
 */
interface Blocker {
  stage: StageNumber;
  reason: string;
}

export function blockersFrom(checks: Checks): Blocker[] {
  const out: Blocker[] = [];
  const t = checks.totals;
  const n = t.productsChecked;

  if (n === 0) {
    out.push({
      stage: 1,
      reason: `no product pages were discoverable from ${checks.sitemap.url}`,
    });
  }

  if (!checks.sitemap.found) {
    out.push({ stage: 1, reason: `no sitemap at ${checks.sitemap.url}` });
  } else if (!checks.robots.allowsAgents) {
    out.push({ stage: 1, reason: "robots.txt disallows known agent crawlers" });
  }

  if (n > 0 && t.withJsonLd < n) {
    out.push({
      stage: 3,
      reason: `only ${t.withJsonLd} of ${n} product pages carry Product JSON-LD`,
    });
  }
  if (n > 0 && t.priceInServedHtml < n) {
    out.push({
      stage: 3,
      reason: `price absent from served HTML on ${n - t.priceInServedHtml} of ${n} pages`,
    });
  }
  if (n > 0 && t.quantityCapped > 0) {
    out.push({
      stage: 4,
      reason: `quantity capped at 10 or fewer on ${t.quantityCapped} of ${n} pages, no bulk path`,
    });
  }
  if (n > 0 && t.withCartForm === 0) {
    out.push({
      stage: 5,
      reason: "add-to-cart is a JS-only widget, no form fallback to post to",
    });
  }
  if (checks.checkoutWall.requiresAccount) {
    out.push({ stage: 6, reason: "checkout redirects to account creation" });
  }

  return out;
}

/**
 * Scripted agents walk the six stages on the prototype's clock. They stop at a
 * blocker the audit actually observed, or complete checkout when there is none.
 * The pass/fail *pattern* is scripted; every reason string is a real finding.
 */
async function runScriptedAgent(
  run: Run,
  agentIndex: number,
  checks: Checks,
  blockers: Blocker[],
): Promise<void> {
  const agentId = AGENT_IDS[agentIndex]!;

  // Spread the observed blockers across the scripted agents; leave roughly a
  // third of them clean so the board shows a spread rather than a wall of red.
  const blocker =
    blockers.length > 0 && agentIndex % 3 !== 0
      ? blockers[agentIndex % blockers.length]!
      : null;

  const ceiling = blocker ? blocker.stage - 1 : 6;

  await sleep(agentIndex * START_GAP_TICKS * MS_PER_TICK);

  for (let s = 1; s <= ceiling; s++) {
    await sleep(STEP_TICKS * MS_PER_TICK);
    emitAgentEvent(run, agentId, s as StageNumber, "pass");
  }

  if (blocker) {
    await sleep(STEP_TICKS * MS_PER_TICK);
    emitAgentEvent(run, agentId, blocker.stage, "fail", blocker.reason);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
