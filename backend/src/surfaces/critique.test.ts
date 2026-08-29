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
  test("retries one invalid critique and accepts the corrected response", async () => {
    let calls = 0;
    const result = await requestSurfaceCritique(
      {
        surface: "model_readable_guide",
        facts: ["Target link is present"],
        evidence: [evidence],
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
      },
      async () => ({ summary: "missing fields" }),
    );

    expect(result.source).toBe("fallback");
    expect(result.critique.summary).toContain("Critique unavailable");
    expect(result.critique.gaps[0]?.evidence_ids).toEqual(["ev_guide_fetch"]);
  });
});
