"use client";

import { useRouter } from "next/navigation";

import { ChevronTrack } from "@/components/ChevronTrack";
import { PERSONAS, PLAN, SIM_SPEED } from "@/lib/fixtures";
import { STEP_ORDER, useRun, type StepKey } from "@/lib/run-context";
import { TOTAL_TICKS } from "@/lib/simulation";
import styles from "./Stepper.module.css";

export function Stepper({ step }: { step: StepKey }) {
  const router = useRouter();
  const { runId, tick, startRun, completeRun } = useRun();
  const current = STEP_ORDER.indexOf(step);

  /**
   * Completed steps read 1.0. The current step reads 0.5 — except check,
   * which tracks live progress.
   */
  const fractionFor = (index: number, key: StepKey): number => {
    if (current > index) return 1;
    if (current !== index) return 0;
    if (key === "check") return Math.min(1, tick / TOTAL_TICKS);
    return 0.5;
  };

  const note =
    step === "check"
      ? `speed ×${SIM_SPEED}`
      : `${PLAN.length} agents · ${PERSONAS.length} briefs`;

  const go = (key: StepKey) => {
    // Check always restarts the run; recommend reads a finished one.
    if (key === "check") startRun();
    else if (key === "recommend") completeRun();
    router.push(`/runs/${runId}/${key}`);
  };

  return (
    <div className={styles.stepper}>
      {STEP_ORDER.map((key, index) => {
        const active = current === index;
        return (
          <button
            key={key}
            type="button"
            onClick={() => go(key)}
            className={
              active ? `${styles.group} ${styles.groupActive}` : styles.group
            }
            aria-current={active ? "step" : undefined}
          >
            <ChevronTrack count={8} fraction={fractionFor(index, key)} fill="ramp" />
            <span
              className={`${styles.label} ${
                active
                  ? styles.labelActive
                  : current > index
                    ? styles.labelDone
                    : ""
              }`}
            >
              {key}
            </span>
          </button>
        );
      })}
      <div className={styles.note}>{note}</div>
    </div>
  );
}
