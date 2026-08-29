import { describe, expect, test } from "bun:test";
import {
  requestSurfaceCritique,
  validateSurfaceCritique,
} from "./critique.ts";

const evidence = {
  evidence_id: "ev_guide_fetch",
  kind: "fetch" as const,
  at: "2026-08-29T10:25:03.114Z",
  url: "https://example.com/llms.txt",
  status: 200,
  summary: "Fetched /llms.txt",
  excerpt: "# Example Store",
};

describe("validateSurfaceCritique", () => {
  test("rejects uncited points and unexpected fields", () => {
    const errors = validateSurfaceCritique(
      {
        summary: "Readable but incomplete",
        strengths: [{ text: "Readable", evidence_ids: [], confidence: 1 }],
        gaps: [],
        shopper_impact: [],
        improvements: [],
        score: 100,
      },
      new Set(["ev_guide_fetch"]),
    );

    expect(errors).toContain("strengths point must cite at least one evidence id");
    expect(errors).toContain('strengths point contains unexpected field "confidence"');
    expect(errors).toContain('critique contains unexpected field "score"');
  });

  test("rejects critique points that invent evidence", () => {
    const errors = validateSurfaceCritique(
      {
        summary: "Readable but incomplete",
        strengths: [],
        gaps: [{ text: "No direct source", evidence_ids: ["ev_invented"] }],
        shopper_impact: [],
        improvements: [],
      },
      new Set(["ev_guide_fetch"]),
    );

    expect(errors).toContain('unknown evidence id "ev_invented"');
  });

  test("accepts a complete critique whose points cite run evidence", () => {
    expect(
      validateSurfaceCritique(
        {
          summary: "The guide links the target.",
          strengths: [
            { text: "Direct link is present", evidence_ids: ["ev_guide_fetch"] },
          ],
          gaps: [],
          shopper_impact: [],
          improvements: [],
        },
        new Set(["ev_guide_fetch"]),
      ),
    ).toEqual([]);
  });
});

describe("requestSurfaceCritique", () => {
  test("includes the shared target, brief, locale, and currency in model context", async () => {
    let prompt = "";
    await requestSurfaceCritique(
      {
        surface: "model_readable_guide",
        facts: ["Target link is present"],
        evidence: [evidence],
        target: {
          product_id: "item_primary",
          name: "Primary item",
          canonical_url: "https://example.com/items/primary",
          gtin: null,
          sku: null,
          category: null,
          price: { amount: 20, currency: "SGD" },
        },
        brief: "Find a well-documented option",
        locale: "en-SG",
        currency: "SGD",
      },
      async (_system, user) => {
        prompt = user;
        return {
          summary: "Target coverage is explicit.",
          strengths: [{ text: "The target is linked", evidence_ids: ["ev_guide_fetch"] }],
          gaps: [],
          shopper_impact: [],
          improvements: [],
        };
      },
    );

    expect(prompt).toContain("Find a well-documented option");
    expect(prompt).toContain("Primary item");
    expect(prompt).toContain("en-SG");
    expect(prompt).toContain("SGD");
  });

  test("retries one invalid critique and accepts the corrected response", async () => {
    let calls = 0;
    const result = await requestSurfaceCritique(
      {
        surface: "model_readable_guide",
        facts: ["Target link is present"],
        evidence: [evidence],
        target: {
          product_id: "item_primary",
          name: "Primary item",
          canonical_url: "https://example.com/items/primary",
          gtin: null,
          sku: null,
          category: null,
          price: { amount: 20, currency: "SGD" },
        },
        brief: "Find a well-documented option",
        locale: "en-SG",
        currency: "SGD",
      },
      async () => {
        calls += 1;
        return calls === 1
          ? {
              summary: "Unsupported",
              strengths: [],
              gaps: [{ text: "Invented", evidence_ids: ["ev_unknown"] }],
              shopper_impact: [],
              improvements: [],
            }
          : {
              summary: "Target coverage is explicit.",
              strengths: [
                {
                  text: "The target is linked",
                  evidence_ids: ["ev_guide_fetch"],
                },
              ],
              gaps: [],
              shopper_impact: [],
              improvements: [],
            };
      },
    );

    expect(calls).toBe(2);
    expect(result.source).toBe("model");
    expect(result.critique.summary).toBe("Target coverage is explicit.");
  });

  test("returns deterministic fallback after the retry also fails", async () => {
    const result = await requestSurfaceCritique(
      {
        surface: "model_readable_guide",
        facts: ["Target link is absent"],
        evidence: [evidence],
        target: {
          product_id: "item_primary",
          name: "Primary item",
          canonical_url: "https://example.com/items/primary",
          gtin: null,
          sku: null,
          category: null,
          price: { amount: 20, currency: "SGD" },
        },
        brief: "Find a well-documented option",
        locale: "en-SG",
        currency: "SGD",
      },
      async () => ({ summary: "missing fields" }),
    );

    expect(result.source).toBe("fallback");
    expect(result.critique.summary).toContain("Critique unavailable");
    expect(result.critique.gaps[0]?.evidence_ids).toEqual(["ev_guide_fetch"]);
  });

  test("does not invent an uncited fallback point when no evidence exists", async () => {
    const result = await requestSurfaceCritique(
      {
        surface: "agent_protocol",
        facts: ["No protocol evidence was returned"],
        evidence: [],
        target: {
          product_id: "item_primary",
          name: "Primary item",
          canonical_url: "https://example.com/items/primary",
          gtin: null,
          sku: null,
          category: null,
          price: null,
        },
        brief: "Find a well-documented option",
        locale: "en-US",
        currency: "USD",
      },
      async () => ({ summary: "invalid" }),
    );

    expect(result.critique.gaps).toEqual([]);
  });
});
