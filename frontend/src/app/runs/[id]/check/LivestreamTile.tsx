"use client";

import { useState } from "react";

import { RING_REGIONS, STAGES, STAGE_ACTIONS, STAGE_PATHS } from "@/lib/fixtures";
import { logText } from "@/lib/simulation";
import type { AgentEvent, AgentState } from "@/lib/types";
import motion from "@/styles/motion.module.css";
import styles from "./LivestreamTile.module.css";
import { PageSkeleton } from "./PageSkeleton";

/**
 * One session tile. The URL, ring, caption and log lines are all derived from
 * the agent's folded state — nothing is stored per tile.
 *
 * The viewport shows, in order of preference:
 *   1. the real Browserbase live view, while that session is still running
 *   2. a capture: `/tiles/<agentId>.mp4`, else the shared `fallback.mp4`
 *   3. the stylized skeleton
 *
 * The live view is dropped once the agent settles, because Browserbase returns
 * 410 for a stopped session and the iframe would go blank.
 */
export function LivestreamTile({
  agent,
  events,
  storeHost,
  liveViewUrl,
}: {
  agent: AgentState;
  /** Every event so far for this agent, oldest first. */
  events: AgentEvent[];
  storeHost: string;
  /** Browserbase live view, present only for agents really driving a browser. */
  liveViewUrl?: string;
}) {
  // Per-agent capture first, then the shared one, then the skeleton.
  const sources = [`/tiles/${agent.id}.mp4`, "/tiles/fallback.mp4"];
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];

  const showLiveView = Boolean(liveViewUrl) && !agent.settled;

  const color = agent.persona.color;
  const stageIndex = Math.max(0, Math.min(5, agent.progress));
  const region = RING_REGIONS[stageIndex]!;

  const path = agent.blocked
    ? STAGE_PATHS[Math.max(0, agent.fail - 1)]
    : STAGE_PATHS[stageIndex];

  const caption = agent.blocked
    ? `halted — ${agent.reason}`
    : agent.ok
      ? "checkout reached · no payment details entered"
      : STAGE_ACTIONS[stageIndex];

  const logs = events.slice(-2);

  return (
    <div className={styles.tile} style={{ borderColor: color }}>
      <div className={styles.titleBar}>
        <span className={styles.swatch} style={{ background: color }} />
        <span className={styles.agentId}>{agent.id}</span>
        <span className={styles.personaName}>{agent.persona.name}</span>
        <span
          className={`${styles.chip} ${
            agent.blocked
              ? styles.chipBlocked
              : agent.ok
                ? styles.chipDone
                : ""
          }`}
        >
          {agent.blocked
            ? "blocked"
            : agent.ok
              ? "done"
              : showLiveView
                ? `live · ${STAGES[stageIndex]}`
                : STAGES[stageIndex]}
        </span>
      </div>

      <div className={styles.urlBar}>
        <span className={styles.dots}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </span>
        <span className={styles.url}>
          {storeHost}
          {path}
        </span>
      </div>

      <div className={styles.viewport}>
        {showLiveView ? (
          <iframe
            className={styles.feed}
            src={liveViewUrl}
            title={`${agent.id} live session`}
            // No sandbox: this is Browserbase's own devtools viewer and it needs
            // a websocket back to the session. Sandboxing it renders a blank box.
          />
        ) : source ? (
          <video
            // Remounting on src change is what lets the fallback actually load.
            key={source}
            className={styles.feed}
            src={source}
            autoPlay
            muted
            loop
            playsInline
            onError={() => setSourceIndex((i) => i + 1)}
            onLoadedMetadata={(e) => {
              // Offset each tile into the clip so four copies of the same
              // capture do not play in lockstep.
              const video = e.currentTarget;
              const seat = Number(agent.id.replace(/\D/g, "")) || 1;
              if (Number.isFinite(video.duration) && video.duration > 0) {
                video.currentTime = (seat * 2.5) % video.duration;
              }
            }}
          />
        ) : (
          <PageSkeleton />
        )}

        <div
          className={`${styles.ring} ${motion.ringPulse}`}
          style={{
            borderColor: color,
            top: region.top,
            left: region.left,
            width: region.width,
            height: region.height,
          }}
        />

        {/* The sweep stops once the agent has settled, either way. */}
        {!agent.settled && (
          <div
            className={`${styles.scan} ${motion.scanSweep}`}
            style={{
              background: `linear-gradient(180deg, ${color}22, transparent)`,
            }}
          />
        )}

        <div
          className={`${styles.cursor} ${motion.cursorBlink}`}
          style={{
            top: `calc(${region.top} + ${region.height} - 4px)`,
            left: `calc(${region.left} + ${region.width} - 4px)`,
          }}
        />

        <div className={styles.caption}>{caption}</div>
      </div>

      <div className={styles.logs}>
        {logs.length === 0 ? (
          <span className={`${styles.log} ${styles.logIdle}`}>
            › session opening…
          </span>
        ) : (
          logs.map((event) => (
            <span
              key={`${event.t}-${event.stage}-${event.kind}`}
              className={`${styles.log} ${
                event.kind === "fail" ? styles.logFail : ""
              }`}
            >
              {event.kind === "fail" ? "✕ " : "› "}
              {logText(event)}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
