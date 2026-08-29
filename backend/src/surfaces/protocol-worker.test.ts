import { expect, test } from "bun:test";
import { runProtocolSimulation } from "./protocol-worker.ts";

test("does not ask the model to critique HTML soft-404 protocol responses", async () => {
  let critiqueCalls = 0;
  let sequence = 0;
  const result = await runProtocolSimulation(
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
      brief: "Find a well-documented option",
      at: "2026-08-29T10:25:03.114Z",
      fetcher: {
        async get(url: string) {
          return {
            url,
            status: 200,
            body: "<!doctype html><title>Not found</title>",
            contentType: "text/html",
            durationMs: 1,
          };
        },
      },
    },
    (surface, phase, message, evidenceId) => ({
      event_id: `surf_${sequence}`,
      sequence: sequence++,
      surface,
      phase,
      at: "2026-08-29T10:25:03.114Z",
      message,
      evidence_id: evidenceId,
    }),
    {
      critiqueClient: async () => {
        critiqueCalls += 1;
        return {};
      },
    },
  );

  expect(critiqueCalls).toBe(0);
  expect(result.critique).toBeNull();
  expect(result.probes.agent_commerce?.note).toBe("Unable to be found");
  expect(result.probes.ucp?.note).toBe("Unable to be found");
});
