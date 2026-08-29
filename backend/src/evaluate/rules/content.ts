/** The facts are readable, but they do not persuade. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import type { FindingEvidence } from "@contracts/finding";
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

/** Each shipping-related failure, with the sentence and paths that evidence it. */
const SHIPPING_PROBES: {
  code: FailureCode;
  fact: string;
  references: (runId: string) => string[];
}[] = [
  {
    code: "SHIPPING_INFO_NOT_FOUND",
    fact: "No shipping cost or delivery window was found on the product page",
    references: (runId) => [`agent_runs#${runId}.observations.shipping_information_found`],
  },
  {
    code: "OUTRANKED_BY_COMPETITOR",
    fact: "The agent chose a competitor that states its shipping terms inline",
    references: (runId) => [`agent_runs#${runId}.ranked_candidates`],
  },
];

const SHIPPING_CODES: FailureCode[] = SHIPPING_PROBES.map((probe) => probe.code);

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

    const evidence: FindingEvidence[] = [];
    for (const run of source.agent_runs) {
      if (!scoped.has(run.run_id)) continue;

      const probes = SHIPPING_PROBES.filter((probe) =>
        (run.outcome?.failure_codes ?? []).some((entry) => entry.code === probe.code),
      );
      if (probes.length === 0) continue;

      evidence.push({
        agent_run_id: run.run_id,
        fact: probes.map((probe) => probe.fact).join(" "),
        references: probes.flatMap((probe) => probe.references(run.run_id)),
      });
    }

    return {
      severity: "medium",
      title: "Shipping terms are absent from the product page",
      evidence,
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
