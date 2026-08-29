"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { ChevronTrack } from "@/components/ChevronTrack";
import { SectionLabel } from "@/components/SectionLabel";
import {
  MOCK_EVENTS,
  journeyOf,
  neighbours,
  outcomeOf,
  type JourneyStep,
} from "@/lib/agent-detail";
import { STAGES } from "@/lib/fixtures";
import { AGENT_IDS, useRun } from "@/lib/run-context";
import { agentStates, elapsedLabel, logText } from "@/lib/simulation";
import motion from "@/styles/motion.module.css";
import styles from "./agent.module.css";
import { AgentViewport } from "./AgentViewport";

/**
 * One shopper's own page.
 *
 * Check answers "how did the population do"; this answers "what happened to
 * this one". It renders inside the run layout, so arriving here from Check
 * keeps `RunProvider` mounted and the SSE subscription alive — the live view
 * does not restart just because the route changed.
 *
 * Landing here cold (a deep link, a refresh) leaves the context empty. Rather
 * than showing an empty shell, the screen falls back to `MOCK_EVENTS` and says
 * so in the header. Nothing mocked is presented as measured.
 */
export default function AgentScreen() {
  const params = useParams<{ agentId: string }>();
  const agentId = String(params?.agentId ?? "").toUpperCase();

  const {
    runId,
    storeHost,
    events,
    agents,
    personas,
    briefs,
    sessions,
    running,
  } = useRun();

  // Nothing has streamed and nothing is streaming: stand in for the run.
  const mocked = events.length === 0 && !running;
  const shownEvents = mocked ? [...MOCK_EVENTS] : events;
  const shownAgents = mocked
    ? agentStates(shownEvents, personas, AGENT_IDS, true)
    : agents;

  const agent = shownAgents.find((a) => a.id === agentId);

  if (!agent) {
    return (
      <div className={styles.screen}>
        <div className={styles.missing}>
          <div className={styles.missingText}>
            No agent <span className={styles.mono}>{agentId || "—"}</span> in
            this run.
          </div>
          <Link className={styles.back} href={`/runs/${runId}/check`}>
            ← back to the population
          </Link>
        </div>
      </div>
    );
  }

  const seat = Number(agent.id.replace(/\D/g, "")) || 1;
  const brief = briefs[seat - 1] ?? agent.persona.prompt;
  const journey = journeyOf(agent, shownEvents);
  const outcome = outcomeOf(agent);
  const { prev, next } = neighbours(AGENT_IDS, agent.id);
  const mine = shownEvents.filter((e) => e.agentId === agent.id);
  const liveViewUrl = mocked ? undefined : sessions[agent.id];

  // The caption follows the stage in progress, falling back to the blocking
  // reason once the agent has stopped.
  const working = journey.find((s) => s.status === "running");
  const caption = working?.note ?? outcome.headline;

  const cleared = journey.filter((s) => s.status === "cleared").length;

  return (
    <div className={styles.screen}>
      <div className={styles.topBar}>
        <Link className={styles.back} href={`/runs/${runId}/check`}>
          ← all agents
        </Link>
        <div className={styles.pager}>
          {prev ? (
            <Link className={styles.pageLink} href={`/runs/${runId}/agents/${prev}`}>
              ‹ {prev}
            </Link>
          ) : (
            <span className={styles.pageLinkOff}>‹ {agent.id}</span>
          )}
          {next ? (
            <Link className={styles.pageLink} href={`/runs/${runId}/agents/${next}`}>
              {next} ›
            </Link>
          ) : (
            <span className={styles.pageLinkOff}>{agent.id} ›</span>
          )}
        </div>
      </div>

      <header className={styles.identity} style={{ borderColor: agent.persona.color }}>
        <span className={styles.swatch} style={{ background: agent.persona.color }} />
        <span className={styles.agentId}>{agent.id}</span>
        <span className={styles.personaName}>{agent.persona.name}</span>
        <span className={styles.tag}>{agent.persona.tag}</span>

        <span
          className={`${styles.chip} ${
            agent.blocked ? styles.chipBlocked : agent.ok ? styles.chipDone : ""
          }`}
        >
          {agent.blocked
            ? "blocked"
            : agent.ok
              ? "done"
              : liveViewUrl
                ? `live · ${STAGES[Math.min(5, agent.progress)]}`
                : STAGES[Math.min(5, agent.progress)]}
        </span>

        {/* Say so where the screen is standing in rather than reporting. */}
        {mocked && <span className={styles.sim}>mock data</span>}
      </header>

      <blockquote className={styles.brief}>“{brief}”</blockquote>

      <div className={styles.split}>
        <AgentViewport
          agent={agent}
          storeHost={storeHost}
          liveViewUrl={liveViewUrl}
          caption={caption}
        />

        <section className={styles.journey}>
          <SectionLabel className={styles.journeyLabel}>
            Journey · {cleared}/{STAGES.length} stages cleared
          </SectionLabel>
          <ChevronTrack
            className={styles.journeyTrack}
            count={24}
            fraction={cleared / STAGES.length}
            fill={agent.blocked ? "var(--blocked)" : agent.persona.color}
          />
          <ol className={styles.steps}>
            {journey.map((step) => (
              <Step key={step.number} step={step} color={agent.persona.color} />
            ))}
          </ol>
        </section>
      </div>

      <div
        className={`${styles.outcome} ${
          outcome.tone === "fail"
            ? styles.outcomeFail
            : outcome.tone === "ok"
              ? styles.outcomeOk
              : ""
        }`}
      >
        <span className={styles.outcomeLabel}>Outcome</span>
        <span className={styles.outcomeText}>{outcome.headline}</span>
      </div>

      <SectionLabel className={styles.logLabel}>
        Session log · {mine.length} events
      </SectionLabel>
      <div className={styles.log}>
        {mine.length === 0 ? (
          <span className={styles.logIdle}>› session opening…</span>
        ) : (
          mine.map((event) => (
            <div
              key={`${event.stage}-${event.kind}-${event.t}`}
              className={styles.logEntry}
            >
              <span className={styles.logTime}>{elapsedLabel(event.t)}</span>
              <span className={styles.logStage}>{STAGES[event.stage - 1]}</span>
              <span
                className={`${styles.logMessage} ${
                  event.kind === "fail" ? styles.logMessageFail : ""
                }`}
              >
                {logText(event)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** One stage on the rail. The dot carries the status; the note says why. */
function Step({ step, color }: { step: JourneyStep; color: string }) {
  const running = step.status === "running";

  return (
    <li className={`${styles.step} ${styles[step.status]!}`}>
      <span
        className={`${styles.stepDot} ${running ? motion.dotBlink : ""}`}
        style={{
          background:
            step.status === "cleared"
              ? color
              : step.status === "blocked"
                ? "var(--ink)"
                : running
                  ? color
                  : "var(--chevron-off)",
        }}
      />
      <span className={styles.stepName}>{step.stage}</span>
      <span className={styles.stepNote}>{step.note}</span>
      <span className={styles.stepAt}>
        {step.at === null ? (running ? "…" : "") : elapsedLabel(step.at)}
      </span>
    </li>
  );
}
