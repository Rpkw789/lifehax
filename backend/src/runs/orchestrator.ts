import { REPORT_TYPE, SCHEMA_VERSION, type AgentRun, type CheckResult, type Evidence, type Observations, type Stage } from "../../../shared/contracts/check-result.ts";
import { assertCheckResult } from "../../../shared/contracts/validate.ts";
import type { AppConfig } from "../env.ts";
import { matchProposal } from "../agents/match.ts";
import type { AgentEvent, AgentKind, ShopperAgent, ShopperProposal } from "../agents/types.ts";
import { assertSameOriginTarget } from "../catalogue/security.ts";
import { snapshotStore, type DocumentFetcher, type StoreSnapshot } from "../catalogue/snapshot.ts";
import type { StructuredModelClient } from "../models/types.ts";
import { generatePersonas, type PersonaBrief } from "../personas/generate.ts";
import { computeScores } from "../score/compute.ts";
import { mapConcurrent } from "./queue.ts";
import { retryOnce, TimeoutError, withTimeout } from "./retry.ts";

export interface SimulationInput {
  run_id: string;
  report_id: string;
  store_url: string;
  target_product_url: string;
  locale: string;
  currency: string;
  agent_kind: AgentKind;
  baseline_report_id: string | null;
  brand_id?: string;
  brand_name?: string;
}

export interface ResultSink {
  save(result: CheckResult): Promise<void>;
}

export interface EventSink {
  emit(event: AgentEvent): Promise<void>;
}

export interface SimulationDependencies {
  config: AppConfig;
  personaClient: StructuredModelClient;
  fetcher: DocumentFetcher;
  agent: ShopperAgent;
  resultSink: ResultSink;
  eventSink: EventSink;
  validateUrls?: (storeUrl: string, targetProductUrl: string) => Promise<void>;
  now?: () => Date;
  monotonicNow?: () => number;
}

interface CompletedAgent {
  run: AgentRun;
  evidence: Evidence[];
  events: AgentEvent[];
}

export async function runSimulation(
  input: SimulationInput,
  dependencies: SimulationDependencies,
): Promise<CheckResult> {
  const now = dependencies.now ?? (() => new Date());
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const deadline = monotonicNow() + dependencies.config.runBudgetMs;
  const withinBudget = <T>(
    operation: (signal: AbortSignal) => Promise<T>,
    maximumMs = Number.POSITIVE_INFINITY,
  ): Promise<T> => {
    const remaining = Math.max(0, deadline - monotonicNow());
    if (remaining === 0) return Promise.reject(new TimeoutError("simulation"));
    return withTimeout(operation, Math.min(remaining, maximumMs), "simulation");
  };
  const validateUrls = dependencies.validateUrls ?? (async (store, target) => {
    await assertSameOriginTarget(store, target);
  });
  await withinBudget(async () => validateUrls(input.store_url, input.target_product_url));
  if (dependencies.agent.kind !== input.agent_kind) {
    throw new Error("configured shopper agent kind does not match simulation input");
  }

  const snapshotAt = now().toISOString();
  const snapshot = await withinBudget((signal) => snapshotStore({
      storeUrl: input.store_url,
      targetProductUrl: input.target_product_url,
      fetchedAt: snapshotAt,
      fetcher: dependencies.fetcher,
      signal,
    }));
  const personas = await retryOnce(() => withinBudget(
    (signal) => generatePersonas({
      productName: snapshot.targetProduct.name,
      category: snapshot.targetProduct.category,
      price: snapshot.targetProduct.price,
      attributes: snapshot.productAttributes,
      locale: input.locale,
      count: dependencies.config.agentCount,
      signal,
    }, dependencies.personaClient),
    dependencies.config.agentAttemptTimeoutMs,
  ));

  const completed = await mapConcurrent(
    personas,
    dependencies.config.agentConcurrency,
    async (brief, index) => {
      const remaining = Math.max(0, deadline - monotonicNow());
      if (remaining === 0) return failedAgentRun(brief, index, dependencies.agent, now(), "AGENT_TIMEOUT");
      let completedAgent: CompletedAgent;
      try {
        completedAgent = await retryOnce(() => {
          const attemptRemaining = Math.max(0, deadline - monotonicNow());
          if (attemptRemaining === 0) return Promise.reject(new TimeoutError(`shopper ${brief.query_id}`));
          return withTimeout(
          (attemptSignal) => runAgentAttempt(
            input,
            brief,
            index,
            dependencies.agent,
            snapshot,
            dependencies.fetcher,
            now,
            attemptSignal,
          ),
          Math.min(dependencies.config.agentAttemptTimeoutMs, attemptRemaining),
          `shopper ${brief.query_id}`,
          );
        });
      } catch (error) {
        return failedAgentRun(
          brief,
          index,
          dependencies.agent,
          now(),
          error instanceof TimeoutError ? "AGENT_TIMEOUT" : "AGENT_ERROR",
        );
      }
      for (const event of completedAgent.events) await dependencies.eventSink.emit(event);
      return completedAgent;
    },
  );
  const agentRuns = completed.map((entry) => entry.run);
  const evidence = [...snapshot.evidence, ...completed.flatMap((entry) => entry.evidence)];
  const store = new URL(input.store_url);
  const domain = stripWww(store.hostname.toLowerCase());
  const result: CheckResult = {
    schema_version: SCHEMA_VERSION,
    report_type: REPORT_TYPE,
    report_id: input.report_id,
    run_id: input.run_id,
    generated_at: now().toISOString(),
    status: "complete",
    error: null,
    brand: {
      brand_id: input.brand_id ?? `brand_${domain.replace(/[^a-z0-9]+/g, "_")}`,
      name: input.brand_name ?? domain,
      store_url: store.href,
      domain,
    },
    target_product: snapshot.targetProduct,
    catalogue_snapshot: snapshot.catalogueSnapshot,
    site_audit: snapshot.siteAudit,
    evaluation_config: {
      locale: input.locale,
      currency: input.currency,
      agent_count: personas.length,
      channels_tested: ["store_browse", "web_search", "acp", "ucp"],
      queries: personas.map((brief) => ({ query_id: brief.query_id, text: brief.query, intent: brief.intent })),
    },
    agent_runs: agentRuns,
    evidence,
    scores: computeScores(agentRuns, snapshot.siteAudit, snapshot.catalogueSnapshot),
    hosted_sources: [],
    baseline_report_id: input.baseline_report_id,
  };
  assertCheckResult(result);
  await dependencies.resultSink.save(result);
  return result;
}

async function runAgentAttempt(
  input: SimulationInput,
  brief: PersonaBrief,
  index: number,
  agent: ShopperAgent,
  snapshot: StoreSnapshot,
  fetcher: DocumentFetcher,
  now: () => Date,
  signal: AbortSignal,
): Promise<CompletedAgent> {
  const started = now();
  const events: AgentEvent[] = [];
  for await (const event of agent.run(brief, {
    runId: input.run_id,
    locale: input.locale,
    currency: input.currency,
    storeOrigin: new URL(input.store_url).origin,
    fetchPage: (url, fetchSignal) => fetcher.get(url, fetchSignal),
    signal,
  })) {
    events.push(event);
  }
  const verdict = events.findLast((event): event is Extract<AgentEvent, { type: "agent.verdict" }> => event.type === "agent.verdict");
  if (!verdict) throw new Error("shopper produced no verdict");
  const citations = events
    .filter((event): event is Extract<AgentEvent, { type: "agent.citation" }> => event.type === "agent.citation")
    .map((event) => ({ title: event.title, url: event.url }));
  const fetchedUrls = events
    .filter((event): event is Extract<AgentEvent, { type: "agent.fetch" }> => event.type === "agent.fetch")
    .filter((event) => event.status !== null && event.status >= 200 && event.status < 300)
    .map((event) => event.url);
  const observations = deriveObservations(snapshot, verdict.proposal, fetchedUrls);
  const matched = matchProposal({
    brandDomain: new URL(input.store_url).hostname,
    target: snapshot.targetProduct,
    proposal: verdict.proposal,
    citations,
    fetchedUrls,
    observations,
  });
  const evidence = eventEvidence(events, brief.query_id, now);
  const durationMs = Math.max(0, now().getTime() - started.getTime());
  const webEvidenceIds = evidence.filter((item) => item.kind === "search_result" || item.kind === "api_call").map((item) => item.evidence_id);
  const storeEvidenceIds = evidence
    .filter((item) => item.kind === "fetch" && item.url && item.status !== null && item.status >= 200 && item.status < 300 && belongsToDomain(item.url, input.store_url))
    .map((item) => item.evidence_id);

  return {
    events,
    evidence,
    run: {
      run_id: `ar_${String(index + 1).padStart(3, "0")}`,
      query_id: brief.query_id,
      agent: {
        agent_id: `agent_${String(index + 1).padStart(3, "0")}`,
        name: brief.name,
        persona: brief.persona,
        color_hex: AGENT_COLORS[index % AGENT_COLORS.length] ?? "#475569",
        model: agent.model,
        kind: agent.kind,
      },
      journey: {
        started_at: started.toISOString(),
        duration_ms: durationMs,
        stages: successfulStages(storeEvidenceIds, webEvidenceIds),
      },
      outcome: matched.outcome,
      ranked_candidates: matched.rankedCandidates,
      observations,
    },
  };
}

function failedAgentRun(
  brief: PersonaBrief,
  index: number,
  agent: ShopperAgent,
  started: Date,
  code: "AGENT_ERROR" | "AGENT_TIMEOUT",
): CompletedAgent {
  const observations = emptyObservations();
  return {
    events: [],
    evidence: [],
    run: {
      run_id: `ar_${String(index + 1).padStart(3, "0")}`,
      query_id: brief.query_id,
      agent: {
        agent_id: `agent_${String(index + 1).padStart(3, "0")}`,
        name: brief.name,
        persona: brief.persona,
        color_hex: AGENT_COLORS[index % AGENT_COLORS.length] ?? "#475569",
        model: agent.model,
        kind: agent.kind,
      },
      journey: { started_at: started.toISOString(), duration_ms: 0, stages: failedStages(code) },
      outcome: {
        target_discovered: false,
        target_identity_matched: false,
        target_recommended: false,
        target_rank: null,
        candidate_count: 0,
        top_3: false,
        purchase_intent: "none",
        purchase_completed: false,
        confidence: 0,
        failure_codes: [{ code }],
        final_choice: null,
        our_pages_fetched: [],
      },
      ranked_candidates: [],
      observations,
    },
  };
}

function deriveObservations(snapshot: StoreSnapshot, proposal: ShopperProposal, fetchedUrls: string[]): Observations {
  const targetSeen = fetchedUrls.some((url) => sameResource(url, snapshot.targetProduct.canonical_url));
  const targetCandidate = proposal.candidates.find((candidate) => sameResource(candidate.url, snapshot.targetProduct.canonical_url));
  return {
    price_found: targetSeen && snapshot.targetProduct.price !== null,
    availability_found: targetSeen && snapshot.availability !== null,
    shipping_information_found: false,
    return_policy_found: false,
    structured_product_data_found: targetSeen && !snapshot.siteAudit.structured_data.missing_json_ld_product_ids.includes(snapshot.targetProduct.product_id),
    reviews_found: targetSeen && (targetCandidate?.reason_codes.some((entry) => entry.code === "STRONG_REVIEW_EVIDENCE" || entry.code === "WEAK_REVIEW_EVIDENCE") ?? false),
    acp_supported: snapshot.siteAudit.agent_commerce.found,
    ucp_supported: snapshot.siteAudit.ucp.found,
  };
}

function eventEvidence(events: AgentEvent[], queryId: string, now: () => Date): Evidence[] {
  let citation = 0;
  let api = 0;
  let fetch = 0;
  const evidence: Evidence[] = [];
  for (const event of events) {
    if (event.type === "agent.citation") {
      citation += 1;
      evidence.push({
        evidence_id: `ev_${queryId}_citation_${String(citation).padStart(2, "0")}`,
        kind: "search_result",
        at: now().toISOString(),
        url: event.url,
        status: null,
        summary: `Recommendation source at position ${event.position}: ${event.title}`,
        excerpt: null,
      });
    }
    if (event.type === "agent.api") {
      api += 1;
      evidence.push({
        evidence_id: `ev_${queryId}_api_${String(api).padStart(2, "0")}`,
        kind: "api_call",
        at: now().toISOString(),
        url: null,
        status: null,
        summary: `${event.endpoint} completed in ${event.latency_ms}ms`,
        excerpt: null,
      });
    }
    if (event.type === "agent.fetch") {
      fetch += 1;
      evidence.push({
        evidence_id: `ev_${queryId}_fetch_${String(fetch).padStart(2, "0")}`,
        kind: "fetch",
        at: now().toISOString(),
        url: event.url,
        status: event.status,
        summary: event.status === null ? "Shopper page fetch failed" : `Shopper fetched page with HTTP ${event.status}`,
        excerpt: null,
      });
    }
  }
  return evidence;
}

function successfulStages(storeEvidenceIds: string[], webEvidenceIds: string[]): Stage[] {
  return [
    { stage: "store_browse", status: storeEvidenceIds.length > 0 ? "completed" : "skipped", duration_ms: 0, error_code: null, evidence_ids: storeEvidenceIds },
    { stage: "web_search", status: "completed", duration_ms: 0, error_code: null, evidence_ids: webEvidenceIds },
    { stage: "protocol_check", status: "completed", duration_ms: 0, error_code: null, evidence_ids: [] },
    { stage: "purchase_decision", status: "completed", duration_ms: 0, error_code: null, evidence_ids: [] },
  ];
}

function failedStages(code: string): Stage[] {
  return [
    { stage: "store_browse", status: "skipped", duration_ms: 0, error_code: null, evidence_ids: [] },
    { stage: "web_search", status: "failed", duration_ms: 0, error_code: code, evidence_ids: [] },
    { stage: "protocol_check", status: "skipped", duration_ms: 0, error_code: null, evidence_ids: [] },
    { stage: "purchase_decision", status: "skipped", duration_ms: 0, error_code: null, evidence_ids: [] },
  ];
}

function emptyObservations(): Observations {
  return {
    price_found: false,
    availability_found: false,
    shipping_information_found: false,
    return_policy_found: false,
    structured_product_data_found: false,
    reviews_found: false,
    acp_supported: false,
    ucp_supported: false,
  };
}

function sameResource(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return stripWww(a.hostname) === stripWww(b.hostname) && trimSlash(a.pathname) === trimSlash(b.pathname);
  } catch {
    return false;
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

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function stripWww(host: string): string {
  const lower = host.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

const AGENT_COLORS = [
  "#2563EB", "#7C3AED", "#DB2777", "#DC2626", "#EA580C",
  "#CA8A04", "#65A30D", "#16A34A", "#059669", "#0D9488",
  "#0891B2", "#0284C7", "#4F46E5", "#9333EA", "#C026D3",
  "#E11D48", "#475569", "#0F766E", "#4338CA", "#A21CAF",
] as const;
