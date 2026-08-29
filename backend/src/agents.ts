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
import { emitAgentEvent } from "./store";
import type { Catalogue, Checks, Persona, Run, StageNumber } from "./types";

const REAL_AGENT_COUNT = Number(process.env.HAPPY2_REAL_AGENTS ?? 3);
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
  const realIndices = pickRealAgents(personas.length);
  agentLog.info("population starting", {
    real: realIndices.map((i) => AGENT_IDS[i]).join(","),
    scripted: 10 - realIndices.length,
  });

  const blockers = blockersFrom(checks);
  agentLog.info("blockers observed in the audit", {
    count: blockers.length,
    stages: blockers.map((b) => b.stage).join(",") || "none",
  });
  const scripted = AGENT_IDS.map((_, i) => i)
    .filter((i) => !realIndices.includes(i))
    .map((i) => runScriptedAgent(run, i, checks, blockers));

  const real = realIndices.map((i) =>
    runRealAgent(run, i, catalogue, personas[personaIndexOf(i)]!),
  );

  const startedAt = Date.now();
  await Promise.allSettled([...scripted, ...real]);
  agentLog.info("population settled", { ms: since(startedAt) });
}

/** Spread the real agents across different briefs so the tiles differ. */
function pickRealAgents(personaCount: number): number[] {
  const stride = Math.max(1, Math.floor(10 / Math.max(1, REAL_AGENT_COUNT)));
  const picked: number[] = [];
  for (let i = 0; i < 10 && picked.length < REAL_AGENT_COUNT; i += stride) {
    picked.push(i);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Real agents
// ---------------------------------------------------------------------------

async function runRealAgent(
  run: Run,
  agentIndex: number,
  catalogue: Catalogue,
  persona: Persona,
): Promise<void> {
  const agentId = AGENT_IDS[agentIndex]!;
  const apiKey = process.env.BROWSERBASE_API_KEY;

  if (!apiKey) {
    agentLog.warn(`${agentId} cannot run: BROWSERBASE_API_KEY is not set`);
    emitAgentEvent(run, agentId, 1, "fail", "BROWSERBASE_API_KEY is not set");
    return;
  }

  const target = catalogue.products[agentIndex % Math.max(1, catalogue.products.length)];
  if (!target) {
    emitAgentEvent(run, agentId, 1, "fail", "no product pages were discoverable");
    return;
  }

  // Stage 1 is discovery, which the catalogue snapshot already proved.
  emitAgentEvent(run, agentId, 1, "pass");

  let browser: Awaited<ReturnType<typeof browserbase.launch>> | null = null;
  let stagehand: Stagehand | null = null;

  try {
    const launchedAt = Date.now();
    browser = await browserbase.launch({ apiKey });
    stagehand = await Stagehand.create({ browser });
    if (browser.sessionId) run.sessions[agentId] = browser.sessionId;
    agentLog.info(`${agentId} browser ready`, {
      ms: since(launchedAt),
      target: target.url,
      // The live session, for watching a run or debugging one after the fact.
      session: browser.sessionId
        ? `https://browserbase.com/sessions/${browser.sessionId}`
        : "none",
    });

    const [page] = await browser.context.pages();
    if (!page) throw new Error("browserbase returned no page");

    const sh = stagehand;

    // 2 · land
    if (!(await stage(run, agentId, 2, () => page.goto(target.url)))) return;

    // 3 · read — can an agent actually get the facts off this page?
    const facts = await stageValue(run, agentId, 3, async () => {
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
          `page did not yield ${!data?.title ? "a title" : "a price"} an agent could read`,
        );
      }
      return data;
    });
    if (!facts) return;

    // 4 · select
    if (
      !(await stage(run, agentId, 4, () =>
        sh.act(`Choose the option that best matches this shopper: ${persona.prompt}`),
      ))
    ) {
      return;
    }

    // 5 · cart
    if (!(await stage(run, agentId, 5, () => sh.act("Add this product to the cart")))) {
      return;
    }

    // 6 · checkout — reaching it is the pass. We never enter payment details.
    await stage(run, agentId, 6, () =>
      sh.act("Go to the checkout page. Do not enter any payment information."),
    );
  } catch (err) {
    agentLog.error(`${agentId} aborted`, err);
    emitAgentEvent(run, agentId, 2, "fail", message(err));
  } finally {
    await stagehand?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
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
