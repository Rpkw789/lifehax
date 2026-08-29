import { describe, expect, test } from "bun:test";
import type { CheckResult } from "@contracts/check-result";
import checkResult from "@fixtures/check-result.example.json";
import { funnelSteps } from "./funnel";

const source = checkResult as unknown as CheckResult;

describe("funnelSteps", () => {
  test("narrows from every agent to the ones that recommended the product", () => {
    expect(funnelSteps(source).map((s) => s.count)).toEqual([6, 4, 3, 2]);
  });

  test("reports how many agents were lost entering each step", () => {
    expect(funnelSteps(source).map((s) => s.lost)).toEqual([0, 2, 1, 1]);
  });

  test("names the dominant reason for each drop, and none for the first step", () => {
    const [ran, found, confirmed, recommended] = funnelSteps(source);
    expect(ran!.reason).toBeNull();
    expect(found!.reason).toBe("not in search results");
    expect(confirmed!.reason).toBe("price client side only");
    expect(recommended!.reason).toBe("shipping info not found");
  });

  test("ignores infrastructure failures when naming a reason, but still counts the agent as lost", () => {
    // ar_006 reported only AGENT_TIMEOUT. It is lost at the discovery step, but
    // a timeout is our problem, not the brand's, so it must not be the reason.
    const found = funnelSteps(source)[1]!;
    expect(found.lost).toBe(2);
    expect(found.reason).not.toContain("timeout");
  });

  test("carries a fraction of the starting cohort for the track fill", () => {
    expect(funnelSteps(source).map((s) => s.fraction)).toEqual([1, 4 / 6, 3 / 6, 2 / 6]);
  });

  test("survives a run where no agent found anything", () => {
    const blind = structuredClone(source);
    for (const run of blind.agent_runs) {
      run.outcome.target_discovered = false;
      run.outcome.target_identity_matched = false;
      run.outcome.target_recommended = false;
    }
    expect(funnelSteps(blind).map((s) => s.count)).toEqual([6, 0, 0, 0]);
  });

  test("returns zeroed steps rather than dividing by zero when there are no runs", () => {
    const empty = structuredClone(source);
    empty.agent_runs = [];
    expect(funnelSteps(empty).map((s) => s.fraction)).toEqual([0, 0, 0, 0]);
  });
});
