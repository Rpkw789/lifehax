import { describe, expect, test } from "bun:test";

import {
  MOCK_PLANS,
  journeyOf,
  mockEvents,
  neighbours,
  outcomeOf,
} from "./agent-detail";
import { ARCHETYPE_PERSONAS, STAGES } from "./fixtures";
import type { AgentEvent, AgentState, StageNumber } from "./types";

/** An agent mid-run or settled, matching what `agentStates` folds. */
function agent(
  id: string,
  progress: number,
  fail: 0 | StageNumber = 0,
  reason?: string,
): AgentState {
  const blocked = fail !== 0;
  return {
    id,
    persona: ARCHETYPE_PERSONAS[0]!,
    personaIndex: 0,
    fail,
    reason,
    ceiling: blocked ? fail - 1 : STAGES.length,
    started: 0,
    progress,
    settled: blocked || progress === STAGES.length,
    ok: !blocked && progress === STAGES.length,
    blocked,
  };
}

function pass(id: string, stage: StageNumber, t: number): AgentEvent {
  return { t, agentId: id, stage, kind: "pass" };
}

function fail(id: string, stage: StageNumber, t: number, reason: string): AgentEvent {
  return { t, agentId: id, stage, kind: "fail", reason };
}

describe("journeyOf", () => {
  test("has one step per stage, in order", () => {
    const steps = journeyOf(agent("A01", 0), []);
    expect(steps.map((s) => s.stage)).toEqual([...STAGES]);
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("marks a cleared stage with the tick its pass landed on", () => {
    const steps = journeyOf(agent("A01", 2), [
      pass("A01", 1, 4),
      pass("A01", 2, 11),
    ]);
    expect(steps[0]!.status).toBe("cleared");
    expect(steps[0]!.at).toBe(4);
    expect(steps[1]!.at).toBe(11);
  });

  test("marks the stage the agent was blocked at, and carries its reason", () => {
    const steps = journeyOf(agent("A02", 2, 3, "specs live only inside product images"), [
      pass("A02", 1, 3),
      pass("A02", 2, 9),
      fail("A02", 3, 15, "specs live only inside product images"),
    ]);
    expect(steps[2]!.status).toBe("blocked");
    expect(steps[2]!.at).toBe(15);
    expect(steps[2]!.note).toBe("specs live only inside product images");
  });

  test("marks the next stage running while the agent is still in flight", () => {
    const steps = journeyOf(agent("A01", 2), [pass("A01", 1, 4), pass("A01", 2, 11)]);
    expect(steps[2]!.status).toBe("running");
    expect(steps[2]!.at).toBeNull();
  });

  test("leaves stages past a block pending rather than running", () => {
    const steps = journeyOf(agent("A02", 2, 3, "blocked"), [
      pass("A02", 1, 3),
      pass("A02", 2, 9),
      fail("A02", 3, 15, "blocked"),
    ]);
    expect(steps.slice(3).map((s) => s.status)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
  });

  test("has no running step once the agent has reached checkout", () => {
    const events = ([1, 2, 3, 4, 5, 6] as StageNumber[]).map((n) =>
      pass("A01", n, n * 5),
    );
    const steps = journeyOf(agent("A01", 6), events);
    expect(steps.every((s) => s.status === "cleared")).toBe(true);
  });

  test("ignores events belonging to another agent", () => {
    const steps = journeyOf(agent("A01", 0), [pass("A02", 1, 4)]);
    expect(steps[0]!.status).toBe("running");
    expect(steps[0]!.at).toBeNull();
  });
});

describe("outcomeOf", () => {
  test("reports checkout reached for an agent that completed", () => {
    const outcome = outcomeOf(agent("A01", 6));
    expect(outcome.tone).toBe("ok");
    expect(outcome.headline).toContain("checkout");
  });

  test("names the stage and the reason for a blocked agent", () => {
    const outcome = outcomeOf(agent("A02", 2, 3, "specs live only inside product images"));
    expect(outcome.tone).toBe("fail");
    expect(outcome.headline).toContain("read");
    expect(outcome.headline).toContain("specs live only inside product images");
  });

  test("names the stage an in-flight agent is working", () => {
    // Cleared discover and land, so it is working the third stage.
    const outcome = outcomeOf(agent("A03", 2));
    expect(outcome.tone).toBe("muted");
    expect(outcome.headline).toContain("read");
  });

  test("says an agent that has reported nothing is still waiting", () => {
    expect(outcomeOf(agent("A04", 0)).headline).toContain("waiting");
  });
});

describe("neighbours", () => {
  const ids = ["A01", "A02", "A03"];

  test("gives the ids either side", () => {
    expect(neighbours(ids, "A02")).toEqual({ prev: "A01", next: "A03" });
  });

  test("has no previous at the head and no next at the tail", () => {
    expect(neighbours(ids, "A01").prev).toBeNull();
    expect(neighbours(ids, "A03").next).toBeNull();
  });

  test("has neither for an id that is not in the population", () => {
    expect(neighbours(ids, "A99")).toEqual({ prev: null, next: null });
  });
});

describe("mockEvents", () => {
  test("emits one pass per stage for an agent that completes", () => {
    const events = mockEvents([{ id: "A01", fail: 0 }]);
    expect(events).toHaveLength(6);
    expect(events.every((e) => e.kind === "pass")).toBe(true);
    expect(events.map((e) => e.stage)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("stops at the blocked stage and emits a fail carrying the reason", () => {
    const events = mockEvents([{ id: "A02", fail: 3, reason: "no discovery feed" }]);
    expect(events.map((e) => e.stage)).toEqual([1, 2, 3]);
    expect(events[2]!.kind).toBe("fail");
    expect(events[2]!.reason).toBe("no discovery feed");
  });

  test("gives every event a tick that increases with the stage", () => {
    const events = mockEvents([{ id: "A01", fail: 0 }]);
    const ticks = events.map((e) => e.t);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
  });

  test("staggers agents so two do not clear the same stage on the same tick", () => {
    const events = mockEvents([
      { id: "A01", fail: 0 },
      { id: "A02", fail: 0 },
    ]);
    const first = events.filter((e) => e.stage === 1).map((e) => e.t);
    expect(new Set(first).size).toBe(first.length);
  });
});

describe("MOCK_PLANS", () => {
  test("covers every agent id exactly once", () => {
    const ids = MOCK_PLANS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("has at least one agent that completes and one that is blocked", () => {
    expect(MOCK_PLANS.some((p) => p.fail === 0)).toBe(true);
    expect(MOCK_PLANS.some((p) => p.fail !== 0)).toBe(true);
  });

  test("gives every blocked agent a reason", () => {
    for (const plan of MOCK_PLANS.filter((p) => p.fail !== 0)) {
      expect(plan.reason && plan.reason.length > 0).toBe(true);
    }
  });
});
