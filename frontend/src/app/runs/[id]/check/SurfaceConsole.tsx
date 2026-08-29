"use client";

import { useLayoutEffect, useRef } from "react";
import type { SurfaceSimulationEvent } from "@contracts/surface-simulation";
import { surfaceTime } from "@/lib/surface-events";
import styles from "./SurfaceColumn.module.css";

export function SurfaceConsole({
  events,
  json,
}: {
  events: SurfaceSimulationEvent[];
  json: unknown | null;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const followTail = useRef(true);
  const startedAt = events[0]?.at ?? null;

  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (feed && followTail.current) feed.scrollTop = feed.scrollHeight;
  }, [events.length, json]);

  return (
    <div
      ref={feedRef}
      className={styles.console}
      onScroll={(event) => {
        const element = event.currentTarget;
        followTail.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 32;
      }}
    >
      {events.length === 0 ? (
        <div className={styles.consoleIdle}>waiting for real backend events…</div>
      ) : (
        events.map((event) => (
          <div className={styles.consoleLine} key={event.event_id}>
            <time className={styles.consoleTime} dateTime={event.at}>
              {surfaceTime(event.at, startedAt ?? event.at)}
            </time>
            <span className={styles.consoleText}>{event.message}</span>
          </div>
        ))
      )}
      {json !== null && (
        <details className={styles.consoleJson}>
          <summary>Relevant CheckResult JSON</summary>
          <pre>{JSON.stringify(json, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
