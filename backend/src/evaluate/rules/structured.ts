/** Product facts exist but not in a form an agent can read. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import type { FindingEvidence } from "@contracts/finding";
import { runIdsReporting, wasReported } from "../helpers";
import { offerSnippet } from "../snippets";
import type { DraftFinding, Rule } from "../types";

/** Each structured-data failure, with the sentence and paths that evidence it. */
const OFFER_PROBES: {
  code: FailureCode;
  fact: string;
  references: (runId: string) => string[];
}[] = [
  {
    code: "PRICE_CLIENT_SIDE_ONLY",
    fact: "The agent read the page and found no price; it is absent from served HTML and appears only after hydration",
    references: (runId) => [
      `agent_runs#${runId}.observations.price_found`,
      "site_audit.client_side_price_product_ids",
    ],
  },
  {
    code: "NO_OFFER_SCHEMA",
    fact: "The product page carries no structured Offer block for the agent to read",
    references: (runId) => [
      `agent_runs#${runId}.outcome.failure_codes`,
      "site_audit.structured_data.missing_offer_product_ids",
    ],
  },
];

const CODES: FailureCode[] = OFFER_PROBES.map((probe) => probe.code);

export const structuredOfferRule: Rule = {
  id: "structured.offer",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, ...CODES);
    if (runIds.length === 0) return null;

    const observed = CODES.filter((code) => wasReported(source, code));

    // Each run is evidenced only by the failures it actually reported — citing a
    // fact a run never observed would overstate the finding.
    const evidence: FindingEvidence[] = [];
    for (const run of source.agent_runs) {
      const probes = OFFER_PROBES.filter((probe) =>
        (run.outcome?.failure_codes ?? []).some((entry) => entry.code === probe.code),
      );
      if (probes.length === 0) continue;

      evidence.push({
        agent_run_id: run.run_id,
        fact: probes.map((probe) => probe.fact).join(" "),
        references: probes.flatMap((probe) => probe.references(run.run_id)),
      });
    }

    if (observed.includes("NO_OFFER_SCHEMA")) {
      evidence.push({
        agent_run_id: null,
        fact: `Only ${source.site_audit.structured_data.products_with_offer} of ${source.site_audit.structured_data.products_total} products carry Offer data`,
        references: ["site_audit.structured_data.missing_offer_product_ids"],
      });
    }

    return {
      severity: "high",
      title: "Price is injected client-side and no Offer schema is served",
      evidence,
      derived_from: runIds,
      addresses_failure_codes: observed,
      recommendation: {
        action: "Render price and availability into the initial HTML and emit a Product + Offer block server-side",
        surface: "structured_data",
        effort: "medium",
        owner: "web",
        snippet_label: "Offer block",
        snippet: offerSnippet(source.target_product),
      },
    };
  },
};
