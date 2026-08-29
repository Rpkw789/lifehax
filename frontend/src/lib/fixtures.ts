/**
 * Presentation constants for the run screens.
 *
 * Everything a run actually measures — briefs, findings, surface scores, agent
 * outcomes — now comes from the backend. What remains here is chrome: stage
 * names, tile geometry, and the generic captions the console shows for a
 * cleared stage.
 *
 * Nothing in this file may name a product category. The briefs below are
 * category-agnostic archetype placeholders shown before a run starts; the real
 * briefs are generated per store from its own catalogue.
 */

import type { Persona, StageName } from "./types";

/** The six journey stages, in order. */
export const STAGES: readonly StageName[] = [
  "discover",
  "land",
  "read",
  "select",
  "cart",
  "checkout",
] as const;

/**
 * Placeholder briefs, shown on Input before the store has been read. The
 * backend replaces these with briefs written from the real catalogue.
 */
export const ARCHETYPE_PERSONAS: readonly Persona[] = [
  {
    name: "Bargain hunter",
    prompt: "cheapest option that meets the need, brand agnostic",
    color: "#c2760a",
    tag: "BGN",
  },
  {
    name: "Spec matcher",
    prompt: "must match exact stated attributes",
    color: "#2563eb",
    tag: "SPC",
  },
  {
    name: "Vague gifter",
    prompt: "a gift, loose intent and a rough budget",
    color: "#7c3aed",
    tag: "GFT",
  },
  {
    name: "Bulk buyer",
    prompt: "large quantity, one delivery, invoiced terms",
    color: "#0b8a5d",
    tag: "BLK",
  },
  {
    name: "In a rush",
    prompt: "in stock, fastest delivery, fewest steps",
    color: "#d02a2a",
    tag: "RSH",
  },
];

/** Ten agents, two per brief. */
export const AGENT_COUNT = 10;

/**
 * Capture clips in `public/tiles/`, one per tile so no two play the same
 * footage. Purely decorative: a tile shows its agent's real Browserbase live
 * view whenever there is one, and falls back to a clip only when there is not.
 */
export const TILE_CLIPS: readonly string[] = [
  "sephora",
  "shein",
  "shopee",
  "footlocker",
  "medicube",
  "sweelee",
  "footlocker2",
];

/** How many sessions get a tile. One per clip, so none repeats. */
export const TILE_COUNT = TILE_CLIPS.length;

/**
 * Where the focus ring sits in the tile viewport, per stage. Percentages of the
 * viewport box. Moving the ring between these is the signature motion.
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

/** Path shown in the tile's URL bar, per stage. Prefixed with the real host. */
export const STAGE_PATHS: readonly string[] = [
  "/search",
  "/",
  "/products/…",
  "/products/…#variant",
  "/cart",
  "/checkout",
];

/** The action caption pinned to the bottom of a tile, per stage. */
export const STAGE_ACTIONS: readonly string[] = [
  "reading result set · ranking candidate stores",
  "loading storefront · waiting on hydration",
  "extracting title, price, stock, attributes",
  "resolving options against the brief",
  "submitting add-to-cart",
  "opening checkout · no payment details entered",
];

/** Console message for a cleared stage. Failures print the backend's reason. */
export const STAGE_PASS_LOGS: readonly string[] = [
  "product discovered in catalogue",
  "storefront reachable · dom ready",
  "title ✓ price ✓ stock ✓",
  "options resolved against the brief",
  "add-to-cart accepted",
  "checkout reached",
];
