import type { ReasonEntry } from "../../../shared/contracts/codes.ts";
import type { PersonaBrief } from "../personas/generate.ts";

export type AgentKind = "shared-search" | "native-search";

export interface CandidateProposal {
  name: string;
  url: string;
  reason_codes: ReasonEntry[];
}

export interface ShopperProposal {
  candidates: CandidateProposal[];
  purchase_intent: "high" | "medium" | "low" | "none";
  confidence: number;
}

export interface SearchCitation {
  title: string;
  url: string;
}

export interface WebSearchRequest {
  query: string;
  locale: string;
  currency: string;
  storeOrigin: string;
  fetchPage: (url: string, signal: AbortSignal) => Promise<{ url: string; status: number; body: string }>;
  signal: AbortSignal;
}

export interface FetchedPage {
  url: string;
  status: number | null;
  body: string | null;
}

export interface WebSearchResponse {
  proposal: ShopperProposal;
  citations: SearchCitation[];
  fetchedPages: Array<Omit<FetchedPage, "body">>;
  latencyMs: number;
}

export interface WebSearchClient {
  recommend(request: WebSearchRequest): Promise<WebSearchResponse>;
}

export interface RunContext {
  runId: string;
  locale: string;
  currency: string;
  storeOrigin: string;
  fetchPage: WebSearchRequest["fetchPage"];
  signal: AbortSignal;
}

interface AgentEventBase {
  run_id: string;
  query_id: string;
  agent_id: string;
  agent_kind: AgentKind;
}

export type AgentEvent =
  | (AgentEventBase & { type: "agent.query"; query: string })
  | (AgentEventBase & { type: "agent.api"; endpoint: string; latency_ms: number })
  | (AgentEventBase & { type: "agent.citation"; title: string; url: string; position: number })
  | (AgentEventBase & { type: "agent.fetch"; url: string; status: number | null; error_code: "FETCH_FAILED" | null })
  | (AgentEventBase & { type: "agent.verdict"; proposal: ShopperProposal });

export interface ShopperAgent {
  readonly kind: AgentKind;
  readonly model: string;
  run(brief: PersonaBrief, context: RunContext): AsyncIterable<AgentEvent>;
}
