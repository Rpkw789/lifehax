/** Shared derivations over a CheckResult. Pure; no I/O. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";

/** Whether any run reported `code`. Guards a rule against claiming it. */
export function wasReported(source: CheckResult, code: FailureCode): boolean {
  return source.agent_runs.some((run) =>
    (run.outcome?.failure_codes ?? []).some((entry) => entry.code === code),
  );
}

/** Union of run ids reporting any of `codes`, in agent_runs order, deduplicated. */
export function runIdsReporting(source: CheckResult, ...codes: FailureCode[]): string[] {
  const wanted = new Set<string>(codes);
  return source.agent_runs
    .filter((run) => (run.outcome?.failure_codes ?? []).some((entry) => wanted.has(entry.code)))
    .map((run) => run.run_id);
}

/**
 * Distinct attribute names flagged as unevidenced, in first-seen order.
 *
 * These come from the data, never from a constant — that is what keeps the
 * rule category-agnostic.
 */
export function missingAttributes(source: CheckResult): string[] {
  const seen: string[] = [];
  for (const run of source.agent_runs) {
    for (const entry of run.outcome?.failure_codes ?? []) {
      if (entry.code === "MISSING_ATTRIBUTE_EVIDENCE" && entry.attribute && !seen.includes(entry.attribute)) {
        seen.push(entry.attribute);
      }
    }
  }
  return seen;
}
