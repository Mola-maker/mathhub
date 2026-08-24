import { describe, expect, it } from 'vitest';
import type { GeometryAiContext } from '../ir/ai-context';
import type { GeometryProofState } from '../semantics/geometry-proof-state';
import { buildGeometryProofPlanArtifact } from '../semantics/geometry-proof-plan';
import {
  isGeometryIntent,
  lowerGeometryIntent,
  type GeometryIntent,
  type GeometryIntentProofObservation,
} from './geometry-intent';

function context(): GeometryAiContext {
  const entityIds = ['point:A', 'point:B', 'point:C', 'point:N', 'circle:nine'];
  const sourceBinding = (
    id: string,
    entityId: string,
    extra: Partial<GeometryAiContext['construction']['sourceBindings'][number]> = {},
  ): GeometryAiContext['construction']['sourceBindings'][number] => ({
    id,
    role: 'test',
    sourceId: 'document-1:tikz',
    targets: [{ recordType: 'entity', id: entityId }],
    range: { start: 0, end: 1 },
    writable: true,
    opaque: false,
    insertionPolicy: 'none',
    writeCapabilities: [],
    entityIds: [entityId],
    renderTargets: [],
    ...extra,
  });
  const bindings: GeometryAiContext['construction']['sourceBindings'] = [
    sourceBinding('binding:point:A', 'point:A'),
    sourceBinding('binding:point:B', 'point:B'),
    sourceBinding('binding:point:C', 'point:C'),
    sourceBinding('binding:managed:nine:center', 'point:N', {
      managedConstructionId: 'nine-1',
      managedSourceRecordId: 'center',
    }),
    sourceBinding('binding:managed:nine:circle', 'circle:nine', {
      writable: false,
      managedConstructionId: 'nine-1',
      managedSourceRecordId: 'circle',
      writeCapabilities: ['update-managed-presentation'],
      managedPresentationTargets: [{
        entityId: 'circle:nine',
        slotId: 'nine-point-circle-render',
        role: 'nine-point-circle-render',
      }],
    }),
    {
      id: 'binding:document:tikzpicture-body-end',
      role: 'insertion',
      sourceId: 'document-1:tikz',
      targets: [],
      range: { start: 1, end: 1 },
      writable: true,
      opaque: false,
      insertionPolicy: 'tikzpicture-body',
      writeCapabilities: ['create-managed-construction'],
      createCapabilityFingerprint: 'create-fingerprint',
      entityIds: [],
      renderTargets: [],
    },
  ];
  return {
    schemaVersion: 'geometry-ai-context/v1',
    basis: {
      documentId: 'document-1',
      epoch: 'epoch-1',
      revision: 7,
      sourceId: 'document-1:tikz',
      sourceHash: 'source-hash',
      hashAlgorithm: 'fnv1a64-utf8',
      kernelHash: 'kernel-hash',
      projectionHash: 'projection-hash',
      pluginSetDigest: 'plugin-digest',
    },
    projection: {
      status: 'complete',
      semanticCoverage: 1,
      exactSourcePreserved: true,
      exactRenderingIsAuthoritative: true,
    },
    entities: [
      { id: 'point:A', kind: 'point', name: 'A', parameters: { x: 0, y: 0 } },
      { id: 'point:B', kind: 'point', name: 'B', parameters: { x: 4, y: 0 } },
      { id: 'point:C', kind: 'point', name: 'C', parameters: { x: 1, y: 3 } },
      { id: 'point:N', kind: 'point', name: 'N', parameters: { x: 1.5, y: 1 } },
      { id: 'circle:nine', kind: 'circle', name: 'omega9' },
    ],
    constraints: [],
    relations: [],
    styles: [],
    focus: {
      requestedRefs: ['A', 'B', 'C', 'N', 'omega9'],
      resolvedEntityIds: entityIds,
      closureEntityIds: entityIds,
      unresolvedRefs: [],
      depth: 2,
      truncated: false,
    },
    construction: {
      constructionCatalogDigest: 'catalog-digest',
      authorizationScopeFingerprint: 'scope-fingerprint',
      intentTools: [
        {
          toolId: 'midpoint',
          category: 'constraint',
          inputKinds: ['point', 'point'],
          minInputs: 2,
          maxInputs: 2,
          requestedNameKeys: ['midpoint'],
          parameterSchema: 'none',
          currentInputReady: true,
          outputSlots: [
            { key: 'midpoint', produces: 'point', roles: ['midpoint'] },
          ],
        },
        {
          toolId: 'circumcircle',
          category: 'constraint',
          inputKinds: ['point', 'point', 'point'],
          minInputs: 3,
          maxInputs: 3,
          requestedNameKeys: ['center'],
          parameterSchema: 'none',
          currentInputReady: true,
          outputSlots: [
            { key: 'center', produces: 'point', roles: ['circumcenter'] },
            { key: 'circle', produces: 'circle', roles: ['circumcircle'] },
          ],
        },
        {
          toolId: 'nine-point-circle',
          category: 'olympiad',
          inputKinds: ['point', 'point', 'point'],
          minInputs: 3,
          maxInputs: 3,
          requestedNameKeys: [
            'midpointBC',
            'midpointCA',
            'midpointAB',
            'footA',
            'footB',
            'footC',
            'orthocenter',
            'vertexMidpointA',
            'vertexMidpointB',
            'vertexMidpointC',
            'center',
          ],
          parameterSchema: 'none',
          currentInputReady: true,
          outputSlots: [
            { key: 'center', produces: 'point', roles: ['nine-point-center'] },
            { key: 'circle', produces: 'circle', roles: ['nine-point-circle'] },
          ],
        },
        {
          toolId: 'label',
          category: 'primitive',
          inputKinds: ['point'],
          minInputs: 1,
          maxInputs: 1,
          requestedNameKeys: [],
          parameterSchema: 'label-text',
          currentInputReady: true,
          outputSlots: [],
        },
      ],
      sourceMapSchemaVersion: 'geometry-source-map/v1',
      authorizedBindingIds: bindings.map((binding) => binding.id),
      sourceBindings: bindings,
      opaqueNodes: [],
      managedConstructions: [],
    },
    protocol: {
      writeMode: 'revision-hash-bound-transaction',
      opaquePolicy: 'preserve-never-invent-semantics',
      staleWritePolicy: 'reject',
    },
    truncation: { truncated: false, omitted: {} },
  };
}

function proofObservation(
  status: 'unresolved' | 'numerically-satisfied' | 'counterexample' = 'unresolved',
): GeometryIntentProofObservation {
  const proofState: GeometryProofState = {
    schemaVersion: 'geometry-proof-state/v1',
    basis: {
      documentId: 'document-1',
      epoch: 'epoch-1',
      revision: 7,
      sourceId: 'document-1:tikz',
      sourceHash: 'source-hash',
      kernelHash: 'kernel-hash',
      projectionHash: 'projection-hash',
      pluginSetDigest: 'plugin-digest',
    },
    focusEntityIds: ['point:A', 'point:B', 'point:C'],
    facts: [],
    obligations: [{
      claimId: 'goal-concyclic',
      kind: 'concyclic',
      entityIds: ['point:A', 'point:B', 'point:C', 'point:N'],
      status,
      evidenceIds: [],
      tolerance: 1e-7,
    }],
    deductions: [],
    auxiliaryCandidates: [],
    completion: status === 'counterexample' ? 'contradicted' : 'open',
    semanticStatus: 'complete',
    truncated: false,
  };
  return {
    callId: 'proof-call-1',
    proofState,
    proofPlan: buildGeometryProofPlanArtifact(proofState, {
      observationCallId: 'proof-call-1',
      runId: 'run-1',
    }),
  };
}

describe('GeometryIntent/v2 host lowering', () => {
  it('lowers semantic construction refs without accepting model authority fields', () => {
    const intent: GeometryIntent = {
      schemaVersion: 'geometry-intent/v2',
      intentId: 'create-nine-point',
      operation: {
        kind: 'construct',
        toolId: 'nine-point-circle',
        inputRefs: ['A', 'B', 'C'],
        requestedNames: {},
        parameters: {},
      },
    };
    const lowered = lowerGeometryIntent(intent, context());
    expect(lowered).toMatchObject({
      ok: true,
      proposal: {
        schemaVersion: 'construction-intent/v1',
        bindingIds: ['binding:point:A', 'binding:point:B', 'binding:point:C'],
        capability: {
          bindingId: 'binding:document:tikzpicture-body-end',
          fingerprint: 'create-fingerprint',
          scopeFingerprint: 'scope-fingerprint',
        },
      },
    });
    expect(isGeometryIntent({ ...intent, basis: { revision: 7 } })).toBe(false);
  });

  it('requires and validates a same-run proof observation for proof-solving construction', () => {
    const intent: GeometryIntent = {
      schemaVersion: 'geometry-intent/v2',
      intentId: 'prove-with-nine-point',
      operation: {
        kind: 'construct',
        toolId: 'nine-point-circle',
        inputRefs: ['A', 'B', 'C'],
        requestedNames: {},
        parameters: {},
        proofContext: {
          role: 'auxiliary-construction',
          observationCallId: 'proof-call-1',
          obligationIds: ['goal-concyclic'],
        },
      },
    };
    expect(lowerGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'prove-without-proof-observation',
      operation: {
        kind: 'construct',
        toolId: 'nine-point-circle',
        inputRefs: ['A', 'B', 'C'],
        requestedNames: {},
        parameters: {},
      },
    }, context(), { requireProofObservation: true })).toMatchObject({
      ok: false,
      code: 'proof-observation-required',
    });
    expect(lowerGeometryIntent(intent, context(), {
      runId: 'run-1',
      requireProofObservation: true,
      proofObservations: [proofObservation()],
    })).toMatchObject({ ok: true, proposal: { toolId: 'nine-point-circle' } });
    expect(lowerGeometryIntent(intent, context(), {
      runId: 'run-1',
      requireProofObservation: true,
      proofObservations: [proofObservation('counterexample')],
    })).toMatchObject({ ok: false, code: 'proof-obligation-contradicted' });
    expect(lowerGeometryIntent(intent, context(), {
      runId: 'run-1',
      requireProofObservation: true,
      proofObservations: [{
        ...proofObservation(),
        proofState: {
          ...proofObservation().proofState,
          basis: { ...proofObservation().proofState.basis, revision: 6 },
        },
      }],
    })).toMatchObject({ ok: false, code: 'proof-observation-invalid' });
    expect(lowerGeometryIntent(intent, context(), {
      runId: 'run-2',
      requireProofObservation: true,
      proofObservations: [proofObservation()],
    })).toMatchObject({ ok: false, code: 'proof-observation-invalid' });
    expect(lowerGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'prove-with-absent-obligation',
      operation: {
        kind: 'construct',
        toolId: 'nine-point-circle',
        inputRefs: ['A', 'B', 'C'],
        requestedNames: {},
        parameters: {},
        proofContext: {
          role: 'auxiliary-construction',
          observationCallId: 'proof-call-1',
          obligationIds: ['absent-obligation'],
        },
      },
    }, context(), {
      runId: 'run-1',
      requireProofObservation: true,
      proofObservations: [proofObservation()],
    })).toMatchObject({ ok: false, code: 'proof-observation-invalid' });
  });

  it('rejects model-authored proof evidence and basis fields', () => {
    expect(isGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'forged-proof-context',
      operation: {
        kind: 'construct',
        toolId: 'nine-point-circle',
        inputRefs: ['A', 'B', 'C'],
        requestedNames: {},
        parameters: {},
        proofContext: {
          role: 'goal-construction',
          observationCallId: 'proof-call-1',
          obligationIds: ['goal-concyclic'],
          evidenceIds: ['constraint:forged'],
          revision: 7,
        },
      },
    })).toBe(false);
  });

  it('atomically lowers style plus label only when both targets share one managed owner', () => {
    const lowered = lowerGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'present-nine-point',
      operation: {
        kind: 'present',
        targetRef: 'omega9',
        style: { color: 'red', width: 'very thick' },
        label: { anchorRef: 'N', text: 'Nine-point circle' },
      },
    }, context());
    expect(lowered).toMatchObject({
      ok: true,
      proposal: {
        schemaVersion: 'host-semantic-action-batch/v1',
        styleIntent: {
          operation: { targetEntityId: 'circle:nine' },
        },
        labelIntent: {
          toolId: 'label',
          bindingIds: ['binding:managed:nine:center'],
          parameters: { text: 'Nine-point circle' },
        },
      },
    });
  });

  it('lowers a source-ordered Catalog DAG without exposing bindings or allocated names', () => {
    const lowered = lowerGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'midpoint-circle-dag',
      operation: {
        kind: 'construct-dag',
        steps: [
          {
            stepId: 'mid-ab',
            toolId: 'midpoint',
            inputs: [
              { kind: 'entity', ref: 'A' },
              { kind: 'entity', ref: 'B' },
            ],
            requestedNames: {},
            parameters: {},
          },
          {
            stepId: 'circle',
            toolId: 'circumcircle',
            inputs: [
              { kind: 'step-output', stepId: 'mid-ab', outputKey: 'midpoint' },
              { kind: 'entity', ref: 'B' },
              { kind: 'entity', ref: 'C' },
            ],
            requestedNames: {},
            parameters: {},
          },
        ],
      },
    }, context());
    expect(lowered).toMatchObject({
      ok: true,
      proposal: {
        schemaVersion: 'construction-dag-intent/v1',
        capability: {
          bindingId: 'binding:document:tikzpicture-body-end',
          fingerprint: 'create-fingerprint',
          scopeFingerprint: 'scope-fingerprint',
        },
        steps: [
          {
            stepId: 'mid-ab',
            inputs: [
              { kind: 'binding', bindingId: 'binding:point:A' },
              { kind: 'binding', bindingId: 'binding:point:B' },
            ],
          },
          {
            stepId: 'circle',
            inputs: [
              { kind: 'step-output', stepId: 'mid-ab', outputKey: 'midpoint' },
              { kind: 'binding', bindingId: 'binding:point:B' },
              { kind: 'binding', bindingId: 'binding:point:C' },
            ],
          },
        ],
      },
    });
  });

  it('preserves only advertised step-local requested names while lowering a DAG', () => {
    const lowered = lowerGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'named-midpoint-circle-dag',
      operation: {
        kind: 'construct-dag',
        steps: [
          {
            stepId: 'mid-ab',
            toolId: 'midpoint',
            inputs: [
              { kind: 'entity', ref: 'A' },
              { kind: 'entity', ref: 'B' },
            ],
            requestedNames: { midpoint: 'Mcustom' },
            parameters: {},
          },
          {
            stepId: 'circle',
            toolId: 'circumcircle',
            inputs: [
              { kind: 'step-output', stepId: 'mid-ab', outputKey: 'midpoint' },
              { kind: 'entity', ref: 'B' },
              { kind: 'entity', ref: 'C' },
            ],
            requestedNames: { center: 'Ocustom' },
            parameters: {},
          },
        ],
      },
    }, context());
    expect(lowered).toMatchObject({
      ok: true,
      proposal: {
        steps: [
          { stepId: 'mid-ab', requestedNames: { midpoint: 'Mcustom' } },
          { stepId: 'circle', requestedNames: { center: 'Ocustom' } },
        ],
      },
    });
  });

  it('rejects undeclared and cross-step duplicate requested names before authority lowering', () => {
    expect(lowerGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'undeclared-name-slot',
      operation: {
        kind: 'construct',
        toolId: 'circumcircle',
        inputRefs: ['A', 'B', 'C'],
        requestedNames: { circle: 'omega' },
        parameters: {},
      },
    }, context())).toMatchObject({ ok: false, code: 'input-mismatch' });

    expect(lowerGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'duplicate-dag-name',
      operation: {
        kind: 'construct-dag',
        steps: [
          {
            stepId: 'mid-ab',
            toolId: 'midpoint',
            inputs: [
              { kind: 'entity', ref: 'A' },
              { kind: 'entity', ref: 'B' },
            ],
            requestedNames: { midpoint: 'SharedName' },
            parameters: {},
          },
          {
            stepId: 'circle',
            toolId: 'circumcircle',
            inputs: [
              { kind: 'step-output', stepId: 'mid-ab', outputKey: 'midpoint' },
              { kind: 'entity', ref: 'B' },
              { kind: 'entity', ref: 'C' },
            ],
            requestedNames: { center: 'SharedName' },
            parameters: {},
          },
        ],
      },
    }, context())).toMatchObject({ ok: false, code: 'input-mismatch' });
  });

  it('rejects forward DAG references and output-kind mismatches before authority lowering', () => {
    const forward = {
      schemaVersion: 'geometry-intent/v2',
      intentId: 'forward-dag',
      operation: {
        kind: 'construct-dag',
        steps: [
          {
            stepId: 'circle',
            toolId: 'circumcircle',
            inputs: [
              { kind: 'step-output', stepId: 'future', outputKey: 'midpoint' },
              { kind: 'entity', ref: 'B' },
              { kind: 'entity', ref: 'C' },
            ],
            requestedNames: {},
            parameters: {},
          },
          {
            stepId: 'future',
            toolId: 'midpoint',
            inputs: [
              { kind: 'entity', ref: 'A' },
              { kind: 'entity', ref: 'B' },
            ],
            requestedNames: {},
            parameters: {},
          },
        ],
      },
    };
    expect(isGeometryIntent(forward)).toBe(false);
    expect(lowerGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'circle-as-point',
      operation: {
        kind: 'construct-dag',
        steps: [
          {
            stepId: 'circum',
            toolId: 'circumcircle',
            inputs: [
              { kind: 'entity', ref: 'A' },
              { kind: 'entity', ref: 'B' },
              { kind: 'entity', ref: 'C' },
            ],
            requestedNames: {},
            parameters: {},
          },
          {
            stepId: 'bad-midpoint',
            toolId: 'midpoint',
            inputs: [
              { kind: 'step-output', stepId: 'circum', outputKey: 'circle' },
              { kind: 'entity', ref: 'A' },
            ],
            requestedNames: {},
            parameters: {},
          },
        ],
      },
    }, context())).toMatchObject({ ok: false, code: 'input-mismatch' });
  });

  it('lowers semantic transform refs to one host-only current-basis intent', () => {
    const lowered = lowerGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'rotate-triangle-about-n',
      operation: {
        kind: 'transform',
        targetRefs: ['A', 'B', 'C'],
        transform: { kind: 'rotate', degrees: 30, centerRef: 'N' },
      },
    }, context());
    expect(lowered).toMatchObject({
      ok: true,
      proposal: {
        schemaVersion: 'ai-selection-transform-intent/v1',
        intentId: 'rotate-triangle-about-n',
        authorizationScopeFingerprint: 'scope-fingerprint',
        selectedEntityIds: ['point:A', 'point:B', 'point:C'],
        transform: {
          kind: 'rotate',
          degrees: 30,
          center: { x: 1.5, y: 1 },
        },
        basis: { revision: 7, sourceHash: 'source-hash' },
      },
    });
  });

  it('rejects a transform center without positioned point semantics', () => {
    expect(lowerGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'bad-transform-center',
      operation: {
        kind: 'transform',
        targetRefs: ['A'],
        transform: { kind: 'scale', factor: 2, centerRef: 'omega9' },
      },
    }, context())).toMatchObject({ ok: false, code: 'transform-invalid' });
  });

  it('lowers delete roots without accepting model-authored cascade authority', () => {
    const lowered = lowerGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'delete-nine-point-circle',
      operation: {
        kind: 'delete',
        targetRefs: ['omega9'],
      },
    }, context());
    expect(lowered).toMatchObject({
      ok: true,
      proposal: {
        schemaVersion: 'ai-semantic-delete-intent/v1',
        intentId: 'delete-nine-point-circle',
        selectedEntityIds: ['circle:nine'],
        mode: 'block',
        authorizationScopeFingerprint: 'scope-fingerprint',
        basis: { revision: 7, sourceHash: 'source-hash' },
      },
    });
    expect(isGeometryIntent({
      schemaVersion: 'geometry-intent/v2',
      intentId: 'forged-cascade-delete',
      operation: {
        kind: 'delete',
        targetRefs: ['omega9'],
        mode: 'cascade',
      },
    })).toBe(false);
  });

  it('fails closed on ambiguous names, out-of-scope refs and open fields', () => {
    const ambiguous = context();
    ambiguous.entities = [
      ...ambiguous.entities,
      { id: 'point:A2', kind: 'point', name: 'A' },
    ];
    ambiguous.focus.closureEntityIds = [...ambiguous.focus.closureEntityIds, 'point:A2'];
    const intent = {
      schemaVersion: 'geometry-intent/v2',
      intentId: 'ambiguous-nine-point',
      operation: {
        kind: 'construct',
        toolId: 'nine-point-circle',
        inputRefs: ['A', 'B', 'C'],
        requestedNames: {},
        parameters: {},
      },
    } as const;
    expect(lowerGeometryIntent(intent, ambiguous)).toMatchObject({
      ok: false,
      code: 'reference-ambiguous',
    });
    expect(lowerGeometryIntent({
      ...intent,
      intentId: 'outside-nine-point',
      operation: { ...intent.operation, inputRefs: ['Z', 'B', 'C'] },
    }, context())).toMatchObject({ ok: false, code: 'reference-unresolved' });
    expect(isGeometryIntent({ ...intent, unexpectedAuthority: true })).toBe(false);
  });
});
