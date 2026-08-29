import type {
  Evidence,
  ProbeResult,
  TargetProduct,
} from "@contracts/check-result";
import type {
  SurfaceSimulationEvent,
  SurfaceSimulationKey,
  SurfaceSimulationPhase,
} from "@contracts/surface-simulation";
import type { DocumentFetcher } from "../catalogue/snapshot.ts";

export interface SurfaceWorkerContext {
  runId: string;
  storeUrl: string;
  target: TargetProduct;
  brief: string;
  locale: string;
  currency: string;
  at: string;
  fetcher: DocumentFetcher;
  signal?: AbortSignal;
}

export interface SurfaceProbes {
  llms_txt: ProbeResult;
  agent_commerce: ProbeResult;
  ucp: ProbeResult;
}

export interface SurfaceWorkerResult {
  surface: SurfaceSimulationKey;
  evidence: Evidence[];
  probes: Partial<SurfaceProbes>;
  critique: SurfaceCritique | null;
}

export interface CritiquePoint {
  text: string;
  evidence_ids: string[];
}

export interface SurfaceCritique {
  summary: string;
  strengths: CritiquePoint[];
  gaps: CritiquePoint[];
  shopper_impact: CritiquePoint[];
  improvements: CritiquePoint[];
}

export type SurfaceEventEmitter = (
  surface: SurfaceSimulationKey,
  phase: SurfaceSimulationPhase,
  message: string,
  evidenceId: string | null,
) => SurfaceSimulationEvent;
