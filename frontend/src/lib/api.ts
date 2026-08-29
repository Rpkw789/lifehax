/**
 * Backend client. One place that knows the API shape, so the screens do not.
 */

import type {
  AgentEvent,
  Checks,
  Finding,
  Persona,
  RunInput,
  Surface,
} from "./types";

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
  | { type: "findings"; findings: Finding[]; surfaces: Surface[] }
  | { type: "done"; status: "complete" | "error"; error: string | null };

/** What the backend reports it picked up. Mirrors `GET /health`. */
export interface Health {
  ok: boolean;
  /** A model gateway is configured. Findings are written rather than rule-based. */
  llm: boolean;
  /** A Browserbase key is configured. Agents can really drive a browser. */
  browserbase: boolean;
}

/**
 * Reads the backend's capability report.
 *
 * This says whether the variables are *set*, not whether they *work* — the
 * README is explicit about that, and Settings repeats it rather than implying
 * a green light means a working key.
 */
export async function fetchHealth(): Promise<Health> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`backend returned ${res.status}`);
  return (await res.json()) as Health;
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
