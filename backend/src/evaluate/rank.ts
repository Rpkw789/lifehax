/**
 * Ordering and id assignment.
 *
 * Priority is array order and ids follow from it, so neither is ever stored on
 * a rule — a stored copy of a derived value drifts from its source.
 */

import type { Finding, Severity } from "@contracts/finding";
import type { DraftFinding, Rule } from "./types";

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };

export interface RankedDraft {
  rule: Rule;
  draft: DraftFinding;
}

/** Most runs unblocked first, then severity, then rule id for determinism. */
export function rankDrafts(drafts: RankedDraft[]): Finding[] {
  return [...drafts]
    .sort((a, b) => {
      const byImpact = b.draft.derived_from.length - a.draft.derived_from.length;
      if (byImpact !== 0) return byImpact;

      const bySeverity = SEVERITY_ORDER[a.draft.severity] - SEVERITY_ORDER[b.draft.severity];
      if (bySeverity !== 0) return bySeverity;

      return a.rule.id.localeCompare(b.rule.id);
    })
    .map((entry, index) => ({
      finding_id: `F${String(index + 1).padStart(3, "0")}`,
      ...entry.draft,
    }));
}
