import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../../fixtures";
import { resolvePath } from "@contracts/validate-findings";
import { structuredOfferRule } from "./structured";

const source = loadExampleCheckResult();

describe("structured.offer", () => {
  test("fires for the run that read the page and found no price", () => {
    const finding = structuredOfferRule.evaluate(source)!;
    expect(finding.derived_from).toEqual(["ar_005"]);
    expect(finding.severity).toBe("high");
  });

  test("claims both structured-data codes", () => {
    expect(structuredOfferRule.evaluate(source)!.addresses_failure_codes.sort()).toEqual([
      "NO_OFFER_SCHEMA",
      "PRICE_CLIENT_SIDE_ONLY",
    ]);
  });

  test("every evidence reference resolves", () => {
    for (const entry of structuredOfferRule.evaluate(source)!.evidence) {
      for (const ref of entry.references) expect(resolvePath(source, ref)).toBeDefined();
    }
  });

  test("its snippet carries the brand's real price", () => {
    expect(structuredOfferRule.evaluate(source)!.recommendation.snippet).toContain("129.99");
  });

  test("returns null when neither code was reported", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "NO_OFFER_SCHEMA" && e.code !== "PRICE_CLIENT_SIDE_ONLY",
      );
    }
    expect(structuredOfferRule.evaluate(clean)).toBeNull();
  });

  test("claims only the structured-data codes actually observed", () => {
    const partial = loadExampleCheckResult();
    for (const run of partial.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "NO_OFFER_SCHEMA",
      );
    }
    const finding = structuredOfferRule.evaluate(partial)!;
    expect(finding.addresses_failure_codes).toEqual(["PRICE_CLIENT_SIDE_ONLY"]);
  });

  test("evidences a run only with the failures it actually reported", () => {
    const partial = loadExampleCheckResult();
    for (const run of partial.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "PRICE_CLIENT_SIDE_ONLY",
      );
    }
    const finding = structuredOfferRule.evaluate(partial)!;
    const perRun = finding.evidence.filter((e) => e.agent_run_id !== null);
    for (const entry of perRun) {
      expect(entry.fact).not.toContain("hydration");
      expect(entry.references).not.toContain("site_audit.client_side_price_product_ids");
    }
  });
});
