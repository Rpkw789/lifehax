/**
 * The site audit: plain `fetch` plus regex, no browser and no model.
 *
 * This is where findings actually come from. The browser agents are the visual;
 * these probes are the evidence. Keeping the diagnosis here is also what keeps
 * it fast (~3s) and free.
 */

import { findNodes, get, jsonLdBlocks, resolve } from "./http";
import type { Catalogue, Checks, PageCheck, Probe, RunInput } from "./types";

/** Probes a URL and reports whether an agent would find something usable. */
async function probe(url: string): Promise<Probe> {
  const res = await get(url);
  // A soft 404 (200 with an HTML error page) is common; treat HTML at a
  // well-known JSON/text path as "not really there".
  const looksHtml = /^\s*<(!doctype|html)/i.test(res.body);
  const found = res.ok && res.body.trim().length > 0 && !looksHtml;
  return {
    url,
    found,
    status: res.status,
    note: res.error
      ? res.error
      : res.ok && looksHtml
        ? "returned an HTML page, not a machine-readable document"
        : null,
  };
}

export async function runChecks(
  catalogue: Catalogue,
  input: RunInput,
): Promise<Checks> {
  const { origin } = catalogue;

  const agentEndpointPath = input.agentEndpoint.trim() || "/.well-known/agent-commerce";

  const [agentCommerce, ucp, llmsTxt, robotsRes] = await Promise.all([
    probe(resolve(origin, agentEndpointPath)),
    probe(resolve(origin, "/.well-known/ucp")),
    probe(resolve(origin, "/llms.txt")),
    get(resolve(origin, "/robots.txt")),
  ]);

  const robots: Checks["robots"] = {
    url: robotsRes.url,
    found: robotsRes.ok,
    status: robotsRes.status,
    note: robotsRes.error,
    allowsAgents: !blocksKnownAgents(robotsRes.body),
  };

  const sitemapUrl = input.sitemapUrl.trim()
    ? resolve(origin, input.sitemapUrl.trim())
    : resolve(origin, "/sitemap.xml");
  const sitemapRes = await get(sitemapUrl);
  const sitemap: Checks["sitemap"] = {
    url: sitemapUrl,
    found: sitemapRes.ok,
    status: sitemapRes.status,
    note: sitemapRes.error,
    productsListed: catalogue.sitemapProductCount,
  };

  // Analyse a handful of real product pages. Prefer the SKUs the user named.
  const targets = pickTargets(catalogue, input.testSkus);
  const pages: PageCheck[] = [];
  for (const url of targets) pages.push(await checkProductPage(url));

  const totals = {
    productsChecked: pages.length,
    withJsonLd: pages.filter((p) => p.hasProductJsonLd).length,
    withOfferPrice: pages.filter((p) => p.hasOfferPrice).length,
    priceInServedHtml: pages.filter((p) => p.priceInServedHtml).length,
    withCartForm: pages.filter((p) => p.hasCartForm).length,
    quantityCapped: pages.filter((p) => p.quantityMax !== null && p.quantityMax <= 10)
      .length,
  };

  const checkoutWall = await checkCheckout(origin);

  return { agentCommerce, ucp, llmsTxt, robots, sitemap, pages, totals, checkoutWall };
}

/** Up to 4 product pages: the named test SKUs first, then whatever we found. */
function pickTargets(catalogue: Catalogue, testSkus: string): string[] {
  const wanted = testSkus
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const matched = catalogue.products.filter((p) =>
    wanted.some(
      (sku) =>
        p.url.toLowerCase().includes(sku) ||
        (p.title ?? "").toLowerCase().includes(sku),
    ),
  );

  const rest = catalogue.products.filter((p) => !matched.includes(p));
  return [...matched, ...rest].slice(0, 4).map((p) => p.url);
}

async function checkProductPage(url: string): Promise<PageCheck> {
  const res = await get(url);
  if (!res.ok) {
    return {
      url,
      status: res.status,
      hasJsonLd: false,
      hasProductJsonLd: false,
      hasOfferPrice: false,
      priceInServedHtml: false,
      hasCartForm: false,
      quantityMax: null,
      note: res.error ?? `HTTP ${res.status}`,
    };
  }

  const html = res.body;
  const blocks = jsonLdBlocks(html);
  const products = findNodes(blocks, "Product");
  const offerNodes = products.flatMap((p) => {
    const o = p.offers;
    return Array.isArray(o) ? o : o ? [o] : [];
  }) as Record<string, unknown>[];

  const price = offerNodes
    .map((o) => (o.price === undefined ? null : String(o.price)))
    .find((p): p is string => Boolean(p));

  // Strip scripts before looking for the price: a price inside a JS bundle is
  // exactly the "client-side only" failure we are trying to detect.
  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  const priceInServedHtml = price
    ? visible.includes(price) || visible.includes(formatMoney(price))
    : /(?:[$£€]\s?\d[\d.,]*)/.test(visible);

  return {
    url,
    status: res.status,
    hasJsonLd: blocks.length > 0,
    hasProductJsonLd: products.length > 0,
    hasOfferPrice: Boolean(price),
    priceInServedHtml,
    hasCartForm: hasCartForm(html),
    quantityMax: quantityMax(html),
    note: null,
  };
}

/** A real `<form>` an agent can POST, rather than a JS-only click handler. */
function hasCartForm(html: string): boolean {
  const forms = [...html.matchAll(/<form\b[^>]*>/gi)].map((m) => m[0]);
  return forms.some((f) => /action=["'][^"']*\/cart\/(add|items)/i.test(f));
}

function quantityMax(html: string): number | null {
  const input = html.match(
    /<input\b[^>]*name=["'](?:qty|quantity)["'][^>]*>/i,
  )?.[0];
  const max = input?.match(/\bmax=["']?(\d+)/i)?.[1];
  if (max) return Number(max);

  // A <select> of quantities caps at its largest option.
  const select = html.match(
    /<select\b[^>]*name=["'](?:qty|quantity)["'][\s\S]*?<\/select>/i,
  )?.[0];
  if (select) {
    const values = [...select.matchAll(/<option[^>]*value=["']?(\d+)/gi)].map((m) =>
      Number(m[1]),
    );
    if (values.length > 0) return Math.max(...values);
  }
  return null;
}

function formatMoney(price: string): string {
  const n = Number(price);
  return Number.isFinite(n) ? n.toFixed(2) : price;
}

/** Does checkout bounce an agent into account creation? */
async function checkCheckout(origin: string): Promise<Checks["checkoutWall"]> {
  const url = resolve(origin, "/checkout");
  const res = await get(url, { redirect: "manual" });
  const location = res.finalUrl;
  const requiresAccount =
    /\/(account|login|signin|sign-in|register)/i.test(location) ||
    /\/(account|login)/i.test(res.body.match(/Location:\s*(\S+)/i)?.[1] ?? "");
  return {
    url,
    found: res.status !== null,
    status: res.status,
    note: res.error,
    requiresAccount,
  };
}

function blocksKnownAgents(robots: string): boolean {
  const agentUas = ["gptbot", "oai-searchbot", "claudebot", "perplexitybot"];
  const lines = robots.toLowerCase().split("\n");
  let blocked = false;
  let active = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("user-agent:")) {
      const ua = line.slice("user-agent:".length).trim();
      active = agentUas.includes(ua);
    } else if (active && line.startsWith("disallow:")) {
      const path = line.slice("disallow:".length).trim();
      if (path === "/") blocked = true;
    }
  }
  return blocked;
}
