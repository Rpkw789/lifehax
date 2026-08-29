/**
 * Fixture data for the readiness run.
 *
 * Copied verbatim from the design reference prototype. Copy in this file is
 * final — do not rewrite it. When a real backend lands, everything here is
 * replaced by the run resource and its sub-resources; the shapes already
 * match (see `types.ts`).
 */

import type { Finding } from "@contracts/finding";
import findingsFixture from "@fixtures/findings.example.json";

import type { AgentPlan, Persona, StageName } from "./types";

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

/**
 * Placeholder findings until the screen reads a real run. Sourced from the
 * committed fixture so the frontend and backend cannot disagree about the shape.
 */
export const FINDINGS: readonly Finding[] = findingsFixture as unknown as Finding[];
