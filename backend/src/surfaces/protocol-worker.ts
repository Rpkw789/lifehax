import type { Evidence, ProbeResult } from "@contracts/check-result";
import type { FetchedDocument } from "../catalogue/snapshot.ts";
import { retryOnce } from "../runs/retry.ts";
import {
  requestSurfaceCritique,
  type SurfaceCritiqueClient,
} from "./critique.ts";
import { assessProtocolDocument, type ProtocolKind } from "./protocol.ts";
import type {
  SurfaceEventEmitter,
  SurfaceWorkerContext,
  SurfaceWorkerResult,
} from "./types.ts";

export async function runProtocolSimulation(
  context: SurfaceWorkerContext,
  emit: SurfaceEventEmitter,
  options: { acpPath?: string; critiqueClient?: SurfaceCritiqueClient } = {},
): Promise<SurfaceWorkerResult> {
  emit("agent_protocol", "context", "Loaded the shared product and shopper brief", null);
  const origin = new URL(context.storeUrl).origin;
  const paths = {
    acp: normalizePath(options.acpPath ?? "/.well-known/agent-commerce"),
    ucp: "/.well-known/ucp",
  } as const;
  const evidence: Evidence[] = [];
  const probes: Partial<Record<"agent_commerce" | "ucp", ProbeResult>> = {};
  const facts: string[] = [];
  let hasAssessableDocument = false;

  for (const kind of ["acp", "ucp"] as const) {
    const url = new URL(paths[kind], origin).href;
    const fetched = await fetchProtocol(context, kind, url, evidence, emit);
    if (!fetched) {
      probes[kind === "acp" ? "agent_commerce" : "ucp"] = {
        url,
        found: false,
        status: null,
        note: "Unable to verify",
      };
      continue;
    }
    const assessment = assessProtocolDocument(kind, fetched.document);
    hasAssessableDocument ||= assessment.found;
    facts.push(...assessment.facts);
    const extraction = addEvidence(evidence, `${kind}_assessment`, {
      kind: "extraction",
      at: context.at,
      url,
      status: fetched.document.status,
      summary: assessment.supported
        ? `${kind.toUpperCase()} support validated deterministically`
        : assessment.reason ?? `${kind.toUpperCase()} support not validated`,
      excerpt: assessment.parsed
        ? JSON.stringify(assessment.parsed).slice(0, 2_000)
        : null,
    });
    emit(
      "agent_protocol",
      "parse",
      assessment.parsed
        ? `Parsed ${kind.toUpperCase()} response as JSON`
        : `${kind.toUpperCase()} response did not expose parsable protocol JSON`,
      extraction.evidence_id,
    );
    emit(
      "agent_protocol",
      "validate",
      assessment.supported
        ? `${kind.toUpperCase()} support validated from document fields`
        : `${kind.toUpperCase()}: ${assessment.reason ?? "unsupported"}`,
      extraction.evidence_id,
    );
    probes[kind === "acp" ? "agent_commerce" : "ucp"] = {
      url,
      found: assessment.supported,
      status: fetched.document.status,
      note: assessment.reason ?? assessment.facts.join("; "),
    };
  }

  let critique = null;
  if (hasAssessableDocument) {
    emit("agent_protocol", "model", "Critiquing the retrieved protocol evidence", null);
    const result = await requestSurfaceCritique(
      {
        surface: "agent_protocol",
        facts,
        evidence,
        target: context.target,
        brief: context.brief,
        locale: context.locale,
        currency: context.currency,
        signal: context.signal,
      },
      options.critiqueClient,
    );
    critique = result.critique;
    const modelEvidence = addEvidence(evidence, "critique", {
      kind: "model_output",
      at: context.at,
      url: null,
      status: null,
      summary: `${result.source === "model" ? "Model" : "Fallback"} protocol critique`,
      excerpt: JSON.stringify(result.critique).slice(0, 4_000),
    });
    emit("agent_protocol", "model", result.critique.summary, modelEvidence.evidence_id);
  }

  const supported = [probes.agent_commerce, probes.ucp].filter((probe) => probe?.found).length;
  emit(
    "agent_protocol",
    "result",
    supported === 0
      ? "Simulation settled: ACP/UCP unavailable at the tested endpoints"
      : `Simulation settled: ${supported} of 2 protocol endpoints validated`,
    evidence.at(-1)?.evidence_id ?? null,
  );
  return { surface: "agent_protocol", evidence, probes, critique };
}

async function fetchProtocol(
  context: SurfaceWorkerContext,
  kind: ProtocolKind,
  url: string,
  evidence: Evidence[],
  emit: SurfaceEventEmitter,
): Promise<{ document: FetchedDocument } | null> {
  try {
    const document = await retryOnce(() => context.fetcher.get(url, context.signal));
    const item = addEvidence(evidence, `${kind}_fetch`, {
      kind: "fetch",
      at: context.at,
      url: document.url,
      status: document.status,
      summary: `Fetched ${new URL(document.url).pathname} with HTTP ${document.status}`,
      excerpt: document.body.replace(/\s+/g, " ").trim().slice(0, 2_000) || null,
    });
    emit("agent_protocol", "fetch", `GET ${url} returned HTTP ${document.status}`, item.evidence_id);
    return { document };
  } catch {
    const item = addEvidence(evidence, `${kind}_fetch`, {
      kind: "fetch",
      at: context.at,
      url,
      status: null,
      summary: `Unable to verify ${kind.toUpperCase()} endpoint`,
      excerpt: null,
    });
    emit("agent_protocol", "fetch", `Unable to verify ${url}`, item.evidence_id);
    return null;
  }
}

function addEvidence(
  evidence: Evidence[],
  suffix: string,
  item: Omit<Evidence, "evidence_id">,
): Evidence {
  const complete = { evidence_id: `ev_protocol_${suffix}`, ...item };
  evidence.push(complete);
  return complete;
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/.well-known/agent-commerce";
  try {
    const parsed = new URL(trimmed, "https://placeholder.invalid");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/.well-known/agent-commerce";
  }
}
