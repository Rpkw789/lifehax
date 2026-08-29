/**
 * Derivations over the run.
 *
 * Previously this derived everything from the fixture `PLAN` and a clock. It
 * now folds the `AgentEvent`s the backend actually streamed — which is what
 * `types.ts` always anticipated. Every function stays pure and the `AgentState`
 * shape is unchanged, so the components did not have to move.
 */

import { MS_PER_TICK } from "./elapsed";
import { STAGES, STAGE_PASS_LOGS } from "./fixtures";
import type { AgentEvent, AgentState, Persona, StageNumber } from "./types";

/** Ticks in a nominal run, used for progress display before completion. */
export const TOTAL_TICKS = 120;

/** Displayed elapsed time, e.g. "4.2s". */
export function secondsLabel(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}

/** When an event happened, from its tick. */
export function elapsedLabel(tick: number): string {
  return secondsLabel((tick * MS_PER_TICK) / 1000);
}

/** Agent ids are stable and ordered: A01..A10, two per brief. */
export function personaIndexOf(agentId: string): number {
  const n = Number(agentId.replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.floor((n - 1) / 2) : 0;
}

/**
 * Folds events into per-agent state.
 *
 * `complete` tells a settled-but-passing agent apart from one still in flight:
 * until the run ends, an agent that has cleared every stage so far is simply
 * ahead, not finished.
 */
export function agentStates(
  events: AgentEvent[],
  personas: Persona[],
  agentIds: string[],
  complete: boolean,
): AgentState[] {
  return agentIds.map((id) => {
    const mine = events.filter((e) => e.agentId === id);
    const failure = mine.find((e) => e.kind === "fail");
    const passes = mine.filter((e) => e.kind === "pass");
    const progress = passes.length === 0 ? 0 : Math.max(...passes.map((e) => e.stage));

    const personaIndex = personaIndexOf(id);
    const persona: Persona = personas[personaIndex] ?? {
      name: "Shopper",
      prompt: "",
      color: "#6b7280",
      tag: "SHP",
    };

    const fail: 0 | StageNumber = failure ? (failure.stage as StageNumber) : 0;
    const blocked = Boolean(failure);
    const ok = !blocked && progress >= STAGES.length;

    return {
      id,
      persona,
      personaIndex,
      fail,
      reason: failure?.reason,
      ceiling: blocked ? fail - 1 : STAGES.length,
      started: mine[0]?.t ?? 0,
      progress,
      settled: blocked || ok || (complete && mine.length > 0),
      ok,
      blocked,
    };
  });
}

/** The console line for an event. Failures carry the backend's own reason. */
export function logText(event: AgentEvent): string {
  if (event.kind === "fail") {
    return `BLOCKED at ${STAGES[event.stage - 1]} — ${event.reason ?? "no reason given"}`;
  }
  return STAGE_PASS_LOGS[event.stage - 1] ?? "stage cleared";
}
