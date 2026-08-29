/** Agents could not retrieve the product at all. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import type { FindingEvidence } from "@contracts/finding";
import { evidencePerRun, type Probe } from "../evidence";
import { runIdsReporting, wasReported } from "../helpers";
import { feedSnippet } from "../snippets";
import type { DraftFinding, Rule } from "../types";

/** Each discovery failure, with the sentence and paths that evidence it. */
const DISCOVERY_PROBES: Probe[] = [
  {
    code: "NOT_IN_SITEMAP",
    fact: "The product is absent from the sitemap, so the agent had no machine-readable route to it",
    references: (runId) => [`agent_runs#${runId}.outcome.target_discovered`],
  },
  {
    code: "NOT_IN_SEARCH_RESULTS",
    fact: "The domain did not appear in the agent's search results and none of our pages were fetched",
    references: (runId) => [`agent_runs#${runId}.outcome.our_pages_fetched`],
  },
];

const CODES: FailureCode[] = DISCOVERY_PROBES.map((probe) => probe.code);

export const discoverySourcesRule: Rule = {
  id: "discovery.sources",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, ...CODES);
    if (runIds.length === 0) return null;

    const observed = CODES.filter((code) => wasReported(source, code));

    const evidence: FindingEvidence[] = evidencePerRun(source, DISCOVERY_PROBES);

    const missing = source.site_audit.sitemap.missing_product_ids.length;
    if (missing > 0) {
      evidence.push({
        agent_run_id: null,
        fact: `${missing} of ${source.site_audit.sitemap.products_total} products are missing from sitemap.xml`,
        references: ["site_audit.sitemap.missing_product_ids", "site_audit.sitemap.products_listed"],
      });
    }

    return {
      severity: "critical",
      title: "Target product is absent from machine-readable discovery sources",
      evidence,
      derived_from: runIds,
      addresses_failure_codes: observed,
      recommendation: {
        action:
          "Regenerate the sitemap from the live catalog on publish and serve a machine-readable product feed at a stable URL",
        surface: "discoverability",
        effort: "low",
        owner: "seo",
        snippet_label: "Feed",
        snippet: feedSnippet(source.site_audit),
      },
    };
  },
};
