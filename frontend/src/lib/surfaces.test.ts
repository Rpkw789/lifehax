import { describe, expect, test } from "bun:test";
import { radarPoints, weakestSurface } from "./surfaces";
import type { Surface } from "./types";

function s(name: string, fraction: number, note = ""): Surface {
  return { name, score: String(Math.round(fraction * 100)), fraction, note };
}

const surfaces = [
  s("Website / browser-use", 1),
  s("Structured product data", 1),
  s("Agent protocol (ACP/UCP)", 0.5, "ucp + llms.txt present"),
  s("Search & discovery", 1),
  s("Checkout & payment", 1),
];

describe("radarPoints", () => {
  test("gives one point per surface, scored 0-100", () => {
    const points = radarPoints(surfaces);
    expect(points).toHaveLength(5);
    expect(points[2]).toEqual({ surface: "Agent protocol", score: 50, full: "Agent protocol (ACP/UCP)" });
  });

  test("shortens long axis labels but keeps the full name for the tooltip", () => {
    const [first] = radarPoints(surfaces);
    expect(first!.surface).toBe("Website");
    expect(first!.full).toBe("Website / browser-use");
  });

  test("clamps a fraction outside 0..1 rather than drawing outside the grid", () => {
    expect(radarPoints([s("Odd", 1.4)])[0]!.score).toBe(100);
    expect(radarPoints([s("Odd", -0.2)])[0]!.score).toBe(0);
  });

  test("returns nothing for no surfaces", () => {
    expect(radarPoints([])).toEqual([]);
  });
});

describe("weakestSurface", () => {
  test("names the lowest surface, which is the one worth fixing", () => {
    expect(weakestSurface(surfaces)?.name).toBe("Agent protocol (ACP/UCP)");
  });

  test("is null when every surface is already full", () => {
    expect(weakestSurface([s("A", 1), s("B", 1)])).toBeNull();
  });

  test("is null with no surfaces", () => {
    expect(weakestSurface([])).toBeNull();
  });

  test("breaks a tie on the first, so the caption does not flicker between equals", () => {
    expect(weakestSurface([s("A", 0.3), s("B", 0.3)])?.name).toBe("A");
  });
});
