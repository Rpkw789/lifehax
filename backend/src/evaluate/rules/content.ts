/** The facts are readable, but they do not persuade. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import { missingAttributes, runIdsReporting } from "../helpers";
import { attributeSnippet, shippingSnippet } from "../snippets";
import type { DraftFinding, Rule } from "../types";

export const contentAttributesRule: Rule = {
  id: "content.attributes",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, "MISSING_ATTRIBUTE_EVIDENCE");
    if (runIds.length === 0) return null;

    return {
      severity: "high",
      title: "Product attributes are claimed in prose but carry no structured value",
      evidence: runIds.map((runId) => ({
        agent_run_id: runId,
        fact: "The agent flagged an attribute claim as unevidenced while a competitor stated it clearly",
        references: [
          `agent_runs#${runId}.outcome.failure_codes`,
          "catalogue_snapshot.target_field_sources",
        ],
      })),
      derived_from: runIds,
      addresses_failure_codes: ["MISSING_ATTRIBUTE_EVIDENCE"],
      recommendation: {
        action: "Emit one additionalProperty per attribute a buyer would filter on, server-side",
        surface: "structured_data",
        effort: "low",
        owner: "web",
        snippet_label: "Product JSON-LD",
        snippet: attributeSnippet(missingAttributes(source)),
      },
    };
  },
};

const SHIPPING_CODES: FailureCode[] = ["SHIPPING_INFO_NOT_FOUND", "OUTRANKED_BY_COMPETITOR"];

export const contentShippingRule: Rule = {
  id: "content.shipping",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, "SHIPPING_INFO_NOT_FOUND");
    if (runIds.length === 0) return null;

    // Only claim OUTRANKED_BY_COMPETITOR when the same runs actually reported it,
    // or validation rejects the finding.
    const scoped = new Set(runIds);
    const observed = SHIPPING_CODES.filter((code) =>
      runIdsReporting(source, code).some((id) => scoped.has(id)),
    );

    return {
      severity: "medium",
      title: "Shipping terms are absent from the product page",
      evidence: runIds.map((runId) => ({
        agent_run_id: runId,
        fact: "A shipping-sensitive agent dropped the product and chose a competitor that states free shipping inline",
        references: [
          `agent_runs#${runId}.observations.shipping_information_found`,
          `agent_runs#${runId}.ranked_candidates`,
        ],
      })),
      derived_from: runIds,
      addresses_failure_codes: observed,
      recommendation: {
        action: "State shipping cost and delivery window as structured data on the offer, not only at checkout",
        surface: "content_quality",
        effort: "low",
        owner: "content",
        snippet_label: "Shipping details",
        snippet: shippingSnippet(),
      },
    };
  },
};
