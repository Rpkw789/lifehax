"use client";

import { useState } from "react";

import { PageSkeleton } from "@/app/runs/[id]/check/PageSkeleton";
import { RING_REGIONS, STAGE_PATHS, TILE_CLIPS } from "@/lib/fixtures";
import type { AgentState } from "@/lib/types";
import motion from "@/styles/motion.module.css";
import styles from "./agent.module.css";

/**
 * The session view, at the size a tile cannot afford.
 *
 * Source preference is the tile's, unchanged — the real Browserbase live view
 * while there is one, then this seat's capture, then the skeleton. What is
 * different here is the frame: a full URL bar, and a caption that stays on the
 * stage the agent is actually working rather than the last one it cleared.
 */
export function AgentViewport({
  agent,
  storeHost,
  liveViewUrl,
  caption,
}: {
  agent: AgentState;
  storeHost: string;
  /** Present only while this agent is really driving a browser. */
  liveViewUrl?: string;
  caption: string;
}) {
  const seat = Number(agent.id.replace(/\D/g, "")) || 1;
  const clip = TILE_CLIPS[(seat - 1) % TILE_CLIPS.length];
  const [clipFailed, setClipFailed] = useState(false);
  const source = clipFailed || !clip ? undefined : `/tiles/${clip}.mp4`;

  const color = agent.persona.color;
  const stageIndex = Math.max(0, Math.min(5, agent.progress));
  const region = RING_REGIONS[stageIndex]!;
  const path = agent.blocked
    ? STAGE_PATHS[Math.max(0, agent.fail - 1)]
    : STAGE_PATHS[stageIndex];

  return (
    <div className={styles.browser}>
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
        {liveViewUrl && (
          <span className={styles.liveTag}>
            <span className={`${styles.liveDot} ${motion.dotBlink}`} />
            live
          </span>
        )}
      </div>

      {/* A light island, as on the tiles: this box shows the storefront as the
          agent saw it, and inverting that would misrepresent it. */}
      <div className={styles.viewport} data-surface="page-preview">
        {liveViewUrl ? (
          <iframe
            className={styles.feed}
            src={liveViewUrl}
            title={`${agent.id} live session`}
            // No sandbox, for the same reason as the tile: this is
            // Browserbase's own viewer and it needs a websocket back.
          />
        ) : source ? (
          <video
            key={source}
            className={styles.feed}
            src={source}
            autoPlay
            muted
            loop
            playsInline
            onError={() => setClipFailed(true)}
            onLoadedMetadata={(e) => {
              const video = e.currentTarget;
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

        {!agent.settled && (
          <div
            className={`${styles.scan} ${motion.scanSweep}`}
            style={{ background: `linear-gradient(180deg, ${color}22, transparent)` }}
          />
        )}

        <div
          className={`${styles.cursor} ${motion.cursorBlink}`}
          style={{
            top: `calc(${region.top} + ${region.height} - 5px)`,
            left: `calc(${region.left} + ${region.width} - 5px)`,
          }}
        />

        <div className={styles.caption}>{caption}</div>
      </div>
    </div>
  );
}
