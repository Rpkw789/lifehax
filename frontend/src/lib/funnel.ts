/**
 * The run funnel: how many agents survive each stage of the journey.
 *
 * The shape is the diagnosis — the widest drop is the stage to fix first — so
 * each step also carries the reason agents were blocked entering it, taken
 * from what the agents themselves reported.
 */

import { STAGES } from "./fixtures";
import type { AgentState } from "./types";

/** Row labels. The first is the whole cohort; the rest mirror STAGES in order. */
const LABELS = [
  "Agents started",
  "Discovered the store",
  "Landed on it",
  "Read the product",
  "Selected a variant",
  "Added to cart",
  "Reached checkout",
];

export interface FunnelStep {
  key: string;
  label: string;
  /** Agents that reached this step. */
  count: number;
  /** Agents lost entering it. Always 0 for the first step. */
  lost: number;
  /** Share of the starting cohort, for the track fill. 0 when nothing ran. */
  fraction: number;
  /** Why agents were blocked here, in their own words. Null when none were. */
  reason: string | null;
}

/**
 * Builds the funnel from live agent state.
 *
 * `progress` is stages cleared, so an agent reaches stage *n* when
 * `progress >= n`. Step 0 is everyone who started, which is what makes the
 * first stage's drop visible rather than implied.
 */
export function funnelFromAgents(agents: AgentState[]): FunnelStep[] {
  const total = agents.length;
  const reachedBy = (stage: number): number =>
    stage === 0 ? total : agents.filter((a) => a.progress >= stage).length;

  return LABELS.map((label, i) => {
    const count = reachedBy(i);
    const previous = reachedBy(i - 1 < 0 ? 0 : i - 1);

    return {
      key: i === 0 ? "started" : (STAGES[i - 1] ?? `stage-${i}`),
      label,
      count,
      lost: i === 0 ? 0 : Math.max(0, previous - count),
      fraction: total === 0 ? 0 : count / total,
      // An agent is blocked at the stage it could not enter, which is `fail`.
      reason: i === 0 ? null : dominantReason(agents, i),
    };
  });
}

/** The most common reason among agents that settled blocked at `stage`. */
function dominantReason(agents: AgentState[], stage: number): string | null {
  const tally = new Map<string, number>();

  for (const a of agents) {
    // Mid-run agents have not failed yet; counting them would invent a cause.
    if (!a.settled || a.fail !== stage || !a.reason) continue;
    tally.set(a.reason, (tally.get(a.reason) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [reason, count] of tally) {
    if (count > bestCount) {
      best = reason;
      bestCount = count;
    }
  }

  return best;
}
