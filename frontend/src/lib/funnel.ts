/**
 * The run funnel: how many agents survive each step from "ran" to
 * "recommended the product".
 *
 * The shape is the diagnosis — the widest drop is the step to fix first — so
 * each step also carries the dominant reason agents were lost entering it.
 */

import type { AgentRun, CheckResult } from "@contracts/check-result";

/**
 * Failures that are ours, not the brand's. An agent that timed out still
 * counts as lost, but naming a timeout as the reason a store failed would
 * point the brand at a problem it cannot fix.
 */
const INFRASTRUCTURE = new Set(["AGENT_TIMEOUT", "AGENT_ERROR"]);

export interface FunnelStep {
  key: string;
  label: string;
  /** Agents that reached this step. */
  count: number;
  /** Agents lost entering it. Always 0 for the first step. */
  lost: number;
  /** Share of the starting cohort, for the track fill. 0 when nothing ran. */
  fraction: number;
  /** Dominant failure behind the drop, in plain words. Null when nothing was lost. */
  reason: string | null;
}

/** Predicates defining who survives each step, in order. */
const STEPS: { key: string; label: string; reached: (run: AgentRun) => boolean }[] = [
  { key: "ran", label: "Agents ran", reached: () => true },
  { key: "found", label: "Found the store", reached: (r) => r.outcome.target_discovered },
  { key: "confirmed", label: "Confirmed the product", reached: (r) => r.outcome.target_identity_matched },
  { key: "recommended", label: "Recommended it", reached: (r) => r.outcome.target_recommended },
];

export function funnelSteps(source: CheckResult): FunnelStep[] {
  const runs = source.agent_runs;
  const total = runs.length;

  return STEPS.map((step, i) => {
    const reached = runs.filter(step.reached);
    const previous = i === 0 ? runs : runs.filter(STEPS[i - 1]!.reached);
    const lost = previous.filter((run) => !step.reached(run));

    return {
      key: step.key,
      label: step.label,
      count: reached.length,
      lost: lost.length,
      fraction: total === 0 ? 0 : reached.length / total,
      reason: dominantReason(lost),
    };
  });
}

/** The most frequent brand-owned failure among the lost agents, in plain words. */
function dominantReason(lost: AgentRun[]): string | null {
  const tally = new Map<string, number>();

  for (const run of lost) {
    for (const entry of run.outcome.failure_codes) {
      if (INFRASTRUCTURE.has(entry.code)) continue;
      // First-seen order is preserved by Map, which makes ties deterministic.
      tally.set(entry.code, (tally.get(entry.code) ?? 0) + 1);
    }
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [code, count] of tally) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }

  return best === null ? null : best.toLowerCase().replace(/_/g, " ");
}
