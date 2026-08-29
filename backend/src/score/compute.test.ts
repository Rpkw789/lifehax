import assert from "node:assert/strict";
import test from "node:test";

import { computeScores } from "./compute.ts";
import type { AgentRun, CatalogueSnapshot, SiteAudit } from "../../../shared/contracts/check-result.ts";

test("computeScores derives hit, discovery, mean rank, and competitors from runs", () => {
  const scores = computeScores(
    [run("q_001", true, 2), run("q_002", false, null)],
    siteAudit(),
    catalogue(),
  );

  assert.equal(scores.hit_rate, 0.5);
  assert.equal(scores.discovery_rate, 1);
  assert.equal(scores.mean_rank, 2);
  assert.deepEqual(scores.competitors_ahead, [{ name: "Other", url: "https://other.example/item", times_ahead: 2 }]);
  assert.deepEqual(scores.surfaces, {
    discoverability: 100,
    structured_data: 50,
    agent_protocol: 0,
    content_quality: 25,
  });
});

function run(queryId: string, recommended: boolean, rank: number | null): AgentRun {
  return {
    run_id: `ar_${queryId}`,
    query_id: queryId,
    agent: { agent_id: `a_${queryId}`, name: "Agent", persona: "Persona", color_hex: "#000000", model: "model", kind: "shared-search" },
    journey: { started_at: "2026-08-29T00:00:00Z", duration_ms: 1, stages: [] },
    outcome: {
      target_discovered: true,
      target_identity_matched: recommended,
      target_recommended: recommended,
      target_rank: rank,
      candidate_count: 1,
      top_3: rank !== null && rank <= 3,
      purchase_intent: "medium",
      purchase_completed: false,
      confidence: 0.5,
      failure_codes: recommended ? [] : [{ code: "OUTRANKED_BY_COMPETITOR" }],
      final_choice: { product_id: "other", name: "Other", url: "https://other.example/item", is_target_product: false },
      our_pages_fetched: [],
    },
    ranked_candidates: [{ rank: 1, product_id: "other", name: "Other", url: "https://other.example/item", is_target_product: false, reason_codes: [] }],
    observations: { price_found: true, availability_found: false, shipping_information_found: false, return_policy_found: false, structured_product_data_found: false, reviews_found: false, acp_supported: false, ucp_supported: false },
  };
}

function siteAudit(): SiteAudit {
  const absent = { url: "https://shop.example/missing", found: false, status: 404, note: null };
  return {
    llms_txt: absent,
    agent_commerce: absent,
    ucp: absent,
    robots: { ...absent, allows_agents: true },
    sitemap: { url: "https://shop.example/sitemap.xml", found: true, status: 200, note: null, products_listed: 2, products_total: 2, missing_product_ids: [] },
    structured_data: { products_total: 2, products_with_json_ld: 1, products_with_offer: 1, missing_json_ld_product_ids: ["B"], missing_offer_product_ids: ["B"] },
    client_side_price_product_ids: [],
  };
}

function catalogue(): CatalogueSnapshot {
  return { fetched_at: "2026-08-29T00:00:00Z", products_total: 2, products_readable: 2, unreadable: [], target_field_sources: {} };
}
