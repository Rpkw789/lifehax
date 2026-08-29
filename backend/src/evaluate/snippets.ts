/**
 * Fix payloads rendered on the Recommend screen.
 *
 * Built from the source document, never from category constants: the attribute
 * snippet lists exactly the attributes the run flagged, and the offer snippet
 * carries the brand's real price.
 */

import type { Brand, SiteAudit, TargetProduct } from "@contracts/check-result";

export function manifestSnippet(): string {
  return [
    "{",
    '  "version": "0.2",',
    '  "catalog": "/api/agent/catalog",',
    '  "search": "/api/agent/search",',
    '  "checkout": { "intent": "/api/agent/checkout", "guest": true },',
    '  "payment": ["card_token", "delegated_mandate"]',
    "}",
  ].join("\n");
}

export function attributeSnippet(attributes: string[]): string {
  if (attributes.length === 0) {
    return '"additionalProperty": []';
  }
  const rows = attributes
    .map((name) => `  { "@type": "PropertyValue", "name": ${JSON.stringify(name)}, "value": "" }`)
    .join(",\n");
  return `"additionalProperty": [\n${rows}\n]`;
}

export function offerSnippet(product: TargetProduct): string {
  const amount = product.price ? JSON.stringify(product.price.amount.toFixed(2)) : '"<your price>"';
  const currency = product.price ? JSON.stringify(product.price.currency) : '"<your currency>"';
  return [
    '"offers": {',
    '  "@type": "Offer",',
    `  "price": ${amount},`,
    `  "priceCurrency": ${currency},`,
    '  "availability": "https://schema.org/InStock"',
    "}",
  ].join("\n");
}

export function feedSnippet(audit: SiteAudit): string {
  const { products_listed, products_total } = audit.sitemap;
  return [
    "GET /feeds/products.xml",
    `  -> all ${products_total} SKUs, updated hourly`,
    `  (sitemap currently lists ${products_listed} of ${products_total})`,
    "sitemap: include /products/* on publish hook",
  ].join("\n");
}

export function shippingSnippet(): string {
  return [
    '"shippingDetails": {',
    '  "@type": "OfferShippingDetails",',
    '  "shippingRate": { "@type": "MonetaryAmount", "value": "<your shipping rate>", "currency": "<your currency>" },',
    '  "deliveryTime": "<your delivery window>"',
    "}",
  ].join("\n");
}

export function llmsTxtSnippet(brand: Brand, audit: SiteAudit): string {
  return [
    `# ${brand.name}`,
    "",
    "## Buying surfaces",
    `- [Product feed](/feeds/products.xml): all ${audit.sitemap.products_total} SKUs, hourly`,
    "",
    "## Policies",
    "- Returns: <your returns policy>",
    "- Shipping: <your shipping policy>",
  ].join("\n");
}
