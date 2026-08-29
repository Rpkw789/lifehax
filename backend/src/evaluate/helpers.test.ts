import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../fixtures";
import { missingAttributes, runIdsReporting, wasReported } from "./helpers";

const source = loadExampleCheckResult();

describe("wasReported", () => {
  test("is true for a code some run reported", () => {
    expect(wasReported(source, "NOT_IN_SITEMAP")).toBe(true);
  });

  test("is false for a code nobody reported", () => {
    expect(wasReported(source, "ROBOTS_BLOCKED")).toBe(false);
  });
});

describe("runIdsReporting", () => {
  test("unions several codes, in agent_runs order, without duplicates", () => {
    expect(runIdsReporting(source, "ACP_UNSUPPORTED", "UCP_UNSUPPORTED")).toEqual(["ar_001", "ar_004"]);
  });

  test("does not repeat a run that reported two of the codes", () => {
    expect(runIdsReporting(source, "PRICE_CLIENT_SIDE_ONLY", "NO_OFFER_SCHEMA")).toEqual(["ar_005"]);
  });
});

describe("missingAttributes", () => {
  test("collects distinct attribute names from MISSING_ATTRIBUTE_EVIDENCE", () => {
    expect(missingAttributes(source)).toEqual(["waterproof"]);
  });
});
