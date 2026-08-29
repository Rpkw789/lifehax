import { describe, expect, test } from "bun:test";
import { assessProtocolDocument } from "./protocol.ts";

describe("assessProtocolDocument", () => {
  test("requires a UCP profile rather than treating any HTTP 200 as support", () => {
    const assessment = assessProtocolDocument("ucp", {
      url: "https://example.com/.well-known/ucp",
      status: 200,
      contentType: "application/json",
      durationMs: 4,
      body: JSON.stringify({
        ucp: {
          version: "2026-04-08",
          services: {},
          capabilities: {},
        },
      }),
    });

    expect(assessment.supported).toBe(true);
    expect(assessment.facts).toContain("UCP version 2026-04-08");
  });

  test("does not infer UCP support from unrelated JSON", () => {
    const assessment = assessProtocolDocument("ucp", {
      url: "https://example.com/.well-known/ucp",
      status: 200,
      contentType: "application/json",
      durationMs: 4,
      body: JSON.stringify({ status: "ok" }),
    });

    expect(assessment.found).toBe(true);
    expect(assessment.supported).toBe(false);
    expect(assessment.reason).toBe("Document is not a valid UCP profile");
  });

  test("rejects an HTML soft 404 at the configured ACP path", () => {
    const assessment = assessProtocolDocument("acp", {
      url: "https://example.com/.well-known/agent-commerce",
      status: 200,
      contentType: "text/html",
      durationMs: 3,
      body: "<!doctype html><title>Not found</title>",
    });

    expect(assessment.supported).toBe(false);
    expect(assessment.reason).toBe("Unable to be found");
  });

  test("recognizes observable ACP commerce capabilities in JSON", () => {
    const assessment = assessProtocolDocument("acp", {
      url: "https://example.com/.well-known/agent-commerce",
      status: 200,
      contentType: "application/json",
      durationMs: 3,
      body: JSON.stringify({ capabilities: { checkout: { endpoint: "/buy" } } }),
    });

    expect(assessment.supported).toBe(true);
    expect(assessment.facts).toContain("ACP document exposes capabilities");
  });
});
