import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { CONSTRUCTION_CATALOG_DIGEST } from '../authoring/construction-catalog';
import type { ConstructionDagIntent } from '../authoring/construction-dag-intent';
import type { ConstructionIntent } from '../authoring/construction-intent';
import { hashSource } from '../document/source-hash';
import { StudioDocument } from '../document/studio-document';
import { buildGeometryAiContext } from '../ir/ai-context';
import { compileAiConstructionDagIntent } from '../ir/ai-construction-dag-intent';
import { compileAiConstructionIntentProposal } from '../ir/ai-construction-intent-proposal';
import type { AiPatchBindingContext } from '../ir/ai-patch-proposal';
import type { JsonObject } from '../ir/model';
import { createGeometryDoc } from '../ir/geometry-doc';
import { buildGeometrySourceMap } from '../ir/source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from '../ir/tikz-adapter';
import { TikzTransactionBroker } from './broker';

/**
 * ConstructionIntent is declared with interfaces, which carry no implicit index
 * signature and therefore never satisfy JsonObject structurally. Production
 * metadata performs the same conversion in ai-construction-intent-proposal.ts;
 * the Broker re-validates the proof shape independently on the way in, so this
 * only restates the wire encoding and grants the fixture no authority.
 */
function proofOf(value: ConstructionIntent): JsonObject {
  return value as unknown as JsonObject;
}

function fixture(
  source = '\\begin{tikzpicture}\n\\end{tikzpicture}',
) {
  const document = new StudioDocument(source);
  const snapshot = document.getSnapshot();
  const projectionInputBasis = {
    documentId: snapshot.documentId,
    epoch: snapshot.epoch,
    revision: snapshot.revision,
    sourceId: `${snapshot.documentId}:tikz`,
    sourceHash: hashSource(source),
    hashAlgorithm: 'fnv1a64-utf8' as const,
    pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
  };
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis: analyze(source, snapshot.revision),
    source,
    basis: projectionInputBasis,
    hashAlgorithm: 'fnv1a64-utf8',
  });
  const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
  const basis = {
    ...geometryDoc.basis,
    sourceId: geometryDoc.basis.sourceId!,
    kernelHash: geometryDoc.basis.kernelHash!,
    projectionHash: geometryDoc.basis.projectionHash!,
    pluginSetDigest: geometryDoc.basis.pluginSetDigest!,
    hashAlgorithm: 'fnv1a64-utf8' as const,
  };
  const aiContext = buildGeometryAiContext(geometryDoc);
  const insertion = aiContext.construction.sourceBindings.find((binding) => (
    binding.id === 'binding:document:tikzpicture-body-end'
  ));
  if (!insertion?.createCapabilityFingerprint) {
    throw new TypeError('Fixture requires a current create capability.');
  }
  const bindings: AiPatchBindingContext[] = [{
    bindingId: insertion.id,
    sourceId: insertion.sourceId,
    range: insertion.range,
    writable: insertion.writable,
    opaque: false,
    insertionPolicy: insertion.insertionPolicy,
    writeCapabilities: insertion.writeCapabilities,
    createCapabilityFingerprint: insertion.createCapabilityFingerprint,
    sliceHash: insertion.sliceHash,
  }];
  const intent: ConstructionIntent = {
    schemaVersion: 'construction-intent/v1',
    intentId: 'broker-intent-create',
    idempotencyKey: 'broker-intent-create',
    basis: {
      ...basis,
      constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
    },
    operation: 'create',
    capability: {
      bindingId: 'binding:document:tikzpicture-body-end',
      fingerprint: insertion.createCapabilityFingerprint,
      scopeFingerprint: aiContext.construction.authorizationScopeFingerprint,
    },
    toolId: 'point',
    bindingIds: [],
    requestedNames: { point: 'P' },
    parameters: { x: 1, y: 2 },
  };
  return { source, document, basis, geometryDoc, bindings, intent };
}

describe('TikzTransactionBroker construction-intent replay', () => {
  it('commits only when Broker independently reproduces the Catalog plan', () => {
    const { source, document, basis, geometryDoc, bindings, intent } = fixture();
    const compiled = compileAiConstructionIntentProposal(intent, {
      basis,
      bindings,
      allowedBindingIds: ['binding:document:tikzpicture-body-end'],
      source,
      geometryDoc,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const result = new TikzTransactionBroker(document).commit(compiled.transaction, {
      hash: basis.sourceHash,
      algorithm: 'fnv1a64-utf8',
      source,
      kernelHash: basis.kernelHash,
      projectionHash: basis.projectionHash,
      pluginSetDigest: basis.pluginSetDigest,
      authorizedBindingIds: ['binding:document:tikzpicture-body-end'],
      authorizationScopeFingerprint: intent.capability.scopeFingerprint,
      createCapabilityFingerprint: intent.capability.fingerprint,
    });

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source).toContain('\\coordinate (P) at (1,2);');
  });

  it('commits a dependent Catalog DAG once and rejects a forged output edge', () => {
    const source = [
      '\\begin{tikzpicture}',
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (6,0);',
      '\\coordinate (C) at (2,4);',
      '\\end{tikzpicture}',
    ].join('\n');
    const { document, basis, geometryDoc, intent: baseIntent } = fixture(source);
    const aiContext = buildGeometryAiContext(geometryDoc, {
      focusRefs: ['A', 'B', 'C'],
    });
    const insertion = aiContext.construction.sourceBindings.find((binding) => (
      binding.id === 'binding:document:tikzpicture-body-end'
    ));
    const pointBinding = (name: string) => {
      const entity = geometryDoc.semantic.ir.entities.find((candidate) => (
        candidate.kind === 'point' && candidate.name === name
      ));
      const bindingId = entity
        ? geometryDoc.sourceMap.entries.find((entry) => entry.entityIds.includes(entity.id))?.bindingId
        : undefined;
      if (!bindingId) throw new TypeError(`Missing point binding ${name}.`);
      return bindingId;
    };
    if (!insertion?.createCapabilityFingerprint) {
      throw new TypeError('Missing DAG create capability.');
    }
    const a = pointBinding('A');
    const b = pointBinding('B');
    const c = pointBinding('C');
    const allowedBindingIds = aiContext.construction.authorizedBindingIds;
    const dag: ConstructionDagIntent = {
      schemaVersion: 'construction-dag-intent/v1',
      intentId: 'broker-construction-dag',
      idempotencyKey: 'broker-construction-dag',
      basis: {
        ...baseIntent.basis,
        constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
      },
      capability: {
        bindingId: insertion.id,
        fingerprint: insertion.createCapabilityFingerprint,
        scopeFingerprint: aiContext.construction.authorizationScopeFingerprint,
      },
      steps: [
        {
          stepId: 'mid-ab',
          toolId: 'midpoint',
          inputs: [
            { kind: 'binding', bindingId: a },
            { kind: 'binding', bindingId: b },
          ],
          requestedNames: {},
          parameters: {},
        },
        {
          stepId: 'circum',
          toolId: 'circumcircle',
          inputs: [
            { kind: 'step-output', stepId: 'mid-ab', outputKey: 'midpoint' },
            { kind: 'binding', bindingId: a },
            { kind: 'binding', bindingId: c },
          ],
          requestedNames: {},
          parameters: {},
        },
      ],
    };
    const bindingContexts: AiPatchBindingContext[] = aiContext.construction.sourceBindings.map(
      (binding) => ({
        bindingId: binding.id,
        sourceId: binding.sourceId,
        range: binding.range,
        writable: binding.writable,
        opaque: binding.opaque,
        insertionPolicy: binding.insertionPolicy,
        writeCapabilities: binding.writeCapabilities,
        ...(binding.createCapabilityFingerprint
          ? { createCapabilityFingerprint: binding.createCapabilityFingerprint }
          : {}),
        sliceHash: binding.sliceHash,
      }),
    );
    const compiled = compileAiConstructionDagIntent(dag, {
      basis,
      bindings: bindingContexts,
      allowedBindingIds,
      source,
      geometryDoc,
    });
    expect(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.errors)).toBe(true);
    if (!compiled.ok) return;

    const forged = {
      ...compiled.transaction,
      metadata: {
        ...compiled.transaction.metadata,
        constructionDagIntentProof: {
          ...dag,
          steps: [
            dag.steps[0],
            {
              ...dag.steps[1],
              inputs: [
                { kind: 'step-output', stepId: 'mid-ab', outputKey: 'private-writer-name' },
                ...dag.steps[1]!.inputs.slice(1),
              ],
            },
          ],
        },
      },
    };
    const broker = new TikzTransactionBroker(document);
    const rejected = broker.commit(forged, {
      hash: basis.sourceHash,
      algorithm: 'fnv1a64-utf8',
      source,
      kernelHash: basis.kernelHash,
      projectionHash: basis.projectionHash,
      pluginSetDigest: basis.pluginSetDigest,
      authorizedBindingIds: allowedBindingIds,
      authorizationScopeFingerprint: dag.capability.scopeFingerprint,
      createCapabilityFingerprint: dag.capability.fingerprint,
    });
    expect(rejected.ok).toBe(false);
    expect(document.getSnapshot()).toMatchObject({ revision: 0, source });

    const result = broker.commit(compiled.transaction, {
      hash: basis.sourceHash,
      algorithm: 'fnv1a64-utf8',
      source,
      kernelHash: basis.kernelHash,
      projectionHash: basis.projectionHash,
      pluginSetDigest: basis.pluginSetDigest,
      authorizedBindingIds: allowedBindingIds,
      authorizationScopeFingerprint: dag.capability.scopeFingerprint,
      createCapabilityFingerprint: dag.capability.fingerprint,
    });
    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot()).toMatchObject({ revision: 1 });
    expect(document.getSnapshot().source).toContain('kind=midpoint');
    expect(document.getSnapshot().source).toContain('kind=circumcircle');
  });

  it('atomically adopts a raw circle and replays the dependent intent', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (O) at (0,0);\n\\draw (O) circle (2);\n\\end{tikzpicture}';
    const { document, basis, geometryDoc, bindings, intent } = fixture(source);
    const circle = geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'circle'
    ));
    const circleBindingId = circle
      ? geometryDoc.sourceMap.entries.find((entry) => (
        entry.entityIds.includes(circle.id)
      ))?.bindingId
      : undefined;
    if (!circle || !circleBindingId) throw new TypeError('Missing raw circle binding.');
    const aiContext = buildGeometryAiContext(geometryDoc, {
      focusRefs: [circle.id],
    });
    const adoptionIntent: ConstructionIntent = {
      ...intent,
      toolId: 'point-on-circle',
      bindingIds: [circleBindingId],
      requestedNames: {},
      parameters: { angleDegrees: 30 },
      capability: {
        ...intent.capability,
        scopeFingerprint: aiContext.construction.authorizationScopeFingerprint,
      },
    };
    const compiled = compileAiConstructionIntentProposal(adoptionIntent, {
      basis,
      bindings,
      allowedBindingIds: aiContext.construction.authorizedBindingIds,
      source,
      geometryDoc,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.transaction).toMatchObject({
      origin: 'ai',
      metadata: {
        proposalSchemaVersion: 'ai-construction-intent-batch-proposal/v1',
      },
    });

    const result = new TikzTransactionBroker(document).commit(compiled.transaction, {
      hash: basis.sourceHash,
      algorithm: 'fnv1a64-utf8',
      source,
      kernelHash: basis.kernelHash,
      projectionHash: basis.projectionHash,
      pluginSetDigest: basis.pluginSetDigest,
      authorizedBindingIds: aiContext.construction.authorizedBindingIds,
      authorizationScopeFingerprint: adoptionIntent.capability.scopeFingerprint,
      createCapabilityFingerprint: adoptionIntent.capability.fingerprint,
    });

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    const committedSource = document.getSnapshot().source;
    expect(committedSource).toContain('\\draw (O) circle (2);');
    expect(committedSource).toContain('role":"adopted-circle"');
    expect(committedSource).toContain('kind=point-on-circle');
  });

  it('rejects a self-consistent client plan when the original intent is removed', () => {
    const { source, document, basis, geometryDoc, bindings, intent } = fixture();
    const compiled = compileAiConstructionIntentProposal(intent, {
      basis,
      bindings,
      allowedBindingIds: ['binding:document:tikzpicture-body-end'],
      source,
      geometryDoc,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const forged = {
      ...compiled.transaction,
      metadata: {
        ...compiled.transaction.metadata,
        constructionIntentProof: null,
      },
    };

    const result = new TikzTransactionBroker(document).commit(forged, {
      hash: basis.sourceHash,
      algorithm: 'fnv1a64-utf8',
      source,
      kernelHash: basis.kernelHash,
      projectionHash: basis.projectionHash,
      pluginSetDigest: basis.pluginSetDigest,
      authorizedBindingIds: ['binding:document:tikzpicture-body-end'],
      authorizationScopeFingerprint: intent.capability.scopeFingerprint,
      createCapabilityFingerprint: intent.capability.fingerprint,
    });

    expect(result).toMatchObject({ ok: false, code: 'invalid-request' });
  });

  it('rejects projection drift before replay', () => {
    const { source, document, basis, geometryDoc, bindings, intent } = fixture();
    const compiled = compileAiConstructionIntentProposal(intent, {
      basis,
      bindings,
      allowedBindingIds: ['binding:document:tikzpicture-body-end'],
      source,
      geometryDoc,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    // Drift has to be expressed on the request. SourceHashEvidence.projectionHash
    // is an explicit caller cache that the Broker never treats as authority: it
    // re-projects the current source itself, so a forged evidence value is
    // correctly ignored and would prove nothing here.
    const drifted = {
      ...compiled.transaction,
      expectedProjectionHash: 'projection-drifted',
    };

    const result = new TikzTransactionBroker(document).commit(drifted, {
      hash: basis.sourceHash,
      algorithm: 'fnv1a64-utf8',
      source,
      kernelHash: basis.kernelHash,
      projectionHash: basis.projectionHash,
      pluginSetDigest: basis.pluginSetDigest,
      authorizedBindingIds: ['binding:document:tikzpicture-body-end'],
      authorizationScopeFingerprint: intent.capability.scopeFingerprint,
      createCapabilityFingerprint: intent.capability.fingerprint,
    });

    expect(result).toMatchObject({ ok: false, code: 'projection-hash-mismatch' });
  });

  it('rejects a canonical client plan when its attached intent replays differently', () => {
    const { source, document, basis, geometryDoc, bindings, intent } = fixture();
    const compiled = compileAiConstructionIntentProposal(intent, {
      basis,
      bindings,
      allowedBindingIds: ['binding:document:tikzpicture-body-end'],
      source,
      geometryDoc,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const tampered = {
      ...compiled.transaction,
      metadata: {
        ...compiled.transaction.metadata,
        constructionIntentProof: proofOf({
          ...intent,
          parameters: { x: 9, y: 2 },
        }),
      },
    };

    const result = new TikzTransactionBroker(document).commit(tampered, {
      hash: basis.sourceHash,
      algorithm: 'fnv1a64-utf8',
      source,
      kernelHash: basis.kernelHash,
      projectionHash: basis.projectionHash,
      pluginSetDigest: basis.pluginSetDigest,
      authorizedBindingIds: ['binding:document:tikzpicture-body-end'],
      authorizationScopeFingerprint: intent.capability.scopeFingerprint,
      createCapabilityFingerprint: intent.capability.fingerprint,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
      message: expect.stringContaining('differs from Broker Catalog intent replay'),
    });
  });

  it('rejects a self-consistent intent that selects bindings outside host authorization', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (B) at (2,0);\n\\end{tikzpicture}';
    const { document, basis, geometryDoc, bindings, intent } = fixture(source);
    const compiled = compileAiConstructionIntentProposal(intent, {
      basis,
      bindings,
      allowedBindingIds: ['binding:document:tikzpicture-body-end'],
      source,
      geometryDoc,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const pointBindingIds = ['A', 'B'].map((name) => {
      const entity = geometryDoc.semantic.ir.entities.find((candidate) => (
        candidate.kind === 'point' && candidate.name === name
      ));
      const entry = entity
        ? geometryDoc.sourceMap.entries.find((candidate) => (
          candidate.entityIds.includes(entity.id)
        ))
        : undefined;
      if (!entry) throw new TypeError(`Missing point binding for ${name}.`);
      return entry.bindingId;
    });
    const overreaching = {
      ...compiled.transaction,
      metadata: {
        ...compiled.transaction.metadata,
        constructionIntentProof: proofOf({
          ...intent,
          toolId: 'midpoint',
          bindingIds: pointBindingIds,
          requestedNames: {},
          parameters: {},
        }),
      },
    };

    const result = new TikzTransactionBroker(document).commit(overreaching, {
      hash: basis.sourceHash,
      algorithm: 'fnv1a64-utf8',
      source,
      kernelHash: basis.kernelHash,
      projectionHash: basis.projectionHash,
      pluginSetDigest: basis.pluginSetDigest,
      authorizedBindingIds: ['binding:document:tikzpicture-body-end'],
      authorizationScopeFingerprint: intent.capability.scopeFingerprint,
      createCapabilityFingerprint: intent.capability.fingerprint,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
      message: expect.stringContaining('outside the authorized scope'),
    });
  });
});
