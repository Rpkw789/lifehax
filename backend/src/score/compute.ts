import type {
  AgentRun,
  CatalogueSnapshot,
  RunScores,
  SiteAudit,
} from "../../../shared/contracts/check-result.ts";

export function computeScores(
  runs: AgentRun[],
  audit: SiteAudit,
  catalogue: CatalogueSnapshot,
): RunScores {
  const total = runs.length;
  const recommended = runs.filter((run) => run.outcome.target_recommended);
  const discovered = runs.filter((run) => run.outcome.target_discovered);
  const targetRanks = recommended
    .map((run) => run.outcome.target_rank)
    .filter((rank): rank is number => rank !== null);

  return {
    hit_rate: ratio(recommended.length, total),
    discovery_rate: ratio(discovered.length, total),
    mean_rank: targetRanks.length === 0 ? null : round(targetRanks.reduce((sum, rank) => sum + rank, 0) / targetRanks.length),
    by_query: runs.map((run) => ({
      query_id: run.query_id,
      discovered: run.outcome.target_discovered,
      recommended: run.outcome.target_recommended,
      rank: run.outcome.target_rank,
    })),
    competitors_ahead: competitorsAhead(runs),
    surfaces: {
      discoverability: percentAverage([
        ratio(catalogue.products_readable, catalogue.products_total),
        ratio(audit.sitemap.products_listed, audit.sitemap.products_total),
        audit.robots.allows_agents ? 1 : 0,
      ]),
      structured_data: percentAverage([
        ratio(audit.structured_data.products_with_json_ld, audit.structured_data.products_total),
        ratio(audit.structured_data.products_with_offer, audit.structured_data.products_total),
      ]),
      agent_protocol: percentAverage([
        audit.llms_txt.found ? 1 : 0,
        audit.agent_commerce.found ? 1 : 0,
        audit.ucp.found ? 1 : 0,
      ]),
      content_quality: contentQuality(runs),
    },
  };
}

function competitorsAhead(runs: AgentRun[]): RunScores["competitors_ahead"] {
  const counts = new Map<string, { name: string; url: string; times_ahead: number }>();
  for (const run of runs) {
    const targetRank = run.outcome.target_rank;
    for (const candidate of run.ranked_candidates) {
      if (candidate.is_target_product || (targetRank !== null && candidate.rank >= targetRank)) continue;
      const key = candidate.url;
      const entry = counts.get(key) ?? { name: candidate.name, url: candidate.url, times_ahead: 0 };
      entry.times_ahead += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.times_ahead - a.times_ahead || a.url.localeCompare(b.url));
}

function contentQuality(runs: AgentRun[]): number {
  if (runs.length === 0) return 0;
  const values = runs.flatMap((run) => [
    run.observations.price_found,
    run.observations.availability_found,
    run.observations.shipping_information_found,
    run.observations.return_policy_found,
  ]);
  return percentAverage(values.map((value) => value ? 1 : 0));
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function percentAverage(values: number[]): number {
  return values.length === 0 ? 0 : round(values.reduce((sum, value) => sum + value, 0) / values.length * 100);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
