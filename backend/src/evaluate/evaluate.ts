/**
 * Evaluate: CheckResult in, ranked Finding[] out.
 *
 * The final assert is deliberate. A finding whose references do not resolve, or
 * that claims a code the run never reported, is exactly the guesswork this
 * product replaces — better to fail loudly here than to render it.
 */

import type { CheckResult } from "@contracts/check-result";
import type { Finding } from "@contracts/finding";
import { assertFindings } from "@contracts/validate-findings";
import { rankDrafts, type RankedDraft } from "./rank";
import { RULES } from "./rules";

export function evaluate(source: CheckResult): Finding[] {
  const drafts: RankedDraft[] = [];

  for (const rule of RULES) {
    const draft = rule.evaluate(source);
    if (draft) drafts.push({ rule, draft });
  }

  const findings = rankDrafts(drafts);
  assertFindings(findings, source);
  return findings;
}
