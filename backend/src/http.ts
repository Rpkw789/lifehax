/**
 * Fetch helpers. Every call here is best-effort: a store that 404s, times out
 * or blocks us is the *finding*, so failures come back as data.
 */

import { LOG_HTTP, logger, since } from "./log";

const httpLog = logger("http");

const UA =
  "Happy2-Readiness-Audit/0.1 (+https://happy2.dev; agent-commerce readiness check)";

export interface Fetched {
  url: string;
  status: number | null;
  ok: boolean;
  body: string;
  error: string | null;
  /** Final URL after redirects, when we followed them. */
  finalUrl: string;
}

export async function get(
  url: string,
  opts: {
    timeoutMs?: number;
    redirect?: "follow" | "manual" | "error";
    maxBytes?: number;
  } = {},
): Promise<Fetched> {
  const { timeoutMs = 10_000, redirect = "follow", maxBytes = 2_000_000 } = opts;
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      redirect,
      signal: control.signal,
      headers: { "user-agent": UA, accept: "*/*" },
    });
    // Cap the read so one enormous page cannot stall the run.
    const raw = await res.text();
    if (LOG_HTTP) {
      httpLog.debug("GET", {
        url,
        status: res.status,
        ms: since(startedAt),
        bytes: raw.length,
      });
    }
    return {
      url,
      status: res.status,
      ok: res.ok,
      body: raw.length > maxBytes ? raw.slice(0, maxBytes) : raw,
      error: null,
      finalUrl: res.url || url,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    httpLog.warn("GET failed", { url, ms: since(startedAt), reason });
    return {
      url,
      status: null,
      ok: false,
      body: "",
      error: reason,
      finalUrl: url,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** `https://x.com/a/b` + `/c` → `https://x.com/c`. Tolerates absolute inputs. */
export function resolve(origin: string, path: string): string {
  try {
    return new URL(path, origin).toString();
  } catch {
    return origin;
  }
}

/**
 * Normalise whatever the user typed.
 *
 * `origin` is where the well-known probes have to go — /sitemap.xml and
 * /.well-known/* only exist at the root. `entryUrl` preserves any path they
 * typed, because "start at /collections/mens" is a meaningful instruction and
 * discarding it sends every agent to the homepage instead.
 */
export function toOrigin(input: string): {
  origin: string;
  domain: string;
  entryUrl: string;
  hasPath: boolean;
} {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withScheme);
  const path = url.pathname.replace(/\/+$/, "");
  return {
    origin: url.origin,
    domain: url.host,
    entryUrl: url.toString(),
    hasPath: path.length > 0,
  };
}

/** Every `<script type="application/ld+json">` payload on a page, parsed. */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      out.push(JSON.parse(match[1]!.trim()));
    } catch {
      // Malformed JSON-LD is itself worth nothing to an agent; skip it.
    }
  }
  return out;
}

/**
 * Every node of a given schema.org @type, anywhere in the document.
 *
 * Recurses through all object values, not just `@graph` — real stores nest the
 * `Product` nodes inside a `ProductGroup`'s `hasVariant`, and a shallow walk
 * silently reports "no structured data" on a page that is full of it.
 */
export function findNodes(blocks: unknown[], type: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const wanted = type.toLowerCase();

  const visit = (node: unknown, depth: number): void => {
    if (depth > 12 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const raw = obj["@type"];
    const types = Array.isArray(raw) ? raw : [raw];
    if (types.some((t) => typeof t === "string" && t.toLowerCase() === wanted)) {
      found.push(obj);
    }
    for (const value of Object.values(obj)) visit(value, depth + 1);
  };

  for (const block of blocks) visit(block, 0);
  return found;
}
