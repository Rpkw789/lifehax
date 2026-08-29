/**
 * The simulation model.
 *
 * Everything here is a pure function of the tick — agent progress, settled and
 * blocked flags, per-stage counts, the hit rate, the event log. Nothing is
 * stored per agent. That keeps scrubbing and re-render trivial, and it is the
 * property worth preserving against a real backend too: buffer real events,
 * then replay them from a clock through these same derivations.
 */

import {
  PERSONAS,
  PLAN,
  STAGES,
  START_GAP,
  STAGE_PASS_LOGS,
  STEP_TICKS,
} from "./fixtures";
import type { AgentEvent, AgentState, StageNumber } from "./types";

/** Ticks in a full run. */
export const TOTAL_TICKS =
  (PLAN.length - 1) * START_GAP + STAGES.length * STEP_TICKS + 6;

/** Displayed elapsed time for a tick, e.g. "4.2s". */
export function elapsedLabel(tick: number): string {
  return `${(tick * 0.14).toFixed(1)}s`;
}

/** Every agent's state at `tick`. Pure. */
export function agentStates(tick: number): AgentState[] {
  return PLAN.map((plan, i) => {
    const ceiling = plan.fail === 0 ? STAGES.length : plan.fail - 1;
    const started = i * START_GAP;
    const raw = Math.floor((tick - started) / STEP_TICKS);
    const progress = Math.max(0, Math.min(ceiling, raw));
    const settled = tick - started >= (ceiling + 1) * STEP_TICKS;
    return {
      id: plan.id,
      persona: PERSONAS[plan.personaIndex],
      personaIndex: plan.personaIndex,
      fail: plan.fail,
      reason: plan.reason,
      ceiling,
      started,
      progress,
      settled,
      ok: settled && plan.fail === 0,
      blocked: settled && plan.fail !== 0,
    };
  });
}

/**
 * Every event emitted up to `tick`, oldest first.
 * A real stream produces exactly these; the fixture derives them.
 */
export function eventsUpTo(tick: number): AgentEvent[] {
  const out: AgentEvent[] = [];
  PLAN.forEach((plan, i) => {
    const started = i * START_GAP;
    const ceiling = plan.fail === 0 ? STAGES.length : plan.fail - 1;
    for (let stage = 1; stage <= ceiling; stage++) {
      const t = started + stage * STEP_TICKS;
      if (t <= tick) {
        out.push({ t, agentId: plan.id, stage: stage as StageNumber, kind: "pass" });
      }
    }
    if (plan.fail !== 0) {
      const t = started + plan.fail * STEP_TICKS;
      if (t <= tick) {
        out.push({
          t,
          agentId: plan.id,
          stage: plan.fail,
          kind: "fail",
          reason: plan.reason,
        });
      }
    }
  });
  return out.sort((a, b) => a.t - b.t || a.agentId.localeCompare(b.agentId));
}

/** The console line for an event. Copy is verbatim. */
export function logText(event: AgentEvent): string {
  if (event.kind === "fail") {
    return `BLOCKED at ${STAGES[event.stage - 1]} — ${event.reason}`;
  }
  return STAGE_PASS_LOGS[event.stage - 1];
}

/** Persona index for an agent id, for badge and swatch colors. */
export function personaIndexOf(agentId: string): number {
  return PLAN.find((p) => p.id === agentId)?.personaIndex ?? 0;
}

/** How many agents reached each stage, by stage index. */
export function stageReachCounts(agents: AgentState[]): number[] {
  return STAGES.map((_, si) => agents.filter((a) => a.progress >= si + 1).length);
}

/** How many agents are blocked at each stage, by stage index. */
export function stageBlockedCounts(agents: AgentState[]): number[] {
  return STAGES.map(
    (_, si) => agents.filter((a) => a.fail === si + 1 && a.settled).length,
  );
}
