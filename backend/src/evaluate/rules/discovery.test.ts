import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../../fixtures";
import { resolvePath } from "@contracts/validate-findings";
import { discoverySourcesRule } from "./discovery";

const source = loadExampleCheckResult();

describe("discovery.sources", () => {
  test("fires for the run that never retrieved the product", () => {
    const finding = discoverySourcesRule.evaluate(source);
    expect(finding).not.toBeNull();
    expect(finding!.derived_from).toEqual(["ar_003"]);
  });

  test("claims exactly the discovery codes that were observed", () => {
    const finding = discoverySourcesRule.evaluate(source)!;
    expect(finding.addresses_failure_codes.sort()).toEqual(["NOT_IN_SEARCH_RESULTS", "NOT_IN_SITEMAP"]);
  });

  test("every evidence reference resolves against the source", () => {
    const finding = discoverySourcesRule.evaluate(source)!;
    expect(finding.evidence.length).toBeGreaterThan(0);
    for (const entry of finding.evidence) {
      for (const ref of entry.references) {
        expect(resolvePath(source, ref)).toBeDefined();
      }
    }
  });

  test("carries a non-empty snippet", () => {
    expect(discoverySourcesRule.evaluate(source)!.recommendation.snippet.length).toBeGreaterThan(0);
  });

  test("returns null when no discovery code was reported", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "NOT_IN_SITEMAP" && e.code !== "NOT_IN_SEARCH_RESULTS",
      );
    }
    expect(discoverySourcesRule.evaluate(clean)).toBeNull();
  });
});
