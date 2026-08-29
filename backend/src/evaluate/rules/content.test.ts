import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../../fixtures";
import { resolvePath } from "@contracts/validate-findings";
import { contentAttributesRule, contentShippingRule } from "./content";

const source = loadExampleCheckResult();

describe("content.attributes", () => {
  test("unions every run that flagged an unevidenced attribute", () => {
    expect(contentAttributesRule.evaluate(source)!.derived_from).toEqual(["ar_001", "ar_005"]);
  });

  test("takes attribute names from the data, not from a constant", () => {
    const withDifferentAttribute = loadExampleCheckResult();
    for (const run of withDifferentAttribute.agent_runs) {
      for (const entry of run.outcome.failure_codes) {
        if (entry.code === "MISSING_ATTRIBUTE_EVIDENCE") entry.attribute = "fragrance_free";
      }
    }
    const snippet = contentAttributesRule.evaluate(withDifferentAttribute)!.recommendation.snippet;
    expect(snippet).toContain("fragrance_free");
    expect(snippet).not.toContain("waterproof");
  });

  test("every evidence reference resolves", () => {
    for (const entry of contentAttributesRule.evaluate(source)!.evidence) {
      for (const ref of entry.references) expect(resolvePath(source, ref)).toBeDefined();
    }
  });

  test("returns null when no attribute was flagged", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "MISSING_ATTRIBUTE_EVIDENCE",
      );
    }
    expect(contentAttributesRule.evaluate(clean)).toBeNull();
  });
});

describe("content.shipping", () => {
  test("fires for the shipping-sensitive run that chose a competitor", () => {
    const finding = contentShippingRule.evaluate(source)!;
    expect(finding.derived_from).toEqual(["ar_002"]);
    expect(finding.severity).toBe("medium");
  });

  test("claims only codes that run actually reported", () => {
    expect(contentShippingRule.evaluate(source)!.addresses_failure_codes.sort()).toEqual([
      "OUTRANKED_BY_COMPETITOR",
      "SHIPPING_INFO_NOT_FOUND",
    ]);
  });

  test("returns null when shipping was never the problem", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "SHIPPING_INFO_NOT_FOUND",
      );
    }
    expect(contentShippingRule.evaluate(clean)).toBeNull();
  });

  test("claims only the codes the cited runs actually reported", () => {
    const partial = loadExampleCheckResult();
    for (const run of partial.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "OUTRANKED_BY_COMPETITOR",
      );
    }
    const finding = contentShippingRule.evaluate(partial)!;
    expect(finding.addresses_failure_codes).toEqual(["SHIPPING_INFO_NOT_FOUND"]);
  });

  test("every evidence reference resolves", () => {
    for (const entry of contentShippingRule.evaluate(source)!.evidence) {
      for (const ref of entry.references) expect(resolvePath(source, ref)).toBeDefined();
    }
  });

  test("evidences a run only with the failures it actually reported", () => {
    const partial = loadExampleCheckResult();
    for (const run of partial.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "OUTRANKED_BY_COMPETITOR",
      );
    }
    const finding = contentShippingRule.evaluate(partial)!;
    for (const entry of finding.evidence) {
      expect(entry.fact).not.toContain("competitor");
      expect(entry.references.some((r) => r.endsWith("ranked_candidates"))).toBe(false);
    }
  });
});
