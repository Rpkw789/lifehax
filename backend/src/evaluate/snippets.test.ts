import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../fixtures";
import {
  attributeSnippet,
  feedSnippet,
  llmsTxtSnippet,
  manifestSnippet,
  offerSnippet,
  shippingSnippet,
} from "./snippets";

const source = loadExampleCheckResult();

describe("attributeSnippet", () => {
  test("emits one property per attribute it is given", () => {
    const out = attributeSnippet(["waterproof", "weight_g"]);
    expect(out).toContain('"name": "waterproof"');
    expect(out).toContain('"name": "weight_g"');
  });

  test("names no attribute it was not given", () => {
    expect(attributeSnippet(["waterproof"])).not.toContain("weight_g");
  });

  test("returns non-empty output for an empty list, since the snippet is required", () => {
    expect(attributeSnippet([]).length).toBeGreaterThan(0);
  });
});

describe("offerSnippet", () => {
  test("uses the real price and currency from the target product", () => {
    const out = offerSnippet(source.target_product);
    expect(out).toContain("129.99");
    expect(out).toContain("USD");
  });

  test("falls back to a placeholder when price is absent", () => {
    const out = offerSnippet({ ...source.target_product, price: null });
    expect(out).toContain("priceCurrency");
    expect(out).not.toContain("null");
  });
});

describe("feedSnippet", () => {
  test("reports the real catalogue coverage", () => {
    const out = feedSnippet(source.site_audit);
    expect(out).toContain("40");
  });
});

describe("llmsTxtSnippet", () => {
  test("names the brand", () => {
    expect(llmsTxtSnippet(source.brand, source.site_audit)).toContain("Acme");
  });
});

describe("static snippets", () => {
  test("are non-empty", () => {
    expect(manifestSnippet().length).toBeGreaterThan(0);
    expect(shippingSnippet().length).toBeGreaterThan(0);
  });
});
