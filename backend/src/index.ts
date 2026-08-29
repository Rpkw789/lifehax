/**
 * Happy2 backend — Hono on Bun.
 *
 * POST /runs starts a run and returns immediately; everything after that is
 * streamed over SSE. The audit runs first because it is fast and free and is
 * where the findings come from; the browser agents run afterwards because they
 * are slow and rate-limited.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";

import { runPopulation } from "./agents";
import { CloudflareWebSearchClient } from "./agents/cloudflare";
import { SharedSearchAgent } from "./agents/shared-search";
import { snapshot } from "./catalogue";
import { OriginFetcher } from "./catalogue/fetch";
import { systemHostLookup } from "./catalogue/security";
import { runChecks } from "./checks";
import { createEvaluateRoutes } from "./evaluate/api/evaluate";
import { openFindingsStore } from "./evaluate/store/findings";
import { computeSurfaces, deriveFindings } from "./findings";
import { llmConfigured } from "./llm";
import { log, since } from "./log";
import { generatePersonas } from "./personas";
import { createRun, finish, getRun, publish, subscribe } from "./store";
import {
  createSurfaceEventEmitter,
  runSurfaceSimulations,
} from "./surfaces/orchestrate";
import type { StreamMessage } from "./store";
import type { Run, RunInput } from "./types";

const PORT = Number(process.env.PORT ?? 3201);

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (o) => o ?? "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type"],
  }),
);

app.use("*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  // SSE stays open for the life of the run, so its "duration" is not useful.
  const streaming = c.req.path.endsWith("/events");
  log.info(`${c.req.method} ${c.req.path}`, {
    status: c.res.status,
    ...(streaming ? {} : { ms: since(startedAt) }),
  });
});

app.onError((err, c) => {
  log.error(`unhandled on ${c.req.method} ${c.req.path}`, err);
  if (err.stack) console.error(err.stack);
  return c.json({ error: { code: "internal", message: err.message } }, 500);
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    llm: llmConfigured(),
    browserbase: Boolean(process.env.BROWSERBASE_API_KEY),
  }),
);

// The Evaluate lane: contract-driven rules over a posted CheckResult. It owns
// POST /runs/:id/evaluate and is independent of the SSE run above.
app.route("/", createEvaluateRoutes(openFindingsStore()));

app.post("/runs", async (c) => {
  let body: Partial<RunInput>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: "bad_json", message: "body must be JSON" } }, 400);
  }

  const storeUrl = (body.storeUrl ?? "").trim();
  if (!storeUrl) {
    return c.json(
      { error: { code: "missing_store_url", message: "storeUrl is required" } },
      400,
    );
  }

  const input: RunInput = {
    storeUrl,
    feedUrl: body.feedUrl ?? "",
    agentEndpoint: body.agentEndpoint ?? "",
    sitemapUrl: body.sitemapUrl ?? "",
    testSkus: body.testSkus ?? "",
    disabledPersonas: body.disabledPersonas ?? [],
    locale: body.locale?.trim() || "en-US",
    currency: body.currency?.trim().toUpperCase() || "USD",
  };

  const run = createRun(input);
  // Fire and forget: the client follows progress over SSE.
  void orchestrate(run).catch((err: unknown) => {
    log.error(`run ${run.runId} failed`, err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    finish(run, err instanceof Error ? err.message : String(err));
  });

  return c.json({ runId: run.runId }, 201);
});

app.get("/runs/:id", (c) => {
  const run = getRun(c.req.param("id"));
  if (!run) {
    return c.json({ error: { code: "not_found", message: "no such run" } }, 404);
  }
  return c.json(run);
});

app.get("/runs/:id/events", (c) => {
  const run = getRun(c.req.param("id"));
  if (!run) {
    return c.json({ error: { code: "not_found", message: "no such run" } }, 404);
  }

  return streamSSE(c, async (stream) => {
    let id = 0;
    const deliveredSurfaceIds = new Set<string>();
    let deliveredCheckResult = false;
    let deliveredDone = false;
    const send = (message: StreamMessage) => {
      if (message.type === "surface_simulation") {
        if (deliveredSurfaceIds.has(message.event.event_id)) return Promise.resolve();
        deliveredSurfaceIds.add(message.event.event_id);
      }
      if (message.type === "check_result") {
        if (deliveredCheckResult) return Promise.resolve();
        deliveredCheckResult = true;
      }
      if (message.type === "done") {
        if (deliveredDone) return Promise.resolve();
        deliveredDone = true;
      }
      return stream.writeSSE({
        id: String(id++),
        event: message.type,
        data: JSON.stringify(message),
      });
    };

    // Subscribe before taking the replay snapshot. JavaScript cannot publish
    // between these synchronous statements, so anything after the snapshot is
    // queued while replay is in progress instead of falling through a gap.
    const queue: StreamMessage[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = subscribe(run.runId, (message) => {
      queue.push(message);
      wake?.();
    });
    const replay = {
      catalogue: run.catalogue,
      personas: [...run.personas],
      briefs: [...run.briefs],
      sessions: Object.entries(run.sessions),
      sessionsClosed: run.sessionsClosed,
      checks: run.checks,
      events: [...run.events],
      surfaceEvents: [...run.surfaceEvents],
      checkResult: run.checkResult,
      findings: [...run.findings],
      surfaces: [...run.surfaces],
      status: run.status,
      error: run.error,
    };

    try {
      // Replay what already happened, so a late subscriber is not missing half
      // the run. Reconnect-by-Last-Event-ID is not implemented today.
      if (replay.catalogue) {
        await send({
          type: "catalogue",
          products: replay.catalogue.products.length,
          source: replay.catalogue.source,
        });
      }
      if (replay.personas.length > 0) {
        await send({ type: "personas", personas: replay.personas, briefs: replay.briefs });
      }
      // Only replay live views that are still alive; a late subscriber must not
      // be handed a URL whose session has already stopped.
      if (!replay.sessionsClosed) {
        for (const [agentId, session] of replay.sessions) {
          if (session.liveViewUrl) {
            await send({ type: "session", agentId, liveViewUrl: session.liveViewUrl });
          }
        }
      } else {
        await send({ type: "sessions_closed" });
      }
      if (replay.checks) await send({ type: "checks", checks: replay.checks });
      for (const event of replay.events) await send({ type: "agent", event });
      for (const event of replay.surfaceEvents) {
        await send({ type: "surface_simulation", event });
      }
      if (replay.checkResult) {
        await send({ type: "check_result", result: replay.checkResult });
      }
      if (replay.findings.length > 0) {
        await send({ type: "findings", findings: replay.findings, surfaces: replay.surfaces });
      }

      if (replay.status !== "running") {
        await send({ type: "done", status: replay.status, error: replay.error });
        return;
      }

      for (;;) {
        while (queue.length > 0) {
          const message = queue.shift()!;
          await send(message);
          if (message.type === "done") return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 15_000);
        });
        wake = null;
        if (queue.length === 0) await stream.writeSSE({ event: "ping", data: "1" });
      }
    } finally {
      unsubscribe();
    }
  });
});

/** snapshot → personas → audit → agents → findings. */
async function orchestrate(run: Run): Promise<void> {
  const runLog = log.child(run.runId);
  const runStartedAt = Date.now();
  runLog.info("run starting", { store: run.input.storeUrl });

  let stepAt = Date.now();
  const catalogue = await snapshot(run.input.storeUrl, run.input.sitemapUrl);
  run.catalogue = catalogue;
  runLog.info("catalogue", {
    ms: since(stepAt),
    products: catalogue.products.length,
    source: catalogue.source,
    sitemapProducts: catalogue.sitemapProductCount,
  });
  publish(run, {
    type: "catalogue",
    products: catalogue.products.length,
    source: catalogue.source,
  });

  if (catalogue.products.length === 0 && catalogue.sitemapProductCount === 0) {
    runLog.error("nothing discoverable, stopping", { store: run.input.storeUrl });
    finish(run, `no products could be discovered at ${run.input.storeUrl}`);
    return;
  }

  stepAt = Date.now();
  const { personas, briefs } = await generatePersonas(catalogue);
  run.personas = personas;
  run.briefs = briefs;
  runLog.info("briefs", {
    ms: since(stepAt),
    archetypes: personas.length,
    briefs: briefs.length,
    generated: llmConfigured(),
  });
  for (const [i, brief] of briefs.entries()) {
    runLog.debug(`  brief ${i + 1}`, brief.slice(0, 90));
  }
  publish(run, { type: "personas", personas, briefs });

  stepAt = Date.now();
  const checks = await runChecks(catalogue, run.input);
  run.checks = checks;
  runLog.info("audit", { ms: since(stepAt), ...checks.totals });
  runLog.info("  probes", {
    agentCommerce: checks.agentCommerce.status ?? "err",
    ucp: checks.ucp.status ?? "err",
    llmsTxt: checks.llmsTxt.status ?? "err",
    sitemap: checks.sitemap.status ?? "err",
    accountWall: checks.checkoutWall.requiresAccount,
  });
  publish(run, { type: "checks", checks });

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const searchAgent = accountId && apiToken
    ? new SharedSearchAgent(
        new CloudflareWebSearchClient({ accountId, apiToken }),
      )
    : undefined;
  const fetcher = new OriginFetcher(catalogue.origin, systemHostLookup);
  const emitSurfaceEvent = createSurfaceEventEmitter((event) => {
    publish(run, { type: "surface_simulation", event });
  });
  const surfaceResult = runSurfaceSimulations(
    {
      runId: run.runId,
      reportId: `report_${run.runId}`,
      generatedAt: new Date().toISOString(),
      storeUrl: run.input.storeUrl,
      testSkus: run.input.testSkus,
      disabledPersonas: run.input.disabledPersonas,
      catalogue,
      checks,
      personas,
      briefs,
      locale: run.input.locale,
      currency: run.input.currency,
      fetcher,
      acpPath: run.input.agentEndpoint,
    },
    {
      emitForWorker: emitSurfaceEvent,
      agent: searchAgent,
    },
  );
  const [, checkResult] = await Promise.all([
    runPopulation(run, catalogue, checks, personas, briefs),
    surfaceResult,
  ]);
  publish(run, { type: "check_result", result: checkResult });

  stepAt = Date.now();
  run.surfaces = computeSurfaces(checks);
  run.findings = await deriveFindings(checks, run.events, personas);
  runLog.info("findings", {
    ms: since(stepAt),
    count: run.findings.length,
    keys: run.findings.map((f) => f.key).join(",") || "none",
  });
  publish(run, {
    type: "findings",
    findings: run.findings,
    surfaces: run.surfaces,
  });

  const blocked = run.events.filter((e) => e.kind === "fail").length;
  runLog.info("run complete", {
    ms: since(runStartedAt),
    events: run.events.length,
    blocked,
  });
  finish(run);
}

log.info(`listening on http://localhost:${PORT}`, {
  llm: llmConfigured() ? "configured" : "MISSING (using fallbacks)",
  browserbase: process.env.BROWSERBASE_API_KEY
    ? "configured"
    : "MISSING (real agents will fail)",
  logLevel: process.env.LOG_LEVEL ?? "info",
});

export default { port: PORT, fetch: app.fetch, idleTimeout: 255 };
