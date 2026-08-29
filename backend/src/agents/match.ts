import type { FailureEntry } from "../../../shared/contracts/codes.ts";
import type {
  FinalChoice,
  Observations,
  Outcome,
  RankedCandidate,
  TargetProduct,
} from "../../../shared/contracts/check-result.ts";
import type { SearchCitation, ShopperProposal } from "./types.ts";

export interface MatchInput {
  brandDomain: string;
  target: TargetProduct;
  proposal: ShopperProposal;
  citations: SearchCitation[];
  fetchedUrls: string[];
  observations: Observations;
}

export interface MatchResult {
  outcome: Outcome;
  rankedCandidates: RankedCandidate[];
}

export function matchProposal(input: MatchInput): MatchResult {
  const targetKey = resourceKey(input.target.canonical_url);
  const citedKeys = new Set(input.citations.map((citation) => safeResourceKey(citation.url)).filter((key): key is string => key !== null));
  const targetIdentityMatched = citedKeys.has(targetKey);
  const targetDiscovered = input.citations.some((citation) => belongsToDomain(citation.url, input.brandDomain));
  const rankedCandidates = input.proposal.candidates
    .filter((candidate) => {
      const key = safeResourceKey(candidate.url);
      return key !== null && citedKeys.has(key);
    })
    .map((candidate, index): RankedCandidate => {
    const isTarget = safeResourceKey(candidate.url) === targetKey;
    return {
      rank: index + 1,
      product_id: isTarget ? input.target.product_id : competitorId(candidate.url),
      name: candidate.name,
      url: candidate.url,
      is_target_product: isTarget,
      reason_codes: candidate.reason_codes,
    };
    });
  const targetCandidate = rankedCandidates.find((candidate) => candidate.is_target_product);
  const targetRecommended = targetCandidate !== undefined;
  const failureCodes = deriveFailureCodes(targetDiscovered, targetRecommended);
  const first = rankedCandidates[0];
  const finalChoice: FinalChoice | null = first
    ? { product_id: first.product_id, name: first.name, url: first.url, is_target_product: first.is_target_product }
    : null;

  return {
    rankedCandidates,
    outcome: {
      target_discovered: targetDiscovered,
      target_identity_matched: targetIdentityMatched,
      target_recommended: targetRecommended,
      target_rank: targetCandidate?.rank ?? null,
      candidate_count: rankedCandidates.length,
      top_3: targetCandidate !== undefined && targetCandidate.rank <= 3,
      purchase_intent: input.proposal.purchase_intent,
      purchase_completed: false,
      confidence: input.proposal.confidence,
      failure_codes: failureCodes,
      final_choice: finalChoice,
      our_pages_fetched: unique(input.fetchedUrls.filter((url) => belongsToDomain(url, input.brandDomain))),
    },
  };
}

function deriveFailureCodes(discovered: boolean, recommended: boolean): FailureEntry[] {
  if (recommended) return [];
  return [{ code: discovered ? "OUTRANKED_BY_COMPETITOR" : "NOT_IN_SEARCH_RESULTS" }];
}

function belongsToDomain(rawUrl: string, domain: string): boolean {
  try {
    const host = stripWww(new URL(rawUrl).hostname.toLowerCase());
    const expected = stripWww(domain.toLowerCase());
    return host === expected || host.endsWith(`.${expected}`);
  } catch {
    return false;
  }
}

function resourceKey(rawUrl: string): string {
  const url = new URL(rawUrl);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  return `${stripWww(url.hostname.toLowerCase())}${path}`;
}

function safeResourceKey(rawUrl: string): string | null {
  try {
    return resourceKey(rawUrl);
  } catch {
    return null;
  }
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function competitorId(rawUrl: string): string {
  try {
    return `url_${resourceKey(rawUrl).replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase()}`;
  } catch {
    return "url_unknown";
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
