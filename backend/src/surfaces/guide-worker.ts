import type { Evidence, ProbeResult } from "@contracts/check-result";
import { retryOnce } from "../runs/retry.ts";
import {
  requestSurfaceCritique,
  type SurfaceCritiqueClient,
} from "./critique.ts";
import { parseLlmsTxt, selectRelevantGuideLinks } from "./guide.ts";
import type {
  SurfaceEventEmitter,
  SurfaceWorkerContext,
  SurfaceWorkerResult,
} from "./types.ts";

export async function runGuideSimulation(
  context: SurfaceWorkerContext,
  emit: SurfaceEventEmitter,
  options: { critiqueClient?: SurfaceCritiqueClient } = {},
): Promise<SurfaceWorkerResult> {
  emit("model_readable_guide", "context", "Loaded the shared product and shopper brief", null);
  const url = new URL("/llms.txt", context.storeUrl).href;
  const evidence: Evidence[] = [];
  let document;
  try {
    document = await retryOnce(() => context.fetcher.get(url, context.signal));
  } catch {
    const failed = addEvidence(evidence, "fetch", {
      kind: "fetch", at: context.at, url, status: null,
      summary: "Unable to verify /llms.txt", excerpt: null,
    });
    emit("model_readable_guide", "fetch", `Unable to verify ${url}`, failed.evidence_id);
    emit("model_readable_guide", "result", "Simulation settled: Unable to verify", failed.evidence_id);
    return { surface: "model_readable_guide", evidence, probes: { llms_txt: probe(url, false, null, "Unable to verify") }, critique: null };
  }

  const found = document.status >= 200 && document.status < 300 && document.body.trim().length > 0 && !looksHtml(document.body, document.contentType);
  const fetched = addEvidence(evidence, "fetch", {
    kind: "fetch", at: context.at, url: document.url, status: document.status,
    summary: `Fetched /llms.txt with HTTP ${document.status}`,
    excerpt: document.body.replace(/\s+/g, " ").trim().slice(0, 4_000) || null,
  });
  emit("model_readable_guide", "fetch", `GET ${url} returned HTTP ${document.status}`, fetched.evidence_id);
  if (!found) {
    emit("model_readable_guide", "validate", "llms.txt: Unable to be found", fetched.evidence_id);
    emit("model_readable_guide", "result", "Simulation settled: Unable to be found", fetched.evidence_id);
    return { surface: "model_readable_guide", evidence, probes: { llms_txt: probe(url, false, document.status, "Unable to be found") }, critique: null };
  }

  const parsed = parseLlmsTxt(document.body, context.target);
  const extraction = addEvidence(evidence, "assessment", {
    kind: "extraction", at: context.at, url, status: document.status,
    summary: parsed.target_covered ? "llms.txt directly covers the target" : "llms.txt does not directly cover the target",
    excerpt: JSON.stringify(parsed).slice(0, 4_000),
  });
  emit("model_readable_guide", "parse", `Parsed ${parsed.links.length} links across ${parsed.sections.length} sections`, extraction.evidence_id);
  emit(
    "model_readable_guide",
    "validate",
    parsed.structurally_valid
      ? "llms.txt matches the required structural format"
      : `llms.txt is structurally invalid: ${parsed.facts.join("; ")}`,
    extraction.evidence_id,
  );
  emit("model_readable_guide", "validate", parsed.target_covered ? "Target product is linked directly" : "Target product is not linked directly", extraction.evidence_id);
  if (!parsed.structurally_valid) {
    emit("model_readable_guide", "result", "Simulation settled: guide found but structurally unusable", extraction.evidence_id);
    return {
      surface: "model_readable_guide",
      evidence,
      probes: {
        llms_txt: probe(
          url,
          false,
          document.status,
          `Found but structurally invalid; ${parsed.facts.join("; ")}`,
        ),
      },
      critique: null,
    };
  }

  const selected = selectRelevantGuideLinks(parsed, `${context.target.name} ${context.brief}`, new URL(context.storeUrl).origin, 3);
  let linkedSuccesses = 0;
  let linkedNonSuccesses = 0;
  let linkedFailures = 0;
  for (const [index, linkedUrl] of selected.entries()) {
    try {
      const linked = await retryOnce(() => context.fetcher.get(linkedUrl, context.signal));
      const linkedEvidence = addEvidence(evidence, `linked_${String(index + 1).padStart(2, "0")}`, {
        kind: "fetch", at: context.at, url: linked.url, status: linked.status,
        summary: `Fetched llms.txt-linked resource with HTTP ${linked.status}`,
        excerpt: linked.body.replace(/\s+/g, " ").trim().slice(0, 2_000) || null,
      });
      emit("model_readable_guide", "fetch", `Followed relevant guide link: ${linkedUrl} — HTTP ${linked.status}`, linkedEvidence.evidence_id);
      if (linked.status >= 200 && linked.status < 300) linkedSuccesses += 1;
      else linkedNonSuccesses += 1;
    } catch {
      linkedFailures += 1;
      const linkedEvidence = addEvidence(evidence, `linked_${String(index + 1).padStart(2, "0")}`, {
        kind: "fetch", at: context.at, url: linkedUrl, status: null,
        summary: "Unable to verify llms.txt-linked resource", excerpt: null,
      });
      emit("model_readable_guide", "fetch", `Unable to verify guide link: ${linkedUrl}`, linkedEvidence.evidence_id);
    }
  }

  const linkedFacts = [
    `${linkedSuccesses} followed links returned successful HTTP responses`,
    `${linkedNonSuccesses} followed links returned non-success HTTP statuses`,
    `${linkedFailures} followed links could not be verified`,
  ];

  emit("model_readable_guide", "model", "Critiquing /llms.txt and its relevant linked content", null);
  const critiqueResult = await requestSurfaceCritique(
    {
      surface: "model_readable_guide",
      facts: [...parsed.facts, ...linkedFacts],
      evidence,
      target: context.target,
      brief: context.brief,
      locale: context.locale,
      currency: context.currency,
      signal: context.signal,
    },
    options.critiqueClient,
  );
  const modelEvidence = addEvidence(evidence, "critique", {
    kind: "model_output", at: context.at, url: null, status: null,
    summary: `${critiqueResult.source === "model" ? "Model" : "Fallback"} llms.txt critique`,
    excerpt: JSON.stringify(critiqueResult.critique).slice(0, 4_000),
  });
  emit("model_readable_guide", "model", critiqueResult.critique.summary, modelEvidence.evidence_id);
  emit("model_readable_guide", "result", parsed.target_covered ? "Simulation settled: guide found and target covered" : "Simulation settled: guide found but target absent", modelEvidence.evidence_id);

  return {
    surface: "model_readable_guide",
    evidence,
    probes: { llms_txt: probe(url, true, document.status, parsed.facts.join("; ")) },
    critique: critiqueResult.critique,
  };
}

function probe(url: string, found: boolean, status: number | null, note: string): ProbeResult {
  return { url, found, status, note };
}

function addEvidence(evidence: Evidence[], suffix: string, item: Omit<Evidence, "evidence_id">): Evidence {
  const complete = { evidence_id: `ev_guide_${suffix}`, ...item };
  evidence.push(complete);
  return complete;
}

function looksHtml(body: string, contentType: string): boolean {
  return contentType.toLowerCase().includes("text/html") || /^\s*<(!doctype|html)/i.test(body);
}
