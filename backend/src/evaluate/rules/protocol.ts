/** No machine-readable buying surface: manifests, and the curated site guide. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import type { FindingEvidence } from "@contracts/finding";
import { runIdsReporting, wasReported } from "../helpers";
import { llmsTxtSnippet, manifestSnippet } from "../snippets";
import type { DraftFinding, Rule } from "../types";

/** Each manifest probe, paired with the document path that evidences it. */
const MANIFEST_PROBES: { code: FailureCode; reference: string }[] = [
  { code: "ACP_UNSUPPORTED", reference: "site_audit.agent_commerce" },
  { code: "UCP_UNSUPPORTED", reference: "site_audit.ucp" },
];

const MANIFEST_CODES: FailureCode[] = MANIFEST_PROBES.map((probe) => probe.code);

export const protocolManifestRule: Rule = {
  id: "protocol.manifest",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, ...MANIFEST_CODES);
    if (runIds.length === 0) return null;

    const observed = MANIFEST_CODES.filter((code) => wasReported(source, code));

    // Each run is evidenced only by the probes it actually reported — citing a
    // probe a run never observed would overstate the finding.
    const evidence: FindingEvidence[] = [];
    for (const run of source.agent_runs) {
      const probes = MANIFEST_PROBES.filter((probe) =>
        (run.outcome?.failure_codes ?? []).some((entry) => entry.code === probe.code),
      );
      if (probes.length === 0) continue;

      evidence.push({
        agent_run_id: run.run_id,
        fact: "The protocol check failed, so the agent fell back to reading the storefront by pixels",
        references: [
          `agent_runs#${run.run_id}.outcome.failure_codes`,
          ...probes.map((probe) => probe.reference),
        ],
      });
    }

    return {
      severity: "critical",
      title: "No agent-commerce manifest exists on either protocol",
      evidence,
      derived_from: runIds,
      addresses_failure_codes: observed,
      recommendation: {
        action:
          "Publish a manifest describing your catalog, search and checkout intents so agents can skip the UI entirely",
        surface: "agent_protocol",
        effort: "high",
        owner: "platform",
        snippet_label: "/.well-known/agent-commerce",
        snippet: manifestSnippet(),
      },
    };
  },
};

export const protocolLlmsTxtRule: Rule = {
  id: "protocol.llms_txt",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, "NO_LLMS_TXT");
    if (runIds.length === 0) return null;

    return {
      severity: "medium",
      title: "No llms.txt to guide models around the catalog",
      evidence: runIds.map((runId) => ({
        agent_run_id: runId,
        fact: "/llms.txt returned 404; the agent had no curated entry point and crawled blind",
        references: ["site_audit.llms_txt", `agent_runs#${runId}.outcome.failure_codes`],
      })),
      derived_from: runIds,
      addresses_failure_codes: ["NO_LLMS_TXT"],
      recommendation: {
        action: "Publish a curated site guide naming your buying surfaces, catalog structure and policies",
        surface: "discoverability",
        effort: "low",
        owner: "content",
        snippet_label: "llms.txt",
        snippet: llmsTxtSnippet(source.brand, source.site_audit),
      },
    };
  },
};
