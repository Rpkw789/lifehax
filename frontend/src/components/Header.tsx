"use client";

import { useRun, type StepKey } from "@/lib/run-context";
import styles from "./Header.module.css";

const META: Record<StepKey, string> = {
  input: "stage 0 of 2 · input",
  check: "stage 1 of 2 · check",
  recommend: "stage 2 of 2 · recommend",
};

function titleFor(step: StepKey, storeHost: string): string {
  switch (step) {
    case "input":
      return "New readiness audit";
    case "check":
      return storeHost;
    case "recommend":
      return `Findings · ${storeHost}`;
  }
}

export function Header({ step }: { step: StepKey }) {
  const { runId, storeHost } = useRun();

  return (
    <div className={styles.header}>
      <div className={styles.title}>{titleFor(step, storeHost)}</div>
      <div className={styles.meta}>{META[step]}</div>
      <div className={styles.right}>
        <div className={styles.runId}>run {runId}</div>
        <div className={styles.avatar}>TL</div>
      </div>
    </div>
  );
}
