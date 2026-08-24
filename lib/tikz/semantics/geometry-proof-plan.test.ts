import { describe, expect, it } from 'vitest';
import type { GeometryProofState } from './geometry-proof-state';
import { buildGeometryProofPlanArtifact } from './geometry-proof-plan';

function proofState(): GeometryProofState {
  return {
    schemaVersion: 'geometry-proof-state/v1',
    basis: {
      documentId: 'doc', epoch: 'epoch', revision: 9, sourceId: 'doc:tikz', sourceHash: 'source',
      kernelHash: 'kernel', projectionHash: 'projection', pluginSetDigest: 'plugins',
    },
    focusEntityIds: ['point:A', 'point:B', 'point:M'],
    facts: [],
    obligations: [{
      claimId: 'goal', kind: 'midpoint', entityIds: ['point:M', 'point:A', 'point:B'],
      status: 'unresolved', evidenceIds: [], tolerance: 1e-7,
    }],
    deductions: [],
    auxiliaryCandidates: [{
      toolId: 'midpoint', currentInputReady: true,
      inputKinds: ['point', 'point'], outputKeys: ['midpoint'],
    }, {
      toolId: 'circumcircle', currentInputReady: false,
      inputKinds: ['point', 'point', 'point'], outputKeys: ['center', 'circle'],
    }],
    completion: 'open',
    semanticStatus: 'complete',
    truncated: false,
  };
}

describe('GeometryProofPlan/v1', () => {
  it('binds one deterministic plan to run, call and immutable GeometryDoc basis', () => {
    const first = buildGeometryProofPlanArtifact(proofState(), {
      observationCallId: 'proof-call',
      runId: 'run-7',
      requestedAuxiliaryToolIds: ['midpoint', 'circumcircle', 'unknown'],
    });
    const second = buildGeometryProofPlanArtifact(proofState(), {
      observationCallId: 'proof-call',
      runId: 'run-7',
      requestedAuxiliaryToolIds: ['midpoint', 'circumcircle', 'unknown'],
    });

    expect(second.artifactId).toBe(first.artifactId);
    expect(first).toMatchObject({
      schemaVersion: 'geometry-proof-plan/v1',
      owner: { observationCallId: 'proof-call', runId: 'run-7' },
      authoritativeForWrite: true,
      basis: { revision: 9, sourceHash: 'source', kernelHash: 'kernel' },
      goals: [{ claimId: 'goal', status: 'unresolved' }],
      auxiliarySelections: [
        { toolId: 'midpoint', status: 'selected' },
        { toolId: 'circumcircle', status: 'input-not-ready' },
        { toolId: 'unknown', status: 'not-advertised' },
      ],
    });
  });

  it('marks simulated plans as observations without write authority', () => {
    expect(buildGeometryProofPlanArtifact(proofState(), {
      observationCallId: 'simulation-call',
      runId: 'run-7',
      authoritativeForWrite: false,
    }).authoritativeForWrite).toBe(false);
  });
});
