"use client";

/**
 * Client-side run state, held at the shell so it survives navigation between
 * the routes.
 *
 * A run is created on the backend from `RunInput`, then its `AgentEvent`s
 * arrive over SSE. Everything the screens render is derived from the buffered
 * events — nothing per-agent is stored, which is what keeps re-render trivial.
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

import { createRun, subscribeToRun, type StreamMessage } from "./api";
import { ARCHETYPE_PERSONAS, TILE_COUNT } from "./fixtures";
import { agentStates } from "./simulation";
import type {
  AgentEvent,
  AgentState,
  Finding,
  Persona,
  RunInput,
  Surface,
} from "./types";

export type StepKey = "input" | "check" | "recommend" | "dashboard";

export const STEP_ORDER: readonly StepKey[] = ["input", "check", "recommend", "dashboard"];

/** Ten agents, two per brief. Ids are assigned by the backend. */
export const AGENT_IDS = Array.from(
  { length: 10 },
  (_, i) => `A${String(i + 1).padStart(2, "0")}`,
);

interface RunContextValue {
  /** The route's run id, which is also the backend run id once started. */
  runId: string;
  /** Highest tick seen, driving the elapsed readout. */
  tick: number;
  running: boolean;
  complete: boolean;
  error: string | null;
  startRun: () => void;

  input: RunInput;
  setInputField: (field: keyof Omit<RunInput, "disabledPersonas">, value: string) => void;
  togglePersona: (index: number) => void;
  storeHost: string;
  activePersonaCount: number;

  /** Live run data. */
  events: AgentEvent[];
  agents: AgentState[];
  personas: Persona[];
  findings: Finding[];
  surfaces: Surface[];
  /** One brief per agent — two agents share an archetype, never a brief. */
  briefs: string[];
  catalogueCount: number;
  /** Embeddable Browserbase live views, by agent id. Only real agents have one. */
  sessions: Record<string, string>;
  /** Tiles to show: agents with a live browser first. */
  tileIds: string[];

  openFindings: Record<string, boolean>;
  toggleFinding: (key: string) => void;
}

const RunContext = createContext<RunContextValue | null>(null);

const DEFAULT_INPUT: RunInput = {
  storeUrl: "",
  feedUrl: "",
  agentEndpoint: "",
  sitemapUrl: "",
  testSkus: "",
  disabledPersonas: [],
};

export function RunProvider({
  runId,
  children,
}: {
  runId: string;
  children: ReactNode;
}) {
  const [input, setInput] = useState<RunInput>(DEFAULT_INPUT);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [briefs, setBriefs] = useState<string[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [catalogueCount, setCatalogueCount] = useState(0);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFindings, setOpenFindings] = useState<Record<string, boolean>>({});

  const unsubscribe = useRef<(() => void) | null>(null);
  const started = useRef(false);

  useEffect(() => () => unsubscribe.current?.(), []);

  const handle = useCallback((message: StreamMessage) => {
    switch (message.type) {
      case "catalogue":
        setCatalogueCount(message.products);
        break;
      case "personas":
        setPersonas(message.personas);
        setBriefs(message.briefs ?? []);
        break;
      case "session":
        setSessions((current) => ({
          ...current,
          [message.agentId]: message.liveViewUrl,
        }));
        break;
      case "sessions_closed":
        // The URLs outlive their sessions and would render Browserbase's
        // "debugging connection was closed" page. Drop them.
        setSessions({});
        break;
      case "agent":
        setEvents((current) => [...current, message.event]);
        break;
      case "findings":
        setFindings(message.findings);
        setSurfaces(message.surfaces);
        break;
      case "done":
        setRunning(false);
        setComplete(true);
        if (message.error) setError(message.error);
        break;
      default:
        break;
    }
  }, []);

  const startRun = useCallback(() => {
    if (started.current) return;
    started.current = true;

    setEvents([]);
    setSessions({});
    setBriefs([]);
    setFindings([]);
    setSurfaces([]);
    setError(null);
    setComplete(false);
    setRunning(true);

    void createRun(input)
      .then((backendRunId) => {
        unsubscribe.current?.();
        unsubscribe.current = subscribeToRun(backendRunId, handle, (message) => {
          setError(message);
          setRunning(false);
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setRunning(false);
        started.current = false;
      });
  }, [input, handle]);

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

  const tick = useMemo(
    () => events.reduce((max, e) => Math.max(max, e.t), 0),
    [events],
  );

  // Before the backend has generated briefs, fall back to the archetype list so
  // the Input screen has something to show.
  const shownPersonas: Persona[] =
    personas.length > 0 ? personas : [...ARCHETYPE_PERSONAS];

  const agents = useMemo(
    () => agentStates(events, shownPersonas, AGENT_IDS, complete),
    [events, shownPersonas, complete],
  );

  // Show the agents that are really driving a browser first — they are the
  // only ones with something live to look at.
  const tileIds = useMemo(() => {
    const live = AGENT_IDS.filter((id) => sessions[id]);
    const rest = AGENT_IDS.filter((id) => !sessions[id]);
    return [...live, ...rest].slice(0, TILE_COUNT);
  }, [sessions]);

  // Host only. The tile URL bar appends a per-stage path, so keeping the user's
  // own path here produced things like "store.com/collections/mens/search".
  const storeHost = useMemo(() => {
    const raw = input.storeUrl.trim();
    if (!raw) return "no store yet";
    try {
      return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).host;
    } catch {
      return raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    }
  }, [input.storeUrl]);

  const value = useMemo<RunContextValue>(
    () => ({
      runId,
      tick,
      running,
      complete,
      error,
      startRun,
      input,
      setInputField,
      togglePersona,
      storeHost,
      activePersonaCount:
        shownPersonas.length - input.disabledPersonas.length,
      events,
      agents,
      personas: shownPersonas,
      findings,
      surfaces,
      briefs,
      catalogueCount,
      sessions,
      tileIds,
      openFindings,
      toggleFinding,
    }),
    [
      runId,
      tick,
      running,
      complete,
      error,
      startRun,
      input,
      setInputField,
      togglePersona,
      storeHost,
      shownPersonas,
      events,
      agents,
      findings,
      surfaces,
      briefs,
      catalogueCount,
      sessions,
      tileIds,
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
