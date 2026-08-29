import { expect, test } from "bun:test";
import { validateCheckResult } from "@contracts/validate";
import { buildSurfaceCheckResult } from "./result.ts";

test("builds one contract-valid report from the shared context", () => {
  const report = buildSurfaceCheckResult({
    runId: "run_surface",
    reportId: "report_surface",
    generatedAt: "2026-08-29T10:25:03.114Z",
    locale: "en-US",
    currency: "USD",
    catalogue: {
      domain: "example.com",
      origin: "https://example.com",
      entryUrl: "https://example.com/",
      hasPath: false,
      products: [
        {
          url: "https://example.com/items/primary",
          title: "Primary item",
          price: "20",
          attributes: {},
        },
      ],
      source: "sitemap",
      sitemapProductCount: 1,
    },
    checks: checksFixture(),
    target: targetFixture(),
    brief: briefFixture(),
    protocol: {
      surface: "agent_protocol",
      evidence: [evidence("ev_protocol", "fetch")],
      probes: {
        agent_commerce: { url: "https://example.com/.well-known/agent-commerce", found: false, status: 404, note: "Unable to be found" },
        ucp: { url: "https://example.com/.well-known/ucp", found: true, status: 200, note: "UCP version 2026-04-08" },
      },
      critique: null,
    },
    guide: {
      surface: "model_readable_guide",
      evidence: [evidence("ev_guide", "extraction")],
      probes: {
        llms_txt: { url: "https://example.com/llms.txt", found: true, status: 200, note: "Target product is linked directly" },
      },
      critique: null,
    },
    search: searchFixture(),
  });

  expect(validateCheckResult(report)).toEqual([]);
  expect(report.evaluation_config.agent_count).toBe(1);
  expect(report.evaluation_config.queries).toEqual([
    {
      query_id: "q_surface_001",
      text: "Find a well-documented option",
      intent: "product_discovery",
    },
  ]);
  expect(report.agent_runs).toHaveLength(1);
  expect(report.site_audit.ucp.found).toBe(true);
  expect(report.scores.hit_rate).toBe(1);
});

function targetFixture() {
  return {
    product_id: "item_primary",
    name: "Primary item",
    canonical_url: "https://example.com/items/primary",
    gtin: null,
    sku: null,
    category: null,
    price: { amount: 20, currency: "USD" },
  };
}

function briefFixture() {
  return {
    brief_id: "brief_surface_001",
    query_id: "q_surface_001",
    name: "Careful shopper",
    persona: "Compares sources.",
    query: "Find a well-documented option",
    intent: "product_discovery" as const,
  };
}

function evidence(evidence_id: string, kind: "fetch" | "extraction") {
  return { evidence_id, kind, at: "2026-08-29T10:25:03.114Z", url: "https://example.com", status: 200, summary: evidence_id, excerpt: null };
}

function checksFixture() {
  const probe = { url: "https://example.com/resource", found: true, status: 200, note: null };
  return {
    agentCommerce: probe,
    ucp: probe,
    llmsTxt: probe,
    robots: { ...probe, allowsAgents: true },
    sitemap: { ...probe, productsListed: 1 },
    pages: [{ url: "https://example.com/items/primary", status: 200, hasJsonLd: true, hasProductJsonLd: true, hasOfferPrice: true, priceInServedHtml: true, hasCartForm: false, quantityMax: null, note: null }],
    totals: { productsChecked: 1, withJsonLd: 1, withOfferPrice: 1, priceInServedHtml: 1, withCartForm: 0, quantityCapped: 0 },
    checkoutWall: { ...probe, requiresAccount: false },
  };
}

function searchFixture() {
  return {
    surface: "web_search" as const,
    evidence: [evidence("ev_search", "fetch")],
    probes: {},
    critique: null,
    run: {
      run_id: "ar_surface_001",
      query_id: "q_surface_001",
      agent: { agent_id: "agent_surface_001", name: "Careful shopper", persona: "Compares sources.", color_hex: "#475569", model: "anthropic/test", kind: "shared-search" as const },
      journey: { started_at: "2026-08-29T10:25:03.114Z", duration_ms: 1, stages: [{ stage: "store_browse" as const, status: "completed" as const, duration_ms: 0, error_code: null, evidence_ids: ["ev_search"] }, { stage: "web_search" as const, status: "completed" as const, duration_ms: 1, error_code: null, evidence_ids: ["ev_search"] }, { stage: "protocol_check" as const, status: "skipped" as const, duration_ms: 0, error_code: null, evidence_ids: [] }, { stage: "purchase_decision" as const, status: "completed" as const, duration_ms: 0, error_code: null, evidence_ids: [] }] },
      outcome: { target_discovered: true, target_identity_matched: true, target_recommended: true, target_rank: 1, candidate_count: 1, top_3: true, purchase_intent: "medium" as const, purchase_completed: false, confidence: 0.8, failure_codes: [], final_choice: { product_id: "item_primary", name: "Primary item", url: "https://example.com/items/primary", is_target_product: true }, our_pages_fetched: ["https://example.com/items/primary"] },
      ranked_candidates: [{ rank: 1, product_id: "item_primary", name: "Primary item", url: "https://example.com/items/primary", is_target_product: true, reason_codes: [] }],
      observations: { price_found: true, availability_found: false, shipping_information_found: false, return_policy_found: false, structured_product_data_found: true, reviews_found: false, acp_supported: false, ucp_supported: true },
    },
  };
}
