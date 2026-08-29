import { describe, expect, test } from "bun:test";
import type { CheckResult } from "@contracts/check-result";
import checkResult from "@fixtures/check-result.example.json";
import { formatRank, formatRate, queryOutcomes } from "./scores";

const source = checkResult as unknown as CheckResult;

describe("formatRate", () => {
  test("renders a fraction as a whole percentage", () => {
    expect(formatRate(0.3333)).toBe("33%");
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(0)).toBe("0%");
  });
});

describe("formatRank", () => {
  test("renders a rank, and an em dash when the brand never ranked", () => {
    expect(formatRank(1.5)).toBe("1.5");
    expect(formatRank(null)).toBe("—");
  });
});

describe("queryOutcomes", () => {
  test("joins each score row to the query text that produced it", () => {
    const rows = queryOutcomes(source.scores, source.evaluation_config);
    expect(rows).toHaveLength(6);
    expect(rows[0].text).toContain("waterproof trail running shoes");
    expect(rows[0].recommended).toBe(true);
    expect(rows[2].recommended).toBe(false);
  });

  test("orders recommended queries first, so what worked reads at the top", () => {
    const rows = queryOutcomes(source.scores, source.evaluation_config);
    const flags = rows.map((r) => r.recommended);
    expect(flags).toEqual([...flags].sort((a, b) => Number(b) - Number(a)));
  });
});
