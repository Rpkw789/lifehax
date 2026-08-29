/**
 * Backend client. One place that knows the API shape, so the screens do not.
 */

import type { RunSummary } from "./history";
import type {
  AgentEvent,
  Checks,
  Finding,
  Persona,
  PersonaOverride,
  RunInput,
  Surface,
} from "./types";
import type { CheckResult } from "@contracts/check-result";
import type { SurfaceSimulationEvent } from "@contracts/surface-simulation";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3201";

/** Server-sent messages, mirroring `backend/src/store.ts` StreamMessage. */
export type StreamMessage =
  | { type: "catalogue"; products: number; source: string }
  | { type: "personas"; personas: Persona[]; briefs: string[] }
  | { type: "session"; agentId: string; liveViewUrl: string }
  | { type: "sessions_closed" }
  | { type: "checks"; checks: Checks }
  | { type: "agent"; event: AgentEvent }
  | { type: "surface_simulation"; event: SurfaceSimulationEvent }
  | { type: "check_result"; result: CheckResult }
  | { type: "findings"; findings: Finding[]; surfaces: Surface[] }
  | { type: "done"; status: "complete" | "error"; error: string | null };

/** Saved runs, newest first. Used by the dashboard to compare iterations. */
export async function listRuns(): Promise<RunSummary[]> {
  const res = await fetch(`${API_BASE}/runs`);
  const body = (await res.json()) as
    | { runs: RunSummary[] }
    | { error: { message: string } };
  if (!res.ok || !("runs" in body)) {
    throw new Error(
      "error" in body ? body.error.message : `backend returned ${res.status}`,
    );
  }
  return body.runs;
}

/**
 * Persona edits for a store, which the backend applies to that store's next
 * run. Filed against the store host, not a run — a finished run's personas are
 * the record of what it measured and are never rewritten.
 */
export async function loadPersonaOverrides(
  storeHost: string,
): Promise<PersonaOverride[]> {
  const res = await fetch(
    `${API_BASE}/stores/${encodeURIComponent(storeHost)}/personas`,
  );
  const body = (await res.json()) as
    | { overrides: PersonaOverride[] }
    | { error: { message: string } };
  if (!res.ok || !("overrides" in body)) {
    throw new Error(
      "error" in body ? body.error.message : `backend returned ${res.status}`,
    );
  }
  return body.overrides;
}

export async function savePersonaOverrides(
  storeHost: string,
  overrides: PersonaOverride[],
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/stores/${encodeURIComponent(storeHost)}/personas`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ overrides }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message: string };
    } | null;
    throw new Error(body?.error?.message ?? `backend returned ${res.status}`);
  }
}

export async function createRun(input: RunInput): Promise<string> {
  const res = await fetch(`${API_BASE}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as
    | { runId: string }
    | { error: { message: string } };
  if (!res.ok || !("runId" in body)) {
    throw new Error(
      "error" in body ? body.error.message : `backend returned ${res.status}`,
    );
  }
  return body.runId;
}

/**
 * Subscribes to a run's event stream. Returns an unsubscribe function.
 *
 * The backend replays everything that already happened on connect, so joining
 * late — or refreshing the page mid-run — still yields the whole run.
 */
export function subscribeToRun(
  runId: string,
  onMessage: (message: StreamMessage) => void,
  onError?: (message: string) => void,
): () => void {
  const source = new EventSource(`${API_BASE}/runs/${runId}/events`);
  let closed = false;

  const handle = (event: MessageEvent<string>) => {
    try {
      onMessage(JSON.parse(event.data) as StreamMessage);
    } catch {
      // A malformed frame is not worth killing the stream over.
    }
  };

  for (const name of [
    "catalogue",
    "personas",
    "session",
    "sessions_closed",
    "checks",
    "agent",
    "surface_simulation",
    "check_result",
    "findings",
    "done",
  ]) {
    source.addEventListener(name, handle as EventListener);
  }

  source.onerror = () => {
    // EventSource retries on its own; only surface a hard failure.
    if (source.readyState === EventSource.CLOSED && !closed) {
      onError?.("lost connection to the backend");
    }
  };

  return () => {
    closed = true;
    source.close();
  };
}
