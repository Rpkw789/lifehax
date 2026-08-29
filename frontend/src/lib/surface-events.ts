import type { CheckResult } from "@contracts/check-result";
import {
  SURFACE_SIMULATION_PHASES,
  type SurfaceSimulationEvent,
  type SurfaceSimulationKey,
} from "@contracts/surface-simulation";

export interface SurfaceConsoleState {
  events: SurfaceSimulationEvent[];
  progress: number;
  status: "waiting" | "running" | "done" | "blocked";
  verdict: string | null;
  json: unknown | null;
}

export function appendSurfaceEvent(
  current: SurfaceSimulationEvent[],
  incoming: SurfaceSimulationEvent,
): SurfaceSimulationEvent[] {
  if (current.some((event) => event.event_id === incoming.event_id)) {
    return current;
  }
  return [...current, incoming].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.event_id.localeCompare(right.event_id),
  );
}

export function surfaceEventsFor(
  surface: SurfaceSimulationKey,
  events: SurfaceSimulationEvent[],
): SurfaceSimulationEvent[] {
  return events.filter((event) => event.surface === surface);
}

export function surfaceConsoleState(
  surface: SurfaceSimulationKey,
  allEvents: SurfaceSimulationEvent[],
  result: CheckResult | null,
): SurfaceConsoleState {
  const events = surfaceEventsFor(surface, allEvents);
  const resultEvent = events.findLast((event) => event.phase === "result");
  const completedPhases = new Set(events.map((event) => event.phase));
  const progress = resultEvent
    ? 1
    : Math.min(0.92, completedPhases.size / SURFACE_SIMULATION_PHASES.length);
  const unavailable = resultEvent
    ? /\b(unavailable|unable|not recommended|could not|timed out|no verdict)\b/i.test(
        resultEvent.message,
      )
    : false;

  return {
    events,
    progress,
    status:
      events.length === 0
        ? "waiting"
        : resultEvent
          ? unavailable
            ? "blocked"
            : "done"
          : "running",
    verdict: resultEvent?.message ?? null,
    json: resultEvent && result ? surfaceJson(surface, result) : null,
  };
}

export function surfaceTime(at: string, startedAt: string): string {
  const elapsed = Math.max(0, Date.parse(at) - Date.parse(startedAt));
  return `${(elapsed / 1_000).toFixed(1)}s`;
}

export function surfaceJson(
  surface: SurfaceSimulationKey,
  result: CheckResult,
): unknown {
  if (surface === "agent_protocol") {
    return {
      agent_commerce: result.site_audit.agent_commerce,
      ucp: result.site_audit.ucp,
    };
  }
  if (surface === "model_readable_guide") {
    return { llms_txt: result.site_audit.llms_txt };
  }
  return {
    agent_run: result.agent_runs[0] ?? null,
    score: result.scores.by_query[0] ?? null,
  };
}
