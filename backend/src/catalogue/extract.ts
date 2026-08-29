import type { TargetProduct } from "../../../shared/contracts/check-result.ts";

export type FieldSource = "json-ld" | "raw-html" | "feed" | "meta" | "absent";

export interface ExtractedProduct {
  target: TargetProduct;
  availability: string | null;
  attributes: Record<string, string | number | boolean>;
  fieldSources: Record<string, FieldSource>;
  hasJsonLd: boolean;
  hasOffer: boolean;
}

type JsonObject = Record<string, unknown>;

export function extractProduct(html: string, pageUrl: string): ExtractedProduct | null {
  const jsonLdObjects = extractJsonLd(html);
  const product = jsonLdObjects.flatMap(flattenJsonLd).find(isProductObject);
  const metadata = extractMetadata(html);
  const canonical = extractCanonical(html, pageUrl);

  const name = stringValue(product?.name) ?? metadata["og:title"] ?? metadata["twitter:title"];
  if (!name) return null;

  const productUrl = absoluteUrl(
    stringValue(product?.url) ?? metadata["og:url"] ?? canonical,
    pageUrl,
  );
  const sku = stringValue(product?.sku);
  const gtin = firstString(product, ["gtin", "gtin8", "gtin12", "gtin13", "gtin14"]);
  const offers = firstObject(product?.offers);
  const jsonPrice = numberValue(offers?.price);
  const metaPrice = numberValue(metadata["product:price:amount"]);
  const amount = jsonPrice ?? metaPrice;
  const currency = stringValue(offers?.priceCurrency) ?? metadata["product:price:currency"];
  const category = stringValue(product?.category);
  const id = sku ?? gtin ?? lastPathSegment(productUrl);

  return {
    target: {
      product_id: id,
      name,
      canonical_url: productUrl,
      gtin,
      sku,
      category,
      price: amount !== null && currency ? { amount, currency } : null,
    },
    availability: stringValue(offers?.availability),
    attributes: scalarAttributes(product),
    fieldSources: {
      name: product?.name !== undefined ? "json-ld" : "meta",
      price: jsonPrice !== null ? "json-ld" : metaPrice !== null ? "meta" : "absent",
      availability: offers?.availability !== undefined ? "json-ld" : "absent",
      sku: sku ? "json-ld" : "absent",
      gtin: gtin ? "json-ld" : "absent",
      category: category ? "json-ld" : "absent",
    },
    hasJsonLd: product !== undefined,
    hasOffer: offers !== null,
  };
}

export function extractSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  for (const match of xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const value = decodeEntities(match[1]?.trim() ?? "");
    if (value) urls.push(value);
  }
  return urls;
}

function extractJsonLd(html: string): unknown[] {
  const values: unknown[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      values.push(JSON.parse(match[1] ?? ""));
    } catch {
      continue;
    }
  }
  return values;
}

function flattenJsonLd(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!isObject(value)) return [];
  const graph = value["@graph"];
  return graph === undefined ? [value] : [value, ...flattenJsonLd(graph)];
}

function isProductObject(value: JsonObject): boolean {
  const type = value["@type"];
  return type === "Product" || (Array.isArray(type) && type.includes("Product"));
}

function extractMetadata(html: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const property = attribute(tag, "property") ?? attribute(tag, "name");
    const content = attribute(tag, "content");
    if (property && content) metadata[property.toLowerCase()] = decodeEntities(content);
  }
  return metadata;
}

function extractCanonical(html: string, pageUrl: string): string {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (attribute(tag, "rel")?.toLowerCase() === "canonical") {
      return absoluteUrl(attribute(tag, "href") ?? pageUrl, pageUrl);
    }
  }
  return pageUrl;
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ?? null;
}

function firstObject(value: unknown): JsonObject | null {
  if (Array.isArray(value)) return value.find(isObject) ?? null;
  return isObject(value) ? value : null;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstString(object: JsonObject | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(object?.[key]);
    if (value) return value;
  }
  return null;
}

function absoluteUrl(value: string, base: string): string {
  return new URL(value, base).href;
}

function lastPathSegment(value: string): string {
  const segments = new URL(value).pathname.split("/").filter(Boolean);
  return decodeURIComponent(segments.at(-1) ?? "target");
}

function scalarAttributes(product: JsonObject | undefined): Record<string, string | number | boolean> {
  if (!product) return {};
  const excluded = new Set(["@context", "@type", "name", "url", "sku", "gtin", "gtin8", "gtin12", "gtin13", "gtin14", "category", "offers"]);
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(product)) {
    if (!excluded.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      attributes[key] = value;
    }
  }
  return attributes;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}
