import { describe, expect, test } from "bun:test";
import { parseLlmsTxt, selectRelevantGuideLinks } from "./guide.ts";

const target = {
  name: "Primary item",
  canonical_url: "https://example.com/items/primary",
};

describe("parseLlmsTxt", () => {
  test("parses title, summary, sections, links, and target coverage", () => {
    const parsed = parseLlmsTxt(
      [
        "# Example Store",
        "",
        "> Agent guide",
        "",
        "Additional context for assistants.",
        "",
        "## Catalogue",
        "- [Primary item](https://example.com/items/primary): Current offer",
      ].join("\n"),
      target,
    );

    expect(parsed.title).toBe("Example Store");
    expect(parsed.summary).toBe("Agent guide");
    expect(parsed.links).toEqual([
      {
        label: "Primary item",
        url: "https://example.com/items/primary",
        note: "Current offer",
        section: "Catalogue",
      },
    ]);
    expect(parsed.target_covered).toBe(true);
  });

  test("reports missing required title without inventing one", () => {
    const parsed = parseLlmsTxt(
      "## Resources\n- [Item](https://example.com/items/primary)",
      target,
    );

    expect(parsed.title).toBeNull();
    expect(parsed.facts).toContain("Required H1 title is missing");
  });
});

describe("selectRelevantGuideLinks", () => {
  test("selects only relevant same-origin HTTP links", () => {
    const parsed = parseLlmsTxt(
      [
        "# Example Store",
        "## Resources",
        "- [Delivery details](https://example.com/help/delivery): Fast delivery information",
        "- [Primary item](https://example.com/items/primary): Current item",
        "- [Outside](https://outside.example/resource): Fast delivery",
        "- [Email](mailto:help@example.com): Contact",
      ].join("\n"),
      target,
    );

    const selected = selectRelevantGuideLinks(
      parsed,
      "find the Primary item with fast delivery",
      "https://example.com",
      3,
    );

    expect(selected).toEqual([
      "https://example.com/items/primary",
      "https://example.com/help/delivery",
    ]);
  });

  test("honors the maximum relevant-link limit", () => {
    const parsed = parseLlmsTxt(
      [
        "# Example Store",
        "## Resources",
        "- [Primary one](https://example.com/one)",
        "- [Primary two](https://example.com/two)",
        "- [Primary three](https://example.com/three)",
        "- [Primary four](https://example.com/four)",
      ].join("\n"),
      target,
    );

    expect(
      selectRelevantGuideLinks(
        parsed,
        "Primary",
        "https://example.com",
        3,
      ),
    ).toHaveLength(3);
  });
});
