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
import { snapshot } from "./catalogue";
import { runChecks } from "./checks";
import { createEvaluateRoutes } from "./evaluate/api/evaluate";
import { openFindingsStore } from "./evaluate/store/findings";
import { computeSurfaces, deriveFindings } from "./findings";
import { llmConfigured } from "./llm";
import { log, since } from "./log";
import { generatePersonas } from "./personas";
import { createRun, finish, getRun, publish, subscribe } from "./store";
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
    const send = (message: StreamMessage) =>
      stream.writeSSE({
        id: String(id++),
        event: message.type,
        data: JSON.stringify(message),
      });

    // Replay what already happened, so a late subscriber is not missing half
    // the run. Reconnect-by-Last-Event-ID is not implemented today.
    if (run.catalogue) {
      await send({
        type: "catalogue",
        products: run.catalogue.products.length,
        source: run.catalogue.source,
      });
    }
    if (run.personas.length > 0) {
      await send({ type: "personas", personas: run.personas });
    }
    // Only replay live views that are still alive; a late subscriber must not
    // be handed a URL whose session has already stopped.
    if (!run.sessionsClosed) {
      for (const [agentId, session] of Object.entries(run.sessions)) {
        if (session.liveViewUrl) {
          await send({ type: "session", agentId, liveViewUrl: session.liveViewUrl });
        }
      }
    } else {
      await send({ type: "sessions_closed" });
    }
    if (run.checks) await send({ type: "checks", checks: run.checks });
    for (const event of run.events) await send({ type: "agent", event });
    if (run.findings.length > 0) {
      await send({ type: "findings", findings: run.findings, surfaces: run.surfaces });
    }

    if (run.status !== "running") {
      await send({ type: "done", status: run.status, error: run.error });
      return;
    }

    const queue: StreamMessage[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = subscribe(run.runId, (message) => {
      queue.push(message);
      wake?.();
    });

    try {
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
  const personas = await generatePersonas(catalogue);
  run.personas = personas;
  runLog.info("personas", {
    ms: since(stepAt),
    count: personas.length,
    generated: llmConfigured(),
  });
  for (const p of personas) runLog.debug(`  brief ${p.tag}`, p.prompt);
  publish(run, { type: "personas", personas });

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

  await runPopulation(run, catalogue, checks, personas);

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
