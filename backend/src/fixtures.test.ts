import { describe, expect, test } from "bun:test";
import { validateCheckResult } from "@contracts/validate";
import { validateFindings } from "@contracts/validate-findings";
import { loadExampleCheckResult, loadExampleFindings } from "./fixtures";

describe("committed fixtures", () => {
  test("the example CheckResult is valid", () => {
    expect(validateCheckResult(loadExampleCheckResult())).toEqual([]);
  });

  test("the example findings are valid against it", () => {
    const source = loadExampleCheckResult();
    expect(validateFindings(loadExampleFindings(), source)).toEqual([]);
  });

  test("the example CheckResult has the six runs the rules are written against", () => {
    const ids = loadExampleCheckResult().agent_runs.map((r) => r.run_id);
    expect(ids).toEqual(["ar_001", "ar_002", "ar_003", "ar_004", "ar_005", "ar_006"]);
  });
});
