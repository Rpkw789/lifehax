"use client";

import { useRun, type StepKey } from "@/lib/run-context";
import styles from "./Header.module.css";

const META: Record<StepKey, string> = {
  input: "stage 0 of 3 · input",
  check: "stage 1 of 3 · check",
  recommend: "stage 2 of 3 · recommend",
  dashboard: "stage 3 of 3 · dashboard",
};

function titleFor(step: StepKey, storeHost: string): string {
  switch (step) {
    case "input":
      return "New readiness audit";
    case "check":
      return storeHost;
    case "recommend":
      return `Findings · ${storeHost}`;
    case "dashboard":
      return `Dashboard · ${storeHost}`;
  }
}

/** The workspace sections, which sit outside the four-stage run flow. */
const SECTIONS: Record<string, { title: string; meta: string }> = {
  personas: { title: "Agent personas", meta: "the population this run shops with" },
  history: { title: "Past runs", meta: "every audit on this workspace" },
};

/**
 * The title strip.
 *
 * Pass `step` inside the run flow, or `section` for a workspace screen. One of
 * the two is always right, so the strip never has to guess.
 */
export function Header({
  step,
  section,
}: {
  step?: StepKey;
  section?: string | null;
}) {
  const { runId, storeHost } = useRun();

  const shown = section
    ? SECTIONS[section]
    : step
      ? { title: titleFor(step, storeHost), meta: META[step] }
      : undefined;

  return (
    <div className={styles.header}>
      <div className={styles.title}>{shown?.title ?? "Happy2"}</div>
      <div className={styles.meta}>{shown?.meta ?? ""}</div>
      <div className={styles.right}>
        <div className={styles.runId}>run {runId}</div>
        <div className={styles.avatar}>TL</div>
      </div>
    </div>
  );
}
