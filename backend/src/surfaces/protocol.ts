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

  if (kind === "ucp") return assessUcp(parsed, document.url);
  return assessAcp(parsed);
}

function assessUcp(parsed: Record<string, unknown>, documentUrl: string): ProtocolAssessment {
  const profile = parsed.ucp;
  if (
    !isHttpsUrl(documentUrl) ||
    !isRecord(profile) ||
    typeof profile.version !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(profile.version) ||
    !isRecord(profile.services) ||
    !isRecord(profile.capabilities) ||
    !validUcpRegistry(profile.services, "service") ||
    !validUcpRegistry(profile.capabilities, "capability")
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

function validUcpRegistry(
  registry: Record<string, unknown>,
  kind: "service" | "capability",
): boolean {
  return Object.entries(registry).every(([name, declarations]) =>
    /^([a-z0-9-]+\.){2,}[a-z0-9_-]+$/i.test(name) &&
    Array.isArray(declarations) &&
    declarations.length > 0 &&
    declarations.every((declaration) => validUcpDeclaration(declaration, kind)),
  );
}

function validUcpDeclaration(
  value: unknown,
  kind: "service" | "capability",
): boolean {
  if (!isRecord(value) || !isDateVersion(value.version) || !isHttpsUrl(value.spec)) {
    return false;
  }
  if (kind === "capability") return isHttpsUrl(value.schema);
  if (typeof value.transport !== "string" ||
    !["rest", "mcp", "a2a", "embedded"].includes(value.transport)) {
    return false;
  }
  if (["rest", "mcp", "embedded"].includes(value.transport) && !isHttpsUrl(value.schema)) {
    return false;
  }
  return value.endpoint === undefined || isHttpsUrl(value.endpoint);
}

function isDateVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function assessAcp(parsed: Record<string, unknown>): ProtocolAssessment {
  const observableKeys = ["capabilities", "services", "endpoints", "openapi"];
  const exposed = observableKeys.filter((key) => hasCapabilityMaterial(key, parsed[key]));
  if (exposed.length === 0) {
    return {
      kind: "acp",
      found: true,
      supported: false,
      parsed,
      facts: ["The response exposed no observable commerce capability material"],
      reason: "Document contains no valid commerce capability material",
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

function hasCapabilityMaterial(key: string, value: unknown): boolean {
  if (key === "openapi") {
    return (typeof value === "string" && value.trim().length > 0) ||
      (isRecord(value) && Object.keys(value).length > 0);
  }
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(validCapabilityValue);
  }
  return isRecord(value) && Object.keys(value).length > 0 &&
    Object.values(value).every(validCapabilityValue);
}

function validCapabilityValue(value: unknown): boolean {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("/")) return true;
    try {
      const url = new URL(trimmed);
      return url.protocol === "https:";
    } catch {
      return true;
    }
  }
  if (Array.isArray(value)) return value.length > 0 && value.every(validCapabilityValue);
  if (!isRecord(value)) return false;
  return Object.keys(value).length > 0 && Object.values(value).every(validCapabilityValue);
}
