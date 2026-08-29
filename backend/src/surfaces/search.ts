import type {
  AgentRun,
  Evidence,
  Observations,
  Stage,
} from "@contracts/check-result";
import type { AgentEvent, ShopperAgent } from "../agents/types.ts";
import { matchProposal } from "../agents/match.ts";
import type { PersonaBrief } from "../personas/generate.ts";
import { TimeoutError } from "../runs/retry.ts";
import {
  requestSurfaceCritique,
  type SurfaceCritiqueClient,
} from "./critique.ts";
import type {
  SurfaceEventEmitter,
  SurfaceWorkerContext,
  SurfaceWorkerResult,
} from "./types.ts";

export interface SearchWorkerResult extends SurfaceWorkerResult {
  surface: "web_search";
  run: AgentRun;
}

export interface WebSearchSimulationInput {
  context: SurfaceWorkerContext;
  brief: PersonaBrief;
  agent: ShopperAgent;
  emit: SurfaceEventEmitter;
  critiqueClient?: SurfaceCritiqueClient;
  now?: () => Date;
}

export async function runWebSearchSimulation(
  input: WebSearchSimulationInput,
): Promise<SearchWorkerResult> {
  const now = input.now ?? (() => new Date());
  const started = now();
  input.emit(
    "web_search",
    "context",
    "Loaded the shared product and shopper brief; the target identity stays hidden from search",
    null,
  );

  const agentEvents: AgentEvent[] = [];
  const evidence: Evidence[] = [];
  try {
    for await (const event of input.agent.run(input.brief, {
      runId: input.context.runId,
      locale: "en-US",
      currency: input.context.target.price?.currency ?? "USD",
      storeOrigin: new URL(input.context.storeUrl).origin,
      fetchPage: (url, signal) => input.context.fetcher.get(url, signal),
      signal: input.context.signal ?? new AbortController().signal,
    })) {
      agentEvents.push(event);
      mapAgentEvent(event, evidence, input.emit, now);
    }
  } catch (error) {
    const code = error instanceof TimeoutError ? "AGENT_TIMEOUT" : "AGENT_ERROR";
    input.emit(
      "web_search",
      "result",
      code === "AGENT_TIMEOUT"
        ? "Web search timed out without a recommendation"
        : "Web search could not complete",
      null,
    );
    return {
      surface: "web_search",
      evidence,
      probes: {},
      critique: null,
      run: failedRun(input.brief, input.agent, started, code),
    };
  }

  const verdict = agentEvents.findLast(
    (event): event is Extract<AgentEvent, { type: "agent.verdict" }> =>
      event.type === "agent.verdict",
  );
  if (!verdict) {
    input.emit("web_search", "result", "Web search returned no verdict", null);
    return {
      surface: "web_search",
      evidence,
      probes: {},
      critique: null,
      run: failedRun(input.brief, input.agent, started, "AGENT_ERROR"),
    };
  }

  const citations = agentEvents
    .filter(
      (event): event is Extract<AgentEvent, { type: "agent.citation" }> =>
        event.type === "agent.citation",
    )
    .map((event) => ({ title: event.title, url: event.url }));
  const fetchedUrls = agentEvents
    .filter(
      (event): event is Extract<AgentEvent, { type: "agent.fetch" }> =>
        event.type === "agent.fetch",
    )
    .filter(
      (event) =>
        event.status !== null && event.status >= 200 && event.status < 300,
    )
    .map((event) => event.url);
  const observations = observationsFor(input.context, fetchedUrls);
  const matched = matchProposal({
    brandDomain: new URL(input.context.storeUrl).hostname,
    target: input.context.target,
    proposal: verdict.proposal,
    citations,
    fetchedUrls,
    observations,
  });
  const targetRank = matched.outcome.target_rank;
  input.emit(
    "web_search",
    "match",
    targetRank === null
      ? "Deterministic URL matching did not identify the target in ranked results"
      : `Deterministic URL matching placed the target at rank ${targetRank}`,
    evidence.find((item) => item.url === input.context.target.canonical_url)
      ?.evidence_id ?? null,
  );
  input.emit(
    "web_search",
    "model",
    "Critiquing the search journey and deterministic match evidence",
    null,
  );
  const critiqueResult = await requestSurfaceCritique(
    {
      surface: "web_search",
      facts: [
        `Search returned ${citations.length} cited results`,
        targetRank === null
          ? "The target was not recommended"
          : `The target was recommended at rank ${targetRank}`,
      ],
      evidence,
    },
    input.critiqueClient,
  );
  const modelEvidence = addEvidence(evidence, {
    kind: "model_output",
    at: now().toISOString(),
    url: null,
    status: null,
    summary: `${critiqueResult.source === "model" ? "Model" : "Fallback"} web-search critique`,
    excerpt: JSON.stringify(critiqueResult.critique).slice(0, 4_000),
  });
  input.emit(
    "web_search",
    "model",
    critiqueResult.critique.summary,
    modelEvidence.evidence_id,
  );
  input.emit(
    "web_search",
    "result",
    targetRank === null
      ? "Search simulation settled: target not recommended"
      : `Search simulation settled: target recommended at rank ${targetRank}`,
    modelEvidence.evidence_id,
  );

  const webEvidenceIds = evidence
    .filter((item) => item.kind === "search_result" || item.kind === "api_call")
    .map((item) => item.evidence_id);
  const storeEvidenceIds = evidence
    .filter(
      (item) =>
        item.kind === "fetch" &&
        item.url !== null &&
        belongsToDomain(item.url, input.context.storeUrl),
    )
    .map((item) => item.evidence_id);
  const durationMs = Math.max(0, now().getTime() - started.getTime());

  return {
    surface: "web_search",
    evidence,
    probes: {},
    critique: critiqueResult.critique,
    run: {
      run_id: "ar_surface_001",
      query_id: input.brief.query_id,
      agent: {
        agent_id: "agent_surface_001",
        name: input.brief.name,
        persona: input.brief.persona,
        color_hex: "#475569",
        model: input.agent.model,
        kind: input.agent.kind,
      },
      journey: {
        started_at: started.toISOString(),
        duration_ms: durationMs,
        stages: successfulStages(storeEvidenceIds, webEvidenceIds, durationMs),
      },
      outcome: matched.outcome,
      ranked_candidates: matched.rankedCandidates,
      observations,
    },
  };
}

function mapAgentEvent(
  event: AgentEvent,
  evidence: Evidence[],
  emit: SurfaceEventEmitter,
  now: () => Date,
): void {
  if (event.type === "agent.query") {
    emit("web_search", "model", `Searching the open web for: ${event.query}`, null);
    return;
  }
  if (event.type === "agent.api") {
    const item = addEvidence(evidence, {
      kind: "api_call",
      at: now().toISOString(),
      url: null,
      status: null,
      summary: `Search API completed in ${event.latency_ms}ms`,
      excerpt: null,
    });
    emit("web_search", "fetch", `Search API returned in ${event.latency_ms}ms`, item.evidence_id);
    return;
  }
  if (event.type === "agent.citation") {
    const item = addEvidence(evidence, {
      kind: "search_result",
      at: now().toISOString(),
      url: event.url,
      status: null,
      summary: `Search result ${event.position}: ${event.title}`,
      excerpt: null,
    });
    emit("web_search", "fetch", `Result ${event.position}: ${event.title} — ${event.url}`, item.evidence_id);
    return;
  }
  if (event.type === "agent.fetch") {
    const item = addEvidence(evidence, {
      kind: "fetch",
      at: now().toISOString(),
      url: event.url,
      status: event.status,
      summary: event.status === null ? "Search page fetch failed" : `Fetched cited page with HTTP ${event.status}`,
      excerpt: null,
    });
    emit("web_search", "fetch", event.status === null ? `Unable to fetch ${event.url}` : `Fetched ${event.url} — HTTP ${event.status}`, item.evidence_id);
  }
}

function addEvidence(
  evidence: Evidence[],
  item: Omit<Evidence, "evidence_id">,
): Evidence {
  const complete: Evidence = {
    evidence_id: `ev_search_${String(evidence.length + 1).padStart(3, "0")}`,
    ...item,
  };
  evidence.push(complete);
  return complete;
}

function observationsFor(
  context: SurfaceWorkerContext,
  fetchedUrls: string[],
): Observations {
  const targetFetched = fetchedUrls.some(
    (url) => resourceKey(url) === resourceKey(context.target.canonical_url),
  );
  return {
    price_found: targetFetched && context.target.price !== null,
    availability_found: false,
    shipping_information_found: false,
    return_policy_found: false,
    structured_product_data_found: false,
    reviews_found: false,
    acp_supported: false,
    ucp_supported: false,
  };
}

function successfulStages(
  storeEvidenceIds: string[],
  webEvidenceIds: string[],
  durationMs: number,
): Stage[] {
  return [
    { stage: "store_browse", status: storeEvidenceIds.length > 0 ? "completed" : "skipped", duration_ms: 0, error_code: null, evidence_ids: storeEvidenceIds },
    { stage: "web_search", status: "completed", duration_ms: durationMs, error_code: null, evidence_ids: webEvidenceIds },
    { stage: "protocol_check", status: "skipped", duration_ms: 0, error_code: null, evidence_ids: [] },
    { stage: "purchase_decision", status: "completed", duration_ms: 0, error_code: null, evidence_ids: [] },
  ];
}

function failedRun(
  brief: PersonaBrief,
  agent: ShopperAgent,
  started: Date,
  code: "AGENT_ERROR" | "AGENT_TIMEOUT",
): AgentRun {
  return {
    run_id: "ar_surface_001",
    query_id: brief.query_id,
    agent: { agent_id: "agent_surface_001", name: brief.name, persona: brief.persona, color_hex: "#475569", model: agent.model, kind: agent.kind },
    journey: { started_at: started.toISOString(), duration_ms: 0, stages: [
      { stage: "store_browse", status: "skipped", duration_ms: 0, error_code: null, evidence_ids: [] },
      { stage: "web_search", status: "failed", duration_ms: 0, error_code: code, evidence_ids: [] },
      { stage: "protocol_check", status: "skipped", duration_ms: 0, error_code: null, evidence_ids: [] },
      { stage: "purchase_decision", status: "skipped", duration_ms: 0, error_code: null, evidence_ids: [] },
    ] },
    outcome: { target_discovered: false, target_identity_matched: false, target_recommended: false, target_rank: null, candidate_count: 0, top_3: false, purchase_intent: "none", purchase_completed: false, confidence: 0, failure_codes: [{ code }], final_choice: null, our_pages_fetched: [] },
    ranked_candidates: [],
    observations: { price_found: false, availability_found: false, shipping_information_found: false, return_policy_found: false, structured_product_data_found: false, reviews_found: false, acp_supported: false, ucp_supported: false },
  };
}

function resourceKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    return `${stripWww(url.hostname)}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return null;
  }
}

function belongsToDomain(rawUrl: string, storeUrl: string): boolean {
  try {
    const host = stripWww(new URL(rawUrl).hostname);
    const domain = stripWww(new URL(storeUrl).hostname);
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function stripWww(host: string): string {
  const lower = host.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}
