import { describe, expect, it, vi } from 'vitest';
import { tikzAgentEvent } from '../agent/protocol';
import {
  CONSTRUCTION_CATALOG_DIGEST,
  createPrimitiveConstructionPlan,
} from '../authoring/construction-catalog';
import type { ConstructionIntent } from '../authoring/construction-intent';
import type { ConstructionDagIntent } from '../authoring/construction-dag-intent';
import { planSelectionTransform } from '../authoring/selection-transform';
import { hashSource } from '../document/source-hash';
import { compileCanvasConstructionBatchProposal } from '../ir/canvas-construction-batch-proposal';
import { compileAiConstructionDagIntent } from '../ir/ai-construction-dag-intent';
import { compileCanvasSelectionTransformProposal } from '../ir/canvas-selection-transform-proposal';
import { compileInspectorDirectProposal } from '../ir/inspector-direct-proposal';
import { buildGeometryAiContext } from '../ir/ai-context';
import type { AiManagedPresentationIntent } from '../ir/ai-managed-presentation-intent';
import type { AiPatchBindingContext } from '../ir/ai-patch-proposal';
import { compileHostSemanticActionSet } from '../ir/host-semantic-action-set';
import type { GeometryTransactionRequest } from '../ir/transactions';
import { attestAiTransaction } from '../transactions/transaction-attestation';
import {
  GEOMETRY_EVALUATION_CORPUS,
  GEOMETRY_EVALUATION_CORPUS_SCHEMA_VERSION,
  type GeometryEvaluationCase,
  type GeometryEvaluationTurn,
} from './evaluation-corpus';
import {
  GEOMETRY_EVALUATION_EXACT_COMPILER_SCHEMA_VERSION,
  GEOMETRY_EVALUATION_RENDER_ARTIFACT_SCHEMA_VERSION,
  runGeometryEvaluationCase,
  type GeometryEvaluationAdapter,
  type GeometryEvaluationSnapshot,
} from './evaluation-runner';
import { createLocalGeometryEvaluationAdapter } from './local-evaluation-adapter';

const initialSource = [
  '\\begin{tikzpicture}',
  '\\coordinate (A) at (0,0);',
  '\\coordinate (B) at (2,0);',
  '\\draw (A) -- (B);',
  '\\end{tikzpicture}',
  '',
].join('\n');

const sourceReference = {
  disposition: 'research-reference-only' as const,
  source: 'mathnet' as const,
  recordId: 'mathnet:test-local',
  sourceUrl: 'https://mathnet.mit.edu/',
  admission: 'not-admitted' as const,
  attributionMode: 'gateway-record' as const,
};

function evaluationCase(
  turns: readonly GeometryEvaluationTurn[],
  profile = 'all-lanes',
): GeometryEvaluationCase {
  return {
    schemaVersion: GEOMETRY_EVALUATION_CORPUS_SCHEMA_VERSION,
    caseId: `local-real-transaction-chain:${profile}`,
    title: 'Local real transaction chain',
    source: sourceReference,
    localFixture: {
      fixturePath: 'evaluation/simple-segment',
      expectationProfile: profile,
      authorship: 'independently-authored',
      sourceSha256: '0a8c9750ee69f072328e69d1c0b2a8428290d25d3966c1b125a9543a16e323f4',
      expectationsSha256: '2834e22cdc0f635392d9336d5c3a3c33a2efad7a72ebda809bc53064ecc68052',
    },
    turns,
  };
}

const allLaneCase = evaluationCase([
  {
    lane: 'answer-only',
    instruction: 'Explain AB without editing.',
    expectedCapabilities: ['semantic-read'],
    invariants: [
      { kind: 'source-unchanged' },
      { kind: 'agent-terminal', outcome: 'answer', requiredEventTypes: ['context.read'] },
      { kind: 'grounding-resolves', minimumRefs: 2, recordTypes: ['entity'] },
    ],
  },
  {
    lane: 'construct',
    instruction: 'Create point C.',
    expectedCapabilities: ['atomic-construction'],
    invariants: [
      { kind: 'single-broker-commit' },
      { kind: 'proposal-schema', allowed: ['canvas-construction-batch-proposal/v1'] },
      { kind: 'semantic-entity-delta', minimum: 1 },
      { kind: 'post-commit-basis-current' },
    ],
  },
  {
    lane: 'modify-existing',
    instruction: 'Style AB green and thick.',
    expectedCapabilities: ['binding-scoped-style'],
    invariants: [
      { kind: 'single-broker-commit' },
      { kind: 'proposal-schema', allowed: ['inspector-direct-proposal/v1'] },
      { kind: 'binding-scoped-write' },
      { kind: 'semantic-style-changed' },
    ],
  },
  {
    lane: 'transform-selection',
    instruction: 'Translate AB.',
    expectedCapabilities: ['dependency-preserving-transform'],
    invariants: [
      { kind: 'single-broker-commit' },
      { kind: 'proposal-schema', allowed: ['canvas-selection-transform-proposal/v1'] },
      { kind: 'selection-transform-attested' },
      { kind: 'geometry-position-changed' },
      { kind: 'semantic-relations-preserved' },
      { kind: 'external-impact-acknowledged' },
    ],
  },
  {
    lane: 'verify-rendering',
    instruction: 'Capture both render lanes.',
    expectedCapabilities: ['interactive-render', 'exact-render'],
    invariants: [
      { kind: 'source-unchanged' },
      { kind: 'render-artifacts-attested', lanes: ['interactive', 'exact'] },
      { kind: 'render-read-only' },
    ],
  },
]);

function abEntity(snapshot: GeometryEvaluationSnapshot) {
  const entity = snapshot.geometryDoc.semantic.ir.entities.find((candidate) => (
    candidate.kind === 'polyline'
    && Array.isArray(candidate.parameters?.references)
    && candidate.parameters.references.includes('A')
    && candidate.parameters.references.includes('B')
  ));
  if (!entity) throw new TypeError('AB polyline is missing from the local fixture.');
  return entity;
}

function realLocalAdapter() {
  return createLocalGeometryEvaluationAdapter({
    capabilities: [
      'semantic-read',
      'atomic-construction',
      'binding-scoped-style',
      'dependency-preserving-transform',
      'interactive-render',
      'exact-render',
    ],
    answer: ({ snapshot }) => ({
      text: 'AB is determined by A and B.',
      groundingRefs: snapshot.geometryDoc.semantic.ir.entities
        .filter((entity) => entity.kind === 'point')
        .slice(0, 2)
        .map((entity) => entity.id),
    }),
    mutations: {
      construct: ({ snapshot }) => {
        const pointC = createPrimitiveConstructionPlan('point', {
          anchors: [{ name: 'C', position: { x: 1, y: 1 }, existing: false }],
          nextName: (prefix) => `${prefix}1`,
          nextConstructionId: () => 'evaluation-point-c',
        });
        return compileCanvasConstructionBatchProposal({
          source: snapshot.source,
          geometryDoc: snapshot.geometryDoc,
          plans: [pointC],
          primaryConstructionId: pointC.id,
        }).transaction;
      },
      'modify-existing': ({ snapshot }) => {
        const entity = abEntity(snapshot);
        const insertAt = snapshot.source.indexOf('\\draw') + '\\draw'.length;
        return compileInspectorDirectProposal({
          source: snapshot.source,
          geometryDoc: snapshot.geometryDoc,
          semanticEntityId: entity.id,
          bindingIds: entity.sourceBindingIds ?? [],
          patch: { from: insertAt, to: insertAt, insert: '[green,thick]' },
          propertyKind: 'style',
        }).transaction;
      },
      'transform-selection': ({ snapshot }) => {
        const entity = abEntity(snapshot);
        const transform = { kind: 'translate' as const, dx: 1, dy: 2 };
        const plan = planSelectionTransform(
          snapshot.source,
          snapshot.geometryDoc,
          [entity.id],
          transform,
        );
        return compileCanvasSelectionTransformProposal({
          source: snapshot.source,
          geometryDoc: snapshot.geometryDoc,
          selectedEntityIds: [entity.id],
          transform,
          acknowledgedExternalImpactedEntityIds: plan.externalImpactedEntityIds,
        }).transaction;
      },
    },
    render: ({ snapshot }) => [
      {
        lane: 'interactive',
        rendererId: 'test-interactive-svg-capture',
        mediaType: 'image/svg+xml',
        artifact: `<svg data-source="${snapshot.manifest.sourceHash}"/>`,
      },
      {
        lane: 'exact',
        rendererId: 'test-exact-artifact-capture',
        mediaType: 'application/pdf',
        artifact: `%PDF-test-capture:${snapshot.manifest.sourceHash}`,
        exactCompiler: {
          jobId: 'test-compiler-job-1',
          compilerId: 'test-double-tex-service',
          compilerProfileDigest: 'test-profile-digest',
        },
      },
    ],
  });
}

function evaluationAiBindings(
  snapshot: GeometryEvaluationSnapshot,
  context: ReturnType<typeof buildGeometryAiContext>,
): AiPatchBindingContext[] {
  return context.construction.sourceBindings.map((binding) => ({
    bindingId: binding.id,
    sourceId: binding.sourceId,
    range: binding.range,
    writable: binding.writable,
    opaque: false,
    insertionPolicy: binding.insertionPolicy,
    writeCapabilities: binding.writeCapabilities,
    sliceHash: snapshot.geometryDoc.construction.bindings.find((candidate) => (
      candidate.id === binding.id
    ))?.source.sliceHash,
    ...(binding.createCapabilityFingerprint
      ? { createCapabilityFingerprint: binding.createCapabilityFingerprint }
      : {}),
    ...(binding.managedConstructionId
      ? { managedConstructionId: binding.managedConstructionId }
      : {}),
  }));
}

function mathNetNinePointAdapter(onFinalSource: (source: string) => void) {
  return createLocalGeometryEvaluationAdapter({
    capabilities: [
      'semantic-read',
      'atomic-construction',
      'binding-scoped-style',
      'label-intent',
      'interactive-render',
      'exact-render',
    ],
    answer: ({ snapshot }) => ({
      text: '三条高交于垂心 H，N 是 O 与 H 的中点，九点圆经过三边中点与三个垂足。',
      groundingRefs: [
        ...snapshot.geometryDoc.semantic.ir.entities.map((entity) => entity.id),
        ...snapshot.geometryDoc.semantic.ir.constraints.map((constraint) => constraint.id),
        ...snapshot.geometryDoc.semantic.ir.relations.map((relation) => relation.id),
      ].slice(0, 8),
    }),
    mutations: {
      construct: ({ snapshot }) => {
        const context = buildGeometryAiContext(snapshot.geometryDoc, {
          focusRefs: snapshot.geometryDoc.semantic.ir.entities.map((entity) => entity.id),
          focusDepth: 4,
        });
        const insertion = context.construction.sourceBindings.find((binding) => (
          binding.id === 'binding:document:tikzpicture-body-end'
          && binding.createCapabilityFingerprint
        ));
        const pointBinding = (name: string): string => {
          const entity = snapshot.geometryDoc.semantic.ir.entities.find((candidate) => (
            candidate.kind === 'point' && candidate.name === name
          ));
          const bindings = entity ? context.construction.sourceBindings.filter((binding) => (
            binding.id !== insertion?.id && binding.entityIds.includes(entity.id)
          )) : [];
          if (bindings.length !== 1) {
            throw new TypeError(`MathNet DAG point ${name} has no unique source binding.`);
          }
          return bindings[0]!.id;
        };
        if (!insertion?.createCapabilityFingerprint) {
          throw new TypeError('MathNet DAG has no current create capability.');
        }
        const bindings = Object.fromEntries(
          ['A', 'D', 'E', 'F', 'H', 'N'].map((name) => [name, pointBinding(name)]),
        ) as Readonly<Record<'A' | 'D' | 'E' | 'F' | 'H' | 'N', string>>;
        const basis = context.basis;
        const intent: ConstructionDagIntent = {
          schemaVersion: 'construction-dag-intent/v1',
          intentId: 'mathnet-nine-point-cyclic-dag',
          idempotencyKey: 'mathnet-nine-point-cyclic-dag',
          basis: {
            ...basis,
            hashAlgorithm: 'fnv1a64-utf8',
            kernelHash: basis.kernelHash!,
            projectionHash: basis.projectionHash!,
            pluginSetDigest: basis.pluginSetDigest!,
            constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
          },
          capability: {
            bindingId: insertion.id,
            fingerprint: insertion.createCapabilityFingerprint,
            scopeFingerprint: context.construction.authorizationScopeFingerprint,
          },
          steps: [
            {
              stepId: 'bisect-ef',
              toolId: 'perpendicular-bisector',
              inputs: [
                { kind: 'binding', bindingId: bindings.E },
                { kind: 'binding', bindingId: bindings.F },
              ],
              requestedNames: {},
              parameters: {},
            },
            {
              stepId: 'bisect-hd',
              toolId: 'perpendicular-bisector',
              inputs: [
                { kind: 'binding', bindingId: bindings.H },
                { kind: 'binding', bindingId: bindings.D },
              ],
              requestedNames: {},
              parameters: {},
            },
            {
              stepId: 'bisector-intersection',
              toolId: 'complete-quadrilateral',
              inputs: [
                { kind: 'step-output', stepId: 'bisect-ef', outputKey: 'midpoint' },
                { kind: 'step-output', stepId: 'bisect-ef', outputKey: 'direction-point' },
                { kind: 'step-output', stepId: 'bisect-hd', outputKey: 'midpoint' },
                { kind: 'step-output', stepId: 'bisect-hd', outputKey: 'direction-point' },
              ],
              requestedNames: { intersection1: 'P' },
              parameters: {},
            },
            {
              stepId: 'and-circumcircle',
              toolId: 'circumcircle',
              inputs: [
                { kind: 'binding', bindingId: bindings.A },
                { kind: 'binding', bindingId: bindings.N },
                { kind: 'binding', bindingId: bindings.D },
              ],
              requestedNames: {},
              parameters: {},
            },
            {
              stepId: 'circle-point-l',
              toolId: 'point-on-circle',
              inputs: [{
                kind: 'step-output',
                stepId: 'and-circumcircle',
                outputKey: 'circle',
              }],
              requestedNames: { point: 'L' },
              parameters: { angleDegrees: 35 },
            },
            {
              stepId: 'polygon-andl',
              toolId: 'polygon',
              inputs: [
                { kind: 'binding', bindingId: bindings.A },
                { kind: 'binding', bindingId: bindings.N },
                { kind: 'binding', bindingId: bindings.D },
                { kind: 'step-output', stepId: 'circle-point-l', outputKey: 'point' },
              ],
              requestedNames: {},
              parameters: {},
            },
          ],
        };
        const compiled = compileAiConstructionDagIntent(intent, {
          basis,
          bindings: evaluationAiBindings(snapshot, context),
          allowedBindingIds: context.construction.authorizedBindingIds,
          source: snapshot.source,
          geometryDoc: snapshot.geometryDoc,
        });
        if (!compiled.ok) throw new TypeError(JSON.stringify(compiled.errors));
        return compiled.transaction;
      },
      'modify-existing': ({ snapshot }) => {
        const points = ['P', 'L', 'N'].map((name) => {
          const entity = snapshot.geometryDoc.semantic.ir.entities.find((candidate) => (
            candidate.kind === 'point' && candidate.name === name
          ));
          if (!entity) throw new TypeError(`MathNet follow-up point ${name} is unavailable.`);
          return entity;
        });
        const polygon = snapshot.geometryDoc.semantic.ir.entities.find((entity) => (
          entity.kind === 'polygon'
          && Array.isArray(entity.parameters?.references)
          && entity.parameters.references.includes('A')
          && entity.parameters.references.includes('N')
          && entity.parameters.references.includes('D')
          && entity.parameters.references.includes('L')
        ));
        if (!polygon) throw new TypeError('MathNet ANDL polygon is unavailable.');
        const context = buildGeometryAiContext(snapshot.geometryDoc, {
          focusRefs: [polygon.id, ...points.map((point) => point.id)],
          focusDepth: 4,
        });
        const insertion = context.construction.sourceBindings.find((binding) => (
          binding.id === 'binding:document:tikzpicture-body-end'
          && binding.createCapabilityFingerprint
        ));
        const styleBinding = context.construction.sourceBindings.find((binding) => (
          binding.managedPresentationTargets?.some((target) => (
            target.entityId === polygon.id
          ))
        ));
        const pointBindings = points.map((point) => (
          context.construction.sourceBindings.find((binding) => (
            binding.id !== insertion?.id
            && binding.entityIds.length === 1
            && binding.entityIds[0] === point.id
            && snapshot.geometryDoc.sourceMap.entries.some((entry) => (
              entry.bindingId === binding.id
              && entry.entityIds.length === 1
              && entry.entityIds[0] === point.id
            ))
          ))
        ));
        if (
          !insertion?.createCapabilityFingerprint
          || !styleBinding?.managedConstructionId
          || pointBindings.some((binding) => !binding)
        ) throw new TypeError('MathNet follow-up capabilities are incomplete.');
        const basis = context.basis;
        const styleIntent: AiManagedPresentationIntent = {
          schemaVersion: 'managed-presentation-intent/v1',
          intentId: 'mathnet-style-andl',
          idempotencyKey: 'mathnet-style-andl',
          basis,
          focusBindingIds: [styleBinding.id],
          readBindingIds: [styleBinding.id],
          operation: {
            kind: 'set-managed-style',
            bindingId: styleBinding.id,
            sourceId: styleBinding.sourceId,
            constructionId: styleBinding.managedConstructionId,
            targetEntityId: polygon.id,
            style: { color: 'purple', width: 'very thick' },
          },
        };
        const labelIntents: ConstructionIntent[] = points.map((point, index) => ({
          schemaVersion: 'construction-intent/v1',
          intentId: `mathnet-label-${point.name}`,
          idempotencyKey: `mathnet-label-${point.name}`,
          basis: {
            ...basis,
            hashAlgorithm: 'fnv1a64-utf8',
            kernelHash: basis.kernelHash!,
            projectionHash: basis.projectionHash!,
            pluginSetDigest: basis.pluginSetDigest!,
            constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
          },
          operation: 'create',
          capability: {
            bindingId: insertion.id,
            fingerprint: insertion.createCapabilityFingerprint!,
            scopeFingerprint: context.construction.authorizationScopeFingerprint,
          },
          toolId: 'label',
          bindingIds: [pointBindings[index]!.id],
          requestedNames: {},
          parameters: { text: point.name! },
        }));
        const compiled = compileHostSemanticActionSet({
          schemaVersion: 'host-semantic-action-set/v1',
          actionSetId: 'mathnet-style-label-set',
          idempotencyKey: 'mathnet-style-label-set',
          styleIntent,
          labelIntents,
        }, {
          basis,
          bindings: evaluationAiBindings(snapshot, context),
          allowedBindingIds: context.construction.authorizedBindingIds,
          source: snapshot.source,
          geometryDoc: snapshot.geometryDoc,
        });
        if (!compiled.ok) throw new TypeError(JSON.stringify(compiled.errors));
        return compiled.transaction;
      },
    },
    render: ({ snapshot }) => {
      onFinalSource(snapshot.source);
      return [
        {
          lane: 'interactive',
          rendererId: 'interactive-geometrydoc-svg-v1',
          mediaType: 'image/svg+xml',
          artifact: `<svg data-revision="${snapshot.revision}" data-source="${snapshot.manifest.sourceHash}"/>`,
        },
        {
          lane: 'exact',
          rendererId: 'tectonic-dvisvgm-evaluation-receipt',
          mediaType: 'image/svg+xml',
          artifact: `<svg data-exact-source="${snapshot.manifest.sourceHash}"/>`,
          exactCompiler: {
            jobId: 'evaluation-mathnet-exact-job',
            compilerId: 'isolated-tikz-compiler',
            compilerProfileDigest: 'tikz-standard-v1:fixture-attestation',
          },
        },
      ];
    },
  });
}

describe('geometry evaluation runner', () => {
  it('refuses to execute a corpus case against source bytes outside its pinned local fixture', async () => {
    await expect(runGeometryEvaluationCase({
      caseDefinition: allLaneCase,
      initialSource: `${initialSource}% drift`,
      adapter: realLocalAdapter(),
    })).rejects.toThrow(/Caller source does not match/u);
  });

  it('reads and verifies the pinned expectations artifact before executing a case', async () => {
    const forgedCase: GeometryEvaluationCase = {
      ...allLaneCase,
      localFixture: {
        ...allLaneCase.localFixture,
        expectationsSha256: '0'.repeat(64),
      },
    };
    await expect(runGeometryEvaluationCase({
      caseDefinition: forgedCase,
      adapter: realLocalAdapter(),
    })).rejects.toThrow(/expectations digest/u);
  });

  it('rejects caller-supplied turns and invariants that are absent from the pinned profile', async () => {
    const forgedCase: GeometryEvaluationCase = {
      ...allLaneCase,
      turns: [{
        ...allLaneCase.turns[0]!,
        instruction: 'Pretend this trivial fixture proves every olympiad construction.',
        invariants: [{ kind: 'source-unchanged' }],
      }],
    };
    await expect(runGeometryEvaluationCase({
      caseDefinition: forgedCase,
      adapter: realLocalAdapter(),
    })).rejects.toThrow(/do not authorize this case definition/u);
  });

  it('loads the byte-pinned Simson competition profile before capability gating', async () => {
    const execute = vi.fn();
    const report = await runGeometryEvaluationCase({
      caseDefinition: GEOMETRY_EVALUATION_CORPUS[0]!,
      adapter: { capabilities: [], execute },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(report.lanes).toHaveLength(5);
    expect(report.lanes.every((lane) => lane.status === 'skipped')).toBe(true);
    expect(report.source).toMatchObject({
      disposition: 'research-reference-only',
      recordId: 'mathnet:0akr',
    });
  });

  it('loads the byte-pinned MathNet nine-point cyclic profile before capability gating', async () => {
    const execute = vi.fn();
    const caseDefinition = GEOMETRY_EVALUATION_CORPUS.find((entry) => (
      entry.caseId === 'mathnet-iran-2025-nine-point-cyclic'
    ));
    if (!caseDefinition) throw new TypeError('MathNet nine-point cyclic case is unavailable.');
    const report = await runGeometryEvaluationCase({
      caseDefinition,
      adapter: { capabilities: [], execute },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(report.lanes).toHaveLength(4);
    expect(report.lanes.every((lane) => lane.status === 'skipped')).toBe(true);
    expect(report.source).toMatchObject({
      disposition: 'research-reference-only',
      recordId: 'mathnet:iran-2025-nine-point-cyclic',
    });
  });

  it('runs the MathNet nine-point answer, construction, style-label set, and dual-render chain', async () => {
    const caseDefinition = GEOMETRY_EVALUATION_CORPUS.find((entry) => (
      entry.caseId === 'mathnet-iran-2025-nine-point-cyclic'
    ));
    if (!caseDefinition) throw new TypeError('MathNet nine-point cyclic case is unavailable.');
    let finalSource = '';
    const report = await runGeometryEvaluationCase({
      caseDefinition,
      adapter: mathNetNinePointAdapter((source) => {
        finalSource = source;
      }),
      exactRenderVerifier: ({ artifact, snapshot }) => (
        artifact.compiler?.compilerId === 'isolated-tikz-compiler'
        && artifact.compiler.compilerProfileDigest
          === 'tikz-standard-v1:fixture-attestation'
        && artifact.source === snapshot.source
        && artifact.sourceHash === snapshot.manifest.sourceHash
      ),
    });

    expect(report.passed).toBe(true);
    expect(report.lanes.map((lane) => lane.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
    expect(finalSource).toContain('in coordinate (P) at');
    expect(finalSource).toContain('\\coordinate (L) at');
    expect(finalSource).toContain('purple,very thick');
    expect(finalSource).toContain('{P}');
    expect(finalSource).toContain('{L}');
    expect(finalSource).toContain('{N}');
  });

  it('rejects fixture path traversal before reading repository files', async () => {
    const forgedCase: GeometryEvaluationCase = {
      ...allLaneCase,
      localFixture: {
        ...allLaneCase.localFixture,
        fixturePath: '../evaluation/simple-segment',
      },
    };
    await expect(runGeometryEvaluationCase({
      caseDefinition: forgedCase,
      adapter: realLocalAdapter(),
    })).rejects.toThrow(/safe stem/u);
  });

  it('does not accept a typed admitted-artifact reference without its host-issued receipt', async () => {
    const admittedCase: GeometryEvaluationCase = {
      ...allLaneCase,
      source: {
        disposition: 'admitted-artifact',
        referenceSchema: 'AdmittedProblemReference/v1',
        corpusIdentity: 'a'.repeat(64),
        source: 'mathnet',
        sourceId: 'mathnet:forged',
        contentDigest: 'b'.repeat(64),
        contentDigestAlgorithm: 'sha256',
        manifestSchema: 'ProblemArtifactManifest/v1',
        taskId: 'mathnet:forged:task',
        taskContentDigest: 'c'.repeat(64),
        taskSchema: 'ProblemTask/v1',
        admission: 'evaluation-canary',
      },
    };
    await expect(runGeometryEvaluationCase({
      caseDefinition: admittedCase,
      initialSource,
      adapter: realLocalAdapter(),
    })).rejects.toThrow(/host-issued evaluation receipt/u);
  });

  it('derives Broker-backed lanes and explicitly skips exact rendering without external evidence', async () => {
    const report = await runGeometryEvaluationCase({
      caseDefinition: allLaneCase,
      initialSource,
      adapter: realLocalAdapter(),
    });

    expect(report.passed).toBe(false);
    expect(report.lanes.map((lane) => lane.status)).toEqual([
      'passed', 'passed', 'passed', 'passed', 'skipped',
    ]);
    expect(report.lanes.map((lane) => lane.after.revision)).toEqual([0, 1, 2, 3, 3]);
    expect(report.lanes[1]?.assertions).toContainEqual(expect.objectContaining({
      id: 'transaction-attestation-valid',
      passed: true,
    }));
    expect(report.lanes[3]?.assertions).toContainEqual(expect.objectContaining({
      id: 'capability:dependency-preserving-transform',
      passed: true,
    }));
  });

  it('is deterministic for the same fixture and real local adapter', async () => {
    const first = await runGeometryEvaluationCase({
      caseDefinition: allLaneCase,
      initialSource,
      adapter: realLocalAdapter(),
    });
    const second = await runGeometryEvaluationCase({
      caseDefinition: allLaneCase,
      initialSource,
      adapter: realLocalAdapter(),
    });
    expect(second).toEqual(first);
  });

  it('ignores adapter-owned boolean assertions and rejects a comment-only construction', async () => {
    const onlyConstruct = evaluationCase([allLaneCase.turns[1]!], 'construct-only');
    const adapter = createLocalGeometryEvaluationAdapter({
      capabilities: ['atomic-construction'],
      mutations: {
        construct: ({ snapshot }): GeometryTransactionRequest => {
          const at = snapshot.source.indexOf('\\end{tikzpicture}');
          const sourceId = snapshot.geometryDoc.basis.sourceId!;
          const range = { start: at, end: at };
          return {
            schemaVersion: 'geometry-transaction/v1',
            transactionId: 'comment-only-construction',
            idempotencyKey: 'comment-only-construction',
            documentId: snapshot.documentId,
            documentEpoch: snapshot.epoch,
            origin: 'external',
            stage: 'validated',
            expectedRevision: snapshot.revision,
            sourceHash: snapshot.manifest.sourceHash,
            expectedKernelHash: snapshot.geometryDoc.basis.kernelHash,
            expectedProjectionHash: snapshot.geometryDoc.basis.projectionHash,
            pluginSetDigest: snapshot.geometryDoc.basis.pluginSetDigest,
            readSet: [{ kind: 'source-range', sourceId, range }],
            writeSet: [{ kind: 'source-range', sourceId, range }],
            preconditions: [{ kind: 'source-slice-equals', sourceId, range, text: '' }],
            operations: [{
              op: 'source-patch',
              operationId: 'comment-only-construction:source',
              patches: [{ sourceId, range, insert: '% fake construction\n', expectedText: '' }],
            }],
            metadata: { sourceEditOrigin: 'external' },
          };
        },
      },
    });
    const originalExecute = adapter.execute.bind(adapter);
    const dishonest = {
      ...adapter,
      async execute(input: Parameters<typeof originalExecute>[0]) {
        return {
          ...await originalExecute(input),
          assertions: [{ id: 'adapter-says-pass', passed: true }],
        };
      },
    } as GeometryEvaluationAdapter;

    const report = await runGeometryEvaluationCase({
      caseDefinition: onlyConstruct,
      initialSource,
      adapter: dishonest,
    });

    expect(report.passed).toBe(false);
    expect(report.lanes[0]?.after.revision).toBe(1);
    expect(report.lanes[0]?.assertions).not.toContainEqual(expect.objectContaining({
      id: 'adapter-says-pass',
    }));
    expect(report.lanes[0]?.assertions).toContainEqual(expect.objectContaining({
      id: 'capability:atomic-construction',
      passed: false,
    }));
  });

  it('records an explicit capability-gated SKIP without executing the adapter', async () => {
    const execute = vi.fn();
    const adapter: GeometryEvaluationAdapter = {
      capabilities: ['binding-scoped-style'],
      execute,
    };
    const report = await runGeometryEvaluationCase({
      caseDefinition: evaluationCase([{
        lane: 'modify-existing',
        instruction: 'Style and label.',
        expectedCapabilities: ['binding-scoped-style', 'label-intent'],
        invariants: [{ kind: 'label-entity-delta', minimum: 1 }],
      }], 'missing-label-capability'),
      initialSource,
      adapter,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(report.lanes[0]).toMatchObject({
      status: 'skipped',
      passed: false,
      unsupportedCapabilities: ['label-intent'],
    });
    expect(report.lanes[0]?.after.revision).toBe(0);
  });

  it('rejects a forged transaction attestation even when the Broker commit is real', async () => {
    const base = realLocalAdapter();
    const onlyConstruct = evaluationCase([allLaneCase.turns[1]!], 'construct-only');
    const adapter: GeometryEvaluationAdapter = {
      capabilities: base.capabilities,
      async execute(input) {
        const observation = await base.execute(input);
        if (!observation.transaction) return observation;
        return {
          ...observation,
          transaction: {
            ...observation.transaction,
            attestation: {
              ...observation.transaction.attestation,
              digest: '0000000000000000',
            },
          },
        };
      },
    };
    const report = await runGeometryEvaluationCase({
      caseDefinition: onlyConstruct,
      initialSource,
      adapter,
    });
    expect(report.passed).toBe(false);
    expect(report.lanes[0]?.assertions).toContainEqual(expect.objectContaining({
      id: 'transaction-attestation-valid',
      passed: false,
    }));
  });

  it('fails exact verification when the external compiler evidence verifier rejects it', async () => {
    const snapshotHash = hashSource(initialSource);
    const events = [
      tikzAgentEvent('render-forgery', 0, { type: 'run.started', title: 'start' }),
      tikzAgentEvent('render-forgery', 1, { type: 'context.read', title: 'read' }),
      tikzAgentEvent('render-forgery', 2, {
        type: 'run.completed', title: 'done', outcome: 'answer',
      }),
    ];
    const adapter: GeometryEvaluationAdapter = {
      capabilities: ['exact-render'],
      async execute({ snapshot }) {
        return {
          agentEvents: events,
          renderArtifacts: [{
            schemaVersion: GEOMETRY_EVALUATION_RENDER_ARTIFACT_SCHEMA_VERSION,
            lane: 'exact',
            documentId: snapshot.documentId,
            epoch: snapshot.epoch,
            revision: snapshot.revision,
            rendererId: 'forged-exact',
            mediaType: 'application/pdf',
            source: snapshot.source,
            sourceHashAlgorithm: 'fnv1a64-utf8',
            sourceHash: snapshotHash,
            artifact: '%PDF-real-bytes',
            artifactHashAlgorithm: 'fnv1a64-utf8',
            artifactHash: hashSource('%PDF-real-bytes'),
            compiler: {
              schemaVersion: GEOMETRY_EVALUATION_EXACT_COMPILER_SCHEMA_VERSION,
              jobId: 'forged-job',
              compilerId: 'forged-compiler',
              compilerProfileDigest: 'forged-profile',
              sourceHash: snapshotHash,
              artifactHash: hashSource('%PDF-real-bytes'),
            },
          }],
        };
      },
    };
    const report = await runGeometryEvaluationCase({
      caseDefinition: evaluationCase([{
        lane: 'verify-rendering',
        instruction: 'Verify exact.',
        expectedCapabilities: ['exact-render'],
        invariants: [{ kind: 'render-artifacts-attested', lanes: ['exact'] }],
      }], 'verify-exact-only'),
      initialSource,
      adapter,
      exactRenderVerifier: async () => false,
    });
    expect(report.passed).toBe(false);
    expect(report.lanes[0]?.assertions).toContainEqual(expect.objectContaining({
      id: 'capability:exact-render',
      passed: false,
    }));
  });

  it('fails a stale typed request without advancing the StudioDocument', async () => {
    const adapter: GeometryEvaluationAdapter = {
      capabilities: ['atomic-construction'],
      async execute(input) {
        const point = createPrimitiveConstructionPlan('point', {
          anchors: [{ name: 'C', position: { x: 1, y: 1 }, existing: false }],
          nextName: (prefix) => `${prefix}1`,
          nextConstructionId: () => 'stale-point-c',
        });
        const current = compileCanvasConstructionBatchProposal({
          source: input.snapshot.source,
          geometryDoc: input.snapshot.geometryDoc,
          plans: [point],
          primaryConstructionId: point.id,
        }).transaction;
        const request: GeometryTransactionRequest = {
          ...current,
          transactionId: 'stale-transaction',
          idempotencyKey: 'stale-transaction',
          expectedRevision: current.expectedRevision - 1,
        };
        const brokerResult = input.broker.commit(request, {
          hash: input.snapshot.manifest.sourceHash,
          algorithm: input.snapshot.manifest.hashAlgorithm,
          source: input.snapshot.source,
          pluginSetDigest: input.snapshot.geometryDoc.basis.pluginSetDigest,
        });
        return {
          agentEvents: [
            tikzAgentEvent('stale-run', 0, { type: 'run.started', title: 'start' }),
            tikzAgentEvent('stale-run', 1, { type: 'run.failed', title: 'failed', outcome: 'failed' }),
          ],
          transaction: {
            request,
            brokerResult,
            attestation: await attestAiTransaction(request),
          },
        };
      },
    };
    const report = await runGeometryEvaluationCase({
      caseDefinition: evaluationCase([allLaneCase.turns[1]!], 'construct-only'),
      initialSource,
      adapter,
    });
    expect(report.passed).toBe(false);
    expect(report.lanes[0]?.after.revision).toBe(0);
    expect(report.lanes[0]?.assertions).toContainEqual(expect.objectContaining({
      id: 'broker-committed',
      passed: false,
    }));
  });
});
