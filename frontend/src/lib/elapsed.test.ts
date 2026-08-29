import { describe, expect, test } from "bun:test";

import { anchorFor, elapsedSeconds } from "./elapsed";

describe("elapsedSeconds", () => {
  test("a running run counts on the wall clock, not on events", () => {
    // The whole bug: with no new event, tick stays put and the readout froze.
    const args = { running: true, startedAtMs: 1_000_000, tick: 100 };
    expect(elapsedSeconds({ ...args, nowMs: 1_014_000 })).toBeCloseTo(14, 3);
    expect(elapsedSeconds({ ...args, nowMs: 1_020_000 })).toBeCloseTo(20, 3);
  });

  test("a settled run freezes at its last event, not at 'now'", () => {
    // Opening a run from Past runs must not show days of elapsed time.
    const elapsed = elapsedSeconds({
      running: false,
      startedAtMs: 1_000_000,
      nowMs: 9_999_999_999,
      tick: 182,
    });
    expect(elapsed).toBeCloseTo(182 * 0.14, 5);
  });

  test("falls back to the event clock when no start time is known", () => {
    expect(
      elapsedSeconds({ running: true, startedAtMs: null, nowMs: 5_000, tick: 50 }),
    ).toBeCloseTo(7, 5);
  });

  test("never runs backwards if the clock is behind the anchor", () => {
    expect(
      elapsedSeconds({ running: true, startedAtMs: 2_000, nowMs: 1_000, tick: 0 }),
    ).toBe(0);
  });
});

describe("anchorFor", () => {
  test("places the start so the client clock agrees with the run's own ticks", () => {
    // A run joined mid-flight knows its tick but not the server's clock. The
    // backend derives t from 140ms since start, so the tick is the offset.
    expect(anchorFor(100, 1_014_000)).toBe(1_014_000 - 14_000);
  });

  test("a run with no events yet anchors at now", () => {
    expect(anchorFor(0, 777)).toBe(777);
  });
});
