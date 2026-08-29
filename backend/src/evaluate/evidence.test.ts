import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../fixtures";
import { evidencePerRun, type Probe } from "./evidence";

const PROBES: Probe[] = [
  { code: "NOT_IN_SITEMAP", fact: "sitemap", references: (id) => [`agent_runs#${id}.outcome.target_discovered`] },
  { code: "NOT_IN_SEARCH_RESULTS", fact: "search", references: (id) => [`agent_runs#${id}.outcome.our_pages_fetched`] },
];

describe("evidencePerRun", () => {
  test("evidences a run only with the probes it reported", () => {
    const partial = loadExampleCheckResult();
    for (const run of partial.agent_runs) {
      run.outcome.failure_codes = run.outcome.failure_codes.filter(
        (e) => e.code !== "NOT_IN_SEARCH_RESULTS",
      );
    }
    const out = evidencePerRun(partial, PROBES);
    expect(out).toHaveLength(1);
    expect(out[0].fact).toBe("sitemap");
    expect(out[0].references).toEqual(["agent_runs#ar_003.outcome.target_discovered"]);
  });

  test("combines both facts when a run reported both", () => {
    const out = evidencePerRun(loadExampleCheckResult(), PROBES);
    expect(out[0].fact).toBe("sitemap search");
    expect(out[0].references).toHaveLength(2);
  });

  test("skips runs outside the `only` set", () => {
    expect(evidencePerRun(loadExampleCheckResult(), PROBES, new Set(["ar_001"]))).toEqual([]);
  });

  test("returns nothing when no run reported any probe", () => {
    const clean = loadExampleCheckResult();
    for (const run of clean.agent_runs) run.outcome.failure_codes = [];
    expect(evidencePerRun(clean, PROBES)).toEqual([]);
  });
});
