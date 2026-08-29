export const SURFACE_SIMULATION_KEYS = [
  "agent_protocol",
  "model_readable_guide",
  "web_search",
] as const;

export type SurfaceSimulationKey =
  (typeof SURFACE_SIMULATION_KEYS)[number];

export const SURFACE_SIMULATION_PHASES = [
  "context",
  "fetch",
  "parse",
  "validate",
  "model",
  "match",
  "result",
] as const;

export type SurfaceSimulationPhase =
  (typeof SURFACE_SIMULATION_PHASES)[number];

export interface SurfaceSimulationEvent {
  event_id: string;
  sequence: number;
  surface: SurfaceSimulationKey;
  phase: SurfaceSimulationPhase;
  at: string;
  message: string;
  evidence_id: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

export function validateSurfaceSimulationEvent(value: unknown): string[] {
  if (!isRecord(value)) return ["event must be an object"];

  const errors: string[] = [];
  if (!isNonEmptyString(value.event_id)) {
    errors.push("event_id must be non-empty");
  }
  if (!Number.isInteger(value.sequence) || (value.sequence as number) < 0) {
    errors.push("sequence must be a non-negative integer");
  }
  if (!SURFACE_SIMULATION_KEYS.includes(value.surface as SurfaceSimulationKey)) {
    errors.push("surface is not supported");
  }
  if (
    !SURFACE_SIMULATION_PHASES.includes(
      value.phase as SurfaceSimulationPhase,
    )
  ) {
    errors.push("phase is not supported");
  }
  if (!isIsoTimestamp(value.at)) {
    errors.push("at must be an ISO timestamp");
  }
  if (!isNonEmptyString(value.message)) {
    errors.push("message must be non-empty");
  }
  if (value.evidence_id !== null && !isNonEmptyString(value.evidence_id)) {
    errors.push("evidence_id must be null or a non-empty string");
  }

  return errors;
}
