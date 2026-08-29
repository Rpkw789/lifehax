import { expect, test } from "bun:test";
import type { SurfaceSimulationEvent } from "@contracts/surface-simulation";
import { runGuideSimulation } from "./guide-worker.ts";

test("includes followed-link failures in the deterministic critique facts", async () => {
  let prompt = "";
  const events: SurfaceSimulationEvent[] = [];
  await runGuideSimulation(
    {
      runId: "run_surface",
      storeUrl: "https://example.com",
      target: {
        product_id: "item_primary",
        name: "Primary item",
        canonical_url: "https://example.com/items/primary",
        gtin: null,
        sku: null,
        category: null,
        price: null,
      },
      brief: "Find the Primary item",
      locale: "en-US",
      currency: "USD",
      at: "2026-08-29T10:25:03.114Z",
      fetcher: {
        async get(url: string) {
          if (url.endsWith("/llms.txt")) {
            return {
              url,
              status: 200,
              body: "# Store\n## Products\n- [Primary item](https://example.com/items/primary)",
              contentType: "text/markdown",
              durationMs: 1,
            };
          }
          return { url, status: 404, body: "", contentType: "text/plain", durationMs: 1 };
        },
      },
    },
    (surface, phase, message, evidenceId) => {
      const event: SurfaceSimulationEvent = {
        event_id: `surf_${events.length}`,
        sequence: events.length,
        surface,
        phase,
        at: "2026-08-29T10:25:03.114Z",
        message,
        evidence_id: evidenceId,
      };
      events.push(event);
      return event;
    },
    {
      critiqueClient: async (_system, user) => {
        prompt = user;
        return {
          summary: "Linked evidence is unavailable.",
          strengths: [],
          gaps: [{ text: "The product link is broken", evidence_ids: ["ev_guide_linked_01"] }],
          shopper_impact: [],
          improvements: [],
        };
      },
    },
  );

  expect(prompt).toContain("1 followed links returned non-success HTTP statuses");
  expect(events.some((event) => event.message.includes("HTTP 404"))).toBe(true);
});
