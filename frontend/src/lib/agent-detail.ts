/**
 * Derivations for one agent's own page.
 *
 * Check shows the population; this shows a single shopper. The folding is the
 * same idea as `simulation.ts` — pure functions over the buffered `AgentEvent`s
 * — but at a finer grain: where a tile needs "how far has it got", this page
 * needs the state of every stage, when each landed, and why the run stopped.
 *
 * `MOCK_EVENTS` at the bottom exists so a deep link into an agent's page shows
 * the screen rather than an empty shell. It is the only thing here that is not
 * measured, and callers are expected to say so in the UI.
 */

import { STAGES, STAGE_ACTIONS, STAGE_PASS_LOGS } from "./fixtures";
import type { AgentEvent, AgentState, StageName, StageNumber } from "./types";

export type JourneyStatus = "cleared" | "blocked" | "running" | "pending";

/** One stage on the agent's journey rail. */
export interface JourneyStep {
  stage: StageName;
  /** 1-indexed, matching `AgentEvent.stage`. */
  number: StageNumber;
  status: JourneyStatus;
  /** Tick the stage settled on. Null while it has not. */
  at: number | null;
  /** What happened, or is happening. A block carries the backend's own reason. */
  note: string;
}

/**
 * The state of all six stages for one agent.
 *
 * Events for other agents are ignored rather than assumed absent, so callers
 * can hand over the whole buffer without filtering first.
 */
export function journeyOf(agent: AgentState, events: AgentEvent[]): JourneyStep[] {
  const mine = events.filter((event) => event.agentId === agent.id);

  return STAGES.map((stage, index) => {
    const number = (index + 1) as StageNumber;
    const event = mine.find((e) => e.stage === number);

    if (event?.kind === "pass") {
      return {
        stage,
        number,
        status: "cleared",
        at: event.t,
        note: STAGE_PASS_LOGS[index] ?? "stage cleared",
      };
    }

    if (event?.kind === "fail") {
      return {
        stage,
        number,
        status: "blocked",
        at: event.t,
        note: event.reason ?? "no reason given",
      };
    }

    // Only the stage immediately after the last cleared one is in progress, and
    // only while the agent is still moving. Everything past a block is pending.
    const running = !agent.settled && !agent.blocked && number === agent.progress + 1;

    return {
      stage,
      number,
      status: running ? "running" : "pending",
      at: null,
      note: running ? (STAGE_ACTIONS[index] ?? "working") : "queued",
    };
  });
}

export interface Outcome {
  headline: string;
  /**
   * Read inverted, like everything else on this run. "ok" is the storefront
   * doing its job — an agent it stopped; "fail" is a bot that walked to
   * checkout with nothing in its way.
   */
  tone: "ok" | "fail" | "muted";
}

/** The headline this agent's run earned, in the console's own voice. */
export function outcomeOf(agent: AgentState): Outcome {
  if (agent.blocked) {
    return {
      headline: `stopped at ${STAGES[agent.fail - 1]} — ${agent.reason ?? "no reason given"}`,
      tone: "ok",
    };
  }
  if (agent.ok) {
    return {
      headline: "reached checkout unchallenged · no payment details entered",
      tone: "fail",
    };
  }
  if (agent.progress === 0) {
    return { headline: "waiting for a browser session", tone: "muted" };
  }
  return { headline: `in flight · ${STAGES[agent.progress]}`, tone: "muted" };
}

export interface Stop {
  /** The status itself, short enough for a chip: "stopped at cart". */
  label: string;
  /** What was observed — the backend's reason, or the state it is still in. */
  detail: string;
  tone: "ok" | "fail" | "muted";
}

/**
 * The same state `outcomeOf` phrases as one line, split in two.
 *
 * The personas screen shows the status and the reason in different places —
 * a chip beside the agent id and a footnote under its brief — so it needs the
 * halves rather than the sentence.
 */
export function stopOf(agent: AgentState): Stop {
  if (agent.blocked) {
    return {
      label: `stopped at ${STAGES[agent.fail - 1]}`,
      detail: agent.reason ?? "no reason given",
      tone: "ok",
    };
  }
  if (agent.ok) {
    return {
      label: "through unchallenged",
      detail: "no payment details entered",
      tone: "fail",
    };
  }
  if (agent.progress === 0) {
    return { label: "waiting", detail: "no browser session yet", tone: "muted" };
  }
  return {
    label: "in flight",
    detail: `working through ${STAGES[agent.progress]}`,
    tone: "muted",
  };
}

/** The agents either side of this one, for the prev/next control. */
export function neighbours(
  ids: readonly string[],
  id: string,
): { prev: string | null; next: string | null } {
  const index = ids.indexOf(id);
  if (index === -1) return { prev: null, next: null };
  return { prev: ids[index - 1] ?? null, next: ids[index + 1] ?? null };
}

/** How far one mock agent gets. `fail` is the stage it could not enter. */
export interface MockPlan {
  id: string;
  fail: 0 | StageNumber;
  reason?: string;
}

/**
 * The stand-in population.
 *
 * Reasons are the store-level failures this product actually diagnoses, phrased
 * the way the backend phrases them — and, like everything else in the frontend,
 * they name no product category.
 */
export const MOCK_PLANS: readonly MockPlan[] = [
  { id: "A01", fail: 0 },
  { id: "A02", fail: 5, reason: "add-to-cart is a JS-only widget" },
  { id: "A03", fail: 0 },
  { id: "A04", fail: 3, reason: "price only appears after JavaScript runs" },
  { id: "A05", fail: 1, reason: "absent from the sitemap and from every result set" },
  { id: "A06", fail: 3, reason: "specs live only inside product images" },
  { id: "A07", fail: 0 },
  { id: "A08", fail: 6, reason: "checkout requires an account before totals are shown" },
  { id: "A09", fail: 4, reason: "variants are not addressable by URL" },
  { id: "A10", fail: 2, reason: "storefront returned 403 to a non-browser client" },
];

/**
 * Events a plan would have produced. Each agent is offset by its seat so the
 * population interleaves instead of moving in lockstep.
 */
export function mockEvents(plans: readonly MockPlan[]): AgentEvent[] {
  const events: AgentEvent[] = [];

  plans.forEach((plan, seat) => {
    const last = plan.fail === 0 ? STAGES.length : plan.fail;
    for (let number = 1; number <= last; number++) {
      const stage = number as StageNumber;
      const t = seat * 3 + number * 9;
      events.push(
        plan.fail === number
          ? {
              t,
              agentId: plan.id,
              stage,
              kind: "fail",
              reason: plan.reason ?? "no reason given",
            }
          : { t, agentId: plan.id, stage, kind: "pass" },
      );
    }
  });

  return events.sort((a, b) => a.t - b.t);
}

/** The buffer a page falls back to when no run has streamed anything. */
export const MOCK_EVENTS: readonly AgentEvent[] = mockEvents(MOCK_PLANS);
