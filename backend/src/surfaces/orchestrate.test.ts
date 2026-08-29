import { expect, test } from "bun:test";
import type { SurfaceWorkerContext, SurfaceWorkerResult } from "./types.ts";
import { runSurfaceSimulations, type SurfaceSimulationInput } from "./orchestrate.ts";

test("runs all three methods with the same target and brief and monotonic events", async () => {
  const contexts: SurfaceWorkerContext[] = [];
  const events: number[] = [];
  const worker = (surface: SurfaceWorkerResult["surface"], delay: number) =>
    async (context: SurfaceWorkerContext, emit: Parameters<typeof runSurfaceSimulations>[1]["emitForWorker"]) => {
      contexts.push(context);
      await new Promise((resolve) => setTimeout(resolve, delay));
      emit(surface, "context", `Started ${surface}`, null);
      emit(surface, "result", `Finished ${surface}`, null);
      return { surface, evidence: [], probes: {}, critique: null } satisfies SurfaceWorkerResult;
    };

  const report = await runSurfaceSimulations(
    inputFixture(),
    {
      protocolWorker: worker("agent_protocol", 3),
      guideWorker: worker("model_readable_guide", 1),
      searchWorker: async (context, emit) => ({
        ...(await worker("web_search", 2)(context, emit)),
        surface: "web_search" as const,
        run: failedRun(),
      }),
      emitForWorker: (surface, phase, message, evidenceId) => {
        const sequence = events.length;
        events.push(sequence);
        return { event_id: `surf_${sequence}`, sequence, surface, phase, at: "2026-08-29T10:25:03.114Z", message, evidence_id: evidenceId };
      },
    },
  );

  expect(contexts).toHaveLength(3);
  expect(contexts.every((context) => context.target === contexts[0]?.target)).toBe(true);
  expect(contexts.every((context) => context.brief === contexts[0]?.brief)).toBe(true);
  expect(contexts.every((context) => context.storeUrl === "https://example.com/")).toBe(true);
  expect(events).toEqual([0, 1, 2, 3, 4, 5]);
  expect(report.evaluation_config.queries[0]?.text).toBe("Find a well-documented option");
});

test("marks a failed method unavailable while the other simulations settle", async () => {
  const input = inputFixture();
  const emitForWorker: Parameters<typeof runSurfaceSimulations>[1]["emitForWorker"] =
    (surface, phase, message, evidenceId) => ({
      event_id: `surf_${surface}_${phase}`,
      sequence: phase === "result" ? 1 : 0,
      surface,
      phase,
      at: "2026-08-29T10:25:03.114Z",
      message,
      evidence_id: evidenceId,
    });

  const report = await runSurfaceSimulations(input, {
    emitForWorker,
    protocolWorker: async () => ({
      surface: "agent_protocol",
      evidence: [],
      probes: {},
      critique: null,
    }),
    guideWorker: async () => {
      throw new Error("recorded fetch failure");
    },
    searchWorker: async () => ({
      surface: "web_search",
      evidence: [],
      probes: {},
      critique: null,
      run: failedRun(),
    }),
  });

  expect(report.site_audit.llms_txt).toEqual({
    url: "https://example.com/llms.txt",
    found: false,
    status: null,
    note: "Unable to verify",
  });
  expect(report.agent_runs).toHaveLength(1);
});

test("bounds a hung worker and still returns a degraded report", async () => {
  const report = await runSurfaceSimulations(inputFixture(), {
    workerTimeoutMs: 5,
    emitForWorker: (surface, phase, message, evidenceId) => ({
      event_id: `surf_${surface}_${phase}`,
      sequence: phase === "result" ? 1 : 0,
      surface,
      phase,
      at: "2026-08-29T10:25:03.114Z",
      message,
      evidence_id: evidenceId,
    }),
    protocolWorker: async () => new Promise<never>(() => undefined),
    guideWorker: async () => ({
      surface: "model_readable_guide",
      evidence: [],
      probes: {},
      critique: null,
    }),
    searchWorker: async () => ({
      surface: "web_search",
      evidence: [],
      probes: {},
      critique: null,
      run: failedRun(),
    }),
  });

  expect(report.site_audit.agent_commerce.note).toBe("Unable to verify");
  expect(report.evidence.some((item) => item.summary.includes("timed out"))).toBe(true);
});

test("drops progress emitted by a timed-out worker after it settles", async () => {
  const messages: string[] = [];
  await runSurfaceSimulations(inputFixture(), {
    workerTimeoutMs: 5,
    emitForWorker: (surface, phase, message, evidenceId) => {
      messages.push(message);
      return {
        event_id: `surf_${messages.length}`,
        sequence: messages.length,
        surface,
        phase,
        at: "2026-08-29T10:25:03.114Z",
        message,
        evidence_id: evidenceId,
      };
    },
    protocolWorker: async (_context, emit) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      emit("agent_protocol", "result", "late protocol result", null);
      return { surface: "agent_protocol", evidence: [], probes: {}, critique: null };
    },
    guideWorker: async () => ({ surface: "model_readable_guide", evidence: [], probes: {}, critique: null }),
    searchWorker: async () => ({ surface: "web_search", evidence: [], probes: {}, critique: null, run: failedRun() }),
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(messages).not.toContain("late protocol result");
});

test("rejects a run with no enabled shopper brief", async () => {
  const input = inputFixture();
  input.disabledPersonas = [0];
  await expect(
    runSurfaceSimulations(input, {
      emitForWorker: () => {
        throw new Error("workers must not start");
      },
    }),
  ).rejects.toThrow("enabled shopper brief");
});

test("every surface event evidence reference resolves in the final report", async () => {
  const evidenceIds: Array<string | null> = [];
  const report = await runSurfaceSimulations(inputFixture(), {
    emitForWorker: (surface, phase, message, evidenceId) => {
      evidenceIds.push(evidenceId);
      return {
        event_id: `surf_${evidenceIds.length}`,
        sequence: evidenceIds.length,
        surface,
        phase,
        at: "2026-08-29T10:25:03.114Z",
        message,
        evidence_id: evidenceId,
      };
    },
  });
  const reportEvidenceIds = new Set(report.evidence.map((item) => item.evidence_id));
  expect(
    evidenceIds.filter((id): id is string => id !== null)
      .every((id) => reportEvidenceIds.has(id)),
  ).toBe(true);
});

function inputFixture(): SurfaceSimulationInput {
  const probe = { url: "https://example.com/resource", found: true, status: 200, note: null };
  return {
    runId: "run_surface",
    reportId: "report_surface",
    generatedAt: "2026-08-29T10:25:03.114Z",
    storeUrl: "example.com",
    testSkus: "primary",
    disabledPersonas: [],
    catalogue: { domain: "example.com", origin: "https://example.com", entryUrl: "https://example.com/", hasPath: false, products: [{ url: "https://example.com/items/primary", title: "Primary item", price: "20", attributes: {} }], source: "sitemap" as const, sitemapProductCount: 1, sitemapUrls: ["https://example.com/items/primary"] },
    checks: { agentCommerce: probe, ucp: probe, llmsTxt: probe, robots: { ...probe, allowsAgents: true }, sitemap: { ...probe, productsListed: 1 }, pages: [], totals: { productsChecked: 0, withJsonLd: 0, withOfferPrice: 0, priceInServedHtml: 0, withCartForm: 0, quantityCapped: 0 }, checkoutWall: { ...probe, requiresAccount: false } },
    personas: [{ name: "Careful shopper", prompt: "Find a well-documented option", color: "#475569", tag: "CAR" }],
    briefs: ["Find a well-documented option"],
    locale: "en-US",
    currency: "USD",
    fetcher: { async get(url: string) { return { url, status: 404, body: "", contentType: "text/plain", durationMs: 1 }; } },
  };
}

function failedRun() {
  return {
    run_id: "ar_surface_001", query_id: "q_surface_001",
    agent: { agent_id: "agent_surface_001", name: "Careful shopper", persona: "Careful shopper", color_hex: "#475569", model: "test", kind: "shared-search" as const },
    journey: { started_at: "2026-08-29T10:25:03.114Z", duration_ms: 0, stages: [{ stage: "store_browse" as const, status: "skipped" as const, duration_ms: 0, error_code: null, evidence_ids: [] }, { stage: "web_search" as const, status: "failed" as const, duration_ms: 0, error_code: "AGENT_ERROR", evidence_ids: [] }, { stage: "protocol_check" as const, status: "skipped" as const, duration_ms: 0, error_code: null, evidence_ids: [] }, { stage: "purchase_decision" as const, status: "skipped" as const, duration_ms: 0, error_code: null, evidence_ids: [] }] },
    outcome: { target_discovered: false, target_identity_matched: false, target_recommended: false, target_rank: null, candidate_count: 0, top_3: false, purchase_intent: "none" as const, purchase_completed: false, confidence: 0, failure_codes: [{ code: "AGENT_ERROR" as const }], final_choice: null, our_pages_fetched: [] },
    ranked_candidates: [], observations: { price_found: false, availability_found: false, shipping_information_found: false, return_policy_found: false, structured_product_data_found: false, reviews_found: false, acp_supported: false, ucp_supported: false },
  };
}
