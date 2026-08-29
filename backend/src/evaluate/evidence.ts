/**
 * Per-run evidence construction.
 *
 * A run is evidenced only by the observations it actually reported. Citing an
 * observation a run never made is the guesswork this product replaces, so the
 * invariant lives here rather than being re-derived in every rule.
 */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import type { FindingEvidence } from "@contracts/finding";

/** One observable failure: its code, the sentence stating it, and the paths backing it. */
export interface Probe {
  code: FailureCode;
  fact: string;
  references: (runId: string) => string[];
}

/**
 * One entry per run, carrying only the probes that run reported.
 * `only`, when given, restricts output to those run ids.
 */
export function evidencePerRun(
  source: CheckResult,
  probes: Probe[],
  only?: Set<string>,
): FindingEvidence[] {
  const out: FindingEvidence[] = [];

  for (const run of source.agent_runs) {
    if (only && !only.has(run.run_id)) continue;

    const reported = new Set((run.outcome?.failure_codes ?? []).map((entry) => entry.code));
    const matched = probes.filter((probe) => reported.has(probe.code));
    if (matched.length === 0) continue;

    out.push({
      agent_run_id: run.run_id,
      // Distinct facts only — two probes may share a sentence.
      fact: [...new Set(matched.map((probe) => probe.fact))].join(" "),
      references: matched.flatMap((probe) => probe.references(run.run_id)),
    });
  }

  return out;
}
