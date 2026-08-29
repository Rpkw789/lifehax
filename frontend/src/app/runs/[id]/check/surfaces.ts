import type { CheckResult } from "@contracts/check-result";
import type {
  SurfaceSimulationEvent,
  SurfaceSimulationKey,
} from "@contracts/surface-simulation";
import { surfaceConsoleState } from "@/lib/surface-events";
import type { AgentState } from "@/lib/types";

export type SurfaceKey = "browse" | "protocol" | "guide" | "search";

export interface SurfaceState {
  key: SurfaceKey;
  name: string;
  subtitle: string;
  progress: number;
  status: "waiting" | "running" | "done" | "blocked";
  verdict: string | null;
}

const SURFACE_META: Record<
  Exclude<SurfaceKey, "browse">,
  {
    simulationKey: SurfaceSimulationKey;
    name: string;
    subtitle: string;
  }
> = {
  protocol: {
    simulationKey: "agent_protocol",
    name: "Agent protocol",
    subtitle: "ACP · UCP endpoints",
  },
  guide: {
    simulationKey: "model_readable_guide",
    name: "Model-readable guide",
    subtitle: "llms.txt · linked sources",
  },
  search: {
    simulationKey: "web_search",
    name: "Web search",
    subtitle: "blind shopper retrieval",
  },
};

function eventSurface(
  key: Exclude<SurfaceKey, "browse">,
  events: SurfaceSimulationEvent[],
  checkResult: CheckResult | null,
): SurfaceState {
  const meta = SURFACE_META[key];
  const state = surfaceConsoleState(meta.simulationKey, events, checkResult);
  return {
    key,
    name: meta.name,
    subtitle: meta.subtitle,
    progress: state.progress,
    status: state.status,
    verdict: state.verdict,
  };
}

function browseSurface(agents: AgentState[], complete: boolean): SurfaceState {
  const cleared = agents.reduce((sum, agent) => sum + agent.progress, 0);
  const settled = agents.filter((agent) => agent.settled).length;
  const won = agents.filter((agent) => agent.ok).length;

  return {
    key: "browse",
    name: "Browser agents",
    subtitle: `${agents.length} shoppers · live sessions`,
    progress: complete
      ? 1
      : Math.min(1, cleared / Math.max(1, agents.length * 6)),
    status: complete ? (won > 0 ? "done" : "blocked") : "running",
    verdict:
      settled > 0 ? `${won}/${agents.length} completed a purchase` : null,
  };
}

export function simulationKeyFor(
  key: Exclude<SurfaceKey, "browse">,
): SurfaceSimulationKey {
  return SURFACE_META[key].simulationKey;
}

export function buildSurfaces(input: {
  agents: AgentState[];
  surfaceEvents: SurfaceSimulationEvent[];
  checkResult: CheckResult | null;
  complete: boolean;
}): SurfaceState[] {
  return [
    browseSurface(input.agents, input.complete),
    eventSurface("protocol", input.surfaceEvents, input.checkResult),
    eventSurface("guide", input.surfaceEvents, input.checkResult),
    eventSurface("search", input.surfaceEvents, input.checkResult),
  ];
}
