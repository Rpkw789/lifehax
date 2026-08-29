import { describe, expect, test } from "bun:test";
import { validateFindings } from "@contracts/validate-findings";
import { loadExampleCheckResult, loadExampleFindings } from "../fixtures";
import { evaluate } from "./evaluate";

const source = loadExampleCheckResult();

describe("evaluate", () => {
  test("its output passes the shared validator", () => {
    expect(validateFindings(evaluate(source), source)).toEqual([]);
  });

  test("reproduces the golden fixture's ids, order, severities and codes", () => {
    const actual = evaluate(source);
    const expected = loadExampleFindings();

    expect(actual.map((f) => f.finding_id)).toEqual(expected.map((f) => f.finding_id));
    expect(actual.map((f) => f.severity)).toEqual(expected.map((f) => f.severity));
    expect(actual.map((f) => f.derived_from)).toEqual(expected.map((f) => f.derived_from));
    expect(actual.map((f) => [...f.addresses_failure_codes].sort())).toEqual(
      expected.map((f) => [...f.addresses_failure_codes].sort()),
    );
    expect(actual.map((f) => f.recommendation.surface)).toEqual(
      expected.map((f) => f.recommendation.surface),
    );
  });

  test("emits no finding for an infrastructure-only failure", () => {
    // ar_006 reported only AGENT_TIMEOUT. No finding may cite it.
    for (const finding of evaluate(source)) {
      expect(finding.derived_from).not.toContain("ar_006");
      expect(finding.addresses_failure_codes).not.toContain("AGENT_TIMEOUT");
    }
  });

  test("returns an empty array when nothing failed", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) run.outcome.failure_codes = [];
    expect(evaluate(clean)).toEqual([]);
  });

  test("every finding carries a non-empty snippet", () => {
    for (const finding of evaluate(source)) {
      expect(finding.recommendation.snippet.length).toBeGreaterThan(0);
      expect(finding.recommendation.snippet_label.length).toBeGreaterThan(0);
    }
  });
});
