import { Hono } from "hono";
import { cors } from "hono/cors";
import { createEvaluateRoutes } from "./http/evaluate";
import { openFindingsStore } from "./store/findings";

const app = new Hono();

app.use("/*", cors({ origin: "http://localhost:3200" }));

app.get("/health", (c) => c.json({ ok: true }));

app.route("/", createEvaluateRoutes(openFindingsStore()));

export default { port: 3201, fetch: app.fetch };
