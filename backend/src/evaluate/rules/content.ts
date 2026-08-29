/** The facts are readable, but they do not persuade. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import { evidencePerRun, type Probe } from "../evidence";
import { missingAttributes, runIdsReporting } from "../helpers";
import { attributeSnippet, shippingSnippet } from "../snippets";
import type { DraftFinding, Rule } from "../types";

/** The attribute failure, with the sentence and paths that evidence it. */
const ATTRIBUTE_PROBES: Probe[] = [
  {
    code: "MISSING_ATTRIBUTE_EVIDENCE",
    fact: "The agent flagged an attribute claim as unevidenced",
    references: (runId) => [
      `agent_runs#${runId}.outcome.failure_codes`,
      "catalogue_snapshot.target_field_sources",
    ],
  },
];

export const contentAttributesRule: Rule = {
  id: "content.attributes",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, "MISSING_ATTRIBUTE_EVIDENCE");
    if (runIds.length === 0) return null;

    return {
      severity: "high",
      title: "Product attributes are claimed in prose but carry no structured value",
      evidence: evidencePerRun(source, ATTRIBUTE_PROBES),
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
const SHIPPING_PROBES: Probe[] = [
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

    return {
      severity: "medium",
      title: "Shipping terms are absent from the product page",
      evidence: evidencePerRun(source, SHIPPING_PROBES, scoped),
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
