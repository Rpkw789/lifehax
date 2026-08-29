"use client";

import { useRouter } from "next/navigation";

import { ChevronTrack } from "@/components/ChevronTrack";
import { CHANNELS, PERSONAS, PLAN, SIM_SPEED } from "@/lib/fixtures";
import { STEP_ORDER, useRun, type StepKey } from "@/lib/run-context";
import { TOTAL_TICKS } from "@/lib/simulation";
import styles from "./Stepper.module.css";

const FLAGGED_COUNT = CHANNELS.reduce(
  (n, channel) => n + channel.rows.filter((row) => !row.grounded).length,
  0,
);

export function Stepper({ step }: { step: StepKey }) {
  const router = useRouter();
  const { runId, tick, startRun, completeRun, verified } = useRun();
  const current = STEP_ORDER.indexOf(step);

  /**
   * Completed steps read 1.0. The current step reads 0.5 — except check,
   * which tracks live progress, and create, which fills once the re-check
   * has closed the loop.
   */
  const fractionFor = (index: number, key: StepKey): number => {
    if (current > index) return 1;
    if (current !== index) return 0;
    if (key === "check") return Math.min(1, tick / TOTAL_TICKS);
    if (key === "create" && verified) return 1;
    return 0.5;
  };

  const note =
    step === "check"
      ? `speed ×${SIM_SPEED}`
      : step === "create"
        ? verified
          ? "loop closed · re-checked"
          : `3 artifacts · ${FLAGGED_COUNT} flagged`
        : `${PLAN.length} agents · ${PERSONAS.length} briefs`;

  const go = (key: StepKey) => {
    // Check always restarts the run; the later screens read a finished one.
    if (key === "check") startRun();
    else if (key === "recommend" || key === "create") completeRun();
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
