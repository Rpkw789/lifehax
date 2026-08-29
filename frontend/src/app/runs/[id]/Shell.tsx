"use client";

import { useSelectedLayoutSegment } from "next/navigation";

import { AppFrame } from "@/components/AppFrame";
import { Header } from "@/components/Header";
import { Stepper } from "@/components/Stepper";
import { STEP_ORDER, type StepKey } from "@/lib/run-context";

/** Run-scoped screens that are not stages of the flow, so get no stepper. */
const SECTIONS = ["personas", "history"];

/**
 * The shell: three fixed regions plus the routed screen.
 *
 * The step is read off the route segment rather than held in state — the four
 * screens are routes, not a state machine, so a URL is always enough to
 * restore the view.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();

  if (segment && SECTIONS.includes(segment)) {
    return (
      <AppFrame>
        <Header section={segment} />
        {children}
      </AppFrame>
    );
  }

  // An agent's own page is a drill-down from Check, not a fifth step, so the
  // stepper and header stay on Check while you are inside one.
  const step: StepKey = STEP_ORDER.includes(segment as StepKey)
    ? (segment as StepKey)
    : segment === "agents"
      ? "check"
      : "input";

  return (
    <AppFrame>
      <Header step={step} />
      <Stepper step={step} />
      {children}
    </AppFrame>
  );
}
