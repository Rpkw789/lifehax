import type {
  CatalogueSnapshot,
  Evidence,
  SiteAudit,
  TargetProduct,
} from "../../../shared/contracts/check-result.ts";
import { computeSiteAudit } from "../audit/compute.ts";
import { extractProduct, extractSitemapUrls } from "./extract.ts";
import { discoverFeedUrls, mergeProduct, parseProductFeed } from "./feed.ts";

export interface FetchedDocument {
  url: string;
  status: number;
  body: string;
  contentType: string;
  durationMs: number;
}

export interface DocumentFetcher {
  get(url: string, signal?: AbortSignal): Promise<FetchedDocument>;
}

export interface SnapshotInput {
  storeUrl: string;
  targetProductUrl: string;
  fetchedAt: string;
  fetcher: DocumentFetcher;
  signal?: AbortSignal;
}

export interface StoreSnapshot {
  targetProduct: TargetProduct;
  catalogueSnapshot: CatalogueSnapshot;
  siteAudit: SiteAudit;
  productAttributes: Record<string, string | number | boolean>;
  availability: string | null;
  evidence: Evidence[];
}

export async function snapshotStore(input: SnapshotInput): Promise<StoreSnapshot> {
  const origin = new URL(input.storeUrl).origin;
  const probeUrls = {
    sitemap: `${origin}/sitemap.xml`,
    robots: `${origin}/robots.txt`,
    llms_txt: `${origin}/llms.txt`,
    agent_commerce: `${origin}/.well-known/agent-commerce`,
    ucp: `${origin}/.well-known/ucp`,
  } as const;
  const robots = await input.fetcher.get(probeUrls.robots, input.signal);
  if (!robotsAllowAgent(robots)) throw new Error("robots.txt disallows Happy2Agent");
  const targetDocument = await input.fetcher.get(input.targetProductUrl, input.signal);
  if (targetDocument.status < 200 || targetDocument.status >= 300) {
    throw new Error(`target product returned HTTP ${targetDocument.status}`);
  }
  const pageProduct = extractProduct(targetDocument.body, targetDocument.url);
  const feedDiscovery = await fetchProductFeeds(
    discoverFeedUrls(targetDocument.body, targetDocument.url),
    origin,
    input.fetcher,
    input.signal,
  );
  const feedProducts = feedDiscovery.documents.flatMap((document) =>
    successful(document) ? parseProductFeed(document.body, document.contentType, document.url) : [],
  );
  const feedTarget = feedProducts.find((product) => sameResource(product.target.canonical_url, input.targetProductUrl));
  const extracted = pageProduct && feedTarget ? mergeProduct(pageProduct, feedTarget) : pageProduct ?? feedTarget;
  if (!extracted) throw new Error("target product could not be extracted");

  const [sitemap, llms, agentCommerce, ucp] = await Promise.all([
    input.fetcher.get(probeUrls.sitemap, input.signal),
    input.fetcher.get(probeUrls.llms_txt, input.signal),
    input.fetcher.get(probeUrls.agent_commerce, input.signal),
    input.fetcher.get(probeUrls.ucp, input.signal),
  ]);
  const sitemapUrls = successful(sitemap) ? extractSitemapUrls(sitemap.body) : [];
  const targetInSitemap = sitemapUrls.some((url) => sameResource(url, extracted.target.canonical_url));
  const discovered = await discoverCatalogueDocuments(
    sitemapUrls,
    origin,
    extracted.target.canonical_url,
    input.fetcher,
    input.signal,
  );
  const discoveredProducts = discovered.documents
    .map((document) => ({ document, product: successful(document) ? extractProduct(document.body, document.url) : null }))
    .filter((entry): entry is { document: FetchedDocument; product: NonNullable<typeof entry.product> } => entry.product !== null);
  const productsById = new Map(feedProducts.map((product) => [product.target.product_id, product]));
  productsById.set(extracted.target.product_id, extracted);
  for (const entry of discoveredProducts) productsById.set(entry.product.target.product_id, entry.product);
  const products = [...productsById.values()];

  const probes = {
    llms_txt: probe(llms),
    agent_commerce: probe(agentCommerce),
    ucp: probe(ucp),
    robots: probe(robots),
    sitemap: probe(sitemap),
  };
  const siteAudit = computeSiteAudit({
    targetProductId: extracted.target.product_id,
    targetInSitemap,
    products: products.map((product) => ({
      productId: product.target.product_id,
      hasJsonLd: product.hasJsonLd,
      hasOffer: product.hasOffer,
      hasClientSidePrice: false,
    })),
    probes,
    robotsAllowsAgents: robotsAllowAgent(robots),
  });
  const catalogueSnapshot: CatalogueSnapshot = {
    fetched_at: input.fetchedAt,
    products_total: products.length + discovered.unreadable.length + feedDiscovery.unreadable.length,
    products_readable: products.length,
    unreadable: [...feedDiscovery.unreadable, ...discovered.unreadable],
    target_field_sources: extracted.fieldSources,
  };
  const documents = [targetDocument, ...feedDiscovery.documents, sitemap, robots, llms, agentCommerce, ucp, ...discovered.documents];
  const evidence = documents.map((document, index): Evidence => ({
    evidence_id: `ev_fetch_${String(index + 1).padStart(3, "0")}`,
    kind: "fetch",
    at: input.fetchedAt,
    url: document.url,
    status: document.status,
    summary: `Fetched ${new URL(document.url).pathname} with HTTP ${document.status}`,
    excerpt: truncate(document.body),
  }));
  evidence.push({
    evidence_id: "ev_extract_target",
    kind: "extraction",
    at: input.fetchedAt,
    url: extracted.target.canonical_url,
    status: targetDocument.status,
    summary: `Extracted target product ${extracted.target.product_id}`,
    excerpt: null,
  });

  return {
    targetProduct: extracted.target,
    catalogueSnapshot,
    siteAudit,
    productAttributes: extracted.attributes,
    availability: extracted.availability,
    evidence,
  };
}

async function fetchProductFeeds(
  urls: string[],
  origin: string,
  fetcher: DocumentFetcher,
  signal: AbortSignal | undefined,
): Promise<{ documents: FetchedDocument[]; unreadable: { url: string; reason: string }[] }> {
  const sameOriginUrls = urls.filter((url) => sameOrigin(url, origin)).slice(0, 10);
  const documents: FetchedDocument[] = [];
  const unreadable: { url: string; reason: string }[] = [];
  for (const url of sameOriginUrls) {
    try {
      const document = await fetcher.get(url, signal);
      documents.push(document);
      if (!successful(document)) {
        unreadable.push({ url, reason: `HTTP ${document.status}` });
      } else if (parseProductFeed(document.body, document.contentType, document.url).length === 0) {
        unreadable.push({ url, reason: "product feed could not be parsed" });
      }
    } catch (error) {
      unreadable.push({ url, reason: errorMessage(error) });
    }
  }
  return { documents, unreadable };
}

function successful(document: FetchedDocument): boolean {
  return document.status >= 200 && document.status < 300;
}

function probe(document: FetchedDocument) {
  return {
    url: document.url,
    found: successful(document),
    status: document.status,
    note: null,
  };
}

function sameResource(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.origin === b.origin && trimSlash(a.pathname) === trimSlash(b.pathname);
  } catch {
    return false;
  }
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function robotsAllowAgent(document: FetchedDocument): boolean {
  if (!successful(document)) return true;
  const lines = document.body.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim());
  let applies = false;
  for (const line of lines) {
    const [rawName, ...rawValue] = line.split(":");
    const name = rawName?.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (name === "user-agent") applies = value === "*" || value.toLowerCase() === "happy2agent";
    if (applies && name === "disallow" && value === "/") return false;
    if (applies && name === "allow" && value === "/") return true;
  }
  return true;
}

function truncate(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 500) : null;
}

async function discoverCatalogueDocuments(
  initialUrls: string[],
  origin: string,
  targetUrl: string,
  fetcher: DocumentFetcher,
  signal: AbortSignal | undefined,
): Promise<{ documents: FetchedDocument[]; unreadable: { url: string; reason: string }[] }> {
  const queued = initialUrls.filter((url) => sameOrigin(url, origin)).slice(0, 200);
  const seen = new Set<string>();
  const documents: FetchedDocument[] = [];
  const unreadable: { url: string; reason: string }[] = [];
  let sitemapCount = 0;

  while (queued.length > 0 && seen.size < 200) {
    const batch = queued.splice(0, 8).filter((url) => {
      if (seen.has(url) || sameResource(url, targetUrl)) return false;
      seen.add(url);
      return true;
    });
    const results = await Promise.all(batch.map(async (url) => {
      try {
        return { url, document: await fetcher.get(url, signal), error: null };
      } catch (error) {
        return { url, document: null, error: errorMessage(error) };
      }
    }));
    for (const result of results) {
      if (!result.document) {
        unreadable.push({ url: result.url, reason: result.error ?? "fetch failed" });
        continue;
      }
      documents.push(result.document);
      if (looksLikeSitemap(result.document) && sitemapCount < 10) {
        sitemapCount += 1;
        for (const nested of extractSitemapUrls(result.document.body)) {
          if (queued.length + seen.size >= 200) break;
          if (sameOrigin(nested, origin) && !seen.has(nested)) queued.push(nested);
        }
      } else if (!successful(result.document)) {
        unreadable.push({ url: result.url, reason: `HTTP ${result.document.status}` });
      }
    }
  }
  return { documents, unreadable };
}

function sameOrigin(rawUrl: string, origin: string): boolean {
  try {
    return new URL(rawUrl).origin === origin;
  } catch {
    return false;
  }
}

function looksLikeSitemap(document: FetchedDocument): boolean {
  return document.contentType.includes("xml") || /<\s*(?:urlset|sitemapindex)\b/i.test(document.body);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "fetch failed";
}
