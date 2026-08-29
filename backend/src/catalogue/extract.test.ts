import assert from "node:assert/strict";
import test from "node:test";

import { extractProduct, extractSitemapUrls } from "./extract.ts";

test("extractProduct reads identity and offer facts from Product JSON-LD", () => {
  const html = `<!doctype html>
    <link rel="canonical" href="https://shop.example/items/alpha">
    <script type="application/ld+json">{
      "@context":"https://schema.org",
      "@type":"Product",
      "name":"Alpha",
      "url":"https://shop.example/items/alpha",
      "sku":"A-1",
      "gtin13":"1234567890123",
      "offers":{"price":"19.95","priceCurrency":"SGD","availability":"https://schema.org/InStock"},
      "color":"blue"
    }</script>`;

  const product = extractProduct(html, "https://shop.example/items/alpha?ref=home");

  assert.ok(product);
  assert.equal(product.target.name, "Alpha");
  assert.equal(product.target.canonical_url, "https://shop.example/items/alpha");
  assert.deepEqual(product.target.price, { amount: 19.95, currency: "SGD" });
  assert.equal(product.availability, "https://schema.org/InStock");
  assert.equal(product.attributes.color, "blue");
  assert.equal(product.fieldSources.price, "json-ld");
});

test("extractProduct falls back to metadata without inventing absent facts", () => {
  const html = `<!doctype html>
    <meta property="og:title" content="Alpha">
    <meta property="og:url" content="https://shop.example/items/alpha">
    <meta property="product:price:amount" content="25.00">
    <meta property="product:price:currency" content="USD">`;

  const product = extractProduct(html, "https://shop.example/items/alpha");

  assert.ok(product);
  assert.equal(product.target.name, "Alpha");
  assert.equal(product.target.sku, null);
  assert.deepEqual(product.target.price, { amount: 25, currency: "USD" });
  assert.equal(product.fieldSources.name, "meta");
  assert.equal(product.fieldSources.sku, "absent");
});

test("extractProduct reads microdata and visible HTML when JSON-LD is absent", () => {
  const html = `<!doctype html>
    <main itemscope itemtype="https://schema.org/Product">
      <h1 itemprop="name">Alpha</h1>
      <meta itemprop="sku" content="A-1">
      <link itemprop="url" href="/items/alpha">
      <data itemprop="price" value="21.50"></data>
      <meta itemprop="priceCurrency" content="SGD">
      <link itemprop="availability" href="https://schema.org/InStock">
    </main>`;

  const product = extractProduct(html, "https://shop.example/items/alpha");

  assert.ok(product);
  assert.equal(product.target.name, "Alpha");
  assert.equal(product.target.sku, "A-1");
  assert.deepEqual(product.target.price, { amount: 21.5, currency: "SGD" });
  assert.equal(product.availability, "https://schema.org/InStock");
  assert.equal(product.fieldSources.name, "raw-html");
  assert.equal(product.fieldSources.price, "raw-html");
});

test("extractSitemapUrls decodes loc values from both urlsets and sitemap indexes", () => {
  const xml = `<sitemapindex>
    <sitemap><loc>https://shop.example/sitemap-products.xml</loc></sitemap>
    <sitemap><loc>https://shop.example/items/a?x=1&amp;y=2</loc></sitemap>
  </sitemapindex>`;

  assert.deepEqual(extractSitemapUrls(xml), [
    "https://shop.example/sitemap-products.xml",
    "https://shop.example/items/a?x=1&y=2",
  ]);
});
