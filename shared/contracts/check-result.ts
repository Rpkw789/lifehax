/**
 * The Check (Simulate) output document — the single interface between the Check
 * workstream and the Evaluate workstream.
 *
 * Wire format is snake_case; these interfaces mirror it exactly so there is no
 * mapping layer to drift. Changing anything here is a cross-team change: update
 * this file, the fixture, and docs/data-contracts.md in one commit.
 */

import type { FailureEntry, ReasonEntry } from "./codes";

export const SCHEMA_VERSION = "1.1.0";
export const REPORT_TYPE = "happy2.llo_evaluation";

/** Stages an agent moves through. Site stages are fetch-based, never a browser. */
export type StageName =
  | "store_browse"
  | "web_search"
  | "protocol_check"
  | "purchase_decision";

export type StageStatus = "completed" | "failed" | "skipped";

export type Channel = "store_browse" | "web_search" | "acp" | "ucp";

export interface CheckResult {
  schema_version: string;
  report_type: typeof REPORT_TYPE;
  report_id: string;
  run_id: string;
  generated_at: string;
  status: "running" | "complete" | "error";
  error: string | null;

  brand: Brand;
  target_product: TargetProduct;
  catalogue_snapshot: CatalogueSnapshot;
  site_audit: SiteAudit;
  evaluation_config: EvaluationConfig;
  agent_runs: AgentRun[];
  evidence: Evidence[];
  scores: RunScores;

  /**
   * Create-generated artifact URLs that were reachable by agents this run.
   * Empty on a first run; populated on a re-run. This is what makes the loop
   * self-verifying.
   */
  hosted_sources: string[];

  /** report_id of the run this one is compared against, if any. */
  baseline_report_id: string | null;
}

export interface Brand {
  brand_id: string;
  name: string;
  store_url: string;
  /** Canonical host used for deterministic matching, e.g. "example.com". */
  domain: string;
}

export interface TargetProduct {
  product_id: string;
  name: string;
  canonical_url: string;
  gtin: string | null;
  sku: string | null;
  category: string | null;
  price: Money | null;
}

export interface Money {
  amount: number;
  currency: string;
}

/** What we could actually read from the store. Evaluate diagnoses gaps from this. */
export interface CatalogueSnapshot {
  fetched_at: string;
  products_total: number;
  products_readable: number;
  /** Referenced by sitemap or feed but unfetchable or unparseable. */
  unreadable: { url: string; reason: string }[];
  /** Where each field of the target product came from. Drives Create provenance. */
  target_field_sources: Record<
    string,
    "json-ld" | "raw-html" | "feed" | "meta" | "absent"
  >;
}

/**
 * Store-level facts, checked once per run rather than per agent. Half of
 * Evaluate's findings originate here.
 */
export interface SiteAudit {
  llms_txt: ProbeResult;
  agent_commerce: ProbeResult;
  ucp: ProbeResult;
  robots: ProbeResult & { allows_agents: boolean };
  sitemap: ProbeResult & {
    products_listed: number;
    products_total: number;
    /** Which products are absent — identities, not just a count. */
    missing_product_ids: string[];
  };
  structured_data: {
    products_total: number;
    products_with_json_ld: number;
    products_with_offer: number;
    missing_json_ld_product_ids: string[];
    missing_offer_product_ids: string[];
  };
  /** Products whose price is absent from served HTML and only appears after JS. */
  client_side_price_product_ids: string[];
}

export interface ProbeResult {
  url: string;
  found: boolean;
  status: number | null;
  note: string | null;
}

export interface EvaluationConfig {
  locale: string;
  currency: string;
  agent_count: number;
  channels_tested: Channel[];
  queries: Query[];
}

export interface Query {
  query_id: string;
  text: string;
  intent: IntentArchetype;
}

/**
 * Category-agnostic intent archetypes. The archetype is a constant; the query
 * text is generated per catalogue at runtime.
 */
export type IntentArchetype =
  | "product_discovery"
  | "budget_led"
  | "spec_led"
  | "gift"
  | "bulk"
  | "urgent"
  | "sustainability_led"
  | "comparison"
  | "novice"
  | "replacement"
  | "constraint_led";

export interface AgentRun {
  run_id: string;
  query_id: string;
  agent: AgentIdentity;
  journey: Journey;
  outcome: Outcome;
  ranked_candidates: RankedCandidate[];
  observations: Observations;
}

export interface AgentIdentity {
  agent_id: string;
  name: string;
  persona: string;
  color_hex: string;
  model: string;
  /** Which tier ran this agent. Shared-search is the free path. */
  kind: "shared-search" | "native-search";
}

export interface Journey {
  started_at: string;
  duration_ms: number;
  stages: Stage[];
}

export interface Stage {
  stage: StageName;
  status: StageStatus;
  duration_ms: number;
  error_code: string | null;
  evidence_ids: string[];
}

export interface Outcome {
  /** Our domain appeared in retrieved results at all. */
  target_discovered: boolean;
  /** The retrieved page was confirmed to be the target product. */
  target_identity_matched: boolean;
  /** The agent actually recommended it. Discovered-but-not-recommended is the
   *  single most diagnostic distinction in this document. */
  target_recommended: boolean;
  target_rank: number | null;
  candidate_count: number;
  top_3: boolean;
  purchase_intent: "high" | "medium" | "low" | "none";
  purchase_completed: boolean;
  confidence: number;
  failure_codes: FailureEntry[];
  final_choice: FinalChoice | null;
  /** Our URLs the agent actually fetched. Separates "never found" from "read and rejected". */
  our_pages_fetched: string[];
}

export interface FinalChoice {
  product_id: string;
  name: string;
  url: string;
  is_target_product: boolean;
}

export interface RankedCandidate {
  rank: number;
  product_id: string;
  name: string;
  url: string;
  is_target_product: boolean;
  reason_codes: ReasonEntry[];
}

/** Per-run, per-product observations. Store-level facts live in SiteAudit. */
export interface Observations {
  price_found: boolean;
  availability_found: boolean;
  shipping_information_found: boolean;
  return_policy_found: boolean;
  structured_product_data_found: boolean;
  reviews_found: boolean;
  acp_supported: boolean;
  ucp_supported: boolean;
}

/** Referenced by `evidence_ids`. Every finding must trace back to one of these. */
export interface Evidence {
  evidence_id: string;
  kind: "search_result" | "fetch" | "api_call" | "extraction" | "model_output";
  at: string;
  url: string | null;
  /** HTTP status where applicable. */
  status: number | null;
  summary: string;
  /** Raw excerpt, truncated. Never contains credentials. */
  excerpt: string | null;
}

export interface RunScores {
  /** agent_runs where target_recommended / total. 0..1 */
  hit_rate: number;
  /** agent_runs where target_discovered / total. 0..1 */
  discovery_rate: number;
  /** Mean target_rank over runs that recommended it. */
  mean_rank: number | null;
  by_query: {
    query_id: string;
    discovered: boolean;
    recommended: boolean;
    rank: number | null;
  }[];
  /** Competitors that outranked the target, by how often. */
  competitors_ahead: { name: string; url: string; times_ahead: number }[];
  surfaces: {
    discoverability: number;
    structured_data: number;
    agent_protocol: number;
    content_quality: number;
  };
}
