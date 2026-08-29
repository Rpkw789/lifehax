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

  test("emits valid JSON for an empty list", () => {
    expect(() => JSON.parse(`{${attributeSnippet([])}}`)).not.toThrow();
  });

  test("emits valid JSON for a populated list", () => {
    expect(() => JSON.parse(`{${attributeSnippet(["waterproof", "weight_g"])}}`)).not.toThrow();
  });
});

describe("offerSnippet", () => {
  test("emits valid JSON when the price is known", () => {
    expect(() => JSON.parse(`{${offerSnippet(source.target_product)}}`)).not.toThrow();
  });

  test("uses the real price and currency when they are present", () => {
    const out = offerSnippet(source.target_product);
    expect(out).toContain("129.99");
    expect(out).toContain("USD");
    expect(out).not.toContain("<your price>");
    expect(out).not.toContain("<your currency>");
  });

  test("never fabricates a price when one is absent", () => {
    const out = offerSnippet({ ...source.target_product, price: null });
    expect(out).not.toContain("0.00");
    expect(out).not.toContain("null");
    expect(out).toContain("<your price>");
  });
});

describe("feedSnippet", () => {
  test("reports both the listed count and the total", () => {
    const out = feedSnippet(source.site_audit);
    expect(out).toContain("28");
    expect(out).toContain("40");
  });
});

describe("llmsTxtSnippet", () => {
  test("uses the brand name from the data, not a constant", () => {
    const out = llmsTxtSnippet({ ...source.brand, name: "Northwind" }, source.site_audit);
    expect(out).toContain("Northwind");
    expect(out).not.toContain("Acme");
  });
});

describe("static snippets", () => {
  test("are non-empty", () => {
    expect(manifestSnippet().length).toBeGreaterThan(0);
    expect(shippingSnippet().length).toBeGreaterThan(0);
  });
});
