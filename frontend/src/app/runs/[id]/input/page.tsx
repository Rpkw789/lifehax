"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/Button";
import { PERSONAS } from "@/lib/fixtures";
import { useRun } from "@/lib/run-context";
import type { RunInput } from "@/lib/types";
import styles from "./input.module.css";

/** The four optional inputs beside the required store URL. */
const OPTIONAL_FIELDS: {
  field: keyof Omit<RunInput, "disabledPersonas">;
  label: string;
  suffix: string;
  placeholder: string;
}[] = [
  {
    field: "feedUrl",
    label: "Product feed",
    suffix: "— optional",
    placeholder: "/feeds/products.xml",
  },
  {
    field: "agentEndpoint",
    label: "Agent endpoint",
    suffix: "— ACP / UCP",
    placeholder: "/.well-known/agent-commerce",
  },
  {
    field: "sitemapUrl",
    label: "Sitemap",
    suffix: "— optional",
    placeholder: "/sitemap.xml",
  },
  {
    field: "testSkus",
    label: "Test SKUs",
    suffix: "— comma separated",
    placeholder: "ATL-1120, NW-DESK-04",
  },
];

export default function InputScreen() {
  const router = useRouter();
  const {
    runId,
    input,
    setInputField,
    togglePersona,
    activePersonaCount,
    startRun,
  } = useRun();

  const run = () => {
    startRun();
    router.push(`/runs/${runId}/check`);
  };

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <div className={styles.eyebrow}>Stage 0 · inputs</div>
        <h1 className={styles.h1}>Is your store ready for AI shoppers?</h1>
        <p className={styles.lede}>
          Point us at a storefront. We run a population of shopping agents
          against it — each with a different buying brief — across four
          surfaces: your website, your agent-commerce endpoints, your feeds and
          your checkout. You get a hit rate, the exact stage every agent died
          at, and the fixes ranked by what they unblock.
        </p>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.cardLabel}>Storefront</div>
          </div>
          <div className={styles.cardBody}>
            <label className={styles.label} htmlFor="store-url">
              Store URL <span className={styles.suffix}>— required</span>
            </label>
            <input
              id="store-url"
              className={styles.urlInput}
              value={input.storeUrl}
              onChange={(e) => setInputField("storeUrl", e.target.value)}
              placeholder="https://store.example.com"
            />

            <div className={styles.grid}>
              {OPTIONAL_FIELDS.map(({ field, label, suffix, placeholder }) => (
                <div key={field}>
                  <label className={styles.label} htmlFor={field}>
                    {label} <span className={styles.suffix}>{suffix}</span>
                  </label>
                  <input
                    id={field}
                    className={styles.input}
                    value={input[field]}
                    onChange={(e) => setInputField(field, e.target.value)}
                    placeholder={placeholder}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.card} ${styles.cardSpaced}`}>
          <div className={styles.cardHeader}>
            <div className={styles.cardLabel}>Agent population</div>
            <div className={styles.populationNote}>
              {activePersonaCount} of {PERSONAS.length} briefs · 2 agents each
            </div>
          </div>
          <div className={styles.personaList}>
            {PERSONAS.map((persona, index) => {
              const on = !input.disabledPersonas.includes(index);
              return (
                <button
                  key={persona.tag}
                  type="button"
                  onClick={() => togglePersona(index)}
                  aria-pressed={on}
                  className={`${styles.personaRow} ${
                    on ? "" : styles.personaRowOff
                  }`}
                >
                  <span
                    className={styles.swatch}
                    style={{
                      background: on ? persona.color : "var(--border-strong)",
                    }}
                  />
                  <span className={styles.personaText}>
                    <span className={styles.personaName}>{persona.name}</span>
                    <span className={styles.personaPrompt}>
                      {persona.prompt}
                    </span>
                  </span>
                  <span
                    className={`${styles.personaCount} ${
                      on ? "" : styles.personaCountOff
                    }`}
                  >
                    {on ? "2 agents" : "off"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className={styles.actions}>
          <Button size="lg" onClick={run}>
            Run simulation
          </Button>
          <div className={styles.estimate}>
            ≈ 9s · {activePersonaCount * 2} sessions across 4 surfaces
          </div>
        </div>
      </div>
    </div>
  );
}
