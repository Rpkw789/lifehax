/**
 * Diagnosis: turn the audit into ranked, evidence-citing findings.
 *
 * Surface scores are arithmetic over the probe results — no model decides a
 * number. The model only writes the prose explanation and the fix snippet, and
 * it is given the observed facts to quote rather than asked to guess them.
 */

import { completeJson, llmConfigured, type JsonSchema } from "./llm";
import type { AgentEvent, Checks, Finding, Persona, Surface } from "./types";

export function computeSurfaces(checks: Checks): Surface[] {
  const t = checks.totals;
  const n = t.productsChecked;
  // No pages read means no evidence of structure, which scores zero rather
  // than dividing by a placeholder.
  const per = (count: number): number => (n === 0 ? 0 : count / n);

  const structured = per(t.withJsonLd) * 0.6 + per(t.withOfferPrice) * 0.4;
  const website = per(t.withCartForm) * 0.6 + per(t.priceInServedHtml) * 0.4;
  const protocol =
    (checks.agentCommerce.found ? 0.5 : 0) +
    (checks.ucp.found ? 0.3 : 0) +
    (checks.llmsTxt.found ? 0.2 : 0);
  const discovery =
    (checks.sitemap.found ? 0.5 : 0) +
    (checks.sitemap.productsListed > 0 ? 0.3 : 0) +
    (checks.robots.allowsAgents ? 0.2 : 0);
  const checkout =
    (checks.checkoutWall.requiresAccount ? 0 : 0.6) +
    (checks.checkoutWall.status !== null ? 0.4 : 0);

  const mk = (name: string, fraction: number, note: string): Surface => ({
    name,
    score: String(Math.round(fraction * 100)),
    fraction: Math.max(0.02, Math.min(1, fraction)),
    note,
  });

  return [
    mk(
      "Website / browser-use",
      website,
      n === 0
        ? "no product pages were readable"
        : t.withCartForm === 0
        ? "add-to-cart has no form fallback an agent can post to"
        : `${t.withCartForm}/${n} product pages expose a real cart form`,
    ),
    mk(
      "Structured product data",
      structured,
      n === 0
        ? "no product pages were readable"
        : t.withJsonLd === 0
        ? "no Product JSON-LD found on sampled pages"
        : `${t.withJsonLd}/${n} pages carry Product JSON-LD, ${t.withOfferPrice}/${n} with Offer price`,
    ),
    mk(
      "Agent protocol (ACP/UCP)",
      protocol,
      protocol === 0
        ? "nothing at /.well-known — surface absent"
        : [
            checks.agentCommerce.found ? "agent-commerce" : null,
            checks.ucp.found ? "ucp" : null,
            checks.llmsTxt.found ? "llms.txt" : null,
          ]
            .filter(Boolean)
            .join(" + ") + " present",
    ),
    mk(
      "Search & discovery",
      discovery,
      checks.sitemap.found
        ? `${checks.sitemap.productsListed} products in sitemap`
        : "no sitemap reachable",
    ),
    mk(
      "Checkout & payment",
      checkout,
      checks.checkoutWall.requiresAccount
        ? "checkout redirects to account creation"
        : "checkout reachable without an account wall",
    ),
  ];
}

const SYSTEM = `You diagnose why AI shopping agents fail on a storefront.

You are given the raw result of an HTTP audit and the agent run events. Produce
ranked findings, most impactful first.

Rules:
- Every "evidence" string must quote observed facts from the audit: exact URLs,
  HTTP status codes, counts. Cite agent ids from the events when relevant.
- Never invent a status code, URL or count. If you did not observe it, do not
  claim it.
- Only report problems the audit actually shows. If the store is in good shape,
  return fewer findings. Do not pad.
- "snippet" is copy-pasteable code or config that fixes it.
- "impact" is like "+3 agents". "effort" is like "1 day". "owner" is a team
  name like "Web", "Platform", "Checkout", "SEO".
- severity is "critical", "high" or "medium".

Order the findings by how many agents each fix unblocks.`;

/** Structured-output contract for the diagnosis. */
const FINDINGS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium"] },
          title: { type: "string" },
          evidence: {
            type: "string",
            description:
              "Must quote observed URLs, status codes and counts from the audit.",
          },
          fix: { type: "string" },
          impact: { type: "string", description: 'e.g. "+3 agents"' },
          surface: { type: "string" },
          effort: { type: "string", description: 'e.g. "1 day"' },
          owner: { type: "string" },
          snippetLabel: { type: "string" },
          snippet: { type: "string" },
        },
        required: [
          "key", "severity", "title", "evidence", "fix", "impact",
          "surface", "effort", "owner", "snippetLabel", "snippet",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

export async function deriveFindings(
  checks: Checks,
  events: AgentEvent[],
  personas: Persona[],
): Promise<Finding[]> {
  const observed = {
    probes: {
      agentCommerce: checks.agentCommerce,
      ucp: checks.ucp,
      llmsTxt: checks.llmsTxt,
      robots: checks.robots,
      sitemap: checks.sitemap,
      checkout: checks.checkoutWall,
    },
    productPages: checks.pages,
    totals: checks.totals,
    agentFailures: events
      .filter((e) => e.kind === "fail")
      .map((e) => ({ agentId: e.agentId, stage: e.stage, reason: e.reason })),
    briefs: personas.map((p) => p.prompt),
  };

  if (!llmConfigured()) return ruleFindings(checks);

  try {
    const { findings } = await completeJson<{ findings: Finding[] }>(
      SYSTEM,
      JSON.stringify(observed, null, 2),
      FINDINGS_SCHEMA,
      8000,
    );
    const cleaned = findings
      .filter((f) => f && f.title && f.evidence)
      .map((f, i) => ({ ...f, key: f.key || `i${i}` }));
    return cleaned.length > 0 ? cleaned : ruleFindings(checks);
  } catch {
    return ruleFindings(checks);
  }
}

/**
 * Deterministic fallback. Used when the model is unavailable, and as the floor
 * if it returns nothing usable — a run should never reach Recommend empty.
 */
export function ruleFindings(checks: Checks): Finding[] {
  const out: Finding[] = [];
  const t = checks.totals;
  const n = t.productsChecked;

  // With no product page in hand, every page-derived check below would report
  // "0 of 0" and read as a defect. The absence of discoverable products is
  // itself the finding.
  if (n === 0) {
    out.push({
      key: "nothing-discoverable",
      severity: "critical",
      title: "No product pages could be discovered",
      evidence: `${checks.sitemap.url} returned ${checks.sitemap.status ?? "no response"} and listed ${checks.sitemap.productsListed} product URLs. No product feed was reachable either, so an agent has no entry point into the catalogue.`,
      fix: "Publish a sitemap that lists every product URL, and serve a machine-readable product feed at a stable path.",
      impact: "+4 agents",
      surface: "Discovery",
      effort: "half day",
      owner: "SEO",
      snippetLabel: "Feed",
      snippet:
        "GET /feeds/products.xml\n  -> every SKU, refreshed hourly\nsitemap: include /products/* on publish hook",
    });
  }

  if (!checks.agentCommerce.found && !checks.ucp.found) {
    out.push({
      key: "no-agent-endpoint",
      severity: "critical",
      title: "No agent-commerce endpoint exists",
      evidence: `${checks.agentCommerce.url} returned ${checks.agentCommerce.status ?? "no response"} and ${checks.ucp.url} returned ${checks.ucp.status ?? "no response"}. Every agent had to fall back to browsing the site.`,
      fix: "Publish a manifest describing your catalog, search and checkout intents so agents can skip the UI entirely.",
      impact: "+4 agents",
      surface: "Agent protocol",
      effort: "2-3 days",
      owner: "Platform",
      snippetLabel: "/.well-known/agent-commerce",
      snippet:
        '{\n  "version": "0.2",\n  "catalog": "/api/agent/catalog",\n  "search": "/api/agent/search",\n  "checkout": { "intent": "/api/agent/checkout", "guest": true }\n}',
    });
  }

  if (n > 0 && t.withJsonLd < n) {
    out.push({
      key: "missing-json-ld",
      severity: "high",
      title: "Product facts are not in structured data",
      evidence: `${t.withJsonLd} of ${n} sampled product pages carry Product JSON-LD; ${t.withOfferPrice} of ${n} include an Offer price. Checked: ${checks.pages.map((p) => p.url).join(", ")}.`,
      fix: "Emit Product + Offer JSON-LD server-side, with one additionalProperty per attribute a buyer would filter on.",
      impact: "+2 agents",
      surface: "Structured data",
      effort: "1 day",
      owner: "Web",
      snippetLabel: "Product JSON-LD",
      snippet:
        '"offers": { "@type": "Offer",\n  "price": "118.00",\n  "priceCurrency": "USD",\n  "availability": "https://schema.org/InStock" }',
    });
  }

  if (n > 0 && t.priceInServedHtml < n) {
    out.push({
      key: "client-side-price",
      severity: "high",
      title: "Price is injected client-side",
      evidence: `${n - t.priceInServedHtml} of ${n} sampled pages had no price in the served HTML — it arrives only after hydration, so a fetch-based agent never sees it.`,
      fix: "Render the price server-side into the initial HTML.",
      impact: "+2 agents",
      surface: "Structured data",
      effort: "1 day",
      owner: "Web",
      snippetLabel: "Served HTML",
      snippet: '<span data-agent="price" itemprop="price">118.00</span>',
    });
  }

  if (n > 0 && t.withCartForm === 0) {
    out.push({
      key: "no-cart-form",
      severity: "high",
      title: "Add-to-cart is a JS-only widget with no form fallback",
      evidence: `None of the ${n} sampled product pages expose a <form> posting to /cart/add. The control is a scripted element with no route an agent can call directly.`,
      fix: "Keep the widget, but wrap it in a real form that posts variant and quantity.",
      impact: "+1 agent",
      surface: "Website",
      effort: "2 days",
      owner: "Web",
      snippetLabel: "Markup",
      snippet:
        '<form method="post" action="/cart/add">\n  <input name="id" value="VARIANT_ID">\n  <input name="quantity" value="1">\n  <button data-agent="add-to-cart">Add to cart</button>\n</form>',
    });
  }

  if (n > 0 && t.quantityCapped > 0) {
    out.push({
      key: "quantity-cap",
      severity: "medium",
      title: "Quantity is capped with no bulk path",
      evidence: `${t.quantityCapped} of ${n} sampled pages cap quantity at 10 or fewer, and expose no route to a quote.`,
      fix: "Accept an arbitrary quantity, and expose bulk terms as data rather than a contact form.",
      impact: "+1 agent",
      surface: "Website",
      effort: "half day",
      owner: "Web",
      snippetLabel: "Field",
      snippet: '<input type="number" name="quantity" min="1" max="999">',
    });
  }

  if (checks.checkoutWall.requiresAccount) {
    out.push({
      key: "account-wall",
      severity: "high",
      title: "Checkout requires an account",
      evidence: `${checks.checkoutWall.url} returned ${checks.checkoutWall.status} and redirected toward account creation.`,
      fix: "Allow guest checkout with a tokenized card.",
      impact: "+2 agents",
      surface: "Checkout",
      effort: "1 week",
      owner: "Checkout",
      snippetLabel: "Bot rule",
      snippet:
        "if (isVerifiedAgent(ua) && hasSignedIntent(req)) {\n  return next();   // skip challenge\n}",
    });
  }

  if (!checks.llmsTxt.found) {
    out.push({
      key: "no-llms-txt",
      severity: "medium",
      title: "No model-readable site guide",
      evidence: `${checks.llmsTxt.url} returned ${checks.llmsTxt.status ?? "no response"}.`,
      fix: "Serve an llms.txt summarising your catalogue, buying surfaces and policies.",
      impact: "+1 agent",
      surface: "Discovery",
      effort: "half day",
      owner: "SEO",
      snippetLabel: "llms.txt",
      snippet:
        "# Your Store\n\n> One-line description.\n\n## Buying surfaces\n- [Product feed](/feeds/agent-products.json)\n\n## Policies\n- Returns: 30 days",
    });
  }

  return out;
}
