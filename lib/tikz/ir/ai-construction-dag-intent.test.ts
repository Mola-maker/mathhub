import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { constructionAuthorizationScopeFingerprint } from '../authoring/construction-authorization';
import { CONSTRUCTION_CATALOG_DIGEST } from '../authoring/construction-catalog';
import type { ConstructionDagIntent } from '../authoring/construction-dag-intent';
import { hashSource } from '../document/source-hash';
import { createGeometryDoc } from './geometry-doc';
import { buildGeometrySourceMap } from './source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from './tikz-adapter';
import { compileAiConstructionDagIntent } from './ai-construction-dag-intent';

const DOCUMENT_ID = 'construction-dag-document';
const EPOCH = 'construction-dag-epoch';

function geometryDocFor(source: string) {
  const basis = {
    documentId: DOCUMENT_ID,
    epoch: EPOCH,
    revision: 0,
    sourceHash: hashSource(source),
    sourceId: `${DOCUMENT_ID}:tikz`,
    pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
  };
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis: analyze(source, 0),
    source,
    basis,
    hashAlgorithm: 'fnv1a64-utf8',
  });
  return createGeometryDoc(truths, buildGeometrySourceMap(truths));
}

function bindingIdForPoint(
  geometryDoc: ReturnType<typeof geometryDocFor>,
  name: string,
): string {
  const entity = geometryDoc.semantic.ir.entities.find((candidate) => (
    candidate.kind === 'point' && candidate.name === name
  ));
  const matches = entity
    ? geometryDoc.sourceMap.entries.filter((entry) => entry.entityIds.includes(entity.id))
    : [];
  if (matches.length !== 1) throw new TypeError(`Point ${name} has no unique binding.`);
  return matches[0]!.bindingId;
}

function intentFor(source: string): {
  readonly intent: ConstructionDagIntent;
  readonly geometryDoc: ReturnType<typeof geometryDocFor>;
  readonly allowedBindingIds: readonly string[];
} {
  const geometryDoc = geometryDocFor(source);
  const insertion = geometryDoc.construction.bindings.find((binding) => (
    binding.id === 'binding:document:tikzpicture-body-end'
  ));
  const fingerprint = insertion?.metadata?.capabilityFingerprint;
  if (typeof fingerprint !== 'string') throw new TypeError('Missing insertion capability.');
  const bindings = Object.fromEntries(
    ['A', 'B', 'C'].map((name) => [name, bindingIdForPoint(geometryDoc, name)]),
  );
  const allowedBindingIds = [
    'binding:document:tikzpicture-body-end',
    bindings.A!,
    bindings.B!,
    bindings.C!,
  ];
  const intent: ConstructionDagIntent = {
    schemaVersion: 'construction-dag-intent/v1',
    intentId: 'midpoint-circumcircle-dag',
    idempotencyKey: 'midpoint-circumcircle-dag',
    basis: {
      documentId: geometryDoc.basis.documentId,
      epoch: geometryDoc.basis.epoch,
      revision: geometryDoc.basis.revision,
      sourceId: geometryDoc.basis.sourceId!,
      sourceHash: geometryDoc.basis.sourceHash,
      hashAlgorithm: 'fnv1a64-utf8',
      kernelHash: geometryDoc.basis.kernelHash!,
      projectionHash: geometryDoc.basis.projectionHash!,
      pluginSetDigest: geometryDoc.basis.pluginSetDigest!,
      constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
    },
    capability: {
      bindingId: 'binding:document:tikzpicture-body-end',
      fingerprint,
      scopeFingerprint: constructionAuthorizationScopeFingerprint({
        basis: geometryDoc.basis,
        authorizedBindingIds: allowedBindingIds,
        createCapabilityFingerprint: fingerprint,
      }),
    },
    steps: [
      {
        stepId: 'mid-ab',
        toolId: 'midpoint',
        inputs: [
          { kind: 'binding', bindingId: bindings.A! },
          { kind: 'binding', bindingId: bindings.B! },
        ],
        requestedNames: {},
        parameters: {},
      },
      {
        stepId: 'circum',
        toolId: 'circumcircle',
        inputs: [
          { kind: 'step-output', stepId: 'mid-ab', outputKey: 'midpoint' },
          { kind: 'binding', bindingId: bindings.A! },
          { kind: 'binding', bindingId: bindings.C! },
        ],
        requestedNames: {},
        parameters: {},
      },
    ],
  };
  return { intent, geometryDoc, allowedBindingIds };
}

describe('ai-construction-dag-intent/v1', () => {
  it('compiles dependent Catalog steps into one atomic source operation', () => {
    const source = [
      '\\begin{tikzpicture}',
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (6,0);',
      '\\coordinate (C) at (2,4);',
      '\\end{tikzpicture}',
    ].join('\n');
    const { intent, geometryDoc, allowedBindingIds } = intentFor(source);
    const result = compileAiConstructionDagIntent(intent, {
      basis: {
        ...geometryDoc.basis,
        sourceId: geometryDoc.basis.sourceId!,
        hashAlgorithm: 'fnv1a64-utf8',
      },
      bindings: geometryDoc.construction.bindings.map((binding) => ({
        bindingId: binding.id,
        sourceId: binding.source.document.sourceId,
        range: binding.source.range,
        writable: binding.writable,
        opaque: false,
        insertionPolicy: binding.id === 'binding:document:tikzpicture-body-end'
          ? 'tikzpicture-body'
          : 'none',
        writeCapabilities: binding.id === 'binding:document:tikzpicture-body-end'
          ? ['create-managed-construction']
          : [],
        ...(typeof binding.metadata?.capabilityFingerprint === 'string'
          ? { createCapabilityFingerprint: binding.metadata.capabilityFingerprint }
          : {}),
        sliceHash: binding.source.sliceHash,
      })),
      allowedBindingIds,
      source,
      geometryDoc,
    });
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.transaction).toMatchObject({
      origin: 'ai',
      stage: 'proposed',
      operations: [{ op: 'source-patch' }],
      metadata: {
        proposalSchemaVersion: 'ai-construction-dag-intent/v1',
        authoringSchemaVersion: 'construction-dag-intent/v1',
        constructionDagIntentProof: intent,
      },
    });
    expect(result.transaction.operations).toHaveLength(1);
    expect(result.transaction.metadata?.canvasConstructionBatchProof).toMatchObject({
      planProofs: [
        expect.objectContaining({ planKind: 'midpoint' }),
        expect.objectContaining({ planKind: 'circumcircle' }),
      ],
    });
  });

  it('lets a later step consume a circle produced earlier in the same batch', () => {
    const source = [
      '\\begin{tikzpicture}',
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (6,0);',
      '\\coordinate (C) at (2,4);',
      '\\end{tikzpicture}',
    ].join('\n');
    const { intent, geometryDoc, allowedBindingIds } = intentFor(source);
    const circleConsumer: ConstructionDagIntent = {
      ...intent,
      intentId: 'circumcircle-point-dag',
      idempotencyKey: 'circumcircle-point-dag',
      steps: [
        {
          stepId: 'circum',
          toolId: 'circumcircle',
          inputs: [
            { kind: 'binding', bindingId: bindingIdForPoint(geometryDoc, 'A') },
            { kind: 'binding', bindingId: bindingIdForPoint(geometryDoc, 'B') },
            { kind: 'binding', bindingId: bindingIdForPoint(geometryDoc, 'C') },
          ],
          requestedNames: {},
          parameters: {},
        },
        {
          stepId: 'circle-point',
          toolId: 'point-on-circle',
          inputs: [{
            kind: 'step-output',
            stepId: 'circum',
            outputKey: 'circle',
          }],
          requestedNames: {},
          parameters: { angleDegrees: 35 },
        },
      ],
    };
    const result = compileAiConstructionDagIntent(circleConsumer, {
      basis: {
        ...geometryDoc.basis,
        sourceId: geometryDoc.basis.sourceId!,
        hashAlgorithm: 'fnv1a64-utf8',
      },
      bindings: geometryDoc.construction.bindings.map((binding) => ({
        bindingId: binding.id,
        sourceId: binding.source.document.sourceId,
        range: binding.source.range,
        writable: binding.writable,
        opaque: false,
        insertionPolicy: binding.id === 'binding:document:tikzpicture-body-end'
          ? 'tikzpicture-body'
          : 'none',
        writeCapabilities: binding.id === 'binding:document:tikzpicture-body-end'
          ? ['create-managed-construction']
          : [],
        sliceHash: binding.source.sliceHash,
      })),
      allowedBindingIds,
      source,
      geometryDoc,
    });
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.errors)).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.metadata?.canvasConstructionBatchProof).toMatchObject({
      planProofs: [
        expect.objectContaining({ planKind: 'circumcircle' }),
        expect.objectContaining({ planKind: 'point-on-circle' }),
      ],
    });
  });

  it('keeps requested names step-local while sharing one collision namespace', () => {
    const source = [
      '\\begin{tikzpicture}',
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (6,0);',
      '\\coordinate (C) at (2,4);',
      '\\end{tikzpicture}',
    ].join('\n');
    const { intent, geometryDoc, allowedBindingIds } = intentFor(source);
    const named: ConstructionDagIntent = {
      ...intent,
      intentId: 'step-local-requested-names',
      idempotencyKey: 'step-local-requested-names',
      steps: [
        intent.steps[0]!,
        {
          ...intent.steps[1]!,
          requestedNames: { center: 'Ocustom' },
        },
        {
          stepId: 'circle-point',
          toolId: 'point-on-circle',
          inputs: [{
            kind: 'step-output',
            stepId: 'circum',
            outputKey: 'circle',
          }],
          requestedNames: { point: 'L' },
          parameters: { angleDegrees: 35 },
        },
      ],
    };
    const result = compileAiConstructionDagIntent(named, {
      basis: {
        ...geometryDoc.basis,
        sourceId: geometryDoc.basis.sourceId!,
        hashAlgorithm: 'fnv1a64-utf8',
      },
      bindings: geometryDoc.construction.bindings.map((binding) => ({
        bindingId: binding.id,
        sourceId: binding.source.document.sourceId,
        range: binding.source.range,
        writable: binding.writable,
        opaque: false,
        insertionPolicy: binding.id === 'binding:document:tikzpicture-body-end'
          ? 'tikzpicture-body'
          : 'none',
        writeCapabilities: binding.id === 'binding:document:tikzpicture-body-end'
          ? ['create-managed-construction']
          : [],
        sliceHash: binding.source.sliceHash,
      })),
      allowedBindingIds,
      source,
      geometryDoc,
    });
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.errors)).toBe(true);
    if (!result.ok) return;
    const inserted = result.transaction.operations.flatMap((operation) => (
      operation.op === 'source-patch'
        ? operation.patches.map((patch) => patch.insert)
        : []
    )).join('');
    expect(inserted).toContain('circle through=(M1)] at (Ocustom)');
    expect(inserted).toContain('\\coordinate (L)');
    expect(inserted).not.toContain('\\coordinate (Ocustom) at ($(A)!0.5!(B)$)');
  });

  it('fails closed when a step output key is not part of the Catalog ABI', () => {
    const source = [
      '\\begin{tikzpicture}',
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (6,0);',
      '\\coordinate (C) at (2,4);',
      '\\end{tikzpicture}',
    ].join('\n');
    const { intent, geometryDoc, allowedBindingIds } = intentFor(source);
    const forged: ConstructionDagIntent = {
      ...intent,
      steps: [
        intent.steps[0]!,
        {
          ...intent.steps[1]!,
          inputs: [
            { kind: 'step-output', stepId: 'mid-ab', outputKey: 'private-writer-name' },
            ...intent.steps[1]!.inputs.slice(1),
          ],
        },
      ],
    };
    const result = compileAiConstructionDagIntent(forged, {
      basis: {
        ...geometryDoc.basis,
        sourceId: geometryDoc.basis.sourceId!,
        hashAlgorithm: 'fnv1a64-utf8',
      },
      bindings: geometryDoc.construction.bindings.map((binding) => ({
        bindingId: binding.id,
        sourceId: binding.source.document.sourceId,
        range: binding.source.range,
        writable: binding.writable,
        opaque: false,
        insertionPolicy: binding.id === 'binding:document:tikzpicture-body-end'
          ? 'tikzpicture-body'
          : 'none',
        writeCapabilities: binding.id === 'binding:document:tikzpicture-body-end'
          ? ['create-managed-construction']
          : [],
        sliceHash: binding.source.sliceHash,
      })),
      allowedBindingIds,
      source,
      geometryDoc,
    });
    expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({
      code: 'plan-invalid',
    })] });
  });
});
