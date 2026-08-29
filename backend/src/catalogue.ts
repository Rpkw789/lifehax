/**
 * Reads what an agent could actually discover about the store's products.
 *
 * Deliberately category-agnostic: nothing here knows what is being sold. The
 * product list it returns is what the persona generator writes briefs from,
 * which is how hard rule 1 ("no product category in source") is satisfied.
 */

import { findNodes, get, jsonLdBlocks, resolve, toOrigin } from "./http";
import type { Catalogue, CatalogueProduct } from "./types";

const MAX_PRODUCTS = 12;

export async function snapshot(
  storeUrl: string,
  sitemapOverride: string,
): Promise<Catalogue> {
  const { origin, domain, entryUrl, hasPath } = toOrigin(storeUrl);

  const sitemapUrls = await productUrlsFromSitemap(origin, sitemapOverride);

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
      sitemapProductCount: sitemapUrls.length,
    };
  }

  if (sitemapUrls.length > 0) {
    const products = await productsFromPages(sitemapUrls.slice(0, MAX_PRODUCTS));
    return {
      domain,
      origin,
      entryUrl,
      hasPath,
      products,
      source: "sitemap",
      sitemapProductCount: sitemapUrls.length,
    };
  }

  // Last resort: whatever the entry page links to that looks like a product.
  // Using entryUrl rather than the root matters when the user pointed us at a
  // collection — that page lists products the homepage may not.
  const home = await get(entryUrl);
  const linked = productLinksFromHtml(home.body, origin).slice(0, MAX_PRODUCTS);
  const products = await productsFromPages(linked);
  return {
    domain,
    origin,
    entryUrl,
    hasPath,
    products,
    source: products.length > 0 ? "homepage" : "none",
    sitemapProductCount: sitemapUrls.length,
  };
}

/**
 * Sitemaps a site declares in robots.txt, in the order given.
 *
 * This is how a store says where its sitemap actually is, and plenty do not
 * use /sitemap.xml — bose.com serves 404 there and names sitemap_index.xml
 * here, which is 207 products the crawler would otherwise never see.
 */
async function declaredSitemaps(origin: string): Promise<string[]> {
  const res = await get(resolve(origin, "/robots.txt"));
  if (!res.ok) return [];

  const out: string[] = [];
  for (const line of res.body.split(/\r?\n/)) {
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

/** Follows a sitemap index one level down. Returns product-looking URLs. */
export async function productUrlsFromSitemap(
  origin: string,
  override: string,
): Promise<string[]> {
  // An explicit override is the operator speaking; do not second-guess it with
  // robots. Otherwise prefer what the site declares, and guess only last.
  const candidates = override.trim()
    ? [resolve(origin, override.trim())]
    : [...(await declaredSitemaps(origin)), resolve(origin, "/sitemap.xml")];

  for (const candidate of candidates) {
    const found = await productUrlsFrom(candidate);
    if (found.length > 0) return found;
  }
  return [];
}

/** Product URLs reachable from one sitemap, following an index one level. */
async function productUrlsFrom(start: string): Promise<string[]> {
  const root = await get(start);
  if (!root.ok) return [];

  const locs = (body: string): string[] =>
    [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);

  const top = locs(root.body);
  const direct = top.filter(isProductUrl);
  if (direct.length > 0) return unique(direct);

  // Sitemap index: fetch the children that look like product sitemaps.
  const children = top
    .filter((u) => /\.xml/i.test(u))
    .filter((u) => /product/i.test(u) || top.length <= 5)
    .slice(0, 4);

  const found: string[] = [];
  for (const child of children) {
    const res = await get(child);
    if (res.ok) {
      // A sitemap the site itself calls "product" is a list of products, so
      // take it at its word. Bose's are /p/…​.html, which no /products/
      // pattern would ever match, and filtering would discard all 207.
      const declared = /product/i.test(child);
      const urls = locs(res.body).filter((u) => !/\.xml$/i.test(u));
      found.push(...(declared ? urls : urls.filter(isProductUrl)));
    }
    if (found.length > 400) break;
  }
  return unique(found);
}

function isProductUrl(url: string): boolean {
  return /\/products?\//i.test(url) && !/\.xml$/i.test(url);
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
