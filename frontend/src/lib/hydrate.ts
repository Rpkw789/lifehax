/**
 * Turning a saved run back into screen state.
 *
 * A live run arrives as a stream of messages the provider folds into state.
 * A finished one is a single document from `GET /runs/:id`, so it needs the
 * same state assembled in one step instead. Keeping that as a pure function
 * means the mapping is testable without a provider, a fetch, or a browser —
 * and it is the mapping, not the fetching, that has the edge cases.
 */

import type { CheckResult } from "@contracts/check-result";
import type { SurfaceSimulationEvent } from "@contracts/surface-simulation";

import type {
  AgentEvent,
  Checks,
  Finding,
  Persona,
  RunInput,
  Surface,
} from "./types";

/** A run as the backend stores it. Mirrors `Run` in `backend/src/types.ts`. */
export interface SavedRun {
  runId: string;
  status: "running" | "complete" | "error";
  error: string | null;
  createdAt: string;
  startedAtMs: number;
  input: Partial<RunInput> & { storeUrl: string };
  catalogue: { products: unknown[] } | null;
  personas: Persona[];
  briefs: string[];
  checks: Checks | null;
  surfaces: Surface[];
  findings: Finding[];
  events: AgentEvent[];
  /** Absent on runs saved before surface simulations existed. */
  surfaceEvents?: SurfaceSimulationEvent[];
  checkResult?: CheckResult | null;
  sessions: Record<string, { sessionId: string; liveViewUrl: string | null }>;
}

/** The provider state a saved run restores. */
export interface HydratedRun {
  input: RunInput;
  events: AgentEvent[];
  personas: Persona[];
  briefs: string[];
  checks: Checks | null;
  surfaces: Surface[];
  findings: Finding[];
  surfaceEvents: SurfaceSimulationEvent[];
  checkResult: CheckResult | null;
  catalogueCount: number;
  sessions: Record<string, string>;
  running: boolean;
  complete: boolean;
  error: string | null;
}

export function hydrate(run: SavedRun): HydratedRun {
  return {
    // The stream sends a product count; the document keeps the products.
    catalogueCount: run.catalogue?.products.length ?? 0,
    input: {
      storeUrl: run.input.storeUrl,
      feedUrl: run.input.feedUrl ?? "",
      agentEndpoint: run.input.agentEndpoint ?? "",
      sitemapUrl: run.input.sitemapUrl ?? "",
      testSkus: run.input.testSkus ?? "",
      disabledPersonas: run.input.disabledPersonas ?? [],
      // Runs saved before these fields existed still have to render.
      locale: run.input.locale ?? "en-US",
      currency: run.input.currency ?? "USD",
    },
    events: run.events,
    personas: run.personas,
    briefs: run.briefs,
    checks: run.checks,
    surfaces: run.surfaces,
    findings: run.findings,
    surfaceEvents: run.surfaceEvents ?? [],
    checkResult: run.checkResult ?? null,
    // A live view URL outlives its session by nothing — Browserbase serves
    // "debugging connection was closed" once the run ends, so a restored run
    // shows no video rather than an error page.
    sessions: {},
    running: run.status === "running",
    complete: run.status !== "running",
    error: run.error,
  };
}
