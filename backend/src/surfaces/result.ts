import {
  REPORT_TYPE,
  SCHEMA_VERSION,
  type CheckResult,
  type Evidence,
  type ProbeResult,
  type TargetProduct,
} from "@contracts/check-result";
import { assertCheckResult } from "@contracts/validate";
import type { PersonaBrief } from "../personas/generate.ts";
import { computeScores } from "../score/compute.ts";
import type { Catalogue, Checks } from "../types.ts";
import type { SearchWorkerResult } from "./search.ts";
import type { SurfaceWorkerResult } from "./types.ts";

export interface BuildSurfaceCheckResultInput {
  runId: string;
  reportId: string;
  generatedAt: string;
  locale: string;
  currency: string;
  catalogue: Catalogue;
  checks: Checks;
  target: TargetProduct;
  brief: PersonaBrief;
  protocol: SurfaceWorkerResult;
  guide: SurfaceWorkerResult;
  search: SearchWorkerResult;
}

export function buildSurfaceCheckResult(
  input: BuildSurfaceCheckResultInput,
): CheckResult {
  const protocolProbe = input.protocol.probes.agent_commerce ?? toProbe(input.checks.agentCommerce);
  const ucpProbe = input.protocol.probes.ucp ?? toProbe(input.checks.ucp);
  const guideProbe = input.guide.probes.llms_txt ?? toProbe(input.checks.llmsTxt);
  const targetPage = input.checks.pages.find(
    (page) => resourceKey(page.url) === resourceKey(input.target.canonical_url),
  );
  const productsTotal = Math.max(
    input.catalogue.products.length,
    input.checks.totals.productsChecked,
  );
  const sitemapTotal = Math.max(productsTotal, input.checks.sitemap.productsListed);
  const targetListed = input.catalogue.source === "sitemap";
  const evidence = uniqueEvidence([
    ...input.protocol.evidence,
    ...input.guide.evidence,
    ...input.search.evidence,
  ]);
  const agentRun = {
    ...input.search.run,
    observations: {
      ...input.search.run.observations,
      structured_product_data_found:
        input.search.run.outcome.target_identity_matched &&
        Boolean(targetPage?.hasProductJsonLd),
      acp_supported: protocolProbe.found,
      ucp_supported: ucpProbe.found,
    },
  };
  const siteAudit: CheckResult["site_audit"] = {
    llms_txt: guideProbe,
    agent_commerce: protocolProbe,
    ucp: ucpProbe,
    robots: {
      ...toProbe(input.checks.robots),
      allows_agents: input.checks.robots.allowsAgents,
    },
    sitemap: {
      ...toProbe(input.checks.sitemap),
      products_listed: input.checks.sitemap.productsListed,
      products_total: sitemapTotal,
      missing_product_ids: targetListed ? [] : [input.target.product_id],
    },
    structured_data: {
      products_total: input.checks.totals.productsChecked,
      products_with_json_ld: input.checks.totals.withJsonLd,
      products_with_offer: input.checks.totals.withOfferPrice,
      missing_json_ld_product_ids:
        targetPage && !targetPage.hasProductJsonLd ? [input.target.product_id] : [],
      missing_offer_product_ids:
        targetPage && !targetPage.hasOfferPrice ? [input.target.product_id] : [],
    },
    client_side_price_product_ids:
      targetPage?.hasOfferPrice && !targetPage.priceInServedHtml
        ? [input.target.product_id]
        : [],
  };
  const catalogueSnapshot: CheckResult["catalogue_snapshot"] = {
    fetched_at: input.generatedAt,
    products_total: productsTotal,
    products_readable: input.catalogue.products.length,
    unreadable: [],
    target_field_sources: targetFieldSources(input),
  };
  const report: CheckResult = {
    schema_version: SCHEMA_VERSION,
    report_type: REPORT_TYPE,
    report_id: input.reportId,
    run_id: input.runId,
    generated_at: input.generatedAt,
    status: "complete",
    error: null,
    brand: {
      brand_id: `brand_${input.catalogue.domain.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      name: input.catalogue.domain,
      store_url: input.catalogue.entryUrl,
      domain: stripWww(input.catalogue.domain),
    },
    target_product: input.target,
    catalogue_snapshot: catalogueSnapshot,
    site_audit: siteAudit,
    evaluation_config: {
      locale: input.locale,
      currency: input.currency,
      agent_count: 1,
      channels_tested: ["web_search", "acp", "ucp"],
      queries: [
        {
          query_id: input.brief.query_id,
          text: input.brief.query,
          intent: input.brief.intent,
        },
      ],
    },
    agent_runs: [agentRun],
    evidence,
    scores: computeScores([agentRun], siteAudit, catalogueSnapshot),
    hosted_sources: [],
    baseline_report_id: null,
  };
  assertCheckResult(report);
  return report;
}

function targetFieldSources(
  input: BuildSurfaceCheckResultInput,
): CheckResult["catalogue_snapshot"]["target_field_sources"] {
  const source = input.catalogue.source === "products.json" ? "feed" : "raw-html";
  return {
    canonical_url: source,
    name: input.target.name ? source : "absent",
    price: input.target.price ? source : "absent",
    sku: input.target.sku ? source : "absent",
    gtin: "absent",
    category: "absent",
  };
}

function toProbe(probe: {
  url: string;
  found: boolean;
  status: number | null;
  note: string | null;
}): ProbeResult {
  return {
    url: probe.url,
    found: probe.found,
    status: probe.status,
    note: probe.note,
  };
}

function uniqueEvidence(items: Evidence[]): Evidence[] {
  const byId = new Map<string, Evidence>();
  for (const item of items) byId.set(item.evidence_id, item);
  return [...byId.values()];
}

function resourceKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    return `${stripWww(url.hostname)}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return null;
  }
}

function stripWww(host: string): string {
  const lower = host.toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}
