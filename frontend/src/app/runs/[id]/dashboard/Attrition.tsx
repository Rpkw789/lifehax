"use client";

import { useEffect, useState } from "react";

import type { FunnelStep } from "@/lib/funnel";
import styles from "./Attrition.module.css";

/**
 * Where AI shoppers are lost.
 *
 * The product's whole claim is that agents fall out at identifiable gates, so
 * the page opens with the falling out rather than with summary tiles. Each
 * stage draws the surviving mass against the full cohort behind it; the gap is
 * the finding, and the reason is printed at the point where the bar stopped,
 * not in a legend.
 */
export function Attrition({ steps, total }: { steps: FunnelStep[]; total: number }) {
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    // One frame, so the transition has a zero state to move from.
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const completed = steps[steps.length - 1]?.count ?? 0;

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
        {total - completed > 0
          ? `${total - completed} stopped somewhere earlier. The gaps below are where.`
          : "Every agent completed the journey."}
      </p>

      <ol className={styles.stream}>
        {steps.map((step, i) => (
          <li key={step.key}>
            <div className={styles.stage}>
              <span className={styles.name}>{step.label}</span>
              <span className={styles.track}>
                <span
                  className={styles.alive}
                  style={{
                    ["--alive" as string]: drawn ? step.fraction : 0,
                    transitionDelay: `${i * 70}ms`,
                  }}
                />
              </span>
              <span className={styles.count}>{step.count}</span>
            </div>

            {step.lost > 0 ? (
              <div className={styles.loss}>
                <span />
                <span
                  className={styles.lossBody}
                  // Start the reason where the bar stopped: at the loss.
                  style={{
                    ["--at" as string]: `${Math.round(step.fraction * 100)}%`,
                    animationDelay: `${i * 70 + 420}ms`,
                  }}
                >
                  <span className={styles.lossCount}>&minus;{step.lost}</span>
                  {step.reason ? (
                    <span className={styles.lossReason}>{step.reason}</span>
                  ) : null}
                </span>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </>
  );
}
