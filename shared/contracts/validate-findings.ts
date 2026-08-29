/**
 * Validates Evaluate's output against the CheckResult it was derived from.
 *
 * The point is the reference resolver: a finding's `references` are paths into
 * the source document, and this actually walks them. A path that does not
 * resolve is a finding citing evidence that is not there — which is precisely
 * the failure mode this product exists to replace.
 */

import { FAILURE_CODES } from "./codes";
import type { CheckResult } from "./check-result";
import type { Finding } from "./finding";
import type { ValidationError } from "./validate";

const SEVERITIES = ["critical", "high", "medium"];
const SURFACES = ["discoverability", "structured_data", "agent_protocol", "content_quality"];
const EFFORTS = ["low", "medium", "high"];
const OWNERS = ["web", "seo", "platform", "checkout", "content"];

const STORE_LEVEL_ROOTS = ["site_audit", "catalogue_snapshot"];

/** Returns [] when valid. Never throws. */
export function validateFindings(findings: unknown, source: CheckResult): ValidationError[] {
  const errors: ValidationError[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  if (!Array.isArray(findings)) {
    return [{ path: "$", message: "expected an array of findings" }];
  }

  const runIds = new Set((source.agent_runs ?? []).map((r) => r.run_id));
  const observedCodes = collectObservedCodes(source);
  const seenIds = new Set<string>();

  (findings as Finding[]).forEach((f, i) => {
    const at = `findings[${i}]`;

    if (!f.finding_id) fail(`${at}.finding_id`, "required");
    else if (seenIds.has(f.finding_id)) fail(`${at}.finding_id`, `duplicate id "${f.finding_id}"`);
    else seenIds.add(f.finding_id);

    if (!SEVERITIES.includes(f.severity)) fail(`${at}.severity`, `expected one of ${SEVERITIES.join(", ")}`);
    if (!f.title) fail(`${at}.title`, "required");

    // Rejects fields the contract deliberately derives rather than stores.
    for (const derived of ["priority", "shoppers_affected", "shoppersAffected"]) {
      if (derived in (f as object)) {
        fail(`${at}.${derived}`, "derived value must not be stored — it drifts from its source");
      }
    }

    // Evidence
    if (!Array.isArray(f.evidence) || f.evidence.length === 0) {
      fail(`${at}.evidence`, "must cite at least one observation");
    } else {
      f.evidence.forEach((e, j) => {
        const eAt = `${at}.evidence[${j}]`;
        if (!e.fact) fail(`${eAt}.fact`, "required");
        if (e.agent_run_id !== null && !runIds.has(e.agent_run_id)) {
          fail(`${eAt}.agent_run_id`, `"${e.agent_run_id}" is not an agent_run in this report`);
        }
        if (!Array.isArray(e.references) || e.references.length === 0) {
          fail(`${eAt}.references`, "must reference at least one path in the CheckResult");
        } else {
          e.references.forEach((ref) => {
            if (resolvePath(source, ref) === MISSING) {
              fail(`${eAt}.references`, `path does not resolve: "${ref}"`);
            }
          });
        }
      });
    }

    // derived_from
    if (!Array.isArray(f.derived_from)) {
      fail(`${at}.derived_from`, "required");
    } else {
      f.derived_from.forEach((id) => {
        if (!runIds.has(id)) fail(`${at}.derived_from`, `unknown agent_run id "${id}"`);
      });
      if (f.derived_from.length === 0 && !isStoreLevel(f)) {
        fail(
          `${at}.derived_from`,
          "empty derived_from is only allowed when every reference is store-level (site_audit / catalogue_snapshot)",
        );
      }
    }

    // addresses_failure_codes — the link that makes impact computable
    if (!Array.isArray(f.addresses_failure_codes) || f.addresses_failure_codes.length === 0) {
      fail(`${at}.addresses_failure_codes`, "must name at least one observed failure code");
    } else {
      const scope = f.derived_from?.length ? new Set(f.derived_from) : runIds;
      f.addresses_failure_codes.forEach((code) => {
        if (!FAILURE_CODES.includes(code)) {
          fail(`${at}.addresses_failure_codes`, `unknown code "${code}"`);
          return;
        }
        const carriers = observedCodes.get(code);
        if (!carriers || carriers.size === 0) {
          fail(`${at}.addresses_failure_codes`, `"${code}" was never observed in this run`);
        } else if (![...carriers].some((runId) => scope.has(runId))) {
          fail(
            `${at}.addresses_failure_codes`,
            `"${code}" was not observed in any run listed in derived_from`,
          );
        }
      });
    }

    // Recommendation
    const rec = f.recommendation;
    if (!rec) {
      fail(`${at}.recommendation`, "required");
    } else {
      if (!rec.action) fail(`${at}.recommendation.action`, "required");
      if (!SURFACES.includes(rec.surface)) fail(`${at}.recommendation.surface`, `expected one of ${SURFACES.join(", ")}`);
      if (!EFFORTS.includes(rec.effort)) fail(`${at}.recommendation.effort`, `expected one of ${EFFORTS.join(", ")}`);
      if (!OWNERS.includes(rec.owner)) fail(`${at}.recommendation.owner`, `expected one of ${OWNERS.join(", ")}`);
      if (!rec.snippet_label) fail(`${at}.recommendation.snippet_label`, "required");
      if (!rec.snippet) fail(`${at}.recommendation.snippet`, "required — Recommend renders it");
    }
  });

  return errors;
}

export function assertFindings(findings: unknown, source: CheckResult): asserts findings is Finding[] {
  const errors = validateFindings(findings, source);
  if (errors.length > 0) {
    const lines = errors.map((e) => `  ${e.path}: ${e.message}`).join("\n");
    throw new Error(`Findings failed validation:\n${lines}`);
  }
}

const MISSING = Symbol("missing");

/**
 * Resolves a reference path against the document.
 *
 * Supports dotted keys, `[n]` array indices, and `#id` lookup that matches an
 * array element by its `*_id` field — so `agent_runs#ar_003` works without
 * anyone hardcoding an index that shifts when a run is added.
 */
export function resolvePath(root: unknown, path: string): unknown {
  const tokens = path.match(/[^.[\]#]+|\[\d+\]|#[^.[\]]+/g);
  if (!tokens) return MISSING;

  let current: unknown = root;
  for (const raw of tokens) {
    if (current === null || current === undefined) return MISSING;

    if (raw.startsWith("[")) {
      const index = Number(raw.slice(1, -1));
      if (!Array.isArray(current) || index >= current.length) return MISSING;
      current = current[index];
      continue;
    }

    if (raw.startsWith("#")) {
      const wanted = raw.slice(1);
      if (!Array.isArray(current)) return MISSING;
      const hit = current.find(
        (item) =>
          item &&
          typeof item === "object" &&
          Object.entries(item).some(([k, v]) => k.endsWith("_id") && v === wanted),
      );
      if (hit === undefined) return MISSING;
      current = hit;
      continue;
    }

    if (typeof current !== "object") return MISSING;
    if (!(raw in (current as Record<string, unknown>))) return MISSING;
    current = (current as Record<string, unknown>)[raw];
  }
  return current;
}

function isStoreLevel(f: Finding): boolean {
  const refs = (f.evidence ?? []).flatMap((e) => e.references ?? []);
  return refs.length > 0 && refs.every((r) => STORE_LEVEL_ROOTS.some((root) => r.startsWith(root)));
}

/** code -> set of run_ids that reported it. */
function collectObservedCodes(source: CheckResult): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const run of source.agent_runs ?? []) {
    for (const entry of run.outcome?.failure_codes ?? []) {
      if (!map.has(entry.code)) map.set(entry.code, new Set());
      map.get(entry.code)!.add(run.run_id);
    }
  }
  return map;
}
