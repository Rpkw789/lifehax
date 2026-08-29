/**
 * Runtime validation for CheckResult.
 *
 * Check calls this before writing; Evaluate calls it on read. A contract drift
 * then fails loudly at the boundary instead of silently producing wrong
 * findings. Dependency-free on purpose — no schema library to keep in sync.
 */

import { ATTRIBUTE_SCOPED_CODES, FAILURE_CODES, REASON_CODES } from "./codes";
import { REPORT_TYPE, SCHEMA_VERSION, type CheckResult } from "./check-result";

export interface ValidationError {
  path: string;
  message: string;
}

/** Returns [] when valid. Never throws. */
export function validateCheckResult(doc: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  if (typeof doc !== "object" || doc === null) {
    return [{ path: "$", message: "expected an object" }];
  }
  const r = doc as CheckResult;

  if (r.report_type !== REPORT_TYPE) {
    fail("report_type", `expected "${REPORT_TYPE}", got ${JSON.stringify(r.report_type)}`);
  }
  if (majorOf(r.schema_version) !== majorOf(SCHEMA_VERSION)) {
    fail(
      "schema_version",
      `incompatible major version: document ${r.schema_version}, contract ${SCHEMA_VERSION}`,
    );
  }

  for (const key of [
    "report_id", "run_id", "generated_at", "brand", "target_product",
    "catalogue_snapshot", "site_audit", "evaluation_config", "agent_runs",
    "evidence", "scores", "hosted_sources",
  ] as const) {
    if (r[key] === undefined) fail(key, "required field missing");
  }
  if (!Array.isArray(r.agent_runs)) return errors.concat({ path: "agent_runs", message: "expected an array" });
  if (!Array.isArray(r.evidence)) return errors.concat({ path: "evidence", message: "expected an array" });

  const evidenceIds = new Set(r.evidence.map((e) => e.evidence_id));
  const queryIds = new Set((r.evaluation_config?.queries ?? []).map((q) => q.query_id));

  r.agent_runs.forEach((run, i) => {
    const at = `agent_runs[${i}]`;

    if (!queryIds.has(run.query_id)) {
      fail(`${at}.query_id`, `"${run.query_id}" is not declared in evaluation_config.queries`);
    }

    run.journey?.stages?.forEach((stage, j) => {
      stage.evidence_ids?.forEach((id) => {
        if (!evidenceIds.has(id)) {
          fail(`${at}.journey.stages[${j}].evidence_ids`, `dangling evidence id "${id}"`);
        }
      });
    });

    const o = run.outcome;
    if (!o) {
      fail(`${at}.outcome`, "required field missing");
      return;
    }

    // Semantic invariants. These are the ones that actually catch integration bugs.
    if (o.target_recommended && o.target_rank === null) {
      fail(`${at}.outcome`, "target_recommended is true but target_rank is null");
    }
    if (!o.target_recommended && o.target_rank !== null) {
      fail(`${at}.outcome`, "target_rank is set but target_recommended is false");
    }
    if (o.target_recommended && !o.target_discovered) {
      fail(`${at}.outcome`, "recommended without being discovered");
    }
    if (o.target_identity_matched && !o.target_discovered) {
      fail(`${at}.outcome`, "identity matched without being discovered");
    }
    if (o.target_rank !== null && o.target_rank < 1) {
      fail(`${at}.outcome.target_rank`, "rank is 1-indexed");
    }
    if (o.top_3 !== (o.target_rank !== null && o.target_rank <= 3)) {
      fail(`${at}.outcome.top_3`, "does not agree with target_rank");
    }
    if (o.confidence < 0 || o.confidence > 1) {
      fail(`${at}.outcome.confidence`, "expected 0..1");
    }
    if (!o.target_recommended && (o.failure_codes ?? []).length === 0) {
      fail(`${at}.outcome.failure_codes`, "a non-recommendation must carry at least one failure code");
    }

    checkCodes(o.failure_codes ?? [], FAILURE_CODES, `${at}.outcome.failure_codes`, fail);

    const ranks = (run.ranked_candidates ?? []).map((c) => c.rank);
    if (new Set(ranks).size !== ranks.length) {
      fail(`${at}.ranked_candidates`, "duplicate rank values");
    }
    run.ranked_candidates?.forEach((c, j) => {
      checkCodes(c.reason_codes ?? [], REASON_CODES, `${at}.ranked_candidates[${j}].reason_codes`, fail);
    });

    const targetEntry = run.ranked_candidates?.find((c) => c.is_target_product);
    if (targetEntry && targetEntry.rank !== o.target_rank) {
      fail(`${at}.ranked_candidates`, "target candidate rank disagrees with outcome.target_rank");
    }
  });

  // Scores must be derivable from the runs, not asserted independently.
  const total = r.agent_runs.length;
  if (total > 0 && r.scores) {
    const recommended = r.agent_runs.filter((x) => x.outcome?.target_recommended).length;
    const discovered = r.agent_runs.filter((x) => x.outcome?.target_discovered).length;
    approx(r.scores.hit_rate, recommended / total, "scores.hit_rate", fail);
    approx(r.scores.discovery_rate, discovered / total, "scores.discovery_rate", fail);
  }

  return errors;
}

export function assertCheckResult(doc: unknown): asserts doc is CheckResult {
  const errors = validateCheckResult(doc);
  if (errors.length > 0) {
    const lines = errors.map((e) => `  ${e.path}: ${e.message}`).join("\n");
    throw new Error(`CheckResult failed validation:\n${lines}`);
  }
}

function checkCodes(
  entries: { code: string; attribute?: string }[],
  registry: readonly string[],
  path: string,
  fail: (path: string, message: string) => void,
): void {
  entries.forEach((entry, i) => {
    if (!registry.includes(entry.code)) {
      fail(`${path}[${i}]`, `unknown code "${entry.code}"`);
    }
    if (ATTRIBUTE_SCOPED_CODES.includes(entry.code) && !entry.attribute) {
      fail(`${path}[${i}]`, `"${entry.code}" requires an attribute`);
    }
  });
}

function approx(
  actual: number,
  expected: number,
  path: string,
  fail: (path: string, message: string) => void,
): void {
  if (Math.abs(actual - expected) > 0.001) {
    fail(path, `expected ${expected.toFixed(3)} from agent_runs, got ${actual}`);
  }
}

function majorOf(version: string): string {
  return String(version ?? "").split(".")[0] ?? "";
}
