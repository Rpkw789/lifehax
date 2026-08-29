import type { ProbeResult, SiteAudit } from "../../../shared/contracts/check-result.ts";

export interface AuditedProduct {
  productId: string;
  hasJsonLd: boolean;
  hasOffer: boolean;
  hasClientSidePrice: boolean;
}

export interface AuditInputs {
  targetProductId: string;
  targetInSitemap: boolean;
  products: AuditedProduct[];
  probes: {
    llms_txt: ProbeResult;
    agent_commerce: ProbeResult;
    ucp: ProbeResult;
    robots: ProbeResult;
    sitemap: ProbeResult;
  };
  robotsAllowsAgents: boolean;
}

export function computeSiteAudit(input: AuditInputs): SiteAudit {
  const ids = input.products.map((product) => product.productId);
  const missingJsonLd = input.products.filter((product) => !product.hasJsonLd).map((product) => product.productId);
  const missingOffer = input.products.filter((product) => !product.hasOffer).map((product) => product.productId);
  const clientSidePrice = input.products.filter((product) => product.hasClientSidePrice).map((product) => product.productId);

  return {
    llms_txt: input.probes.llms_txt,
    agent_commerce: input.probes.agent_commerce,
    ucp: input.probes.ucp,
    robots: { ...input.probes.robots, allows_agents: input.robotsAllowsAgents },
    sitemap: {
      ...input.probes.sitemap,
      products_listed: input.targetInSitemap ? ids.length : Math.max(0, ids.length - 1),
      products_total: ids.length,
      missing_product_ids: input.targetInSitemap ? [] : [input.targetProductId],
    },
    structured_data: {
      products_total: ids.length,
      products_with_json_ld: ids.length - missingJsonLd.length,
      products_with_offer: ids.length - missingOffer.length,
      missing_json_ld_product_ids: missingJsonLd,
      missing_offer_product_ids: missingOffer,
    },
    client_side_price_product_ids: clientSidePrice,
  };
}
