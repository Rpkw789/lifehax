"use client";

import { useEffect, useState } from "react";

import { ChevronTrack } from "@/components/ChevronTrack";
import { ramp } from "@/lib/tokens";
import type { FunnelStep } from "@/lib/funnel";
import styles from "./Funnel.module.css";

/**
 * The run funnel.
 *
 * One chevron per agent, so a chevron is a countable thing rather than a
 * percentage of a bar: four lit chevrons means four agents, and the two that
 * went dark are the two that dropped.
 *
 * Tracks fill from empty on mount, one step after another, so the cohort is
 * seen narrowing rather than presented already narrowed. The chevrons are the
 * product's load-bearing motif and carry their own 420ms fill transition, so
 * the motion is a staggered mount rather than an animation invented here.
 */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    if (steps.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDrawn(steps.length);
      return;
    }

    const timers = steps.map((_, i) =>
      setTimeout(() => setDrawn((n) => Math.max(n, i + 1)), 90 + i * 220),
    );
    return () => timers.forEach(clearTimeout);
  }, [steps]);

  const total = steps[0]?.count ?? 0;

  return (
    <div className={styles.funnel}>
      {steps.map((step, i) => {
        const shown = i < drawn;

        return (
          <div key={step.key}>
            <div className={styles.step}>
              <span className={styles.label}>{step.label}</span>
              <span className={styles.trackCell}>
                <ChevronTrack
                  count={total}
                  fraction={shown ? step.fraction : 0}
                  fill={ramp(i, steps.length)}
                />
              </span>
              <span className={styles.count}>
                {step.count}
                <span className={styles.of}> / {total}</span>
              </span>
            </div>

            {step.lost > 0 && shown ? (
              <div className={styles.drop}>
                <span />
                <span className={styles.dropBody}>
                  <span className={styles.dropCount}>
                    &minus;{step.lost} {step.lost === 1 ? "agent" : "agents"}
                  </span>
                  {step.reason ? (
                    <span className={styles.dropReason}>{step.reason}</span>
                  ) : null}
                </span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
