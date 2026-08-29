"use client";

import { useEffect, useState } from "react";
import { useSelectedLayoutSegment } from "next/navigation";

import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { Stepper } from "@/components/Stepper";
import { isFlowSegment } from "@/lib/nav";
import { STEP_ORDER, type StepKey } from "@/lib/run-context";
import styles from "./Shell.module.css";

/** Remembers the rail across reloads. Cosmetic, so a failure here is ignored. */
const COLLAPSE_KEY = "happy2.sidebar.collapsed";

/**
 * The shell: three fixed regions plus the routed screen.
 *
 * The step is read off the route segment rather than held in state — the
 * screens are routes, not a state machine, so a URL is always enough to
 * restore the view. The workspace sections (past runs, personas, settings) are
 * not steps in the flow, so they get the header without the stepper.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const [collapsed, setCollapsed] = useState(false);

  // Read after mount: the server has no idea what this browser last chose, and
  // guessing would flash the wrong width.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Private mode, or site data blocked. The default stands.
    }
  }, []);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Not worth failing a click over.
      }
      return next;
    });
  };

  const inFlow = isFlowSegment(segment);

  // An agent's own page is a drill-down from Check, not a fifth step, so the
  // stepper and header stay on Check while you are inside one.
  const step: StepKey = STEP_ORDER.includes(segment as StepKey)
    ? (segment as StepKey)
    : segment === "agents"
      ? "check"
      : "input";

  return (
    <div className={styles.shell}>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className={styles.main}>
        {inFlow ? (
          <>
            <Header step={step} />
            <Stepper step={step} />
          </>
        ) : (
          <Header section={segment} />
        )}
        {children}
      </div>
    </div>
  );
}
