import { ramp } from "@/lib/tokens";
import styles from "./ChevronTrack.module.css";

/**
 * The chevron track — the load-bearing visual motif. Never substitute a plain
 * progress bar for one of these.
 *
 * A track is a flex row of 7×12 clipped spans with a 2px gap. The filled count
 * is `round(fraction × count)`, and each chevron transitions its background
 * over 420ms, which is what makes a count change read as a fill rather than a
 * redraw.
 *
 * Two fill modes:
 * - a single color — per-agent tracks take the agent's brief color, per-stage
 *   counts take that stage's ramp color;
 * - `"ramp"` — chevron *i* of *n* takes `oklch(0.70 0.175 H)` with
 *   `H = 88 − 62 × i/(n−1)`, an amber→red ramp. Used for the stepper tracks.
 */
export function ChevronTrack({
  count,
  fraction,
  fill,
  unfilled = "var(--chevron-off)",
  className,
}: {
  count: number;
  /** 0–1, clamped. */
  fraction: number;
  /** A CSS color, or `"ramp"` for the amber→red ramp. */
  fill: string | "ramp";
  /** Defaults to `#e6e6e9`. */
  unfilled?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * count);

  return (
    <span
      className={className ? `${styles.track} ${className}` : styles.track}
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={styles.chevron}
          style={{
            background:
              i < filled ? (fill === "ramp" ? ramp(i, count) : fill) : unfilled,
          }}
        />
      ))}
    </span>
  );
}
