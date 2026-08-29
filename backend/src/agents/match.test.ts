import assert from "node:assert/strict";
import test from "node:test";

import { matchProposal } from "./match.ts";

test("matchProposal derives target rank from canonical candidate URLs", () => {
  const result = matchProposal({
    brandDomain: "shop.example",
    target: {
      product_id: "A-1",
      name: "Alpha",
      canonical_url: "https://shop.example/items/alpha",
      gtin: null,
      sku: "A-1",
      category: null,
      price: { amount: 20, currency: "SGD" },
    },
    proposal: {
      candidates: [
        { name: "Other", url: "https://other.example/items/one", reason_codes: [{ code: "STRONG_REVIEW_EVIDENCE" }] },
        { name: "Alpha", url: "https://shop.example/items/alpha/?utm_source=agent", reason_codes: [{ code: "PRICE_MATCH" }] },
      ],
      purchase_intent: "high",
      confidence: 0.9,
    },
    citations: [{ title: "Alpha", url: "https://shop.example/items/alpha" }],
    observations: baseObservations(),
  });

  assert.equal(result.outcome.target_discovered, true);
  assert.equal(result.outcome.target_identity_matched, true);
  assert.equal(result.outcome.target_recommended, true);
  assert.equal(result.outcome.target_rank, 2);
  assert.equal(result.rankedCandidates[1]?.is_target_product, true);
});

test("matchProposal never trusts a foreign candidate identity", () => {
  const result = matchProposal({
    brandDomain: "shop.example",
    target: { product_id: "A-1", name: "Alpha", canonical_url: "https://shop.example/items/alpha", gtin: null, sku: "A-1", category: null, price: null },
    proposal: { candidates: [{ name: "Alpha", url: "https://other.example/items/alpha", reason_codes: [] }], purchase_intent: "low", confidence: 0.5 },
    citations: [],
    observations: baseObservations(),
  });

  assert.equal(result.outcome.target_recommended, false);
  assert.deepEqual(result.outcome.failure_codes, [{ code: "NOT_IN_SEARCH_RESULTS" }]);
});

function baseObservations() {
  return {
    price_found: true,
    availability_found: true,
    shipping_information_found: false,
    return_policy_found: false,
    structured_product_data_found: true,
    reviews_found: false,
    acp_supported: false,
    ucp_supported: false,
  };
}
