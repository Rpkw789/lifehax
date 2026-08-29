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
import { computeSurfaces, deriveFindings } from "./findings";
import { llmConfigured } from "./llm";
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

app.onError((err, c) => {
  console.error("[error]", err);
  return c.json({ error: { code: "internal", message: err.message } }, 500);
});

app.get("/health", (c) =>
  c.json({
    ok: true,
    llm: llmConfigured(),
    browserbase: Boolean(process.env.BROWSERBASE_API_KEY),
  }),
);

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
  void orchestrate(run).catch((err) => {
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
  const catalogue = await snapshot(run.input.storeUrl, run.input.sitemapUrl);
  run.catalogue = catalogue;
  publish(run, {
    type: "catalogue",
    products: catalogue.products.length,
    source: catalogue.source,
  });

  if (catalogue.products.length === 0 && catalogue.sitemapProductCount === 0) {
    finish(run, `no products could be discovered at ${run.input.storeUrl}`);
    return;
  }

  const personas = await generatePersonas(catalogue);
  run.personas = personas;
  publish(run, { type: "personas", personas });

  const checks = await runChecks(catalogue, run.input);
  run.checks = checks;
  publish(run, { type: "checks", checks });

  await runPopulation(run, catalogue, checks, personas);

  run.surfaces = computeSurfaces(checks);
  run.findings = await deriveFindings(checks, run.events, personas);
  publish(run, {
    type: "findings",
    findings: run.findings,
    surfaces: run.surfaces,
  });

  finish(run);
}

console.log(`happy2 backend on http://localhost:${PORT}`);

export default { port: PORT, fetch: app.fetch, idleTimeout: 255 };
