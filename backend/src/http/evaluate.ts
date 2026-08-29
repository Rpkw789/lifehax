import { Hono } from "hono";
import { validateCheckResult } from "@contracts/validate";
import type { CheckResult } from "@contracts/check-result";
import { evaluate } from "../evaluate/evaluate";
import type { FindingsStore } from "../store/findings";
import { jsonError } from "./errors";

export function createEvaluateRoutes(store: FindingsStore): Hono {
  const app = new Hono();

  app.post("/runs/:id/evaluate", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(c, 400, "invalid_json", "Request body is not valid JSON");
    }

    const errors = validateCheckResult(body);
    if (errors.length > 0) {
      return jsonError(
        c,
        422,
        "invalid_check_result",
        "Body does not conform to the CheckResult contract",
        errors,
      );
    }

    const findings = evaluate(body as CheckResult);
    store.save(c.req.param("id"), findings);
    return c.json({ findings });
  });

  return app;
}
