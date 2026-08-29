import type { FetchedDocument } from "../catalogue/snapshot.ts";

export type ProtocolKind = "acp" | "ucp";

export interface ProtocolAssessment {
  kind: ProtocolKind;
  found: boolean;
  supported: boolean;
  parsed: Record<string, unknown> | null;
  facts: string[];
  reason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function successful(document: FetchedDocument): boolean {
  return document.status >= 200 && document.status < 300;
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(body);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function looksLikeHtml(document: FetchedDocument): boolean {
  const contentType = document.contentType.toLowerCase();
  const start = document.body.trimStart().slice(0, 100).toLowerCase();
  return (
    contentType.includes("text/html") ||
    start.startsWith("<!doctype html") ||
    start.startsWith("<html")
  );
}

export function assessProtocolDocument(
  kind: ProtocolKind,
  document: FetchedDocument,
): ProtocolAssessment {
  if (!successful(document) || looksLikeHtml(document)) {
    return {
      kind,
      found: false,
      supported: false,
      parsed: null,
      facts: [`${kind.toUpperCase()} support was not exposed at the tested URL`],
      reason: "Unable to be found",
    };
  }

  const parsed = parseJsonObject(document.body);
  if (!parsed) {
    return {
      kind,
      found: true,
      supported: false,
      parsed: null,
      facts: [`${kind.toUpperCase()} response was not a JSON object`],
      reason: `Document is not a valid ${kind.toUpperCase()} profile`,
    };
  }

  if (kind === "ucp") return assessUcp(parsed);
  return assessAcp(parsed);
}

function assessUcp(parsed: Record<string, unknown>): ProtocolAssessment {
  const profile = parsed.ucp;
  if (
    !isRecord(profile) ||
    typeof profile.version !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(profile.version) ||
    !isRecord(profile.services) ||
    !isRecord(profile.capabilities)
  ) {
    return {
      kind: "ucp",
      found: true,
      supported: false,
      parsed,
      facts: ["The response did not contain a complete UCP profile"],
      reason: "Document is not a valid UCP profile",
    };
  }

  return {
    kind: "ucp",
    found: true,
    supported: true,
    parsed,
    facts: [
      `UCP version ${profile.version}`,
      `UCP declares ${Object.keys(profile.services).length} services`,
      `UCP declares ${Object.keys(profile.capabilities).length} capabilities`,
    ],
    reason: null,
  };
}

function assessAcp(parsed: Record<string, unknown>): ProtocolAssessment {
  const observableKeys = ["capabilities", "services", "endpoints", "openapi"];
  const exposed = observableKeys.filter((key) => key in parsed);
  if (exposed.length === 0) {
    return {
      kind: "acp",
      found: true,
      supported: false,
      parsed,
      facts: ["The response exposed no observable commerce capability material"],
      reason: "Document is not a valid ACP capability document",
    };
  }

  return {
    kind: "acp",
    found: true,
    supported: true,
    parsed,
    facts: exposed.map((key) => `ACP document exposes ${key}`),
    reason: null,
  };
}
