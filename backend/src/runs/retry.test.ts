import assert from "node:assert/strict";
import test from "node:test";

import { retryOnce, withTimeout } from "./retry.ts";

test("retryOnce returns the second attempt after one transient failure", async () => {
  let attempts = 0;
  const value = await retryOnce(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("transient");
    return "ok";
  });

  assert.equal(value, "ok");
  assert.equal(attempts, 2);
});

test("retryOnce never makes a third attempt", async () => {
  let attempts = 0;
  await assert.rejects(
    retryOnce(async () => {
      attempts += 1;
      throw new Error("still failing");
    }),
    /still failing/,
  );
  assert.equal(attempts, 2);
});

test("withTimeout aborts the operation and reports a stable timeout code", async () => {
  await assert.rejects(
    withTimeout(
      (signal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
      5,
      "shopper",
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "TimeoutError" &&
      error.message === "shopper timed out",
  );
});

test("withTimeout stops when its parent signal aborts even if work ignores the signal", async () => {
  const parent = new AbortController();
  const pending = withTimeout(
    async () => new Promise<never>(() => undefined),
    10_000,
    "child",
    parent.signal,
  );
  parent.abort(new Error("run cancelled"));
  await assert.rejects(pending, /run cancelled/);
});
