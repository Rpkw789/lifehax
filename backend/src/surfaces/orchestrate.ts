import type { CheckResult, Evidence, TargetProduct } from "@contracts/check-result";
import {
  validateSurfaceSimulationEvent,
  type SurfaceSimulationEvent,
} from "@contracts/surface-simulation";
import type { ShopperAgent } from "../agents/types.ts";
import type { DocumentFetcher } from "../catalogue/snapshot.ts";
import type { PersonaBrief } from "../personas/generate.ts";
import { TimeoutError, withTimeout } from "../runs/retry.ts";
import type { Catalogue, Checks, Persona } from "../types.ts";
import type { SurfaceCritiqueClient } from "./critique.ts";
import { runGuideSimulation } from "./guide-worker.ts";
import { runProtocolSimulation } from "./protocol-worker.ts";
import { buildSurfaceCheckResult } from "./result.ts";
import {
  runWebSearchSimulation,
  type SearchWorkerResult,
} from "./search.ts";
import type {
  SurfaceEventEmitter,
  SurfaceWorkerContext,
  SurfaceWorkerResult,
} from "./types.ts";

export interface SurfaceSimulationInput {
  runId: string;
  reportId: string;
  generatedAt: string;
  storeUrl: string;
  testSkus: string;
  disabledPersonas: number[];
  catalogue: Catalogue;
  checks: Checks;
  personas: Persona[];
  briefs: string[];
  locale: string;
  currency: string;
  fetcher: DocumentFetcher;
  acpPath?: string;
  signal?: AbortSignal;
}

type StandardWorker = (
  context: SurfaceWorkerContext,
  emit: SurfaceEventEmitter,
) => Promise<SurfaceWorkerResult>;
type SearchWorker = (
  context: SurfaceWorkerContext,
  emit: SurfaceEventEmitter,
) => Promise<SearchWorkerResult>;

export interface SurfaceSimulationDependencies {
  emitForWorker: SurfaceEventEmitter;
  agent?: ShopperAgent;
  critiqueClient?: SurfaceCritiqueClient;
  protocolWorker?: StandardWorker;
  guideWorker?: StandardWorker;
  searchWorker?: SearchWorker;
  workerTimeoutMs?: number;
}

export async function runSurfaceSimulations(
  input: SurfaceSimulationInput,
  dependencies: SurfaceSimulationDependencies,
): Promise<CheckResult> {
  const target = selectTarget(input.catalogue, input.testSkus, input.currency);
  const brief = selectBrief(input.briefs, input.personas, input.disabledPersonas);
  const context: SurfaceWorkerContext = {
    runId: input.runId,
    storeUrl: input.catalogue.entryUrl,
    target,
    brief: brief.query,
    locale: input.locale,
    currency: input.currency,
    at: input.generatedAt,
    fetcher: input.fetcher,
    signal: input.signal,
  };
  const protocolWorker = dependencies.protocolWorker ?? ((workerContext, emit) =>
    runProtocolSimulation(workerContext, emit, {
      acpPath: input.acpPath,
      critiqueClient: dependencies.critiqueClient,
    }));
  const guideWorker = dependencies.guideWorker ?? ((workerContext, emit) =>
    runGuideSimulation(workerContext, emit, {
      critiqueClient: dependencies.critiqueClient,
    }));
  const searchWorker = dependencies.searchWorker ?? ((workerContext, emit) =>
    runWebSearchSimulation({
      context: workerContext,
      brief,
      agent: dependencies.agent ?? unavailableSearchAgent,
      emit,
      critiqueClient: dependencies.critiqueClient,
    }));

  const [protocol, guide, search] = await Promise.all([
    settleStandard("agent_protocol", context, dependencies.emitForWorker, protocolWorker, dependencies.workerTimeoutMs ?? 45_000, input.acpPath),
    settleStandard("model_readable_guide", context, dependencies.emitForWorker, guideWorker, dependencies.workerTimeoutMs ?? 45_000),
    settleSearch(context, brief, dependencies, searchWorker, dependencies.workerTimeoutMs ?? 45_000),
  ]);

  return buildSurfaceCheckResult({
    runId: input.runId,
    reportId: input.reportId,
    generatedAt: input.generatedAt,
    locale: input.locale,
    currency: input.currency,
    catalogue: input.catalogue,
    checks: input.checks,
    target,
    brief,
    protocol,
    guide,
    search,
  });
}

export function createSurfaceEventEmitter(
  onEvent: (event: SurfaceSimulationEvent) => void,
  now: () => Date = () => new Date(),
): SurfaceEventEmitter {
  let sequence = 0;
  return (surface, phase, message, evidenceId) => {
    const current = sequence;
    sequence += 1;
    const event: SurfaceSimulationEvent = {
      event_id: `surf_${String(current + 1).padStart(4, "0")}`,
      sequence: current,
      surface,
      phase,
      at: now().toISOString(),
      message,
      evidence_id: evidenceId,
    };
    const errors = validateSurfaceSimulationEvent(event);
    if (errors.length > 0) {
      throw new Error(`invalid surface event: ${errors.join("; ")}`);
    }
    onEvent(event);
    return event;
  };
}

export function selectTarget(
  catalogue: Catalogue,
  testSkus: string,
  currency: string,
): TargetProduct {
  const wanted = testSkus.split(",").map((value) => value.trim()).filter(Boolean);
  const selected = catalogue.products.find((product) =>
    wanted.some((value) => `${product.url} ${product.title ?? ""}`.toLowerCase().includes(value.toLowerCase())),
  ) ?? catalogue.products[0];
  if (!selected) throw new Error("surface simulations require a readable product");
  const selectedSku = wanted.find((value) =>
    `${selected.url} ${selected.title ?? ""}`.toLowerCase().includes(value.toLowerCase()),
  ) ?? null;
  const amount = selected.price === null ? Number.NaN : Number(selected.price.replace(/[^0-9.-]/g, ""));
  const url = new URL(selected.url);
  const fallbackName = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname);
  return {
    product_id: stableProductId(url),
    name: selected.title?.trim() || fallbackName,
    canonical_url: url.href,
    gtin: null,
    sku: selectedSku,
    category: null,
    price: Number.isFinite(amount) ? { amount, currency } : null,
  };
}

function selectBrief(
  briefs: string[],
  personas: Persona[],
  disabledPersonas: number[],
): PersonaBrief {
  const enabledIndex = briefs.findIndex(
    (_brief, index) => !disabledPersonas.includes(Math.floor(index / 2)),
  );
  if (enabledIndex < 0) {
    throw new Error("surface simulations require an enabled shopper brief");
  }
  const index = enabledIndex;
  const query = briefs[index]?.trim();
  if (!query) throw new Error("surface simulations require a shopper brief");
  const persona = personas[Math.floor(index / 2)];
  return {
    brief_id: "brief_surface_001",
    query_id: "q_surface_001",
    name: persona?.name ?? "Shopping agent",
    persona: persona?.prompt ?? "Evaluates retrieved evidence before choosing.",
    query,
    intent: "product_discovery",
  };
}

async function settleStandard(
  surface: "agent_protocol" | "model_readable_guide",
  context: SurfaceWorkerContext,
  emit: SurfaceEventEmitter,
  worker: StandardWorker,
  timeoutMs: number,
  acpPath?: string,
): Promise<SurfaceWorkerResult> {
  const gated = gateEmitter(emit, context.at);
  try {
    const result = await withTimeout(
      (signal) => worker({ ...context, signal }, gated.emit),
      timeoutMs,
      surface,
      context.signal,
    );
    gated.close();
    return result;
  } catch (error) {
    gated.close();
    const timedOut = error instanceof TimeoutError;
    const evidence = [...gated.evidence(), {
      evidence_id: `ev_${surface}_degraded`,
      kind: "api_call" as const,
      at: context.at,
      url: null,
      status: null,
      summary: timedOut
        ? `${surface} worker timed out`
        : `${surface} worker failed before verification completed`,
      excerpt: null,
    }];
    emit(
      surface,
      "result",
      timedOut
        ? "Simulation settled: Unable to verify before timeout"
        : "Simulation settled: Unable to verify",
      evidence[0]!.evidence_id,
    );
    const origin = new URL(context.storeUrl).origin;
    return {
      surface,
      evidence,
      probes:
        surface === "model_readable_guide"
          ? {
              llms_txt: {
                url: new URL("/llms.txt", origin).href,
                found: false,
                status: null,
                note: "Unable to verify",
              },
            }
          : {
              agent_commerce: {
                url: new URL(normalizeAcpPath(acpPath), origin).href,
                found: false,
                status: null,
                note: "Unable to verify",
              },
              ucp: {
                url: new URL("/.well-known/ucp", origin).href,
                found: false,
                status: null,
                note: "Unable to verify",
              },
            },
      critique: null,
    };
  }
}

function normalizeAcpPath(value: string | undefined): string {
  const candidate = value?.trim() || "/.well-known/agent-commerce";
  try {
    const parsed = new URL(candidate, "https://placeholder.invalid");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/.well-known/agent-commerce";
  }
}

async function settleSearch(
  context: SurfaceWorkerContext,
  brief: PersonaBrief,
  dependencies: SurfaceSimulationDependencies,
  worker: SearchWorker,
  timeoutMs: number,
): Promise<SearchWorkerResult> {
  const gated = gateEmitter(dependencies.emitForWorker, context.at);
  try {
    const result = await withTimeout(
      (signal) => worker({ ...context, signal }, gated.emit),
      timeoutMs,
      "web_search",
      context.signal,
    );
    gated.close();
    return result;
  } catch (error) {
    gated.close();
    const fallback = await runWebSearchSimulation({
      context,
      brief,
      agent: failingSearchAgent(error),
      emit: dependencies.emitForWorker,
    });
    return {
      ...fallback,
      evidence: uniqueEvidence([...gated.evidence(), ...fallback.evidence]),
    };
  }
}

function gateEmitter(
  target: SurfaceEventEmitter,
  at: string,
): { emit: SurfaceEventEmitter; close: () => void; evidence: () => Evidence[] } {
  let active = true;
  const observed = new Map<string, Evidence>();
  return {
    emit: (surface, phase, message, evidenceId) => {
      if (active && evidenceId && !observed.has(evidenceId)) {
        observed.set(evidenceId, {
          evidence_id: evidenceId,
          kind: phase === "fetch"
            ? "fetch"
            : phase === "model"
              ? "model_output"
              : "extraction",
          at,
          url: null,
          status: httpStatus(message),
          summary: message,
          excerpt: null,
        });
      }
      return active
        ? target(surface, phase, message, evidenceId)
        : {
            event_id: "surf_ignored_after_settle",
            sequence: 0,
            surface,
            phase,
            at,
            message,
            evidence_id: evidenceId,
          };
    },
    close: () => {
      active = false;
    },
    evidence: () => [...observed.values()],
  };
}

function httpStatus(message: string): number | null {
  const value = Number(message.match(/\bHTTP\s+(\d{3})\b/i)?.[1]);
  return Number.isInteger(value) ? value : null;
}

function uniqueEvidence(items: Evidence[]): Evidence[] {
  const unique = new Map<string, Evidence>();
  for (const item of items) unique.set(item.evidence_id, item);
  return [...unique.values()];
}

const unavailableSearchAgent: ShopperAgent = {
  kind: "shared-search",
  model: "unavailable",
  async *run() {
    throw new Error("shared search is not configured");
  },
};

function failingSearchAgent(error: unknown): ShopperAgent {
  return {
    kind: "shared-search",
    model: "unavailable",
    async *run() {
      throw error instanceof TimeoutError
        ? error
        : new Error("shared search could not complete");
    },
  };
}

function stableProductId(url: URL): string {
  const readable = url.pathname
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  if (readable) return `item_${readable}`;
  let hash = 0;
  for (const character of url.href) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `item_${hash.toString(36)}`;
}
