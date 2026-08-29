"use client";

import { useEffect, useState } from "react";

import {
  RING_REGIONS,
  STAGES,
  STAGE_ACTIONS,
  STAGE_PATHS,
  TILE_CLIPS,
} from "@/lib/fixtures";
import { logText } from "@/lib/simulation";
import type { AgentEvent, AgentState } from "@/lib/types";
import motion from "@/styles/motion.module.css";
import styles from "./LivestreamTile.module.css";
import { ChevronTrack } from "@/components/ChevronTrack";
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
  booting,
  brief,
}: {
  agent: AgentState;
  /** Every event so far for this agent, oldest first. */
  events: AgentEvent[];
  storeHost: string;
  /** Browserbase live view, present only for agents really driving a browser. */
  liveViewUrl?: string;
  /** The run is live and this agent has not reported anything yet. */
  booting: boolean;
  /** This agent's own shopping brief. */
  brief?: string;
}) {
  // One clip per tile, chosen by the agent's seat so no two tiles play the
  // same footage and the choice is stable across re-renders.
  const seat = Number(agent.id.replace(/\D/g, "")) || 1;
  const clip = TILE_CLIPS[(seat - 1) % TILE_CLIPS.length];
  const [clipFailed, setClipFailed] = useState(false);
  const source = clipFailed || !clip ? undefined : `/tiles/${clip}.mp4`;

  // Sessions are held open for the whole run so other tiles keep a valid live
  // view, but a settled agent has nothing left to show: its browser is idle on
  // whatever page it stopped at. Streaming that reads as activity it is not
  // doing, so the tile switches to its outcome instead.
  const showLiveView = Boolean(liveViewUrl) && !agent.settled;

  const color = agent.persona.color;
  const stageIndex = Math.max(0, Math.min(5, agent.progress));
  const region = RING_REGIONS[stageIndex]!;

  const path = agent.blocked
    ? STAGE_PATHS[Math.max(0, agent.fail - 1)]
    : STAGE_PATHS[stageIndex];

  const bootCaption = "provisioning a browser session";
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
          {booting && !showLiveView
            ? "starting"
            : agent.blocked
            ? "blocked"
            : agent.ok
              ? "done"
              : showLiveView
                ? `live · ${STAGES[stageIndex]}`
                : STAGES[stageIndex]}
        </span>
      </div>

      {brief && <div className={styles.brief}>“{brief}”</div>}

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
        {agent.settled ? (
          <SettledState
            outcome={agent.ok ? "reached checkout" : "blocked"}
            reason={agent.blocked ? agent.reason : undefined}
            path={path}
          />
        ) : booting && !showLiveView ? (
          <BootState color={color} agentId={agent.id} />
        ) : showLiveView ? (
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
            onError={() => setClipFailed(true)}
            onLoadedMetadata={(e) => {
              // Offset each tile into the clip so four copies of the same
              // capture do not play in lockstep.
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

        <div className={styles.caption}>
          {agent.settled ? caption : booting && !showLiveView ? bootCaption : caption}
        </div>
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


/** The phases a session goes through before the agent can drive it. */
const BOOT_PHASES = [
  "requesting session",
  "allocating browser",
  "attaching agent",
  "opening storefront",
];

/**
 * Shown while a real agent's browser is being provisioned — roughly five
 * seconds, which is long enough that an empty box looks broken.
 *
 * The track is the same chevron motif the rest of the product uses, filled in
 * the brief's color, so this reads as part of the system rather than a spinner
 * borrowed from somewhere else.
 */
/**
 * What a tile shows once its agent stops. Deliberately still: the run is over
 * for this agent, and a moving frame would suggest otherwise.
 */
function SettledState({
  outcome,
  reason,
  path,
}: {
  outcome: string;
  reason?: string;
  path?: string;
}) {
  return (
    <div className={styles.settled}>
      <div className={`${styles.bootGrid}`} />
      <span className={styles.settledOutcome}>{outcome}</span>
      {reason ? <span className={styles.settledReason}>{reason}</span> : null}
      {path ? <span className={styles.settledPath}>{path}</span> : null}
    </div>
  );
}

function BootState({ color, agentId }: { color: string; agentId: string }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setPhase((p) => (p + 1) % BOOT_PHASES.length),
      1100,
    );
    return () => clearInterval(timer);
  }, []);

  // The track fills across the phases, then starts over with the cycle.
  const fraction = (phase + 1) / BOOT_PHASES.length;

  return (
    <div className={styles.boot}>
      <div className={`${styles.bootGrid} ${motion.bootGrid}`} />
      <div
        className={`${styles.bootSweep} ${motion.bootSweep}`}
        style={{
          background: `linear-gradient(90deg, transparent, ${color}1f, transparent)`,
        }}
      />

      <span className={styles.bootAgent}>{agentId}</span>

      <ChevronTrack
        className={styles.bootTrack}
        count={18}
        fraction={fraction}
        fill={color}
      />

      <span className={styles.bootStatus}>
        {BOOT_PHASES[phase]}
        <span className={`${styles.bootCaret} ${motion.cursorBlink}`} />
      </span>
    </div>
  );
}
