"use client";

import { ChevronTrack } from "@/components/ChevronTrack";
import motion from "@/styles/motion.module.css";
import styles from "./UnifiedProgress.module.css";
import type { SurfaceState } from "./surfaces";

/**
 * One bar across all four surfaces.
 *
 * Segmented rather than averaged: a single number would hide that three
 * surfaces can be finished while the fourth is still working, which is the
 * thing worth seeing. Each segment carries its own chevron track in its
 * surface's colour, and the overall figure is the mean of the four.
 */
export function UnifiedProgress({
  surfaces,
  colors,
  running,
}: {
  surfaces: SurfaceState[];
  colors: Record<string, string>;
  running: boolean;
}) {
  const overall =
    surfaces.reduce((sum, s) => sum + s.progress, 0) / Math.max(1, surfaces.length);
  const done = surfaces.filter((s) => s.status === "done" || s.status === "blocked").length;

  return (
    <div className={styles.wrap}>
      <div className={styles.top}>
        <span className={styles.label}>Surfaces evaluated</span>
        <span className={styles.count}>
          {done}/{surfaces.length}
        </span>
        <span className={styles.pct}>{Math.round(overall * 100)}%</span>
        {running && <span className={`${styles.pulse} ${motion.dotBlink}`} />}
      </div>

      <div className={styles.segments}>
        {surfaces.map((surface) => (
          <div key={surface.key} className={styles.segment}>
            <ChevronTrack
              count={16}
              fraction={surface.progress}
              fill={
                surface.status === "blocked"
                  ? "var(--blocked)"
                  : colors[surface.key] ?? "var(--ink)"
              }
            />
            <div className={styles.segmentLabel}>
              <span className={styles.segmentName}>{surface.name}</span>
              <span className={styles.segmentState}>
                {surface.status === "waiting" ? "queued" : surface.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
