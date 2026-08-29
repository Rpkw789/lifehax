/** Product facts exist but not in a form an agent can read. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import type { FindingEvidence } from "@contracts/finding";
import { runIdsReporting, wasReported } from "../helpers";
import { offerSnippet } from "../snippets";
import type { DraftFinding, Rule } from "../types";

const CODES: FailureCode[] = ["PRICE_CLIENT_SIDE_ONLY", "NO_OFFER_SCHEMA"];

export const structuredOfferRule: Rule = {
  id: "structured.offer",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, ...CODES);
    if (runIds.length === 0) return null;

    const observed = CODES.filter((code) => wasReported(source, code));

    const evidence: FindingEvidence[] = runIds.map((runId) => ({
      agent_run_id: runId,
      fact: "The agent read the page and found no price; it is absent from served HTML and appears only after hydration",
      references: [
        `agent_runs#${runId}.observations.price_found`,
        "site_audit.client_side_price_product_ids",
      ],
    }));

    evidence.push({
      agent_run_id: null,
      fact: `Only ${source.site_audit.structured_data.products_with_offer} of ${source.site_audit.structured_data.products_total} products carry Offer data`,
      references: ["site_audit.structured_data.missing_offer_product_ids"],
    });

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
