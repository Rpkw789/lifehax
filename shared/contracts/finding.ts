/**
 * Evaluate's output: a diagnosed cause, ranked by how many agent runs it
 * unblocks.
 *
 * Wire format is snake_case, matching CheckResult. A finding is only meaningful
 * if it can be traced back to something observed, so every field that makes a
 * claim is checkable against the CheckResult it came from — see
 * `validate-findings.ts`.
 */

import type { FailureCode } from "./codes";

export type Severity = "critical" | "high" | "medium";

/** Aligns with `RunScores["surfaces"]`. */
export type Surface =
  | "discoverability"
  | "structured_data"
  | "agent_protocol"
  | "content_quality";

export type Effort = "low" | "medium" | "high";

export type Owner = "web" | "seo" | "platform" | "checkout" | "content";

export interface Finding {
  finding_id: string;
  severity: Severity;
  title: string;

  /** Non-empty. What was actually observed, and where to verify it. */
  evidence: FindingEvidence[];

  /**
   * `agent_run.run_id`s this finding was derived from. May be empty only for a
   * store-level finding whose evidence comes entirely from `site_audit` or
   * `catalogue_snapshot`. Priority is array order; the count of affected runs
   * is `derived_from.length` — neither is stored, because stored duplicates of
   * derived values drift.
   */
  derived_from: string[];

  /**
   * Non-empty. Which observed failure codes this finding addresses. This is the
   * link that makes impact computable and lets a re-run verify the fix: after
   * the fix, these codes should stop appearing.
   */
  addresses_failure_codes: FailureCode[];

  recommendation: Recommendation;
}

export interface FindingEvidence {
  /** null for a store-level fact that no single run owns. */
  agent_run_id: string | null;
  /** Human-readable statement of what was observed. Display copy. */
  fact: string;
  /**
   * Paths into the CheckResult that back this fact. Non-empty, and every one
   * must resolve. Supports array indices and id lookup:
   *   site_audit.sitemap.missing_product_ids
   *   agent_runs[2].outcome.target_recommended
   *   agent_runs#ar_003.ranked_candidates
   */
  references: string[];
}

export interface Recommendation {
  /** What to do, in one imperative sentence. */
  action: string;
  surface: Surface;
  effort: Effort;
  owner: Owner;
  /** Label for the snippet shown on Recommend, e.g. "Product JSON-LD". */
  snippet_label: string;
  /** The fix, as pasteable code or config. */
  snippet: string;
}

/** Derived, never stored. */
export function shoppersAffected(finding: Finding): number {
  return finding.derived_from.length;
}

/** Derived from array order, never stored. */
export function priorityOf(findings: Finding[], findingId: string): number {
  return findings.findIndex((f) => f.finding_id === findingId) + 1;
}
