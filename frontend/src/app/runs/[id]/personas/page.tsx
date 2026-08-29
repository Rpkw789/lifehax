"use client";

import Link from "next/link";

import { MOCK_EVENTS, outcomeOf } from "@/lib/agent-detail";
import { AGENT_IDS, useRun } from "@/lib/run-context";
import { agentStates } from "@/lib/simulation";
import styles from "../sections.module.css";

/**
 * The population, as briefs rather than as sessions.
 *
 * Check shows ten tiles; this shows the five briefs behind them and how each
 * one fared, which is the question "which intents does this store fail" —
 * closer to what the findings are derived from. Every agent links through to
 * its own page.
 */
export default function PersonasScreen() {
  const { runId, events, agents, personas, briefs, running } = useRun();

  const mocked = events.length === 0 && !running;
  const shownEvents = mocked ? [...MOCK_EVENTS] : events;
  const shownAgents = mocked
    ? agentStates(shownEvents, personas, AGENT_IDS, true)
    : agents;

  // Two agents per brief, assigned by seat — the same mapping `personaIndexOf`
  // uses, read the other way round.
  const groups = personas.map((persona, index) => ({
    index,
    persona,
    agents: shownAgents.filter((agent) => agent.personaIndex === index),
  }));

  const settled = shownAgents.filter((a) => a.settled).length;
  const won = shownAgents.filter((a) => a.ok).length;

  return (
    <div className={styles.screen}>
      <div className={styles.note}>
        {personas.length} briefs · {shownAgents.length} agents · {won} of{" "}
        {settled || shownAgents.length} reached checkout
        {mocked && <span className={styles.sim}>mock data</span>}
      </div>

      <div className={styles.list}>
        {groups.map((group) => (
          <section
            key={group.persona.tag}
            className={`${styles.card} ${styles.personaCard}`}
            style={{ borderLeftColor: group.persona.color }}
          >
            <div className={styles.cardHead}>
              <span
                className={styles.swatch}
                style={{ background: group.persona.color }}
              />
              <span className={styles.name}>{group.persona.name}</span>
              <span className={styles.tag}>{group.persona.tag}</span>
              <span className={styles.count}>
                {group.agents.filter((a) => a.ok).length}/{group.agents.length}{" "}
                through
              </span>
            </div>

            <div className={styles.agents}>
              {group.agents.map((agent) => {
                const seat = Number(agent.id.replace(/\D/g, "")) || 1;
                const outcome = outcomeOf(agent);
                return (
                  <Link
                    key={agent.id}
                    className={styles.agent}
                    href={`/runs/${runId}/agents/${agent.id}`}
                  >
                    <span className={styles.agentId}>{agent.id}</span>
                    <span
                      className={`${styles.agentOutcome} ${
                        outcome.tone === "fail" ? styles.agentOutcomeFail : ""
                      }`}
                    >
                      {outcome.headline}
                    </span>
                    <span className={styles.agentBrief}>
                      “{briefs[seat - 1] ?? group.persona.prompt}”
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
