import type { TextPatch } from '../document/source-transaction';
import type { Pt } from '../semantics/calc-eval';

export interface DerivedDragRequest {
  source: string;
  sourceRevision: number;
  pointName: string;
  target: Pt;
}

export interface DerivedDragResult {
  sourceRevision: number;
  status: 'solved' | 'underconstrained' | 'unsolved';
  patches: TextPatch[];
  residual: number;
  iterations: number;
  variables: string[];
  message?: string;
}

export interface SolverPort {
  solveDerivedDrag(request: DerivedDragRequest, signal?: AbortSignal): Promise<DerivedDragResult>;
  dispose(): void;
}

export interface SolverWorkerRequest {
  type: 'solve-derived-drag';
  requestId: number;
  payload: DerivedDragRequest;
}

export interface SolverWorkerResponse {
  type: 'solve-derived-drag-result';
  requestId: number;
  payload?: DerivedDragResult;
  error?: string;
}
