/**
 * Reads what an agent could actually discover about the store's products.
 *
 * Deliberately category-agnostic: nothing here knows what is being sold. The
 * product list it returns is what the persona generator writes briefs from,
 * which is how hard rule 1 ("no product category in source") is satisfied.
 */

import { findNodes, get, jsonLdBlocks, resolve, toOrigin, type Fetched } from "./http";
import type { Catalogue, CatalogueProduct } from "./types";

const MAX_PRODUCTS = 12;

export async function snapshot(
  storeUrl: string,
  sitemapOverride: string,
): Promise<Catalogue> {
  const { origin, domain, entryUrl, hasPath } = toOrigin(storeUrl);

  const sitemap = await observeSitemap(origin, sitemapOverride);
  const sitemapProductUrls = sitemap.productUrls;

  // Shopify hands over the whole catalogue unauthenticated. Take it when it is
  // there — it is richer than anything we can scrape, and it costs one request.
  const shopify = await productsFromShopifyJson(origin);
  if (shopify.length > 0) {
    return {
      domain,
      origin,
      entryUrl,
      hasPath,
      products: shopify.slice(0, MAX_PRODUCTS),
      source: "products.json",
      sitemapProductCount: sitemapProductUrls.length,
      sitemapUrls: sitemap.observedUrls,
      sitemapComplete: sitemap.complete,
    };
  }

  if (sitemapProductUrls.length > 0) {
    const products = await productsFromPages(sitemapProductUrls.slice(0, MAX_PRODUCTS));
    return {
      domain,
      origin,
      entryUrl,
      hasPath,
      products,
      source: "sitemap",
      sitemapProductCount: sitemapProductUrls.length,
      sitemapUrls: sitemap.observedUrls,
      sitemapComplete: sitemap.complete,
    };
  }

  // Last resort: whatever the entry page links to that looks like a product.
  // Using entryUrl rather than the root matters when the user pointed us at a
  // collection — that page lists products the homepage may not.
  const home = await get(entryUrl);
  const linked = productLinksFromHtml(home.body, origin).slice(0, MAX_PRODUCTS);
  const products = await productsFromPages(linked);

  // A store that refuses non-browser clients has not hidden its catalogue, it
  // has closed the door — and every AI shopping agent meets the same door. That
  // is a finding about the store, not a crawler failure, so it is recorded as
  // its own source rather than folded into an empty "none".
  const blocked = products.length === 0 && isBlocking(home.status);
  return {
    domain,
    origin,
    entryUrl,
    hasPath,
    products,
    source: products.length > 0 ? "homepage" : blocked ? "blocked" : "none",
    blockedStatus: blocked ? home.status : null,
    sitemapProductCount: sitemapProductUrls.length,
    sitemapUrls: sitemap.observedUrls,
    sitemapComplete: sitemap.complete,
  };
}

/** Statuses a bot wall answers with, as opposed to a page simply being gone. */
function isBlocking(status: number | null): boolean {
  return status === 401 || status === 403 || status === 429;
}

/**
 * Sitemaps a site declares in robots.txt, in the order given.
 *
 * This is how a store says where its sitemap actually is, and plenty do not
 * use /sitemap.xml — bose.com serves 404 there and names sitemap_index.xml
 * here, which is 207 products the crawler would otherwise never see. Pure, so
 * the audit can reuse it against the robots.txt it has already fetched.
 */
export function sitemapsDeclaredIn(robotsBody: string, origin: string): string[] {
  const out: string[] = [];
  for (const line of robotsBody.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)\s*$/i.exec(line);
    if (!match) continue;
    try {
      out.push(new URL(match[1]!, origin).toString());
    } catch {
      // A malformed Sitemap: line is not worth failing the whole crawl over.
    }
  }
  return out;
}

async function declaredSitemaps(
  origin: string,
  fetchDocument: (url: string) => Promise<Fetched> = get,
): Promise<string[]> {
  const res = await fetchDocument(resolve(origin, "/robots.txt"));
  return res.ok ? sitemapsDeclaredIn(res.body, origin) : [];
}

/** Follows a sitemap index one level down. Returns product-looking URLs. */
export async function productUrlsFromSitemap(
  origin: string,
  override: string,
): Promise<string[]> {
  return (await observeSitemap(origin, override)).productUrls;
}

export interface SitemapObservation {
  productUrls: string[];
  observedUrls: string[];
  complete: boolean;
}

export async function observeSitemap(
  origin: string,
  override: string,
  fetchDocument: (url: string) => Promise<Fetched> = get,
): Promise<SitemapObservation> {
  // An explicit override is the operator speaking; do not second-guess it with
  // robots. Otherwise prefer what the site declares, and guess only last.
  // The declared order is not a ranking — a store may list its help pages
  // first and its catalogue last — so a sitemap that names itself for products
  // is tried before one that merely came first in robots.txt.
  const candidates = override.trim()
    ? [resolve(origin, override.trim())]
    : productNamedFirst([
        ...(await declaredSitemaps(origin, fetchDocument)),
        resolve(origin, "/sitemap.xml"),
      ]);

  let fallback: SitemapObservation | null = null;
  for (const candidate of unique(candidates)) {
    const observation = await observeSitemapAt(candidate, fetchDocument);
    if (observation.productUrls.length > 0) return observation;
    if (!fallback && observation.observedUrls.length > 0) fallback = observation;
  }
  return fallback ?? { productUrls: [], observedUrls: [], complete: false };
}

/** Stable partition: sitemaps naming products first, everything else after. */
function productNamedFirst(urls: string[]): string[] {
  const named = urls.filter((u) => PRODUCT_SITEMAP_NAME.test(fileName(u)));
  return [...named, ...urls.filter((u) => !named.includes(u))];
}

/** How deep an index may nest before we stop. Two covers every store seen. */
const MAX_SITEMAP_DEPTH = 2;
/** Children to open per index. Enough for a catalogue, cheap for a big store. */
const MAX_SITEMAP_CHILDREN = 4;
/** An index this small is worth opening blind; a large one needs a reason. */
const SMALL_INDEX = 5;
const MAX_SITEMAP_URLS = 400;

/**
 * A sitemap file name that says its contents are products.
 *
 * Stores spell this more ways than `product`: Nike and Best Buy say `pdp`,
 * IKEA says `prod`, others say `item` or `sku`. Matching whole tokens rather
 * than substrings keeps `production` out while letting
 * `sitemap-v2-pdp-index.xml` in — 3,726 product URLs that a literal `product`
 * match discards.
 */
const PRODUCT_SITEMAP_NAME = /(^|[^a-z])(products?|pdps?|prod|items?|skus?)([^a-z]|$)/i;

/** Path segments a store puts directly above a product's slug. */
const PRODUCT_PATH_SEGMENTS = new Set([
  "p", "pd", "pdp", "prd", "prod", "product", "products",
  "ip", "dp", "gp", "item", "items", "sku", "site", "t",
]);

/** A product id standing in for the segment name, e.g. `…/trousers/p5966220`. */
const PRODUCT_ID_SEGMENT = /^(p-?\d{3,}|\d{4,}\.p)$/i;

const SITEMAP_FILE = /\.(xml|xml\.gz|gz)$/i;

/**
 * Exact URLs and product candidates reachable from one sitemap.
 *
 * `trusted` means an ancestor named itself a product sitemap. That has to
 * travel downward because plenty of stores label only the index: Target's
 * `sitemap_pdp-index.xml.gz` lists children called `sitemap_00-0001.xml.gz`,
 * which say nothing about themselves. Inside a trusted sitemap every leaf is a
 * product, whatever its URL looks like.
 */
async function observeSitemapAt(
  start: string,
  fetchDocument: (url: string) => Promise<Fetched>,
  depth = 0,
  trusted = false,
): Promise<SitemapObservation> {
  const root = await fetchDocument(start);
  if (!root.ok) return { productUrls: [], observedUrls: [], complete: false };

  const declared = trusted || PRODUCT_SITEMAP_NAME.test(fileName(start));
  const locs = [...root.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
  const nested = locs.filter(isSitemapUrl);
  const leaves = locs.filter((u) => !isSitemapUrl(u));

  // A sitemap the store itself calls "product" is a list of products, so take
  // it at its word even when its page paths are not /products/.
  const direct = declared ? leaves : leaves.filter(isProductUrl);
  const isIndex = nested.length > 0 || /<sitemapindex\b/i.test(root.body);
  if (direct.length > 0 || !isIndex) {
    return {
      productUrls: unique(direct),
      observedUrls: unique(leaves),
      complete: root.truncated !== true,
    };
  }
  if (nested.length === 0 || depth >= MAX_SITEMAP_DEPTH) {
    return { productUrls: [], observedUrls: unique(leaves), complete: false };
  }

  // Prefer children the store names as products. Failing that, open a small
  // index blind — but not a large one, where guessing costs 2,000 requests.
  const named = nested.filter((u) => PRODUCT_SITEMAP_NAME.test(fileName(u)));
  const candidates =
    named.length > 0 ? named : declared || nested.length <= SMALL_INDEX ? nested : [];
  const chosen = candidates.slice(0, MAX_SITEMAP_CHILDREN);

  const observed: string[] = [];
  const products: string[] = [];
  let complete = root.truncated !== true && chosen.length === nested.length;
  for (const child of chosen) {
    const sub = await observeSitemapAt(child, fetchDocument, depth + 1, declared);
    observed.push(...sub.observedUrls);
    products.push(...sub.productUrls);
    if (!sub.complete) complete = false;
    if (observed.length > MAX_SITEMAP_URLS) break;
  }
  if (observed.length > MAX_SITEMAP_URLS) complete = false;
  return { productUrls: unique(products), observedUrls: unique(observed), complete };
}

/** The last path segment, which is where a sitemap carries its name. */
function fileName(url: string): string {
  return pathOf(url).split("/").filter(Boolean).pop() ?? "";
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

function isSitemapUrl(url: string): boolean {
  return SITEMAP_FILE.test(pathOf(url));
}

/**
 * Whether a URL looks like one product's page.
 *
 * Structural, never a store or a category: the test is which segment sits
 * above the slug. Real catalogues use far more than Shopify's `/products/` —
 * Nike `/t/`, Target and IKEA `/p/`, Walmart `/ip/`, Chewy `/dp/`, Best Buy
 * `/site/` — and matching only `/products/` reported nothing at all for every
 * one of them. Requiring a segment *below* the token is what separates a
 * product page from the listing page that shares its prefix.
 */
export function isProductUrl(url: string): boolean {
  if (isSitemapUrl(url)) return false;
  const segments = pathOf(url).split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  if (PRODUCT_ID_SEGMENT.test(last)) return true;
  return segments
    .slice(0, -1)
    .some((segment) => PRODUCT_PATH_SEGMENTS.has(segment.toLowerCase()));
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

function productLinksFromHtml(html: string, origin: string): string[] {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]!);
  return unique(
    hrefs.filter(isProductUrl).map((h) => resolve(origin, h)),
  );
}

async function productsFromShopifyJson(origin: string): Promise<CatalogueProduct[]> {
  const res = await get(resolve(origin, "/products.json?limit=50"));
  if (!res.ok) return [];
  try {
    const parsed = JSON.parse(res.body) as {
      products?: {
        handle?: string;
        title?: string;
        variants?: { price?: string }[];
        options?: { name?: string; values?: string[] }[];
      }[];
    };
    if (!Array.isArray(parsed.products)) return [];
    return parsed.products.map((p) => {
      const attributes: Record<string, string> = {};
      for (const opt of p.options ?? []) {
        if (opt.name && opt.values?.length) {
          attributes[opt.name] = opt.values.slice(0, 6).join(", ");
        }
      }
      return {
        url: resolve(origin, `/products/${p.handle ?? ""}`),
        title: p.title ?? null,
        price: p.variants?.[0]?.price ?? null,
        attributes,
      };
    });
  } catch {
    return [];
  }
}

async function productsFromPages(urls: string[]): Promise<CatalogueProduct[]> {
  const out: CatalogueProduct[] = [];
  // Small pool so we never hammer a store.
  for (const batch of chunk(urls, 4)) {
    const results = await Promise.all(batch.map((u) => productFromPage(u)));
    out.push(...results.filter((p): p is CatalogueProduct => p !== null));
  }
  return out;
}

async function productFromPage(url: string): Promise<CatalogueProduct | null> {
  const res = await get(url);
  if (!res.ok) return null;
  const nodes = findNodes(jsonLdBlocks(res.body), "Product");
  const node = nodes[0];

  const title =
    (typeof node?.name === "string" ? node.name : null) ??
    res.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ??
    null;

  const offers = node?.offers as Record<string, unknown> | undefined;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  const price =
    offer && typeof offer === "object"
      ? String((offer as Record<string, unknown>).price ?? "") || null
      : null;

  const attributes: Record<string, string> = {};
  const extra = node?.additionalProperty;
  if (Array.isArray(extra)) {
    for (const prop of extra) {
      const p = prop as Record<string, unknown>;
      if (typeof p.name === "string") attributes[p.name] = String(p.value ?? "");
    }
  }

  return { url, title, price, attributes };
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
