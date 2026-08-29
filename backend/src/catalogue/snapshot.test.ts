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

function doc(url: string, status: number, body: string, contentType = "text/html"): FetchedDocument {
  return { url, status, body, contentType, durationMs: 3 };
}

function productHtml(name: string, url: string, sku: string): string {
  return `<script type="application/ld+json">{"@type":"Product","name":"${name}","url":"${url}","sku":"${sku}"}</script>`;
}
