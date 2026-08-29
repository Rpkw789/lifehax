/** Presentation helpers for the dashboard. Pure; no formatting logic in the view. */

import type { EvaluationConfig, RunScores } from "@contracts/check-result";

export interface QueryOutcome {
  queryId: string;
  text: string;
  intent: string;
  discovered: boolean;
  recommended: boolean;
  rank: number | null;
}

export function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatRank(value: number | null): string {
  return value === null ? "—" : String(value);
}

/** Score rows joined to their query text, recommended first. */
export function queryOutcomes(scores: RunScores, config: EvaluationConfig): QueryOutcome[] {
  const byId = new Map(config.queries.map((q) => [q.query_id, q]));

  return scores.by_query
    .map((row) => {
      const query = byId.get(row.query_id);
      return {
        queryId: row.query_id,
        text: query?.text ?? row.query_id,
        intent: query?.intent ?? "unknown",
        discovered: row.discovered,
        recommended: row.recommended,
        rank: row.rank,
      };
    })
    .sort((a, b) => Number(b.recommended) - Number(a.recommended));
}
