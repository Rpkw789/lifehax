"use client";

import { useRouter } from "next/navigation";

import { ChevronTrack } from "@/components/ChevronTrack";
import { AGENT_COUNT } from "@/lib/fixtures";
import { STEP_ORDER, useRun, type StepKey } from "@/lib/run-context";
import styles from "./Stepper.module.css";

export function Stepper({ step }: { step: StepKey }) {
  const router = useRouter();
  const { runId, tick, startRun, personas, agents, complete } = useRun();
  const current = STEP_ORDER.indexOf(step);

  /**
   * Completed steps read 1.0. The current step reads 0.5 — except check,
   * which tracks live progress.
   */
  const fractionFor = (index: number, key: StepKey): number => {
    if (current > index) return 1;
    if (current !== index) return 0;
    if (key === "check") {
      // Real progress: stages cleared across the population, not a clock.
      if (complete) return 1;
      const cleared = agents.reduce((sum, a) => sum + a.progress, 0);
      return Math.min(1, cleared / (AGENT_COUNT * 6));
    }
    return 0.5;
  };

  const note = `${AGENT_COUNT} agents · ${personas.length} briefs`;

  const go = (key: StepKey) => {
    // Starting is idempotent: revisiting check rejoins the run in flight.
    if (key === "check") startRun();
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
