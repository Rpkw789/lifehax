/**
 * How long a run has been going.
 *
 * Every agent event carries a tick, which the backend computes as
 * `round((Date.now() - startedAtMs) / 140)` — so `tick * MS_PER_TICK` is real
 * elapsed time, not simulated time. Reading the elapsed figure off the newest
 * event therefore used the right clock but sampled it only when an event
 * arrived, which left the readout frozen between them.
 *
 * A live run counts on the wall clock instead. A settled one keeps using its
 * last event, because a run opened from Past runs started days ago and "now"
 * says nothing about how long it took.
 */

/** The backend's tick length. Mirrors `tickOf` in `backend/src/store.ts`. */
export const MS_PER_TICK = 140;

export function elapsedSeconds({
  running,
  startedAtMs,
  nowMs,
  tick,
}: {
  running: boolean;
  /** When this run began, on the client's clock. Null before it is known. */
  startedAtMs: number | null;
  nowMs: number;
  /** Highest tick seen, which is where a settled run stops. */
  tick: number;
}): number {
  if (!running || startedAtMs === null) return (tick * MS_PER_TICK) / 1000;
  return Math.max(0, (nowMs - startedAtMs) / 1000);
}

/**
 * Where to place the start of a run joined mid-flight.
 *
 * `startedAtMs` from the backend is on the server's clock, and the gap between
 * the two machines would show up as a jump in the readout. The run's own tick
 * is the offset from its start, so subtracting it from the client's clock
 * anchors the timer without trusting the two clocks to agree.
 */
export function anchorFor(tick: number, nowMs: number): number {
  return nowMs - tick * MS_PER_TICK;
}
