/**
 * In-memory run store plus a per-run event bus.
 *
 * Runs vanish on restart. That is deliberate for now — see the plan; the
 * documented architecture calls for bun:sqlite, which we skip today.
 */

import type { AgentEvent, Run, RunInput } from "./types";
import type { CheckResult } from "@contracts/check-result";
import type { SurfaceSimulationEvent } from "@contracts/surface-simulation";

const runs = new Map<string, Run>();
const subscribers = new Map<string, Set<(e: StreamMessage) => void>>();

/** What goes down the SSE wire. `agent` carries an `AgentEvent`. */
export type StreamMessage =
  | { type: "catalogue"; products: number; source: string }
  | { type: "personas"; personas: Run["personas"]; briefs: string[] }
  | { type: "session"; agentId: string; liveViewUrl: string }
  /** Every browser has closed; live views are dead and must not be shown. */
  | { type: "sessions_closed" }
  | { type: "checks"; checks: NonNullable<Run["checks"]> }
  | { type: "agent"; event: AgentEvent }
  | { type: "surface_simulation"; event: SurfaceSimulationEvent }
  | { type: "check_result"; result: CheckResult }
  | { type: "findings"; findings: Run["findings"]; surfaces: Run["surfaces"] }
  | { type: "done"; status: Run["status"]; error: string | null };

export function createRun(input: RunInput): Run {
  const run: Run = {
    runId: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    status: "running",
    error: null,
    createdAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    input,
    catalogue: null,
    personas: [],
    briefs: [],
    checks: null,
    surfaces: [],
    findings: [],
    events: [],
    surfaceEvents: [],
    checkResult: null,
    sessions: {},
    sessionsClosed: false,
  };
  runs.set(run.runId, run);
  return run;
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

/** Tick, matching the frontend's clock: elapsed seconds = `t * 0.14`. */
export function tickOf(run: Run): number {
  return Math.round((Date.now() - run.startedAtMs) / 140);
}

export function publish(run: Run, message: StreamMessage): void {
  if (message.type === "agent") run.events.push(message.event);
  if (
    message.type === "surface_simulation" &&
    !run.surfaceEvents.some(
      (event) => event.event_id === message.event.event_id,
    )
  ) {
    run.surfaceEvents.push(message.event);
    run.surfaceEvents.sort(
      (left, right) =>
        left.sequence - right.sequence ||
        left.event_id.localeCompare(right.event_id),
    );
  }
  if (message.type === "check_result") run.checkResult = message.result;
  for (const send of subscribers.get(run.runId) ?? []) send(message);
}

/** Emit a stage result for an agent, stamped with the current tick. */
export function emitAgentEvent(
  run: Run,
  agentId: string,
  stage: AgentEvent["stage"],
  kind: AgentEvent["kind"],
  reason?: string,
): void {
  publish(run, {
    type: "agent",
    event: { t: tickOf(run), agentId, stage, kind, ...(reason ? { reason } : {}) },
  });
}

export function subscribe(
  runId: string,
  send: (e: StreamMessage) => void,
): () => void {
  let set = subscribers.get(runId);
  if (!set) {
    set = new Set();
    subscribers.set(runId, set);
  }
  set.add(send);
  return () => {
    set!.delete(send);
    if (set!.size === 0) subscribers.delete(runId);
  };
}

export function finish(run: Run, error?: string): void {
  run.status = error ? "error" : "complete";
  run.error = error ?? null;
  publish(run, { type: "done", status: run.status, error: run.error });
}
