import { describe, expect, test } from "bun:test";
import { ARCHETYPE_PERSONAS } from "./fixtures";
import { funnelFromAgents } from "./funnel";
import type { AgentState, StageNumber } from "./types";

/** An agent that cleared `progress` stages, optionally blocked at `fail`. */
function agent(id: string, progress: number, fail: 0 | StageNumber = 0, reason?: string): AgentState {
  return {
    id,
    persona: ARCHETYPE_PERSONAS[0]!,
    personaIndex: 0,
    fail,
    reason,
    ceiling: fail === 0 ? 6 : fail - 1,
    started: 0,
    progress,
    settled: true,
    ok: fail === 0 && progress === 6,
    blocked: fail !== 0,
  };
}

describe("funnelFromAgents", () => {
  const agents = [
    agent("A01", 6),
    agent("A02", 4, 5, "add-to-cart is a JS-only widget"),
    agent("A03", 2, 3, "specs live only inside product images"),
    agent("A04", 2, 3, "specs live only inside product images"),
    agent("A05", 0, 1, "no discovery feed"),
  ];

  test("starts with the whole cohort, then one row per stage", () => {
    const steps = funnelFromAgents(agents);
    expect(steps).toHaveLength(7);
    expect(steps[0]!.label).toBe("Agents started");
    expect(steps[0]!.count).toBe(5);
  });

  test("counts the agents that cleared each stage", () => {
    // A05 cleared none; A03/A04 cleared 2; A02 cleared 4; A01 cleared all 6.
    expect(funnelFromAgents(agents).map((s) => s.count)).toEqual([5, 4, 4, 2, 2, 1, 1]);
  });

  test("reports how many were lost entering each stage", () => {
    expect(funnelFromAgents(agents).map((s) => s.lost)).toEqual([0, 1, 0, 2, 0, 1, 0]);
  });

  test("names the reason from the agents actually blocked there", () => {
    const steps = funnelFromAgents(agents);
    expect(steps[1]!.reason).toBe("no discovery feed");
    expect(steps[3]!.reason).toBe("specs live only inside product images");
    expect(steps[5]!.reason).toBe("add-to-cart is a JS-only widget");
  });

  test("has no reason where nobody was lost", () => {
    const steps = funnelFromAgents(agents);
    expect(steps[0]!.reason).toBeNull();
    expect(steps[2]!.reason).toBeNull();
  });

  test("ignores agents still mid-run when naming a reason", () => {
    const running = [agent("A01", 2, 3, "blocked"), { ...agent("A02", 1), settled: false }];
    expect(funnelFromAgents(running)[3]!.reason).toBe("blocked");
  });

  test("returns an all-zero funnel for no agents rather than dividing by zero", () => {
    const steps = funnelFromAgents([]);
    expect(steps.map((s) => s.count)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(steps.map((s) => s.fraction)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
