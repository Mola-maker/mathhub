import { describe, expect, it } from 'vitest';
import type { GeometryDoc } from '../ir/geometry-doc';
import type { GeometryConstraint } from '../ir/model';
import { buildGeometryProofState } from './geometry-proof-state';

function proofDoc(
  midpointX: number,
  constraints: readonly GeometryConstraint[],
): GeometryDoc {
  return {
    basis: {
      documentId: 'proof-doc',
      epoch: 'epoch',
      revision: 3,
      sourceHash: 'source-hash',
      kernelHash: 'kernel-hash',
      projectionHash: 'projection-hash',
      pluginSetDigest: 'plugin-digest',
      sourceId: 'proof-source',
    },
    semantic: {
      status: 'complete',
      ir: {
        entities: [
          { recordType: 'entity', id: 'point:M', kind: 'point', parameters: { x: midpointX, y: 0 } },
          { recordType: 'entity', id: 'point:A', kind: 'point', parameters: { x: 0, y: 0 } },
          { recordType: 'entity', id: 'point:B', kind: 'point', parameters: { x: 2, y: 0 } },
        ],
        constraints,
        relations: [],
        styles: [],
        sourceBindings: [],
      },
    },
  } as unknown as GeometryDoc;
}

const midpointConstraint = (strength: GeometryConstraint['strength']): GeometryConstraint => ({
  recordType: 'constraint',
  id: 'constraint:midpoint',
  kind: 'midpoint',
  strength,
  arguments: [
    { role: 'point', entityId: 'point:M' },
    { role: 'a', entityId: 'point:A' },
    { role: 'b', entityId: 'point:B' },
  ],
});

function concyclicProofDoc(): GeometryDoc {
  const point = (id: string, x: number, y: number) => ({
    recordType: 'entity' as const,
    id,
    kind: 'point',
    parameters: { x, y },
  });
  const points = [
    point('point:A', 1, 0),
    point('point:B', 0, 1),
    point('point:C', -1, 0),
    point('point:D', 0, -1),
  ];
  return {
    basis: {
      documentId: 'circle-proof', epoch: 'epoch', revision: 1,
      sourceHash: 'circle-source', sourceId: 'circle-proof:tikz',
    },
    semantic: {
      status: 'complete',
      ir: {
        entities: [
          ...points,
          { recordType: 'entity', id: 'circle:omega', kind: 'circle' },
        ],
        constraints: points.map((entry) => ({
          recordType: 'constraint' as const,
          id: `on-circle:${entry.id}`,
          kind: 'on-circle',
          strength: 'required' as const,
          arguments: [
            { role: 'point', entityId: entry.id },
            { role: 'circle', entityId: 'circle:omega' },
          ],
        })),
        relations: [], styles: [], sourceBindings: [],
      },
    },
  } as unknown as GeometryDoc;
}

describe('GeometryProofState/v1', () => {
  it('requires required semantic evidence before declaring a formal proof', () => {
    const state = buildGeometryProofState(
      proofDoc(1, [midpointConstraint('required')]),
      {
        allowedEntityIds: ['point:M', 'point:A', 'point:B'],
        claims: [{
          claimId: 'goal',
          kind: 'midpoint',
          entityIds: ['point:M', 'point:A', 'point:B'],
        }],
      },
    );

    expect(state).toMatchObject({
      schemaVersion: 'geometry-proof-state/v1',
      completion: 'formal-proof-complete',
      obligations: [{
        claimId: 'goal',
        status: 'formally-proven',
        evidenceIds: ['constraint:midpoint'],
        residual: 0,
      }],
    });
  });

  it('keeps a coordinate coincidence numerical when evidence is not required', () => {
    const state = buildGeometryProofState(
      proofDoc(1, [midpointConstraint('weak')]),
      {
        allowedEntityIds: ['point:M', 'point:A', 'point:B'],
        claims: [{
          claimId: 'goal',
          kind: 'midpoint',
          entityIds: ['point:M', 'point:A', 'point:B'],
        }],
      },
    );

    expect(state).toMatchObject({
      completion: 'open',
      obligations: [{ status: 'numerically-satisfied', evidenceIds: [] }],
    });
  });

  it('reports semantic and evaluated geometry disagreement as inconsistent', () => {
    const state = buildGeometryProofState(
      proofDoc(1.5, [midpointConstraint('required')]),
      {
        allowedEntityIds: ['point:M', 'point:A', 'point:B'],
        claims: [{
          claimId: 'goal',
          kind: 'midpoint',
          entityIds: ['point:M', 'point:A', 'point:B'],
          tolerance: 1e-9,
        }],
      },
    );

    expect(state).toMatchObject({
      completion: 'contradicted',
      obligations: [{ status: 'inconsistent' }],
    });
  });

  it('derives formal concyclicity from required on-circle witnesses', () => {
    const state = buildGeometryProofState(concyclicProofDoc(), {
      allowedEntityIds: [
        'point:A', 'point:B', 'point:C', 'point:D', 'circle:omega',
      ],
      claims: [{
        claimId: 'goal-circle',
        kind: 'concyclic',
        entityIds: ['point:A', 'point:B', 'point:C', 'point:D'],
      }],
    });

    expect(state).toMatchObject({
      completion: 'formal-proof-complete',
      obligations: [{
        status: 'formally-proven',
        evidenceIds: [
          'on-circle:point:A',
          'on-circle:point:B',
          'on-circle:point:C',
          'on-circle:point:D',
        ],
      }],
    });
  });

  it('records theorem-specific deductions instead of upgrading numeric geometry', () => {
    const state = buildGeometryProofState(
      proofDoc(1, [midpointConstraint('required')]),
      {
        allowedEntityIds: ['point:M', 'point:A', 'point:B'],
        claims: [{
          claimId: 'midpoint-collinear',
          kind: 'collinear',
          entityIds: ['point:A', 'point:M', 'point:B'],
        }],
      },
    );

    expect(state).toMatchObject({
      completion: 'formal-proof-complete',
      obligations: [{
        claimId: 'midpoint-collinear',
        status: 'formally-proven',
        method: 'midpoint-implies-collinear',
        numericMethod: 'normalized-cross-product',
      }],
      deductions: [{
        rule: 'midpoint-implies-collinear',
        premiseEvidenceIds: ['constraint:midpoint'],
        conclusionClaimId: 'midpoint-collinear',
        status: 'validated',
      }],
    });
  });

  it('derives perpendicularity from the roles of a required foot construction', () => {
    const doc = proofDoc(1, []) as GeometryDoc;
    const entities = [
      { recordType: 'entity' as const, id: 'point:P', kind: 'point', parameters: { x: 1, y: 2 } },
      { recordType: 'entity' as const, id: 'point:H', kind: 'point', parameters: { x: 1, y: 0 } },
      { recordType: 'entity' as const, id: 'point:A', kind: 'point', parameters: { x: 0, y: 0 } },
      { recordType: 'entity' as const, id: 'point:B', kind: 'point', parameters: { x: 2, y: 0 } },
    ];
    const foot: GeometryConstraint = {
      recordType: 'constraint',
      id: 'constraint:foot:H',
      kind: 'perpendicular-foot',
      strength: 'required',
      arguments: [
        { role: 'point', entityId: 'point:P' },
        { role: 'reference-start', entityId: 'point:A' },
        { role: 'reference-end', entityId: 'point:B' },
        { role: 'result', entityId: 'point:H' },
      ],
    };
    const footDoc = {
      ...doc,
      semantic: {
        ...doc.semantic,
        ir: { ...doc.semantic.ir, entities, constraints: [foot] },
      },
    } as GeometryDoc;

    const state = buildGeometryProofState(footDoc, {
      allowedEntityIds: entities.map((entity) => entity.id),
      claims: [{
        claimId: 'altitude-is-perpendicular',
        kind: 'perpendicular',
        entityIds: ['point:P', 'point:H', 'point:A', 'point:B'],
      }],
    });

    expect(state).toMatchObject({
      completion: 'formal-proof-complete',
      obligations: [{
        status: 'formally-proven',
        method: 'perpendicular-foot-implies-perpendicular',
        residual: 0,
      }],
      deductions: [{
        rule: 'perpendicular-foot-implies-perpendicular',
        premiseEvidenceIds: ['constraint:foot:H'],
      }],
    });
  });

  it('rejects a claim that escapes the host-attested entity scope', () => {
    expect(() => buildGeometryProofState(
      proofDoc(1, []),
      {
        allowedEntityIds: ['point:M', 'point:A'],
        claims: [{
          claimId: 'goal',
          kind: 'midpoint',
          entityIds: ['point:M', 'point:A', 'point:B'],
        }],
      },
    )).toThrow(/semantic scope/u);
  });

  it('rejects non-point records even when their IDs are inside the read scope', () => {
    expect(() => buildGeometryProofState(concyclicProofDoc(), {
      allowedEntityIds: ['point:A', 'point:B', 'point:C', 'circle:omega'],
      claims: [{
        claimId: 'invalid-point-claim',
        kind: 'concyclic',
        entityIds: ['point:A', 'point:B', 'point:C', 'circle:omega'],
      }],
    })).toThrow(/semantic scope/u);
  });
});
