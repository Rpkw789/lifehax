import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../../fixtures";
import { resolvePath } from "@contracts/validate-findings";
import { protocolLlmsTxtRule, protocolManifestRule } from "./protocol";

const source = loadExampleCheckResult();

describe("protocol.manifest", () => {
  test("unions the runs that hit either protocol", () => {
    expect(protocolManifestRule.evaluate(source)!.derived_from).toEqual(["ar_001", "ar_004"]);
  });

  test("claims both protocol codes and rates the gap critical", () => {
    const finding = protocolManifestRule.evaluate(source)!;
    expect(finding.addresses_failure_codes.sort()).toEqual(["ACP_UNSUPPORTED", "UCP_UNSUPPORTED"]);
    expect(finding.severity).toBe("critical");
  });

  test("every evidence reference resolves", () => {
    for (const entry of protocolManifestRule.evaluate(source)!.evidence) {
      for (const ref of entry.references) expect(resolvePath(source, ref)).toBeDefined();
    }
  });

  test("returns null when both manifests are present", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "ACP_UNSUPPORTED" && e.code !== "UCP_UNSUPPORTED",
      );
    }
    expect(protocolManifestRule.evaluate(clean)).toBeNull();
  });

  test("claims only the protocol codes actually observed, not both by default", () => {
    const partial = loadExampleCheckResult();
    for (const run of partial.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "UCP_UNSUPPORTED",
      );
    }
    const finding = protocolManifestRule.evaluate(partial)!;
    expect(finding.addresses_failure_codes).toEqual(["ACP_UNSUPPORTED"]);
    expect(finding.derived_from).toEqual(["ar_001"]);
  });
});

describe("protocol.llms_txt", () => {
  test("fires for the run that found no llms.txt", () => {
    const finding = protocolLlmsTxtRule.evaluate(source)!;
    expect(finding.derived_from).toEqual(["ar_004"]);
    expect(finding.addresses_failure_codes).toEqual(["NO_LLMS_TXT"]);
    expect(finding.severity).toBe("medium");
  });

  test("names the brand in its snippet", () => {
    expect(protocolLlmsTxtRule.evaluate(source)!.recommendation.snippet).toContain("Acme");
  });

  test("returns null when llms.txt was never flagged", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter((e) => e.code !== "NO_LLMS_TXT");
    }
    expect(protocolLlmsTxtRule.evaluate(clean)).toBeNull();
  });
});
