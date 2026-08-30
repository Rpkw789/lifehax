import { describe, expect, test } from "bun:test";
import { buildFindingsMarkdown, buildRunJson, type RunExport } from "./export";

const run: RunExport = {
  runId: "run_1",
  storeUrl: "https://example.com",
  exportedAt: "2026-08-29T12:00:00.000Z",
  catalogueCount: 12,
  defence: { score: 35, verdict: "Weak" },
  surfaceReadability: { score: 30, verdict: "Barely readable" },
  agents: [
    { id: "A01", persona: "Bargain hunter", stagesCleared: 6, outcome: "completed" },
    { id: "A02", persona: "Spec matcher", stagesCleared: 4, outcome: "blocked", reason: "no cart form" },
  ],
  surfaces: [{ name: "Structured data", score: "30", fraction: 0.3, note: "no Offer schema" }],
  findings: [
    {
      key: "i0",
      severity: "high",
      title: "No form-postable add-to-cart",
      evidence: "None of the 4 sampled pages expose a form.",
      fix: "Wrap the widget in a real form.",
      impact: "+1 agent",
      surface: "Website",
      effort: "2 days",
      owner: "Web",
      snippetLabel: "Markup",
      snippet: '<form method="post" action="/cart/add"></form>',
    },
  ],
};

describe("buildRunJson", () => {
  test("round-trips to the same object", () => {
    expect(JSON.parse(buildRunJson(run))).toEqual(run);
  });

  test("is indented, so a human opening the file can read it", () => {
    expect(buildRunJson(run)).toContain("\n  ");
  });
});

describe("buildFindingsMarkdown", () => {
  const md = buildFindingsMarkdown(run);

  test("leads with the store and the bot-exposure score", () => {
    expect(md).toContain("https://example.com");
    expect(md).toContain("35/100");
    expect(md).toContain("Weak");
  });

  test("gives every finding a heading, its evidence and its fix", () => {
    expect(md).toContain("## No form-postable add-to-cart");
    expect(md).toContain("None of the 4 sampled pages expose a form.");
    expect(md).toContain("Wrap the widget in a real form.");
  });

  test("puts the snippet in a fenced block so it can be copied", () => {
    expect(md).toContain("```");
    expect(md).toContain('<form method="post" action="/cart/add">');
  });

  test("records the agent outcomes, including why one was blocked", () => {
    expect(md).toContain("A02");
    expect(md).toContain("no cart form");
  });

  test("says so plainly when a run produced no findings", () => {
    const clean = buildFindingsMarkdown({ ...run, findings: [] });
    expect(clean).toContain("No findings");
    // The surfaces and agents sections still belong; the findings section must not.
    expect(clean).not.toContain("# Findings");
    expect(clean).not.toContain("No form-postable add-to-cart");
  });

  test("escapes nothing it should not — a snippet stays verbatim", () => {
    expect(md).not.toContain("&lt;form");
  });
});
