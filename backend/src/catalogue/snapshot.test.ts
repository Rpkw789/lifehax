import assert from "node:assert/strict";
import test from "node:test";

import { snapshotStore, type DocumentFetcher, type FetchedDocument } from "./snapshot.ts";

const storeUrl = "https://shop.example";
const targetUrl = "https://shop.example/items/alpha";

test("snapshotStore assembles target facts, probes, and extraction evidence", async () => {
  const responses = new Map<string, FetchedDocument>([
    [targetUrl, doc(targetUrl, 200, `<script type="application/ld+json">{"@type":"Product","name":"Alpha","url":"${targetUrl}","sku":"A-1","offers":{"price":"20","priceCurrency":"SGD"}}</script>`)],
    [`${storeUrl}/sitemap.xml`, doc(`${storeUrl}/sitemap.xml`, 200, `<urlset><url><loc>${targetUrl}</loc></url></urlset>`, "application/xml")],
    [`${storeUrl}/robots.txt`, doc(`${storeUrl}/robots.txt`, 200, "User-agent: *\nAllow: /", "text/plain")],
  ]);
  const fetcher: DocumentFetcher = {
    async get(url) {
      return responses.get(url) ?? doc(url, 404, "");
    },
  };

  const result = await snapshotStore({
    storeUrl,
    targetProductUrl: targetUrl,
    fetchedAt: "2026-08-29T00:00:00.000Z",
    fetcher,
  });

  assert.equal(result.targetProduct.product_id, "A-1");
  assert.equal(result.catalogueSnapshot.products_readable, 1);
  assert.equal(result.siteAudit.sitemap.products_listed, 1);
  assert.equal(result.siteAudit.robots.allows_agents, true);
  assert.equal(result.evidence[0]?.kind, "fetch");
  assert.equal(result.evidence.at(-1)?.kind, "extraction");
});

test("snapshotStore rejects a target page with no extractable product", async () => {
  const fetcher: DocumentFetcher = { async get(url) { return doc(url, 200, "<h1>Nothing here</h1>"); } };
  await assert.rejects(
    snapshotStore({ storeUrl, targetProductUrl: targetUrl, fetchedAt: "2026-08-29T00:00:00.000Z", fetcher }),
    /target product could not be extracted/,
  );
});

test("snapshotStore counts product pages discovered from the sitemap", async () => {
  const secondUrl = "https://shop.example/items/beta";
  const otherUrl = "https://shop.example/about";
  const responses = new Map<string, FetchedDocument>([
    [targetUrl, doc(targetUrl, 200, productHtml("Alpha", targetUrl, "A-1"))],
    [secondUrl, doc(secondUrl, 200, productHtml("Beta", secondUrl, "B-2"))],
    [otherUrl, doc(otherUrl, 200, "<h1>About</h1>")],
    [`${storeUrl}/sitemap.xml`, doc(`${storeUrl}/sitemap.xml`, 200, `<urlset><url><loc>${targetUrl}</loc></url><url><loc>${secondUrl}</loc></url><url><loc>${otherUrl}</loc></url></urlset>`, "application/xml")],
  ]);
  const fetcher: DocumentFetcher = { async get(url) { return responses.get(url) ?? doc(url, 404, ""); } };

  const result = await snapshotStore({ storeUrl, targetProductUrl: targetUrl, fetchedAt: "2026-08-29T00:00:00.000Z", fetcher });

  assert.equal(result.catalogueSnapshot.products_total, 2);
  assert.equal(result.catalogueSnapshot.products_readable, 2);
  assert.equal(result.siteAudit.structured_data.products_total, 2);
});

test("snapshotStore checks robots before fetching the target and stops when disallowed", async () => {
  const fetched: string[] = [];
  const fetcher: DocumentFetcher = {
    async get(url) {
      fetched.push(url);
      return doc(url, 200, "User-agent: Happy2Agent\nDisallow: /", "text/plain");
    },
  };

  await assert.rejects(
    snapshotStore({ storeUrl, targetProductUrl: targetUrl, fetchedAt: "2026-08-29T00:00:00.000Z", fetcher }),
    /robots.txt disallows Happy2Agent/,
  );
  assert.deepEqual(fetched, [`${storeUrl}/robots.txt`]);
});

test("snapshotStore discovers a JSON feed when the target page has no product fields", async () => {
  const feedUrl = `${storeUrl}/catalogue.json`;
  const secondUrl = `${storeUrl}/items/beta`;
  const responses = new Map<string, FetchedDocument>([
    [targetUrl, doc(targetUrl, 200, `<link rel="alternate" type="application/json" href="${feedUrl}">`)],
    [feedUrl, doc(feedUrl, 200, JSON.stringify({ products: [
      { id: "A-1", name: "Alpha", url: targetUrl, price: { amount: 20, currency: "SGD" }, availability: "in_stock" },
      { id: "B-2", name: "Beta", url: secondUrl, price: { amount: 25, currency: "SGD" } },
    ] }), "application/json")],
    [secondUrl, doc(secondUrl, 200, `<meta property="og:title" content="Beta"><meta property="og:url" content="${secondUrl}">`)],
    [`${storeUrl}/sitemap.xml`, doc(`${storeUrl}/sitemap.xml`, 200, `<urlset><url><loc>${targetUrl}</loc></url><url><loc>${secondUrl}</loc></url></urlset>`, "application/xml")],
    [`${storeUrl}/robots.txt`, doc(`${storeUrl}/robots.txt`, 200, "User-agent: *\nAllow: /", "text/plain")],
  ]);
  const fetcher: DocumentFetcher = { async get(url) { return responses.get(url) ?? doc(url, 404, ""); } };

  const result = await snapshotStore({ storeUrl, targetProductUrl: targetUrl, fetchedAt: "2026-08-29T00:00:00.000Z", fetcher });

  assert.equal(result.targetProduct.product_id, "A-1");
  assert.equal(result.targetProduct.name, "Alpha");
  assert.deepEqual(result.targetProduct.price, { amount: 20, currency: "SGD" });
  assert.equal(result.catalogueSnapshot.target_field_sources.name, "feed");
  assert.equal(result.catalogueSnapshot.products_readable, 2);
  assert.equal(result.siteAudit.structured_data.products_total, 2);
  assert.equal(result.siteAudit.structured_data.products_with_offer, 2);
  assert.equal(result.evidence.some((item) => item.url === feedUrl && item.kind === "fetch"), true);
});

function doc(url: string, status: number, body: string, contentType = "text/html"): FetchedDocument {
  return { url, status, body, contentType, durationMs: 3 };
}

function productHtml(name: string, url: string, sku: string): string {
  return `<script type="application/ld+json">{"@type":"Product","name":"${name}","url":"${url}","sku":"${sku}"}</script>`;
}
