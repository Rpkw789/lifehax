"use client";

import { useEffect, useState } from "react";

import { ChevronTrack } from "@/components/ChevronTrack";
import type { FunnelStep } from "@/lib/funnel";
import { ramp } from "@/lib/tokens";
import styles from "./Attrition.module.css";

/**
 * Where AI shoppers are lost.
 *
 * One chevron per agent: seven lit and three dark is countable, which a filled
 * bar is not. Stage colour comes from the same amber-to-red ramp the stepper
 * uses, so position in the journey reads the same way across the product, and
 * the reason a stage lost agents sits on that stage's row rather than in a
 * block underneath it.
 *
 * The tracks fill on mount in journey order — ChevronTrack already transitions
 * each chevron over 420ms, so this needs no animation of its own.
 */
export function Attrition({ steps, total }: { steps: FunnelStep[]; total: number }) {
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    if (steps.length === 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDrawn(steps.length);
      return;
    }
    const timers = steps.map((_, i) =>
      setTimeout(() => setDrawn((n) => Math.max(n, i + 1)), 60 + i * 110),
    );
    return () => timers.forEach(clearTimeout);
  }, [steps]);

  const completed = steps[steps.length - 1]?.count ?? 0;
  const lost = total - completed;

  return (
    <>
      <p className={styles.lede}>
        {total === 0
          ? "No agents ran."
          : completed === 0
            ? "No AI shopper reached checkout."
            : `${completed} of ${total} AI shoppers reached checkout.`}
      </p>
      <p className={styles.sub}>
        {lost > 0
          ? `${lost} stopped earlier. Each row shows who was left.`
          : "Every agent completed the journey."}
      </p>

      <ol className={styles.stream}>
        {steps.map((step, i) => (
          <li className={styles.stage} key={step.key}>
            <span className={styles.name}>{step.label}</span>
            <ChevronTrack
              count={total}
              fraction={i < drawn ? step.fraction : 0}
              fill={ramp(i, steps.length)}
            />
            <span className={styles.count}>{step.count}</span>
            {step.lost > 0 && i < drawn ? (
              <span className={styles.loss}>
                <span className={styles.lossCount}>&minus;{step.lost}</span>
                {step.reason ? (
                  <span className={styles.lossReason} title={step.reason}>
                    {step.reason}
                  </span>
                ) : null}
              </span>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
