"use client";

/**
 * Client-side run state, held at the shell so it survives navigation between
 * the four routes.
 *
 * The shape here mirrors the eventual server resource: a run is created from
 * `RunInput`, produces a stream of `AgentEvent`s, and the re-check is a child
 * run. Today the stream is a fixture clock; swapping in an SSE subscription
 * means replacing `startRun` and the tick interval, nothing else.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { FINDINGS, PERSONAS, TICK_MS } from "./fixtures";
import { TOTAL_TICKS } from "./simulation";
import type { RunInput } from "./types";

export type StepKey = "input" | "check" | "recommend" | "dashboard";

export const STEP_ORDER: readonly StepKey[] = ["input", "check", "recommend", "dashboard"];

interface RunContextValue {
  runId: string;
  /** Simulation clock. Every derived value on Check comes from this. */
  tick: number;
  running: boolean;
  /** The run has reached its final tick. */
  complete: boolean;
  startRun: () => void;
  /** Pin the run at its end, for the screens that read a finished run. */
  completeRun: () => void;

  input: RunInput;
  setInputField: (field: keyof Omit<RunInput, "disabledPersonas">, value: string) => void;
  togglePersona: (index: number) => void;
  /** Host of the store URL, e.g. "northwind.supply". */
  storeHost: string;
  /** How many briefs are switched on. */
  activePersonaCount: number;

  /** Recommend: which finding accordions are open. */
  openFindings: Record<string, boolean>;
  toggleFinding: (key: string) => void;
}

const RunContext = createContext<RunContextValue | null>(null);

const DEFAULT_INPUT: RunInput = {
  storeUrl: "https://northwind.supply",
  feedUrl: "",
  agentEndpoint: "",
  sitemapUrl: "/sitemap.xml",
  testSkus: "ATL-1120, NW-DESK-04",
  disabledPersonas: [],
};

export function RunProvider({
  runId,
  children,
}: {
  runId: string;
  children: ReactNode;
}) {
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState<RunInput>(DEFAULT_INPUT);
  // Open the highest-ranked finding, by identity rather than by a literal id —
  // ids are assigned from rank order, so a hardcoded one goes stale silently.
  const [openFindings, setOpenFindings] = useState<Record<string, boolean>>(() => {
    const first = FINDINGS[0];
    return first ? { [first.finding_id]: true } : {};
  });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const startRun = useCallback(() => {
    stop();
    setTick(0);
    setRunning(true);
    timer.current = setInterval(() => {
      setTick((current) => {
        if (current >= TOTAL_TICKS) {
          stop();
          setRunning(false);
          return current;
        }
        return current + 1;
      });
    }, TICK_MS);
  }, [stop]);

  const completeRun = useCallback(() => {
    stop();
    setRunning(false);
    setTick(TOTAL_TICKS);
  }, [stop]);

  const setInputField = useCallback(
    (field: keyof Omit<RunInput, "disabledPersonas">, value: string) => {
      setInput((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const togglePersona = useCallback((index: number) => {
    setInput((current) => {
      const off = current.disabledPersonas.includes(index);
      return {
        ...current,
        disabledPersonas: off
          ? current.disabledPersonas.filter((i) => i !== index)
          : [...current.disabledPersonas, index],
      };
    });
  }, []);

  const toggleFinding = useCallback((key: string) => {
    setOpenFindings((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const storeHost = useMemo(
    () =>
      (input.storeUrl || DEFAULT_INPUT.storeUrl)
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, ""),
    [input.storeUrl],
  );

  const value = useMemo<RunContextValue>(
    () => ({
      runId,
      tick,
      running,
      complete: tick >= TOTAL_TICKS,
      startRun,
      completeRun,
      input,
      setInputField,
      togglePersona,
      storeHost,
      activePersonaCount: PERSONAS.length - input.disabledPersonas.length,
      openFindings,
      toggleFinding,
    }),
    [
      runId,
      tick,
      running,
      startRun,
      completeRun,
      input,
      setInputField,
      togglePersona,
      storeHost,
      openFindings,
      toggleFinding,
    ],
  );

  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}

export function useRun(): RunContextValue {
  const value = useContext(RunContext);
  if (!value) throw new Error("useRun must be used inside a RunProvider");
  return value;
}
