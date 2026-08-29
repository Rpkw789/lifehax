/**
 * Fixture data for the readiness run.
 *
 * Copied verbatim from the design reference prototype. Copy in this file is
 * final — do not rewrite it. When a real backend lands, everything here is
 * replaced by the run resource and its sub-resources; the shapes already
 * match (see `types.ts`).
 */

import type { AgentPlan, Channel, Finding, Persona, StageName } from "./types";

/** The six journey stages, in order. */
export const STAGES: readonly StageName[] = [
  "discover",
  "land",
  "read",
  "select",
  "cart",
  "checkout",
] as const;

/** The five buying briefs. Name / prompt / color / tag are verbatim. */
export const PERSONAS: readonly Persona[] = [
  {
    name: "Bargain hunter",
    prompt: '"cheapest one that ships free, ignore brand"',
    color: "#c2760a",
    tag: "BGN",
  },
  {
    name: "Spec matcher",
    prompt: '"must be 40mm, matte black, dimmable"',
    color: "#2563eb",
    tag: "SPC",
  },
  {
    name: "Vague gifter",
    prompt: '"something nice for a new apartment, ~$120"',
    color: "#7c3aed",
    tag: "GFT",
  },
  {
    name: "Bulk buyer",
    prompt: '"40 units, net-30, delivered to one address"',
    color: "#0b8a5d",
    tag: "BLK",
  },
  {
    name: "In a rush",
    prompt: '"in stock, arrives Thursday, one click"',
    color: "#d02a2a",
    tag: "RSH",
  },
];

/**
 * The agent population: ten agents, two per brief.
 * `fail` is the 1-indexed stage the agent could not enter; 0 = completed checkout.
 */
export const PLAN: readonly AgentPlan[] = [
  { id: "A01", personaIndex: 0, fail: 0 },
  {
    id: "A02",
    personaIndex: 0,
    fail: 5,
    reason: "add-to-cart is a JS-only widget, no form fallback",
  },
  {
    id: "A03",
    personaIndex: 1,
    fail: 3,
    reason: "specs live only inside product images",
  },
  {
    id: "A04",
    personaIndex: 1,
    fail: 3,
    reason: "price injected client-side, absent from HTML",
  },
  {
    id: "A05",
    personaIndex: 2,
    fail: 1,
    reason: "no discovery feed; 12 of 40 SKUs missing from sitemap",
  },
  { id: "A06", personaIndex: 2, fail: 0 },
  {
    id: "A07",
    personaIndex: 3,
    fail: 4,
    reason: "quantity capped at 10, no B2B path exposed",
  },
  {
    id: "A08",
    personaIndex: 3,
    fail: 6,
    reason: "checkout requires account creation",
  },
  { id: "A09", personaIndex: 4, fail: 0 },
  {
    id: "A10",
    personaIndex: 4,
    fail: 6,
    reason: "captcha triggers on headless user-agent",
  },
];

/** Ticks between one agent starting and the next. */
export const START_GAP = 4;
/** Ticks an agent spends in each stage. */
export const STEP_TICKS = 7;
/**
 * Playback speed. The design tool exposed this as a slider; there is no
 * control for it in the product, but the stepper note reports it.
 */
export const SIM_SPEED = 1;
/** One tick every `140 / speed` ms; displayed elapsed = `tick * 0.14`s. */
export const TICK_MS = Math.max(40, 140 / SIM_SPEED);
/** Which four sessions get a livestream tile. */
export const TILE_IDS: readonly string[] = ["A02", "A03", "A08", "A09"];

/**
 * Where the focus ring sits in the viewport, per stage. Percentages of the
 * tile viewport box. Moving the ring between these is the signature motion.
 */
export const RING_REGIONS: readonly {
  top: string;
  left: string;
  width: string;
  height: string;
}[] = [
  { top: "6%", left: "6%", width: "88%", height: "13%" },
  { top: "5%", left: "5%", width: "90%", height: "16%" },
  { top: "22%", left: "6%", width: "45%", height: "42%" },
  { top: "26%", left: "54%", width: "40%", height: "20%" },
  { top: "50%", left: "54%", width: "40%", height: "14%" },
  { top: "68%", left: "6%", width: "88%", height: "24%" },
];

/** The URL shown in the fake URL bar, per stage. */
export const STAGE_URLS: readonly string[] = [
  "google.com/search?q=desk+lamp+dimmable",
  "northwind.supply/",
  "northwind.supply/products/atlas-lamp",
  "northwind.supply/products/atlas-lamp#variant",
  "northwind.supply/cart",
  "northwind.supply/checkout",
];

/** The action caption pinned to the bottom of a tile, per stage. */
export const STAGE_ACTIONS: readonly string[] = [
  "reading result set · ranking candidate stores",
  "loading storefront · waiting on hydration",
  "extracting title, price, stock, attributes",
  "resolving variant options against brief",
  "submitting add-to-cart",
  "creating checkout session · tokenizing card",
];

/** Console message for a passed stage. Failures read "BLOCKED at {stage} — {reason}". */
export const STAGE_PASS_LOGS: readonly string[] = [
  "search hit · store ranked #3 of 11",
  "GET /products/atlas-lamp → 200 · dom ready 1.8s",
  "parsed title ✓ price ✓ stock ✓ attrs 2/7",
  "variant resolved · matte black / 40mm",
  "POST /cart/add → 302 · line item 1",
  "checkout session created · card tokenized",
];

/** The five surface scores on Recommend. */
export const SURFACE_SCORES: readonly {
  name: string;
  score: string;
  fraction: number;
  note: string;
}[] = [
  {
    name: "Website / browser-use",
    score: "55",
    fraction: 0.55,
    note: "reachable, but 4 agents stalled on JS-only controls",
  },
  {
    name: "Structured product data",
    score: "30",
    fraction: 0.3,
    note: "no Offer schema; specs unreadable without vision",
  },
  {
    name: "Agent protocol (ACP/UCP)",
    score: "0",
    fraction: 0.02,
    note: "no manifest at /.well-known — surface absent",
  },
  {
    name: "Search & discovery",
    score: "61",
    fraction: 0.61,
    note: "12 of 40 SKUs missing from sitemap",
  },
  {
    name: "Checkout & payment",
    score: "35",
    fraction: 0.35,
    note: "account wall + captcha on headless agents",
  },
];

/** Agents reaching each stage after the fixes are applied, by stage. */
export const AFTER_COUNTS: readonly number[] = [10, 10, 10, 9, 9, 8];

/** The six findings, ordered by agents unblocked. */
export const FINDINGS: readonly Finding[] = [
  {
    key: "i0",
    severity: "critical",
    title: "No agent-commerce endpoint exists",
    evidence:
      "All 10 agents fell back to browsing the site by pixels. /.well-known/agent-commerce and /.well-known/ucp both returned 404.",
    fix: "Publish a manifest describing your catalog, search and checkout intents. Agents that speak the protocol skip your UI entirely, which removes the whole class of DOM failures below.",
    impact: "+4 agents",
    surface: "Agent protocol",
    effort: "2–3 days",
    owner: "Platform",
    snippetLabel: "/.well-known/agent-commerce",
    snippet:
      '{\n  "version": "0.2",\n  "catalog": "/api/agent/catalog",\n  "search": "/api/agent/search",\n  "checkout": { "intent": "/api/agent/checkout",\n                 "guest": true },\n  "payment": ["card_token", "delegated_mandate"]\n}',
  },
  {
    key: "i1",
    severity: "high",
    title: "Product facts only exist in images and client-side JS",
    evidence:
      "A03 and A04 read the page and found title and stock, but 5 of 7 required attributes were baked into product photos; price arrived after hydration and was absent from the served HTML.",
    fix: "Emit Product + Offer JSON-LD server-side, with one additionalProperty per spec you expect a buyer to filter on. Keep the price in the initial HTML.",
    impact: "+2 agents",
    surface: "Structured data",
    effort: "1 day",
    owner: "Web",
    snippetLabel: "Product JSON-LD",
    snippet:
      '"offers": { "@type": "Offer",\n  "price": "118.00",\n  "priceCurrency": "USD",\n  "availability": "InStock" },\n"additionalProperty": [\n  { "name": "diameter", "value": "40mm" },\n  { "name": "finish", "value": "matte black" },\n  { "name": "dimmable", "value": "true" }\n]',
  },
  {
    key: "i2",
    severity: "high",
    title: "Checkout requires an account, and captcha fires on headless agents",
    evidence:
      "A08 reached the payment step and was redirected to /account/new. A10 was served a captcha interstitial after its user-agent was flagged.",
    fix: "Allow guest checkout with a tokenized card, and allowlist verified agent user-agents so they get the standard flow instead of a challenge.",
    impact: "+2 agents",
    surface: "Checkout",
    effort: "1 week",
    owner: "Checkout",
    snippetLabel: "Bot rule",
    snippet:
      "if (isVerifiedAgent(ua) && hasSignedIntent(req)) {\n  return next();   // skip challenge\n}",
  },
  {
    key: "i3",
    severity: "high",
    title: "Add-to-cart is a JS-only widget with no form fallback",
    evidence:
      "A02 selected the right variant, then could not add it: the button is a div with a click handler and no accessible name, and there is no POST route to call directly.",
    fix: "Keep the widget, but wrap it in a real form that posts variant and quantity. Give the control a stable name and a testable hook.",
    impact: "+1 agent",
    surface: "Website",
    effort: "2 days",
    owner: "Web",
    snippetLabel: "Markup",
    snippet:
      '<form method="post" action="/cart/add">\n  <input name="variant" value="atl-1120-40-mb">\n  <input name="qty" value="1">\n  <button data-agent="add-to-cart">Add to cart</button>\n</form>',
  },
  {
    key: "i4",
    severity: "medium",
    title: "Quantity is capped at 10 with no bulk path",
    evidence:
      "A07 asked for 40 units. The select maxes out at 10 and there is no visible route to a quote, so the agent abandoned at variant selection.",
    fix: "Accept an arbitrary quantity input, and expose bulk terms as data rather than a contact form so an agent can act on them.",
    impact: "+1 agent",
    surface: "Website",
    effort: "half day",
    owner: "Web",
    snippetLabel: "Field",
    snippet:
      '<input type="number" name="qty" min="1" max="999">\n<!-- bulk terms: /api/agent/quote -->',
  },
  {
    key: "i5",
    severity: "medium",
    title: "12 of 40 sampled products are not discoverable",
    evidence:
      "A05 never reached the store: the SKUs it wanted are absent from sitemap.xml and return no result from external search.",
    fix: "Regenerate the sitemap from the live catalog on publish, and serve a machine-readable product feed at a stable URL.",
    impact: "+1 agent",
    surface: "Discovery",
    effort: "half day",
    owner: "SEO",
    snippetLabel: "Feed",
    snippet:
      "GET /feeds/products.xml\n  → 40/40 SKUs, updated hourly\nsitemap: include /products/* on publish hook",
  },
];

/** The three generated artifacts, with per-field provenance. */
export const CHANNELS: readonly Channel[] = [
  {
    key: "html",
    name: "Browsing agents",
    sub: "Enriched HTML + JSON-LD",
    target: "/products/atlas-lamp",
    fixes: "Fixes #2, #4",
    file: "atlas-lamp.snippet.html",
    code: '<!-- paste before </head> -->\n<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Product",\n  "name": "Atlas Desk Lamp",\n  "sku": "ATL-1120",\n  "brand": { "@type": "Brand", "name": "Northwind" },\n  "offers": {\n    "@type": "Offer",\n    "price": "118.00",\n    "priceCurrency": "USD",\n    "availability": "https://schema.org/InStock",\n    "shippingDetails": { "@type": "OfferShippingDetails",\n      "deliveryTime": "1-3 business days" }\n  },\n  "additionalProperty": [\n    { "@type": "PropertyValue", "name": "diameter", "value": "40 mm" },\n    { "@type": "PropertyValue", "name": "finish", "value": "matte black" },\n    { "@type": "PropertyValue", "name": "dimmable", "value": "true" },\n    { "@type": "PropertyValue", "name": "colorTemp", "value": "2700-5000K" }\n  ]\n}\n</script>\n\n<!-- server-rendered facts, was image-only -->\n<dl data-agent="specs">\n  <dt>Diameter</dt><dd>40 mm</dd>\n  <dt>Finish</dt><dd>Matte black</dd>\n  <dt>Dimmable</dt><dd>Yes, 2700-5000K</dd>\n</dl>',
    rows: [
      {
        field: "price",
        value: "118.00 USD",
        source: "cart API response",
        grounded: true,
      },
      {
        field: "availability",
        value: "InStock",
        source: "inventory endpoint",
        grounded: true,
      },
      {
        field: "diameter",
        value: "40 mm",
        source: "spec image OCR + PDF",
        grounded: true,
      },
      {
        field: "finish",
        value: "matte black",
        source: "variant name",
        grounded: true,
      },
      {
        field: "dimmable",
        value: "true, 2700–5000K",
        source: "spec sheet p.2",
        grounded: true,
      },
      {
        field: "energyRating",
        value: "—",
        source: "not found in any source",
        grounded: false,
      },
    ],
  },
  {
    key: "feed",
    name: "Feed for ACP / UCP",
    sub: "Structured entry per SKU",
    target: "/feeds/agent-products.json",
    fixes: "Fixes #1, #5, #6",
    file: "agent-products.json",
    code: '{\n  "id": "ATL-1120",\n  "title": "Atlas Desk Lamp",\n  "price": { "amount": 118.00, "currency": "USD" },\n  "availability": "in_stock",\n  "quantity_max": 999,\n  "bulk": { "threshold": 25, "quote_url": "/api/agent/quote" },\n  "attributes": {\n    "diameter_mm": 40,\n    "finish": "matte black",\n    "dimmable": true,\n    "color_temp_k": [2700, 5000]\n  },\n  "ideal_use_cases": [\n    "small desk or nightstand where footprint matters",\n    "late-night work: warm 2700K without waking a room",\n    "housewarming gift under $120"\n  ],\n  "not_suitable_for": [\n    "whole-room lighting",\n    "outdoor or damp locations"\n  ],\n  "checkout": { "guest": true, "intent": "/api/agent/checkout" }\n}',
    rows: [
      {
        field: "ideal_use_cases[0]",
        value: "small desk / nightstand",
        source: "dimensions + 41 reviews",
        grounded: true,
      },
      {
        field: "ideal_use_cases[1]",
        value: "warm 2700K late-night",
        source: "spec sheet",
        grounded: true,
      },
      {
        field: "ideal_use_cases[2]",
        value: "gift under $120",
        source: "price + gift-wrap option",
        grounded: true,
      },
      {
        field: "not_suitable_for",
        value: "outdoor / damp",
        source: "IP rating absent → excluded",
        grounded: true,
      },
      {
        field: "quantity_max",
        value: "999",
        source: "needs ops confirmation",
        grounded: false,
      },
      {
        field: "bulk.threshold",
        value: "25",
        source: "no published policy",
        grounded: false,
      },
    ],
  },
  {
    key: "llms",
    name: "llms.txt",
    sub: "Curated site guide for models",
    target: "/llms.txt",
    fixes: "Fixes #1, #6",
    file: "llms.txt",
    code: "# Northwind Supply\n\n> Desk lighting and workspace hardware, shipped from Portland.\n> 40 SKUs. Guest checkout available to verified agents.\n\n## Buying surfaces\n- [Agent manifest](/.well-known/agent-commerce): catalog, search, checkout intents\n- [Product feed](/feeds/agent-products.json): all 40 SKUs, hourly\n- [Quote API](/api/agent/quote): orders above 25 units\n\n## Catalog\n- [Desk lamps](/collections/lamps): 11 SKUs, $78-$240\n- [Monitor arms](/collections/arms): 6 SKUs, $95-$310\n- [Desks](/collections/desks): 9 SKUs, $420-$1,180\n\n## Policies\n- Returns: 30 days, unused, prepaid label\n- Shipping: 1-3 business days domestic\n- Warranty: 2 years on electrical\n\n## Not covered\n- No international shipping\n- No trade/contract pricing published",
    rows: [
      {
        field: "catalog counts",
        value: "40 SKUs, 3 collections",
        source: "live sitemap crawl",
        grounded: true,
      },
      {
        field: "price ranges",
        value: "per collection",
        source: "feed min/max",
        grounded: true,
      },
      {
        field: "returns",
        value: "30 days prepaid",
        source: "/policies/returns",
        grounded: true,
      },
      {
        field: "warranty",
        value: "2 years electrical",
        source: "/policies/warranty",
        grounded: true,
      },
      {
        field: "lead time",
        value: "1–3 days",
        source: "checkout estimate",
        grounded: true,
      },
      {
        field: "trade pricing",
        value: "declared absent",
        source: "no source — not asserted",
        grounded: false,
      },
    ],
  },
];
