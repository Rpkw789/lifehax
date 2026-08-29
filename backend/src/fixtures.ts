/**
 * Loaders for the committed example documents.
 *
 * Evaluate is built against these rather than a live Check run, which is what
 * lets this workstream reach completion before Check exists.
 */

import type { CheckResult } from "@contracts/check-result";
import type { Finding } from "@contracts/finding";

import checkResult from "@fixtures/check-result.example.json";
import findings from "@fixtures/findings.example.json";

export function loadExampleCheckResult(): CheckResult {
  return structuredClone(checkResult) as unknown as CheckResult;
}

export function loadExampleFindings(): Finding[] {
  return structuredClone(findings) as unknown as Finding[];
}
