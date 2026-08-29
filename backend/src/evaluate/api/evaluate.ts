import { Hono } from "hono";
import { assertCheckResult, validateCheckResult } from "@contracts/validate";
import type { Finding } from "@contracts/finding";
import { evaluate } from "../evaluate";
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

    // validateCheckResult first, because its error list is what the 422 reports;
    // assertCheckResult then narrows the type without a cast.
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
    assertCheckResult(body);

    // evaluate() asserts its own output, so a defect in a rule throws here.
    // Surfacing the reason beats a bare 500 — the message names the offending field.
    let findings: Finding[];
    try {
      findings = evaluate(body);
    } catch (error) {
      return jsonError(
        c,
        500,
        "evaluation_failed",
        error instanceof Error ? error.message : "Evaluation produced an invalid result",
      );
    }

    try {
      await store.save(c.req.param("id"), findings);
    } catch (error) {
      return jsonError(
        c,
        500,
        "persistence_failed",
        error instanceof Error ? error.message : "Could not persist the findings",
      );
    }

    return c.json({ findings });
  });

  return app;
}
