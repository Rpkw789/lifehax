import type { ExtractedProduct, FieldSource } from "./extract.ts";

type JsonObject = Record<string, unknown>;

export function discoverFeedUrls(html: string, pageUrl: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = attribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const type = attribute(tag, "type")?.toLowerCase() ?? "";
    const href = attribute(tag, "href");
    if (!href || !rel.includes("alternate") || !isFeedType(type)) continue;
    try {
      urls.push(new URL(href, pageUrl).href);
    } catch {
      continue;
    }
  }
  return [...new Set(urls)];
}

export function parseProductFeed(body: string, contentType: string, feedUrl: string): ExtractedProduct[] {
  if (contentType.includes("json") || /^[\s\n]*[\[{]/.test(body)) return parseJsonFeed(body, feedUrl);
  if (contentType.includes("xml") || /<\s*(?:[\w-]+:)?(?:item|entry|product)\b/i.test(body)) {
    return parseXmlFeed(body, feedUrl);
  }
  return [];
}

export function mergeProduct(primary: ExtractedProduct, feed: ExtractedProduct): ExtractedProduct {
  const sku = primary.target.sku ?? feed.target.sku;
  const gtin = primary.target.gtin ?? feed.target.gtin;
  return {
    target: {
      product_id: primary.target.sku || primary.target.gtin ? primary.target.product_id : feed.target.product_id,
      name: primary.target.name,
      canonical_url: primary.target.canonical_url,
      sku,
      gtin,
      category: primary.target.category ?? feed.target.category,
      price: primary.target.price ?? feed.target.price,
    },
    availability: primary.availability ?? feed.availability,
    attributes: { ...feed.attributes, ...primary.attributes },
    fieldSources: mergeFieldSources(primary.fieldSources, feed.fieldSources),
    hasJsonLd: primary.hasJsonLd,
    hasOffer: primary.hasOffer || feed.hasOffer,
  };
}

function parseJsonFeed(body: string, feedUrl: string): ExtractedProduct[] {
  try {
    return feedRecords(JSON.parse(body)).map((record) => recordToProduct(record, feedUrl)).filter(isPresent);
  } catch {
    return [];
  }
}

function feedRecords(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter(isObject);
  if (!isObject(value)) return [];
  for (const key of ["products", "items", "entries"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isObject);
  }
  return valueToString(field(value, ["name", "title"])) ? [value] : [];
}

function parseXmlFeed(body: string, feedUrl: string): ExtractedProduct[] {
  const products: ExtractedProduct[] = [];
  const blockPattern = /<(?:[\w-]+:)?(?:item|entry|product)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?(?:item|entry|product)>/gi;
  for (const match of body.matchAll(blockPattern)) {
    const block = match[1] ?? "";
    const record: JsonObject = {};
    for (const key of ["id", "name", "title", "url", "link", "sku", "gtin", "price", "currency", "priceCurrency", "availability", "category", "product_type"]) {
      const value = xmlValue(block, key);
      if (value) record[key] = value;
    }
    const product = recordToProduct(record, feedUrl);
    if (product) products.push(product);
  }
  return products;
}

function recordToProduct(record: JsonObject, feedUrl: string): ExtractedProduct | null {
  const name = valueToString(field(record, ["name", "title"]));
  const rawUrl = linkValue(field(record, ["url", "link", "canonical_url"]));
  if (!name || !rawUrl) return null;
  let canonicalUrl: string;
  try {
    canonicalUrl = new URL(rawUrl, feedUrl).href;
  } catch {
    return null;
  }
  const sku = valueToString(field(record, ["sku", "id", "product_id"]));
  const gtin = valueToString(field(record, ["gtin", "gtin8", "gtin12", "gtin13", "gtin14"]));
  const category = valueToString(field(record, ["category", "product_type"]));
  const availability = valueToString(field(record, ["availability"]));
  const money = feedMoney(field(record, ["price"]), field(record, ["currency", "priceCurrency", "price_currency"]));
  const attributesValue = field(record, ["attributes"]);
  const attributes = isObject(attributesValue) ? scalarValues(attributesValue) : {};
  return {
    target: {
      product_id: sku ?? gtin ?? lastPathSegment(canonicalUrl),
      name,
      canonical_url: canonicalUrl,
      sku,
      gtin,
      category,
      price: money,
    },
    availability,
    attributes,
    fieldSources: {
      name: "feed",
      price: money ? "feed" : "absent",
      availability: availability ? "feed" : "absent",
      sku: sku ? "feed" : "absent",
      gtin: gtin ? "feed" : "absent",
      category: category ? "feed" : "absent",
    },
    hasJsonLd: false,
    hasOffer: money !== null || availability !== null,
  };
}

function feedMoney(priceValue: unknown, currencyValue: unknown): { amount: number; currency: string } | null {
  const priceObject = isObject(priceValue) ? priceValue : null;
  const rawAmount = priceObject ? field(priceObject, ["amount", "value", "price"]) : priceValue;
  const rawCurrency = priceObject ? field(priceObject, ["currency", "priceCurrency", "price_currency"]) : currencyValue;
  const amountText = valueToString(rawAmount);
  const currency = valueToString(rawCurrency) ?? amountText?.match(/\b[A-Z]{3}\b/)?.[0] ?? null;
  const amount = amountText === null ? null : Number(amountText.replace(/[^0-9.+-]/g, ""));
  return amount !== null && Number.isFinite(amount) && currency ? { amount, currency } : null;
}

function field(record: JsonObject, names: string[]): unknown {
  const expected = new Set(names.map(normalizeKey));
  for (const [key, value] of Object.entries(record)) {
    if (expected.has(normalizeKey(key))) return value;
  }
  return undefined;
}

function normalizeKey(value: string): string {
  return value.replace(/^.*:/, "").replace(/[_-]/g, "").toLowerCase();
}

function linkValue(value: unknown): string | null {
  if (isObject(value)) return valueToString(field(value, ["href", "url"]));
  return valueToString(value);
}

function valueToString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function xmlValue(block: string, key: string): string | null {
  const tag = new RegExp(`<(?:[\\w-]+:)?${key}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${key}>`, "i").exec(block);
  if (tag) return decodeEntities((tag[2] ?? "").replace(/<[^>]+>/g, " ").trim());
  if (key === "link") {
    const link = /<(?:[\w-]+:)?link\b[^>]*>/i.exec(block)?.[0];
    return link ? attribute(link, "href") : null;
  }
  return null;
}

function mergeFieldSources(primary: Record<string, FieldSource>, feed: Record<string, FieldSource>): Record<string, FieldSource> {
  const result = { ...feed };
  for (const [key, source] of Object.entries(primary)) {
    result[key] = source === "absent" ? (feed[key] ?? "absent") : source;
  }
  return result;
}

function isFeedType(type: string): boolean {
  return type.includes("json") || type.includes("xml") || type.includes("rss") || type.includes("atom");
}

function attribute(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? null;
}

function scalarValues(value: JsonObject): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string | number | boolean] => {
    const type = typeof entry[1];
    return type === "string" || type === "number" || type === "boolean";
  }));
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function lastPathSegment(value: string): string {
  const segments = new URL(value).pathname.split("/").filter(Boolean);
  return decodeURIComponent(segments.at(-1) ?? "target");
}

function decodeEntities(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}
