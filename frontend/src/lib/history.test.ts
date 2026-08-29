import { describe, expect, test } from "bun:test";
import { iterationsFor, type RunSummary } from "./history";

function run(id: string, storeUrl: string, createdAt: string, findings: number, blocked: number): RunSummary {
  return { runId: id, storeUrl, status: "complete", createdAt, findings, blocked };
}

const runs: RunSummary[] = [
  // Deliberately out of order, and mixed stores.
  run("r3", "https://acme.com", "2026-08-29T15:00:00Z", 3, 1),
  run("r1", "https://acme.com/products/x", "2026-08-29T13:00:00Z", 6, 4),
  run("other", "https://different.com", "2026-08-29T14:00:00Z", 9, 9),
  run("r2", "http://www.acme.com", "2026-08-29T14:00:00Z", 5, 2),
];

describe("iterationsFor", () => {
  test("keeps only runs against the same store", () => {
    expect(iterationsFor(runs, "https://acme.com").map((i) => i.runId)).toEqual(["r1", "r2", "r3"]);
  });

  test("matches on host, ignoring scheme, www and path", () => {
    // r1 has a path, r2 has www and http. All three are the same storefront.
    expect(iterationsFor(runs, "acme.com")).toHaveLength(3);
  });

  test("orders oldest first, so improvement reads left to right", () => {
    expect(iterationsFor(runs, "acme.com").map((i) => i.findings)).toEqual([6, 5, 3]);
  });

  test("reports the change against the previous run, and none for the first", () => {
    const [first, second, third] = iterationsFor(runs, "acme.com");
    expect(first!.findingsDelta).toBeNull();
    expect(second!.findingsDelta).toBe(-1);
    expect(third!.findingsDelta).toBe(-2);
    expect(third!.blockedDelta).toBe(-1);
  });

  test("counts a worse run as a positive delta, not an absolute", () => {
    const worse = [run("a", "https://x.com", "2026-08-29T10:00:00Z", 2, 0),
                   run("b", "https://x.com", "2026-08-29T11:00:00Z", 7, 3)];
    expect(iterationsFor(worse, "x.com")[1]!.findingsDelta).toBe(5);
  });

  test("ignores runs that did not finish — a crashed run is not an iteration", () => {
    const mixed = [...runs, { ...run("bad", "https://acme.com", "2026-08-29T16:00:00Z", 0, 0), status: "error" as const }];
    expect(iterationsFor(mixed, "acme.com").map((i) => i.runId)).toEqual(["r1", "r2", "r3"]);
  });

  test("returns nothing for a store with no runs", () => {
    expect(iterationsFor(runs, "nobody.com")).toEqual([]);
  });

  test("survives a malformed store url rather than throwing", () => {
    expect(() => iterationsFor(runs, "not a url")).not.toThrow();
  });
});
