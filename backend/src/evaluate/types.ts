/**
 * The rule contract.
 *
 * A rule is a pure function of the CheckResult. It has no I/O, makes no model
 * call, and does not know its own priority — ids and ordering are assigned by
 * the orchestrator from rank, because priority is array order and stored
 * copies of derived values drift.
 */

import type { CheckResult } from "@contracts/check-result";
import type { Finding } from "@contracts/finding";

/** A finding before the orchestrator assigns its id from rank order. */
export type DraftFinding = Omit<Finding, "finding_id">;

export interface Rule {
  /** Stable identifier, also the deterministic tie-break in ranking. */
  readonly id: string;
  /** Returns null when this rule found nothing to say about the run. */
  evaluate(source: CheckResult): DraftFinding | null;
}
