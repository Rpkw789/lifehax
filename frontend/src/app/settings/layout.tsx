import type { Metadata } from "next";

import { AppFrame } from "@/components/AppFrame";

export const metadata: Metadata = {
  title: "Settings · Happy2",
};

/**
 * Settings sit outside any run, so this frame carries the sidebar but not the
 * header or stepper — those describe a run's progress and would be lying here.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppFrame>{children}</AppFrame>;
}
