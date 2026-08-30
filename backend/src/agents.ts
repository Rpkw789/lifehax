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
 * REAL_AGENT_COUNT is 8 because one Developer-plan key allows 25 REST requests
 * a rolling minute and starting an agent spends three of them — see
 * CONCURRENT_PER_KEY. The plan's 25 concurrent browsers are not the ceiling
 * here; the request budget is. On the free tier it was 3, so a fallback to
 * free keys means setting HAPPY2_REAL_AGENTS back down.
 */

import { browserbase, Stagehand, type ModelName } from "@browserbasehq/stagehand";
import { z } from "zod";

import { logger, since } from "./log";
import { emitAgentEvent, publish } from "./store";
import type { Catalogue, Checks, Persona, Run, StageNumber } from "./types";

/**
 * Browserbase keys, pooled.
 *
 * One Developer-plan key covers the whole population: that plan allows 25
 * concurrent browsers, so the nine real agents fit inside a single account's
 * quota with room to spare. The pool stays a list because the free-tier
 * arrangement — several accounts at three concurrent browsers each — is what
 * you fall back to when the paid key runs dry.
 *
 * Set BROWSERBASE_API_KEYS to a comma-separated list, or BROWSERBASE_API_KEY
 * for a single one. Keys are only ever referenced by index in logs.
 */
const API_KEYS = [
  ...new Set(
    // Both names are read, rather than `??` between them. An env file that
    // carries the plural as a bare `BROWSERBASE_API_KEYS=` — which is exactly
    // what .env.example ships — has *set* it to the empty string, and `??`
    // keeps an empty string. The singular would then never be consulted and
    // the pool would come up empty with a perfectly good key sitting in it.
    [process.env.BROWSERBASE_API_KEYS, process.env.BROWSERBASE_API_KEY]
      .flatMap((v) => (v ?? "").split(","))
      .map((k) => k.trim())
      .filter(Boolean),
  ),
];

/**
 * Real agents we ask of each key by default.
 *
 * The binding limit is not the Developer plan's 25 concurrent browsers — it is
 * the REST rate limit, which is also 25 requests per rolling minute. Starting
 * one agent spends three of them: the extension Stagehand uploads before every
 * launch, the session create, and our own live-view lookup. Eight agents is 24
 * requests and fits; nine is 27 and the tail of the burst comes back 429.
 *
 * Stagehand discards the status on a rejected create and raises a bare
 * "Failed to create a Browserbase session", so going over the line costs you
 * agents and tells you nothing about why. Free-tier keys cap at three
 * concurrent browsers, so a fallback pool needs HAPPY2_REAL_AGENTS set down.
 */
const CONCURRENT_PER_KEY = 8;

/**
 * A launch still loses its window sometimes — a retried run, a second browser
 * tab kicking off a run inside the same minute. The window is only a minute
 * wide, so waiting it out costs one agent a slow start instead of the whole
 * run an agent.
 */
const LAUNCH_ATTEMPTS = 3;
const LAUNCH_BACKOFF_MS = 30_000;

/**
 * The model behind `act` and `observe`, and the key it bills to.
 *
 * Left unset, Stagehand routes inference through Browserbase's Model Gateway:
 * Browserbase picks the model and spends the browser account's plan, so a run
 * can stall on inference quota with browser-hours to spare. Naming a model and
 * a key here moves that spend onto our own account and makes the choice
 * visible. Provider-prefixed, e.g. `openai/gpt-5.4-mini`.
 *
 * This is deliberately *not* the Cloudflare gateway path in `llm.ts` — that one
 * speaks the Anthropic Messages schema over `fetch`, while Stagehand needs a
 * provider it can drive itself. Personas and findings still go through `llm.ts`.
 */
const AGENT_MODEL =
  // ModelName is a union of literals and an env var is a string, so an
  // unrecognised id is caught by the first call, not by the compiler.
  (process.env.HAPPY2_AGENT_MODEL ?? "openai/gpt-5.4-mini") as ModelName;

/** Empty means we have no key of our own, and inference falls back to them. */
const AGENT_MODEL_KEY = (process.env.OPENAI_API_KEY ?? "").trim();

const REAL_AGENT_COUNT = Number(
  process.env.HAPPY2_REAL_AGENTS ?? API_KEYS.length * CONCURRENT_PER_KEY,
);
const STAGE_TIMEOUT_MS = 75_000;

/** Fixture pacing, so the scripted agents animate like the prototype. */
const START_GAP_TICKS = 4;
const STEP_TICKS = 7;
const MS_PER_TICK = 140;

const agentLog = logger("agents");

/**
 * What the real agents are configured with, for /health and the startup line.
 *
 * `browserbase` reads the pool, not `BROWSERBASE_API_KEY` alone — the deploy
 * docs tell you to set the plural, and health reporting it as missing while
 * agents happily browse sends you debugging the wrong thing.
 */
export function agentConfig(): {
  browserbase: boolean;
  keys: number;
  model: string;
} {
  return {
    browserbase: API_KEYS.length > 0,
    keys: API_KEYS.length,
    model: AGENT_MODEL_KEY ? AGENT_MODEL : "browserbase model gateway",
  };
}

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
  briefs: string[],
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
    runRealAgent(
      run,
      i,
      catalogue,
      personas[personaIndexOf(i)]!,
      // Each agent shops its own brief, not its archetype's first one.
      briefs[i] ?? personas[personaIndexOf(i)]!.prompt,
      open,
      slot,
    ),
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
/**
 * `browserbase.launch`, with the rate limit survived rather than reported.
 *
 * Every failure arrives as the same "Failed to create a Browserbase session"
 * with the HTTP status thrown away inside Stagehand, so there is nothing to
 * branch on — a 429 and a bad key look identical from here. Retrying is right
 * for the first and merely slow for the second, which is the better trade when
 * the alternative is an agent that dies silently at stage one.
 */
async function launchBrowser(
  apiKey: string,
  agentId: string,
): Promise<Awaited<ReturnType<typeof browserbase.launch>>> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await browserbase.launch({ apiKey });
    } catch (err) {
      if (attempt >= LAUNCH_ATTEMPTS) throw err;
      // Jitter, so agents that lost the same window do not all come back at
      // the same instant and lose the next one together.
      const wait = LAUNCH_BACKOFF_MS + Math.floor(Math.random() * 5_000);
      agentLog.warn(`${agentId} launch rejected, retrying`, {
        attempt,
        in: `${Math.round(wait / 1000)}s`,
        // Stagehand keeps no cause; the message is the whole of what we get.
        err: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

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
  brief: string,
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
    const browser = await launchBrowser(apiKey, agentId);
    const stagehand = await Stagehand.create({
      browser,
      // Omitting `model` hands inference to Browserbase's Model Gateway on
      // their plan. With a key of our own, spend and model choice are ours.
      ...(AGENT_MODEL_KEY
        ? { model: { modelName: AGENT_MODEL, apiKey: AGENT_MODEL_KEY } }
        : {}),
    });
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
      // Model id only — never the key that pays for it.
      model: AGENT_MODEL_KEY ? AGENT_MODEL : "browserbase model gateway",
      brief: brief.slice(0, 60),
      entry: short(catalogue.entryUrl),
      session: browser.sessionId
        ? `https://browserbase.com/sessions/${browser.sessionId}`
        : "none",
      liveView: run.sessions[agentId]?.liveViewUrl ? "available" : "unavailable",
    });

    const [page] = await browser.context.pages();
    if (!page) throw new Error("browserbase returned no page");
    const sh = stagehand;

    // Start where the user pointed us. If they gave a path, that is the
    // catalogue as far as this run is concerned.
    await page.goto(catalogue.entryUrl);
    await dismissOverlays(sh);

    // 1 · discover — reach a page that actually lists products.
    if (
      !(await stage(run, agentId, 1, async () => {
        // Poll: a listing rendered client-side has no links in the DOM for the
        // first second or two, and counting once makes a slow page look empty.
        let links = await settledProductLinkCount(page);

        // A session occasionally lands on a page that never painted, or gets a
        // consent wall thrown up after the first dismissal. One reload settles
        // both, and is far cheaper than losing the agent for the whole run.
        if (links === 0) {
          agentLog.debug(`${agentId} saw an empty page, reloading once`);
          await page.goto(catalogue.entryUrl);
          await dismissOverlays(sh);
          links = await settledProductLinkCount(page);
        }

        // Already on a listing — typically because the store URL named one.
        // Hunting for a catalogue from here would navigate away from it.
        if (links >= 3) {
          agentLog.debug(`${agentId} entry page lists ${links} products`);
          return;
        }

        const from = await page.url();
        await observeAndAct(
          sh,
          "Open the main shop, catalogue, or all-products section of this store.",
        ).catch(() => {});
        const url = await waitForNavigation(page, from);
        await dismissOverlays(sh);

        links = await settledProductLinkCount(page);
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

      // Observe the listing once, then act on the candidate whose description
      // best fits the brief. Asking act() to both find and choose re-runs
      // inference and routinely comes back with nothing on a listing page,
      // even though observe() sees every product.
      const listing = await sh.observe(
        "List the product links on this page, with the product name for each.",
      );
      const chosen = pickCandidate(listing.data ?? [], brief);
      if (chosen) {
        agentLog.debug(`${agentId} chose a product`, {
          of: (listing.data ?? []).length,
          description: chosen.description.slice(0, 60),
        });
        await sh.act(chosen).catch((err: unknown) =>
          agentLog.debug(`${agentId} could not replay that action`, err),
        );
      }

      let url = await waitForNavigation(page, from, 8000);

      // Clicking does not always work. On some listings Stagehand can see every
      // product in the accessibility tree but cannot resolve one to an XPath
      // ("Observed element could not be resolved"), so act() has nothing to
      // click and the agent sits on the collection page until it times out.
      // A real shopper would still get to the product, so follow the link
      // ourselves: read the hrefs and pick the closest match to the brief.
      if (!/\/products?\//i.test(url)) {
        const links = await productLinks(page);
        const target = bestMatch(links, brief);
        if (target) {
          agentLog.debug(`${agentId} could not click through, following a link`, {
            of: links.length,
            to: short(target),
          });
          await page.goto(target);
          url = await page.url();
        }
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
        observeAndAct(
          sh,
          `Choose the size, colour or variant that matches this shopper: ${brief}`,
        ),
      ))
    ) {
      return;
    }

    // 5 · cart — confirmed by the cart itself, not by the model's say-so.
    if (
      !(await stage(run, agentId, 5, async () => {
        await observeAndAct(sh, "Add this product to the cart.");
        // Add-to-cart is an XHR on most stores, so the cart is not updated the
        // instant the click returns. Poll before calling it a failure.
        const count = await settledCartCount(page);
        if (count === 0) {
          throw new Error("add-to-cart ran but the cart is still empty");
        }
        if (count === null) {
          // Nothing on this store reports cart state in a way we can read, so
          // there is no post-condition to check. The action succeeded; saying
          // otherwise would invent a failure, which is worse than not knowing.
          agentLog.debug(`${agentId} cart state is not observable on this store`);
        }
      }))
    ) {
      return;
    }

    // 6 · checkout — reaching it is the pass. No payment details, ever.
    await stage(run, agentId, 6, async () => {
      const from = await page.url();
      await observeAndAct(
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
 * Observe, then act on what was observed.
 *
 * This is Stagehand's recommended pattern and it matters here. Passing a
 * natural-language string to `act()` re-runs inference to locate the element,
 * which fails on listings where the model can describe every product but
 * cannot resolve one to an XPath — `act()` then returns "no actionable
 * element" while `observe()` on the same page returns twenty. Replaying an
 * observed Action skips inference entirely and is deterministic.
 *
 * Insists something actually happened: `act()` resolves happily with an empty
 * action list, and treating that as success is how an agent "selects" a
 * variant that does not exist.
 */
async function observeAndAct(sh: Stagehand, instruction: string): Promise<void> {
  const observed = await sh.observe(instruction);
  const candidates = observed.data ?? [];
  // Prefer a click; otherwise take the first thing the page offered.
  const action = candidates.find((a) => a.method === "click") ?? candidates[0];

  if (!action) {
    throw new Error("nothing on the page matched that instruction");
  }

  const result = await sh.act(action);
  const data = result.data;
  if (!data?.success || data.actions.length === 0) {
    throw new Error(data?.message?.trim() || "the page did not respond to that action");
  }
}

/** Consent and newsletter overlays block everything behind them. */
async function dismissOverlays(sh: Stagehand): Promise<void> {
  try {
    await observeAndAct(
      sh,
      "Dismiss or accept the cookie consent, newsletter, or region popup covering the page.",
    );
  } catch {
    // Nothing to dismiss is the common case and not a failure.
  }
}

/**
 * Product-link count once the page has stopped adding them.
 *
 * Polls until the count stops rising, so a client-rendered listing is not
 * judged empty on the strength of one early look.
 */
async function settledProductLinkCount(
  page: { evaluate: <R>(fn: () => R) => Promise<R> },
  timeoutMs = 6000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let best = 0;
  while (Date.now() < deadline) {
    const count = await productLinkCount(page);
    if (count >= 3 && count === best) return count;
    best = Math.max(best, count);
    await sleep(700);
  }
  return best;
}

/** Every distinct product URL on the current page. */
async function productLinks(
  page: { evaluate: <R>(fn: () => R) => Promise<R> },
): Promise<string[]> {
  try {
    return await page.evaluate(() => {
      const hrefs = Array.from(
        document.querySelectorAll("a[href]"),
        (a) => (a as HTMLAnchorElement).href,
      );
      return Array.from(new Set(hrefs.filter((h) => /\/products?\//i.test(h))));
    });
  } catch {
    return [];
  }
}

/**
 * The observed candidate whose description best fits the brief.
 *
 * Deliberately not another model call: observe() has already described every
 * element, and the brief names what the shopper wants, so this is a word
 * overlap rather than a judgement. Ties fall to the first candidate.
 */
function pickCandidate<T extends { description: string; method?: string }>(
  candidates: T[],
  brief: string,
): T | undefined {
  const clickable = candidates.filter((c) => !c.method || c.method === "click");
  const pool = clickable.length > 0 ? clickable : candidates;
  if (pool.length === 0) return undefined;

  const words = briefWords(brief);
  let best = pool[0]!;
  let bestScore = -1;
  for (const candidate of pool) {
    const text = candidate.description.toLowerCase();
    let score = 0;
    for (const word of words) if (text.includes(word)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Words worth matching on: long enough to be meaningful, lowercased. */
function briefWords(brief: string): string[] {
  const STOP = new Set([
    "want", "need", "with", "that", "this", "have", "from", "would", "like",
    "about", "under", "over", "into", "them", "they", "your", "some", "just",
    "please", "looking", "something",
  ]);
  return brief
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

/**
 * The link whose slug shares the most words with the brief.
 *
 * Last resort, when nothing observed could be clicked. Skips the pages a store
 * files under /products/ that nobody shops for — shipping, vouchers, repairs —
 * so an agent does not "buy" a returns label.
 */
const NOT_SHOPPABLE = /shipping|voucher|gift-card|giftcard|repair|returns|sample|donation|deposit/i;

function bestMatch(links: string[], brief: string): string | undefined {
  if (links.length === 0) return undefined;
  const shoppable = links.filter((l) => !NOT_SHOPPABLE.test(l));
  const pool = shoppable.length > 0 ? shoppable : links;

  const words = briefWords(brief);
  let best = pool[0]!;
  let bestScore = -1;
  for (const link of pool) {
    const slug = link.toLowerCase().replace(/[^a-z0-9]/g, " ");
    let score = 0;
    for (const word of words) if (slug.includes(word)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = link;
    }
  }
  return best;
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
 * Waits for the cart to report a line.
 *
 * Returns null when this store gives us no way to read cart state at all —
 * distinct from zero, which means we looked and the cart was empty. Collapsing
 * the two turns "we cannot tell" into "add-to-cart is broken", which is how a
 * non-Shopify store gets reported as failing a stage it actually passed.
 */
async function settledCartCount(
  page: { evaluate: <R>(fn: () => R | Promise<R>) => Promise<R> },
  timeoutMs = 8000,
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  let observable = false;
  while (Date.now() < deadline) {
    const count = await cartCount(page);
    if (count !== null) {
      observable = true;
      if (count > 0) return count;
    }
    await sleep(800);
  }
  return observable ? 0 : null;
}

/**
 * Lines in the cart. Uses Shopify's /cart.js where available and falls back to
 * reading a cart-count element, so a non-Shopify store still gets a verdict.
 */
async function cartCount(
  page: { evaluate: <R>(fn: () => R | Promise<R>) => Promise<R> },
): Promise<number | null> {
  try {
    return await page.evaluate(async () => {
      // Shopify and most platforms that copy it. Absent elsewhere, and a 404
      // here says nothing about the cart.
      try {
        const res = await fetch("/cart.js", {
          headers: { accept: "application/json" },
        });
        if (res.ok) {
          const cart = (await res.json()) as { item_count?: number };
          if (typeof cart.item_count === "number") return cart.item_count;
        }
      } catch {
        // fall through
      }

      // A badge in the header, which most storefronts render whether or not
      // they expose a cart endpoint.
      const el = document.querySelector(
        "[data-cart-count], .cart-count, [class*='cart-count'], [class*='cartCount'], [id*='cart-count'], [aria-label*='cart' i] [class*='count']",
      );
      if (el) {
        const n = Number((el.textContent ?? "").replace(/\D/g, ""));
        if (Number.isFinite(n)) return n;
      }

      // null = this store does not tell us, which is not the same as empty.
      return null;
    });
  } catch {
    return null;
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
