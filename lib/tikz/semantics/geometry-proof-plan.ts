import { hashSource } from '../document/source-hash';
import type {
  GeometryProofDeduction,
  GeometryProofObligation,
  GeometryProofState,
} from './geometry-proof-state';

export const GEOMETRY_PROOF_PLAN_SCHEMA_VERSION =
  'geometry-proof-plan/v1' as const;

export interface GeometryProofPlanOwner {
  readonly observationCallId: string;
  readonly runId?: string;
}
export interface GeometryProofPlanGoal {
  readonly claimId: string;
  readonly status: GeometryProofObligation['status'];
  readonly evidenceIds: readonly string[];
  readonly deductionId?: string;
  readonly diagnostic?: string;
}

export interface GeometryProofPlanAuxiliarySelection {
  readonly toolId: string;
  readonly status: 'selected' | 'input-not-ready' | 'not-advertised';
  readonly inputKinds: readonly string[];
  readonly outputKeys: readonly string[];
}

/**
 * Immutable, bounded bridge between one Agent observation and the semantic
 * proof state that the host actually inspected.  It contains no source edit
 * authority.  A write compiler may only use the associated observation after
 * independently checking its current GeometryDoc basis.
 */
export interface GeometryProofPlanArtifact {
  readonly schemaVersion: typeof GEOMETRY_PROOF_PLAN_SCHEMA_VERSION;
  readonly artifactId: string;
  readonly hashAlgorithm: 'fnv1a64-utf8';
  readonly owner: GeometryProofPlanOwner;
  readonly basis: GeometryProofState['basis'];
  readonly authoritativeForWrite: boolean;
  readonly goals: readonly GeometryProofPlanGoal[];
  readonly deductions: readonly GeometryProofDeduction[];
  readonly auxiliarySelections: readonly GeometryProofPlanAuxiliarySelection[];
  readonly completion: GeometryProofState['completion'];
  readonly semanticStatus: GeometryProofState['semanticStatus'];
}

export interface GeometryProofPlanOptions {
  readonly observationCallId: string;
  readonly runId?: string;
  readonly requestedAuxiliaryToolIds?: readonly string[];
  readonly authoritativeForWrite?: boolean;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function buildGeometryProofPlanArtifact(
  proofState: GeometryProofState,
  options: GeometryProofPlanOptions,
): GeometryProofPlanArtifact {
  const deductionByClaimId = new Map(proofState.deductions.map((deduction) => (
    [deduction.conclusionClaimId, deduction] as const
  )));
  const goals: GeometryProofPlanGoal[] = proofState.obligations.map((obligation) => {
    const deduction = deductionByClaimId.get(obligation.claimId);
    return {
      claimId: obligation.claimId,
      status: obligation.status,
      evidenceIds: obligation.evidenceIds,
      ...(deduction ? { deductionId: deduction.deductionId } : {}),
      ...(obligation.diagnostic ? { diagnostic: obligation.diagnostic } : {}),
    };
  });
  const candidates = new Map(proofState.auxiliaryCandidates.map((candidate) => (
    [candidate.toolId, candidate] as const
  )));
  const requested = [...new Set(options.requestedAuxiliaryToolIds ?? [])].slice(0, 16);
  const auxiliarySelections: GeometryProofPlanAuxiliarySelection[] = requested.map((toolId) => {
    const candidate = candidates.get(toolId);
    if (!candidate) {
      return {
        toolId,
        status: 'not-advertised',
        inputKinds: [],
        outputKeys: [],
      };
    }
    return {
      toolId,
      status: candidate.currentInputReady ? 'selected' : 'input-not-ready',
      inputKinds: candidate.inputKinds,
      outputKeys: candidate.outputKeys,
    };
  });
  const owner: GeometryProofPlanOwner = {
    observationCallId: options.observationCallId,
    ...(options.runId ? { runId: options.runId } : {}),
  };
  const core = {
    owner,
    basis: proofState.basis,
    authoritativeForWrite: options.authoritativeForWrite ?? true,
    goals,
    deductions: proofState.deductions,
    auxiliarySelections,
    completion: proofState.completion,
    semanticStatus: proofState.semanticStatus,
  };
  return {
    schemaVersion: GEOMETRY_PROOF_PLAN_SCHEMA_VERSION,
    artifactId: `proof-plan:${hashSource(canonicalJson(core))}`,
    hashAlgorithm: 'fnv1a64-utf8',
    ...core,
  };
}
