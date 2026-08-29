import {
  RING_REGIONS,
  STAGES,
  STAGE_ACTIONS,
  STAGE_URLS,
} from "@/lib/fixtures";
import { logText } from "@/lib/simulation";
import type { AgentEvent, AgentState } from "@/lib/types";
import motion from "@/styles/motion.module.css";
import styles from "./LivestreamTile.module.css";
import { PageSkeleton } from "./PageSkeleton";

/**
 * One live session. Everything on it — the URL, the ring's region, the caption,
 * the last two log lines — is derived from the agent's state at the current
 * tick. Nothing is stored per tile.
 */
export function LivestreamTile({
  agent,
  events,
}: {
  agent: AgentState;
  /** Every event so far for this agent, oldest first. */
  events: AgentEvent[];
}) {
  const color = agent.persona.color;
  const stageIndex = Math.max(0, Math.min(5, agent.progress));
  const region = RING_REGIONS[stageIndex];

  const url = agent.blocked
    ? STAGE_URLS[Math.max(0, agent.fail - 1)]
    : STAGE_URLS[stageIndex];

  const caption = agent.blocked
    ? `halted — ${agent.reason}`
    : agent.ok
      ? "purchase confirmed · order NW-4471"
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
          {agent.blocked ? "blocked" : agent.ok ? "done" : STAGES[stageIndex]}
        </span>
      </div>

      <div className={styles.urlBar}>
        <span className={styles.dots}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </span>
        <span className={styles.url}>{url}</span>
      </div>

      <div className={styles.viewport}>
        <PageSkeleton />

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
