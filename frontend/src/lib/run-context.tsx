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
import type { CheckResult } from "@contracts/check-result";
import type { SurfaceSimulationEvent } from "@contracts/surface-simulation";

import { createRun, getRun, subscribeToRun, type StreamMessage } from "./api";
import { anchorFor, elapsedSeconds } from "./elapsed";
import { hydrate } from "./hydrate";
import { ARCHETYPE_PERSONAS, TILE_COUNT } from "./fixtures";
import { agentStates } from "./simulation";
import { appendSurfaceEvent } from "./surface-events";
import type {
  AgentEvent,
  AgentState,
  Checks,
  Finding,
  Persona,
  RunInput,
  Surface,
} from "./types";

export type StepKey = "input" | "check" | "recommend" | "dashboard";

/** Whether the run id in the URL turned out to name a run the backend kept. */
export type Restore = "pending" | "restored" | "none";

export const STEP_ORDER: readonly StepKey[] = ["input", "check", "recommend", "dashboard"];

/** Ten agents, two per brief. Ids are assigned by the backend. */
export const AGENT_IDS = Array.from(
  { length: 10 },
  (_, i) => `A${String(i + 1).padStart(2, "0")}`,
);

interface RunContextValue {
  /** The route's run id, which is also the backend run id once started. */
  runId: string;
  /**
   * What became of the attempt to restore this id from the backend.
   * "pending" until the answer is known, so Check can wait rather than
   * starting a second run on top of one it is about to load.
   */
  restore: Restore;
  /** Highest tick seen. Drives per-stage progress. */
  tick: number;
  /**
   * Seconds since the run began. Counts on the wall clock while a run is in
   * flight and freezes at the last event once it settles — reading it off the
   * newest event alone left the display stuck between events.
   */
  elapsed: number;
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
  /** The site audit. Drives the protocol and guide columns on Check. */
  checks: Checks | null;
  /** Real append-only progress for ACP/UCP, llms.txt, and Web search. */
  surfaceEvents: SurfaceSimulationEvent[];
  /** One contract-valid report consolidating the three simulations. */
  checkResult: CheckResult | null;
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
  locale: "en-US",
  currency: "USD",
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
  const [checks, setChecks] = useState<Checks | null>(null);
  const [surfaceEvents, setSurfaceEvents] = useState<
    SurfaceSimulationEvent[]
  >([]);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [catalogueCount, setCatalogueCount] = useState(0);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFindings, setOpenFindings] = useState<Record<string, boolean>>({});
  const [restore, setRestore] = useState<Restore>("pending");
  /** When this run began, on the client's clock. Null once it has settled. */
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

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
      case "checks":
        setChecks(message.checks);
        break;
      case "sessions_closed":
        // The URLs outlive their sessions and would render Browserbase's
        // "debugging connection was closed" page. Drop them.
        setSessions({});
        break;
      case "agent":
        setEvents((current) => [...current, message.event]);
        break;
      case "surface_simulation":
        setSurfaceEvents((current) =>
          appendSurfaceEvent(current, message.event),
        );
        break;
      case "check_result":
        setCheckResult(message.result);
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

  /**
   * Restore the run named in the URL.
   *
   * The screens are fed by the event stream, which only exists while a run is
   * in flight — so a run reached from Past runs had nothing behind it and every
   * screen rendered its empty state. `GET /runs/:id` is the only route that
   * falls back to the database, so it is what a finished run is read from;
   * `/runs/:id/events` answers from memory alone and 404s for saved runs.
   */
  useEffect(() => {
    let live = true;
    setRestore("pending");

    void getRun(runId)
      .then((run) => {
        if (!live) return;
        // A run started in this session is the one on screen; it is newer than
        // anything the id in the URL refers to.
        if (started.current) {
          setRestore("none");
          return;
        }
        if (!run) {
          setRestore("none");
          return;
        }

        const state = hydrate(run);
        setInput(state.input);
        setEvents(state.events);
        setPersonas(state.personas);
        setBriefs(state.briefs);
        setChecks(state.checks);
        setSurfaces(state.surfaces);
        setFindings(state.findings);
        setSurfaceEvents(state.surfaceEvents);
        setCheckResult(state.checkResult);
        setCatalogueCount(state.catalogueCount);
        setSessions(state.sessions);
        setRunning(state.running);
        setComplete(state.complete);
        setError(state.error);
        setRestore("restored");
        // A settled run's elapsed time comes from its own events; only one
        // still in flight gets a clock, anchored so the client's `now` agrees
        // with the ticks the backend has already stamped.
        setStartedAtMs(
          state.running
            ? anchorFor(
                state.events.reduce((max, e) => Math.max(max, e.t), 0),
                Date.now(),
              )
            : null,
        );

        // A run still in flight is still in memory, so it can be followed the
        // rest of the way rather than frozen at the moment it was read.
        if (state.running) {
          unsubscribe.current?.();
          unsubscribe.current = subscribeToRun(runId, handle, (message) => {
            setError(message);
            setRunning(false);
          });
        }
      })
      .catch((err: unknown) => {
        if (!live) return;
        // A 404 is `null` above; reaching here means the backend is unreachable
        // or broken, which is worth saying rather than showing "no run yet".
        setError(err instanceof Error ? err.message : String(err));
        setRestore("none");
      });

    return () => {
      live = false;
    };
  }, [runId, handle]);

  const startRun = useCallback(() => {
    if (started.current) return;
    started.current = true;

    setRestore("none");
    setStartedAtMs(Date.now());
    setEvents([]);
    setSessions({});
    setBriefs([]);
    setChecks(null);
    setSurfaceEvents([]);
    setCheckResult(null);
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

  // Tenth-of-a-second resolution, matching what the readout prints. The
  // interval exists only while a run is in flight, so a settled screen is not
  // re-rendering ten times a second for a number that cannot change.
  useEffect(() => {
    if (!running || startedAtMs === null) return;
    const id = setInterval(() => setNowMs(Date.now()), 100);
    return () => clearInterval(id);
  }, [running, startedAtMs]);

  const elapsed = elapsedSeconds({ running, startedAtMs, nowMs, tick });

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
      restore,
      tick,
      elapsed,
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
      checks,
      surfaceEvents,
      checkResult,
      catalogueCount,
      sessions,
      tileIds,
      openFindings,
      toggleFinding,
    }),
    [
      runId,
      restore,
      tick,
      elapsed,
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
      checks,
      surfaceEvents,
      checkResult,
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
  const value = useRunOptional();
  if (!value) throw new Error("useRun must be used inside a RunProvider");
  return value;
}

/**
 * For the handful of components that render both inside and outside a run —
 * the sidebar, which the settings screen shows with no run in scope. Anything
 * that genuinely needs a run should keep using `useRun` and get the throw.
 */
export function useRunOptional(): RunContextValue | null {
  return useContext(RunContext);
}
