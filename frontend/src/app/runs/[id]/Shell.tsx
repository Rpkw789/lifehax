"use client";

import { useSelectedLayoutSegment } from "next/navigation";

import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { Stepper } from "@/components/Stepper";
import { STEP_ORDER, type StepKey } from "@/lib/run-context";
import styles from "./Shell.module.css";

/**
 * The shell: three fixed regions plus the routed screen.
 *
 * The step is read off the route segment rather than held in state — the four
 * screens are routes, not a state machine, so a URL is always enough to
 * restore the view.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  // An agent's own page is a drill-down from Check, not a fifth step, so the
  // stepper and header stay on Check while you are inside one.
  const step: StepKey = STEP_ORDER.includes(segment as StepKey)
    ? (segment as StepKey)
    : segment === "agents"
      ? "check"
      : "input";

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <Header step={step} />
        <Stepper step={step} />
        {children}
      </div>
    </div>
  );
}
