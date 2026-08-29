/**
 * Domain shapes for a readiness run.
 *
 * These are deliberately the shapes the production API is specified to
 * produce (see "State Management" in the handoff), not the shapes the
 * prototype happened to use — so a real SSE/websocket stream can replace
 * the fixture clock without touching the components.
 */

/** The six journey stages, in order. Stages are 1-indexed on the wire. */
export type StageName =
  | "discover"
  | "land"
  | "read"
  | "select"
  | "cart"
  | "checkout";

/** 1-indexed stage number, matching `AgentEvent.stage`. */
export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6;

/** A buying brief — the natural-language intent an agent shops with. */
export interface Persona {
  name: string;
  /** Quoted, verbatim from the brief table. */
  prompt: string;
  /** Hex. The only chroma in the product besides the stage ramp. */
  color: string;
  /** Three-letter mono tag, e.g. "BGN". */
  tag: string;
}

/**
 * An agent in the population. `fail` is the 1-indexed stage the agent could
 * not enter; 0 means it completed checkout.
 *
 * In production `fail`/`reason` are not known up front — they arrive as a
 * `fail` event. The fixture pre-declares them so the clock can derive the
 * whole run; consumers should read outcomes off `AgentState`, never off here.
 */
export interface AgentPlan {
  id: string;
  /** Index into `PERSONAS`. */
  personaIndex: number;
  fail: 0 | StageNumber;
  reason?: string;
}

/**
 * One observation from the run. This is the wire shape: a real stream emits
 * these and the UI buffers and replays them from a clock.
 */
export interface AgentEvent {
  /** Tick the event landed on. Elapsed seconds = `t * 0.14`. */
  t: number;
  agentId: string;
  /** 1-indexed. */
  stage: StageNumber;
  kind: "pass" | "fail";
  /** Present on `fail`. */
  reason?: string;
}

/** Derived per render from the tick — never stored. */
export interface AgentState {
  id: string;
  persona: Persona;
  personaIndex: number;
  fail: 0 | StageNumber;
  reason?: string;
  /** Highest stage index this agent can reach (`fail - 1`, or 6). */
  ceiling: number;
  /** Tick the agent started on. */
  started: number;
  /** Stages cleared so far, 0–6. */
  progress: number;
  /** The agent has stopped moving, for either reason. */
  settled: boolean;
  /** Settled and completed checkout. */
  ok: boolean;
  /** Settled and blocked. */
  blocked: boolean;
}

/**
 * `Finding` and `Severity` are defined once, in the shared contract, and
 * re-exported here so the screens can keep importing from `@/lib/types`.
 * Do not redeclare them — the backend emits the contract shape.
 */
export type { Finding, Severity, Surface, Effort, Owner } from "@contracts/finding";

/** The input payload a run is created from (`POST /runs`). */
export interface RunInput {
  storeUrl: string;
  feedUrl: string;
  agentEndpoint: string;
  sitemapUrl: string;
  testSkus: string;
  /** Persona indices that are switched off for this run. */
  disabledPersonas: number[];
}
