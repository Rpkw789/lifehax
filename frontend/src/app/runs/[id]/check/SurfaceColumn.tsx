"use client";

import { ChevronTrack } from "@/components/ChevronTrack";
import motion from "@/styles/motion.module.css";
import styles from "./SurfaceColumn.module.css";
import { atLabel, visibleLines, type SurfaceState } from "./surfaces";

/**
 * One surface's column: a header carrying its own progress, then either a
 * console feed or whatever children it renders instead (the browser column
 * puts live views here).
 */
export function SurfaceColumn({
  surface,
  tick,
  color,
  children,
}: {
  surface: SurfaceState;
  tick: number;
  color: string;
  children?: React.ReactNode;
}) {
  const lines = visibleLines(surface, tick);
  const running = surface.status === "running";

  return (
    <section className={styles.column}>
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <span
            className={`${styles.dot} ${running ? motion.dotBlink : ""}`}
            style={{ background: running || surface.status !== "waiting" ? color : "var(--border-strong)" }}
          />
          <span className={styles.name}>{surface.name}</span>
          {/* Say so where the output is illustrative rather than measured. */}
          {!surface.measured && <span className={styles.sim}>simulated</span>}
        </div>
        <div className={styles.subtitle}>{surface.subtitle}</div>
        <ChevronTrack
          className={styles.track}
          count={14}
          fraction={surface.progress}
          fill={surface.status === "blocked" ? "var(--blocked)" : color}
        />
        <div className={styles.verdict}>
          {surface.verdict ?? (running ? "working…" : "queued")}
        </div>
      </header>

      <div className={styles.body}>
        {children ?? (
          <div className={styles.feed}>
            {lines.length === 0 ? (
              <span className={styles.idle}>› waiting…</span>
            ) : (
              lines.map((line, i) => (
                <div key={`${line.at}-${i}`} className={styles.line}>
                  <span className={styles.time}>{atLabel(line.at)}</span>
                  <span
                    className={styles.tag}
                    style={{ color: line.tone === "fail" ? "var(--blocked)" : color }}
                  >
                    {line.tag}
                  </span>
                  <span
                    className={`${styles.text} ${
                      line.tone === "fail"
                        ? styles.textFail
                        : line.tone === "muted"
                          ? styles.textMuted
                          : ""
                    }`}
                  >
                    {line.text}
                  </span>
                </div>
              ))
            )}
            {running && <span className={`${styles.caret} ${motion.cursorBlink}`} />}
          </div>
        )}
      </div>
    </section>
  );
}
