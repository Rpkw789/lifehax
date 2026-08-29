/** No machine-readable buying surface: manifests, and the curated site guide. */

import type { CheckResult } from "@contracts/check-result";
import type { FailureCode } from "@contracts/codes";
import { runIdsReporting, wasReported } from "../helpers";
import { llmsTxtSnippet, manifestSnippet } from "../snippets";
import type { DraftFinding, Rule } from "../types";

const MANIFEST_CODES: FailureCode[] = ["ACP_UNSUPPORTED", "UCP_UNSUPPORTED"];

export const protocolManifestRule: Rule = {
  id: "protocol.manifest",

  evaluate(source: CheckResult): DraftFinding | null {
    const runIds = runIdsReporting(source, ...MANIFEST_CODES);
    if (runIds.length === 0) return null;

    const observed = MANIFEST_CODES.filter((code) => wasReported(source, code));

    return {
      severity: "critical",
      title: "No agent-commerce manifest exists on either protocol",
      evidence: runIds.map((runId) => ({
        agent_run_id: runId,
        fact: "The protocol check failed, so the agent fell back to reading the storefront by pixels",
        references: [`agent_runs#${runId}.outcome.failure_codes`, "site_audit.agent_commerce", "site_audit.ucp"],
      })),
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
