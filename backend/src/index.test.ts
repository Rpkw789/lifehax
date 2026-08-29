import { expect, test } from "bun:test";
import app from "./index.ts";
import { loadExampleCheckResult } from "./fixtures.ts";
import { createRun, finish, publish } from "./store.ts";
import { event, inputFixture } from "./store.test.ts";

test("late SSE subscribers receive ordered surface events before report and done", async () => {
  const run = createRun(inputFixture());
  publish(run, {
    type: "surface_simulation",
    event: event("surf_0002", 2, "web_search"),
  });
  publish(run, {
    type: "surface_simulation",
    event: event("surf_0001", 1, "agent_protocol"),
  });
  publish(run, { type: "check_result", result: loadExampleCheckResult() });
  finish(run);

  const response = await app.fetch(
    new Request(`http://localhost/runs/${run.runId}/events`),
  );
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(body.indexOf('"event_id":"surf_0001"')).toBeLessThan(
    body.indexOf('"event_id":"surf_0002"'),
  );
  expect(body.indexOf("event: surface_simulation")).toBeLessThan(
    body.indexOf("event: check_result"),
  );
  expect(body.indexOf("event: check_result")).toBeLessThan(
    body.indexOf("event: done"),
  );
});

test("events published while replay is active are queued exactly once", async () => {
  const run = createRun(inputFixture());
  publish(run, {
    type: "surface_simulation",
    event: event("surf_before", 1, "agent_protocol"),
  });

  const response = await app.fetch(
    new Request(`http://localhost/runs/${run.runId}/events`),
  );
  publish(run, {
    type: "surface_simulation",
    event: event("surf_during", 2, "web_search"),
  });
  publish(run, { type: "check_result", result: loadExampleCheckResult() });
  finish(run);

  const body = await response.text();
  expect(body.match(/"event_id":"surf_before"/g)).toHaveLength(1);
  expect(body.match(/"event_id":"surf_during"/g)).toHaveLength(1);
  expect(body.match(/event: check_result/g)).toHaveLength(1);
  expect(body.match(/event: done/g)).toHaveLength(1);
});
