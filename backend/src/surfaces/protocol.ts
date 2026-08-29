import type { FetchedDocument } from "../catalogue/snapshot.ts";

export type ProtocolKind = "acp" | "ucp";
const ACP_STABLE_VERSION = "2026-04-17";

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
  if (validOpenApiDocument(parsed)) {
    return {
      kind: "acp",
      found: true,
      supported: true,
      parsed,
      facts: [
        `ACP assessment pinned to ${ACP_STABLE_VERSION}`,
        `OpenAPI ${String(parsed.openapi)} exposes callable operations`,
      ],
      reason: null,
    };
  }

  const version = parsed.version ?? parsed.api_version;
  const observableKeys = ["capabilities", "services", "endpoints", "openapi"];
  const exposed = observableKeys.filter((key) =>
    key === "openapi"
      ? isEndpointReference(parsed[key])
      : containsEndpointMaterial(parsed[key]),
  );
  if (version !== ACP_STABLE_VERSION || exposed.length === 0) {
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
    facts: [
      `ACP assessment pinned to ${ACP_STABLE_VERSION}`,
      ...exposed.map((key) => `ACP document exposes ${key}`),
    ],
    reason: null,
  };
}

function validOpenApiDocument(value: Record<string, unknown>): boolean {
  if (typeof value.openapi !== "string" || !/^3\.\d+\.\d+$/.test(value.openapi)) {
    return false;
  }
  if (!isRecord(value.info) || value.info.version !== ACP_STABLE_VERSION ||
    typeof value.info.title !== "string" || !value.info.title.trim()) {
    return false;
  }
  if (!isRecord(value.paths)) return false;
  const methods = new Set(["get", "post", "put", "patch", "delete"]);
  return Object.values(value.paths).some((path) =>
    isRecord(path) && Object.keys(path).some((key) => methods.has(key.toLowerCase())),
  );
}

function containsEndpointMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsEndpointMaterial);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) =>
    ["endpoint", "url", "schema", "openapi"].includes(key.toLowerCase())
      ? isEndpointReference(nested)
      : containsEndpointMaterial(nested),
  );
}

function isEndpointReference(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  return isHttpsUrl(trimmed);
}
