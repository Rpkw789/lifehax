import assert from "node:assert/strict";
import test from "node:test";

import { computeSiteAudit } from "./compute.ts";

test("computeSiteAudit derives target coverage from observed documents", () => {
  const audit = computeSiteAudit({
    targetProductId: "A-1",
    targetInSitemap: false,
    products: [
      { productId: "A-1", hasJsonLd: true, hasOffer: false, hasClientSidePrice: true },
      { productId: "B-2", hasJsonLd: false, hasOffer: false, hasClientSidePrice: false },
    ],
    probes: {
      llms_txt: { url: "https://shop.example/llms.txt", found: false, status: 404, note: null },
      agent_commerce: { url: "https://shop.example/.well-known/agent-commerce", found: false, status: 404, note: null },
      ucp: { url: "https://shop.example/.well-known/ucp", found: false, status: 404, note: null },
      robots: { url: "https://shop.example/robots.txt", found: true, status: 200, note: null },
      sitemap: { url: "https://shop.example/sitemap.xml", found: true, status: 200, note: null },
    },
    robotsAllowsAgents: true,
  });

  assert.deepEqual(audit.sitemap.missing_product_ids, ["A-1"]);
  assert.deepEqual(audit.structured_data.missing_json_ld_product_ids, ["B-2"]);
  assert.deepEqual(audit.structured_data.missing_offer_product_ids, ["A-1", "B-2"]);
  assert.deepEqual(audit.client_side_price_product_ids, ["A-1"]);
});
