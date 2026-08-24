import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import {
  CONSTRUCTION_CATALOG_DIGEST,
  CONSTRUCTION_TOOL_SPECS,
  createCatalogConstructionPlan,
} from '../authoring/construction-catalog';
import { constructionAuthorizationScopeFingerprint } from '../authoring/construction-authorization';
import type { ConstructionIntent } from '../authoring/construction-intent';
import { compileConstructionPlan } from '../authoring/construction-ir';
import { hashSource } from '../document/source-hash';
import { StudioDocument } from '../document/studio-document';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import { TikzTransactionBroker } from '../transactions/broker';
import type { AuthoringAnchor } from '../authoring/source-builder';
import { buildGeometryAiContext } from './ai-context';
import { compileAiConstructionIntentProposal } from './ai-construction-intent-proposal';
import { createGeometryDoc } from './geometry-doc';
import type { AiPatchBindingContext } from './ai-patch-proposal';
import { buildGeometrySourceMap } from './source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from './tikz-adapter';
import {
  compileAiManagedPresentationIntent,
  type AiManagedPresentationIntent,
} from './ai-managed-presentation-intent';
import { compileHostSemanticActionBatch } from './host-semantic-action-batch';
import { compileHostSemanticActionSet } from './host-semantic-action-set';

function anchor(name: string, x: number, y: number): AuthoringAnchor {
  return { name, position: { x, y }, existing: true };
}

function fixture() {
  const spec = CONSTRUCTION_TOOL_SPECS.find((candidate) => (
    candidate.id === 'nine-point-circle'
  ));
  if (!spec) throw new TypeError('Nine-point circle Catalog tool is unavailable.');
  let nameOrdinal = 0;
  const plan = createCatalogConstructionPlan(spec, {
    anchors: [
      anchor('A', 0, 0),
      anchor('B', 6, 0),
      anchor('C', 2, 4),
    ],
    nextName: (prefix) => `${prefix}${++nameOrdinal}`,
    nextConstructionId: () => 'nine-point-presentation-1',
  });
  const managedSource = compileConstructionPlan(plan).lines.join('\n');
  const source = [
    '\\begin{tikzpicture}',
    '\\coordinate (A) at (0,0);',
    '\\coordinate (B) at (6,0);',
    '\\coordinate (C) at (2,4);',
    managedSource,
    '\\end{tikzpicture}',
  ].join('\n');
  const document = new StudioDocument(source);
  const snapshot = document.getSnapshot();
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis: analyze(source, snapshot.revision),
    source,
    basis: {
      documentId: snapshot.documentId,
      epoch: snapshot.epoch,
      revision: snapshot.revision,
      sourceId: `${snapshot.documentId}:tikz`,
      sourceHash: hashSource(source),
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
    hashAlgorithm: 'fnv1a64-utf8',
  });
  const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
  const circleEntity = geometryDoc.semantic.ir.entities.find((entity) => (
    entity.kind === 'circle'
    && entity.metadata?.constructionId === plan.id
  )) ?? geometryDoc.semantic.ir.entities.find((entity) => entity.kind === 'circle');
  if (!circleEntity) throw new TypeError(
    `Nine-point circle entity was not projected: ${JSON.stringify(
      geometryDoc.semantic.ir.entities.map((entity) => ({ id: entity.id, kind: entity.kind })),
    )}`,
  );
  const aiContext = buildGeometryAiContext(geometryDoc, {
    focusRefs: [circleEntity.id],
    focusDepth: 3,
  });
  const sourceBinding = aiContext.construction.sourceBindings.find((binding) => (
    binding.managedConstructionId === plan.id
    && binding.managedPresentationTargets?.some((target) => (
      target.entityId === circleEntity.id
      && target.role === 'nine-point-circle-render'
    ))
  ));
  if (!sourceBinding) {
    throw new TypeError('Nine-point circle managed presentation binding was not advertised.');
  }
  const binding: AiPatchBindingContext = {
    bindingId: sourceBinding.id,
    sourceId: sourceBinding.sourceId,
    range: sourceBinding.range,
    writable: sourceBinding.writable,
    opaque: false,
    insertionPolicy: sourceBinding.insertionPolicy,
    writeCapabilities: sourceBinding.writeCapabilities,
    managedConstructionId: sourceBinding.managedConstructionId,
  };
  const basis = {
    ...geometryDoc.basis,
    sourceId: geometryDoc.basis.sourceId!,
    hashAlgorithm: 'fnv1a64-utf8' as const,
  };
  const intent: AiManagedPresentationIntent = {
    schemaVersion: 'managed-presentation-intent/v1',
    intentId: 'style-nine-point-circle-red',
    idempotencyKey: 'style-nine-point-circle-red',
    basis,
    focusBindingIds: [sourceBinding.id],
    readBindingIds: [sourceBinding.id],
    operation: {
      kind: 'set-managed-style',
      bindingId: sourceBinding.id,
      sourceId: sourceBinding.sourceId,
      constructionId: plan.id,
      targetEntityId: circleEntity.id,
      style: { color: 'red', width: 'very thick' },
    },
  };
  return {
    source,
    document,
    geometryDoc,
    aiContext,
    binding,
    basis,
    intent,
    plan,
    circleEntity,
  };
}

function projectDocument(document: StudioDocument) {
  const snapshot = document.getSnapshot();
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis: analyze(snapshot.source, snapshot.revision),
    source: snapshot.source,
    basis: {
      documentId: snapshot.documentId,
      epoch: snapshot.epoch,
      revision: snapshot.revision,
      sourceId: `${snapshot.documentId}:tikz`,
      sourceHash: hashSource(snapshot.source),
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
    hashAlgorithm: 'fnv1a64-utf8',
  });
  const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
  return {
    snapshot,
    geometryDoc,
    basis: {
      ...geometryDoc.basis,
      sourceId: geometryDoc.basis.sourceId!,
      hashAlgorithm: 'fnv1a64-utf8' as const,
    },
  };
}

function aiBindings(
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
    ...(binding.createCapabilityFingerprint
      ? { createCapabilityFingerprint: binding.createCapabilityFingerprint }
      : {}),
    ...(binding.managedConstructionId
      ? { managedConstructionId: binding.managedConstructionId }
      : {}),
  }));
}

describe('managed-presentation-intent/v1', () => {
  it('atomically applies one style update with several independently replayable labels', () => {
    const value = fixture();
    const center = value.geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'point'
      && entity.tags?.includes('center')
      && entity.tags.includes('nine-point-circle')
    ));
    if (!center) throw new TypeError('Nine-point center is unavailable.');
    const pointTargets = value.geometryDoc.semantic.ir.entities.filter((entity) => (
      entity.kind === 'point'
      && entity.id !== center.id
      && entity.tags?.includes('nine-point-circle')
    )).slice(0, 2).concat(center);
    if (pointTargets.length !== 3) {
      throw new TypeError('Nine-point construction has fewer than three label targets.');
    }
    const context = buildGeometryAiContext(value.geometryDoc, {
      focusRefs: [value.circleEntity.id, ...pointTargets.map((entity) => entity.id)],
      focusDepth: 4,
    });
    const insertion = context.construction.sourceBindings.find((binding) => (
      binding.id === 'binding:document:tikzpicture-body-end'
    ));
    const targetBindings = pointTargets.map((entity) => (
      context.construction.sourceBindings.find((binding) => (
        binding.id !== insertion?.id
        && value.geometryDoc.sourceMap.entries.find((entry) => (
          entry.bindingId === binding.id
          && entry.entityIds.length === 1
          && entry.entityIds[0] === entity.id
        ))
      ))
    ));
    if (
      !insertion?.createCapabilityFingerprint
      || targetBindings.some((binding) => !binding)
    ) {
      throw new TypeError('Nine-point points are not label-addressable.');
    }
    const intentBasis = {
      ...value.basis,
      kernelHash: value.basis.kernelHash!,
      projectionHash: value.basis.projectionHash!,
      pluginSetDigest: value.basis.pluginSetDigest!,
      constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
    };
    const labelIntents: ConstructionIntent[] = ['P', 'L', 'N'].map((text, index) => ({
      schemaVersion: 'construction-intent/v1',
      intentId: `set-label-${text.toLowerCase()}`,
      idempotencyKey: `set-label-${text.toLowerCase()}`,
      basis: intentBasis,
      operation: 'create',
      capability: {
        bindingId: insertion.id,
        fingerprint: insertion.createCapabilityFingerprint!,
        scopeFingerprint: context.construction.authorizationScopeFingerprint,
      },
      toolId: 'label',
      bindingIds: [targetBindings[index]!.id],
      requestedNames: {},
      parameters: { text },
    }));
    const compiled = compileHostSemanticActionSet({
      schemaVersion: 'host-semantic-action-set/v1',
      actionSetId: 'style-with-three-labels',
      idempotencyKey: 'style-with-three-labels',
      styleIntent: value.intent,
      labelIntents,
    }, {
      basis: value.basis,
      bindings: aiBindings(context),
      allowedBindingIds: context.construction.authorizedBindingIds,
      source: value.source,
      geometryDoc: value.geometryDoc,
    });
    if (!compiled.ok) throw new TypeError(JSON.stringify(compiled.errors));
    const patches = compiled.transaction.operations.flatMap((operation) => (
      operation.op === 'source-patch' ? operation.patches : []
    ));
    expect(patches).toHaveLength(2);
    expect(compiled.transaction.metadata?.managedConstructionCreateProofs)
      .toHaveLength(3);
    const labelOnly = compileHostSemanticActionSet({
      schemaVersion: 'host-semantic-action-set/v1',
      actionSetId: 'three-labels-without-style',
      idempotencyKey: 'three-labels-without-style',
      labelIntents,
    }, {
      basis: value.basis,
      bindings: aiBindings(context),
      allowedBindingIds: context.construction.authorizedBindingIds,
      source: value.source,
      geometryDoc: value.geometryDoc,
    });
    if (!labelOnly.ok) throw new TypeError(JSON.stringify(labelOnly.errors));
    expect(labelOnly.transaction.operations[0]?.op === 'source-patch'
      ? labelOnly.transaction.operations[0].patches
      : []).toHaveLength(1);
    expect(labelOnly.transaction.metadata?.managedConstructionStyleProof)
      .toBeUndefined();

    const evidence = {
      hash: value.basis.sourceHash,
      algorithm: 'fnv1a64-utf8' as const,
      source: value.source,
      kernelHash: value.basis.kernelHash,
      projectionHash: value.basis.projectionHash,
      pluginSetDigest: value.basis.pluginSetDigest,
      authorizedBindingIds: context.construction.authorizedBindingIds,
      authorizationScopeFingerprint:
        context.construction.authorizationScopeFingerprint,
      createCapabilityFingerprint: insertion.createCapabilityFingerprint,
    };
    const labelOnlyDocument = new StudioDocument(value.source, {
      documentId: value.basis.documentId,
      epoch: value.basis.epoch,
    });
    expect(new TikzTransactionBroker(labelOnlyDocument).commit(
      labelOnly.transaction,
      evidence,
    )).toMatchObject({ ok: true, toRevision: 1 });
    const labelOnlySource = labelOnlyDocument.getSnapshot().source;
    for (const label of ['{P}', '{L}', '{N}']) {
      expect(labelOnlySource).toContain(label);
    }

    const forged = structuredClone(compiled.transaction);
    const forgedProof = forged.metadata?.hostSemanticActionSetProof as {
      labelIntents: { parameters: { text: string } }[];
    };
    forgedProof.labelIntents[1]!.parameters.text = 'forged';
    expect(new TikzTransactionBroker(value.document).commit(forged, evidence))
      .toMatchObject({ ok: false });
    expect(value.document.getSnapshot().revision).toBe(0);

    const committed = new TikzTransactionBroker(value.document).commit(
      compiled.transaction,
      evidence,
    );
    expect(committed).toMatchObject({ ok: true, toRevision: 1 });
    const nextSource = value.document.getSnapshot().source;
    expect(nextSource).toContain('red,very thick');
    for (const label of ['{P}', '{L}', '{N}']) expect(nextSource).toContain(label);
    expect(parseManagedConstructionBlocks(nextSource)).toHaveLength(4);
  });

  it('atomically applies a nine-point-circle style update and label creation', () => {
    const value = fixture();
    const center = value.geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'point'
      && entity.tags?.includes('center')
      && entity.tags.includes('nine-point-circle')
    ));
    if (!center) throw new TypeError('Nine-point center is unavailable.');
    const context = buildGeometryAiContext(value.geometryDoc, {
      focusRefs: [value.circleEntity.id, center.id],
      focusDepth: 4,
    });
    const insertion = context.construction.sourceBindings.find((binding) => (
      binding.id === 'binding:document:tikzpicture-body-end'
    ));
    const centerBinding = context.construction.sourceBindings.find((binding) => (
      binding.id !== insertion?.id
      && binding.managedConstructionId === value.plan.id
      && Boolean(binding.managedSourceRecordId)
      && value.geometryDoc.sourceMap.entries.find((entry) => (
        entry.bindingId === binding.id
      ))?.entityIds.length === 1
      && value.geometryDoc.sourceMap.entries.find((entry) => (
        entry.bindingId === binding.id
      ))?.entityIds[0] === center.id
    ));
    if (!insertion?.createCapabilityFingerprint || !centerBinding) {
      throw new TypeError('Nine-point center is not label-addressable.');
    }
    const labelIntent: ConstructionIntent = {
      schemaVersion: 'construction-intent/v1',
      intentId: 'batch-label-nine-point-center',
      idempotencyKey: 'batch-label-nine-point-center',
      basis: {
        ...value.basis,
        kernelHash: value.basis.kernelHash!,
        projectionHash: value.basis.projectionHash!,
        pluginSetDigest: value.basis.pluginSetDigest!,
        constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
      },
      operation: 'create',
      capability: {
        bindingId: 'binding:document:tikzpicture-body-end',
        fingerprint: insertion.createCapabilityFingerprint,
        scopeFingerprint: context.construction.authorizationScopeFingerprint,
      },
      toolId: 'label',
      bindingIds: [centerBinding.id],
      requestedNames: {},
      parameters: { text: '九点圆' },
    };
    const compiled = compileHostSemanticActionBatch({
      schemaVersion: 'host-semantic-action-batch/v1',
      batchId: 'batch-style-label-nine-point',
      idempotencyKey: 'batch-style-label-nine-point',
      styleIntent: value.intent,
      labelIntent,
    }, {
      basis: value.basis,
      bindings: aiBindings(context),
      allowedBindingIds: context.construction.authorizedBindingIds,
      source: value.source,
      geometryDoc: value.geometryDoc,
    });
    if (!compiled.ok) throw new TypeError(JSON.stringify(compiled.errors));
    const patches = compiled.transaction.operations.flatMap((operation) => (
      operation.op === 'source-patch' ? operation.patches : []
    ));
    expect(patches).toHaveLength(2);

    const forged = structuredClone(compiled.transaction);
    const forgedProof = forged.metadata?.hostSemanticActionBatchProof as {
      styleIntent: { operation: { targetEntityId: string } };
    };
    forgedProof.styleIntent.operation.targetEntityId = 'entity:forged-circle';
    const rejected = new TikzTransactionBroker(value.document).commit(
      forged,
      {
        hash: value.basis.sourceHash,
        algorithm: 'fnv1a64-utf8',
        source: value.source,
        kernelHash: value.basis.kernelHash,
        projectionHash: value.basis.projectionHash,
        pluginSetDigest: value.basis.pluginSetDigest,
        authorizedBindingIds: context.construction.authorizedBindingIds,
        authorizationScopeFingerprint:
          context.construction.authorizationScopeFingerprint,
        createCapabilityFingerprint: insertion.createCapabilityFingerprint,
      },
    );
    expect(rejected).toMatchObject({ ok: false });
    expect(value.document.getSnapshot().revision).toBe(0);

    const committed = new TikzTransactionBroker(value.document).commit(
      compiled.transaction,
      {
        hash: value.basis.sourceHash,
        algorithm: 'fnv1a64-utf8',
        source: value.source,
        kernelHash: value.basis.kernelHash,
        projectionHash: value.basis.projectionHash,
        pluginSetDigest: value.basis.pluginSetDigest,
        authorizedBindingIds: context.construction.authorizedBindingIds,
        authorizationScopeFingerprint:
          context.construction.authorizationScopeFingerprint,
        createCapabilityFingerprint: insertion.createCapabilityFingerprint,
      },
    );
    expect(committed).toMatchObject({ ok: true, toRevision: 1 });
    expect(value.document.getSnapshot().source).toContain('red,very thick');
    expect(value.document.getSnapshot().source).toContain('{九点圆}');
    expect(parseManagedConstructionBlocks(value.document.getSnapshot().source)).toHaveLength(2);
  });

  it('styles only the nine-point circle slot and commits one atomic managed rewrite', () => {
    const value = fixture();
    const compiled = compileAiManagedPresentationIntent(value.intent, {
      basis: value.basis,
      bindings: [value.binding],
      allowedBindingIds: value.aiContext.construction.authorizedBindingIds,
      source: value.source,
      geometryDoc: value.geometryDoc,
    });

    if (!compiled.ok) throw new TypeError(JSON.stringify(compiled.errors));
    expect(compiled.transaction.operations).toHaveLength(1);
    expect(compiled.transaction.operations[0]).toMatchObject({
      op: 'source-patch',
      patches: [{ insert: expect.stringContaining('red,very thick') }],
    });

    const committed = new TikzTransactionBroker(value.document).commit(
      compiled.transaction,
      {
        hash: value.basis.sourceHash,
        algorithm: 'fnv1a64-utf8',
        source: value.source,
        kernelHash: value.basis.kernelHash,
        projectionHash: value.basis.projectionHash,
        pluginSetDigest: value.basis.pluginSetDigest,
        authorizedBindingIds: value.aiContext.construction.authorizedBindingIds,
      },
    );

    if (!committed.ok) throw new TypeError(JSON.stringify(committed));
    expect(committed).toMatchObject({ ok: true, status: 'committed', toRevision: 1 });
    const nextSource = value.document.getSnapshot().source;
    expect(nextSource).toContain('red,very thick');
    expect(parseManagedConstructionBlocks(nextSource)).toHaveLength(1);
    expect(nextSource).toContain('"role":"nine-point-circle"');
  });

  it('keeps a focused nine-point follow-up context within the API request budget', () => {
    const value = fixture();
    const focused = buildGeometryAiContext(value.geometryDoc, {
      focusRefs: [value.circleEntity.id],
      focusDepth: 3,
      maxEntities: 220,
      maxConstraints: 160,
      maxRelations: 280,
      maxBindings: 220,
      maxOpaqueNodes: 96,
    });

    const serialized = JSON.stringify(focused);
    const sectionSizes = Object.fromEntries(Object.entries(focused).map(([key, item]) => (
      [key, JSON.stringify(item).length]
    )));
    const constructionSizes = {
      intentTools: JSON.stringify(focused.construction.intentTools).length,
      sourceBindings: JSON.stringify(focused.construction.sourceBindings).length,
      bindingSizes: focused.construction.sourceBindings.map((binding) => ({
        id: binding.id,
        size: JSON.stringify(binding).length,
        hasPlan: Boolean(binding.managedPlan),
      })).sort((left, right) => right.size - left.size).slice(0, 8),
      opaqueNodes: JSON.stringify(focused.construction.opaqueNodes).length,
    };
    expect(serialized.length, JSON.stringify({ sectionSizes, constructionSizes }))
      .toBeLessThanOrEqual(128_000);
    expect(focused.construction.sourceBindings.some((binding) => (
      binding.managedPresentationTargets?.some((target) => (
        target.entityId === value.circleEntity.id
      ))
    ))).toBe(true);
  });

  it('rejects an entity outside the advertised managed writer owners', () => {
    const value = fixture();
    const compiled = compileAiManagedPresentationIntent({
      ...value.intent,
      operation: {
        ...value.intent.operation,
        targetEntityId: 'entity:not-owned-by-nine-point-writer',
      },
    }, {
      basis: value.basis,
      bindings: [value.binding],
      allowedBindingIds: value.aiContext.construction.authorizedBindingIds,
      source: value.source,
      geometryDoc: value.geometryDoc,
    });

    expect(compiled).toMatchObject({
      ok: false,
      errors: [{ code: 'target-ambiguous' }],
    });
  });

  it('rejects a managed block outside the host-authorized focus scope', () => {
    const value = fixture();
    const compiled = compileAiManagedPresentationIntent(value.intent, {
      basis: value.basis,
      bindings: [value.binding],
      allowedBindingIds: [],
      source: value.source,
      geometryDoc: value.geometryDoc,
    });

    expect(compiled).toMatchObject({
      ok: false,
      errors: [{ code: 'binding-scope' }],
    });
  });

  it('creates a separate plain-text label bound to the nine-point center', () => {
    const value = fixture();
    const centerEntity = value.geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'point'
      && entity.tags?.includes('center')
      && entity.tags.includes('nine-point-circle')
    ));
    if (!centerEntity) throw new TypeError('Nine-point center was not projected.');
    const centerContext = buildGeometryAiContext(value.geometryDoc, {
      focusRefs: [centerEntity.id],
      focusDepth: 2,
    });
    const insertion = centerContext.construction.sourceBindings.find((binding) => (
      binding.id === 'binding:document:tikzpicture-body-end'
    ));
    const centerBinding = centerContext.construction.sourceBindings.find((binding) => (
      value.geometryDoc.sourceMap.entries.find((entry) => entry.bindingId === binding.id)
        ?.entityIds.includes(centerEntity.id)
      && binding.id !== insertion?.id
      && Boolean(binding.managedSourceRecordId)
    ));
    if (!insertion?.createCapabilityFingerprint || !centerBinding) {
      throw new TypeError('Label fixture has no current create/center capabilities.');
    }
    const documentInsertion = value.geometryDoc.construction.bindings.find((binding) => (
      binding.id === 'binding:document:tikzpicture-body-end'
    ));
    expect(documentInsertion?.metadata?.writeCapabilities)
      .toContain('create-managed-construction-batch');
    expect(documentInsertion?.metadata?.capabilityFingerprint)
      .toBe(insertion.createCapabilityFingerprint);
    const allowedBindingIds = centerContext.construction.authorizedBindingIds;
    const intent: ConstructionIntent = {
      schemaVersion: 'construction-intent/v1',
      intentId: 'label-nine-point-center',
      idempotencyKey: 'label-nine-point-center',
      basis: {
        ...value.basis,
        kernelHash: value.basis.kernelHash!,
        projectionHash: value.basis.projectionHash!,
        pluginSetDigest: value.basis.pluginSetDigest!,
        constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
      },
      operation: 'create',
      capability: {
        bindingId: 'binding:document:tikzpicture-body-end',
        fingerprint: insertion.createCapabilityFingerprint,
        scopeFingerprint: constructionAuthorizationScopeFingerprint({
          basis: value.geometryDoc.basis,
          authorizedBindingIds: allowedBindingIds,
          createCapabilityFingerprint: insertion.createCapabilityFingerprint,
        }),
      },
      toolId: 'label',
      bindingIds: [centerBinding.id],
      requestedNames: {},
      parameters: { text: '九点圆圆心' },
    };
    const bindings: AiPatchBindingContext[] = centerContext.construction.sourceBindings.map((binding) => ({
      bindingId: binding.id,
      sourceId: binding.sourceId,
      range: binding.range,
      writable: binding.writable,
      opaque: false,
      insertionPolicy: binding.insertionPolicy,
      writeCapabilities: binding.writeCapabilities,
      ...(binding.createCapabilityFingerprint
        ? { createCapabilityFingerprint: binding.createCapabilityFingerprint }
        : {}),
      ...(binding.managedConstructionId
        ? { managedConstructionId: binding.managedConstructionId }
        : {}),
    }));
    const compiled = compileAiConstructionIntentProposal(intent, {
      basis: value.basis,
      bindings,
      allowedBindingIds,
      source: value.source,
      geometryDoc: value.geometryDoc,
    });

    if (!compiled.ok) throw new TypeError(JSON.stringify(compiled.errors));
    const patches = compiled.transaction.operations.flatMap((operation) => (
      operation.op === 'source-patch' ? operation.patches : []
    ));
    expect(patches).toHaveLength(1);
    expect(patches[0]!.insert).toContain('{九点圆圆心}');
    expect(patches[0]!.insert).toContain('kind=label');
    expect(patches[0]!.insert).not.toContain('kind=nine-point-circle');
  });

  it('keeps create, managed style, label, and the next AI context aligned across revisions', () => {
    const value = fixture();
    const styled = compileAiManagedPresentationIntent(value.intent, {
      basis: value.basis,
      bindings: [value.binding],
      allowedBindingIds: value.aiContext.construction.authorizedBindingIds,
      source: value.source,
      geometryDoc: value.geometryDoc,
    });
    if (!styled.ok) throw new TypeError(JSON.stringify(styled.errors));
    const styleCommit = new TikzTransactionBroker(value.document).commit(
      styled.transaction,
      {
        hash: value.basis.sourceHash,
        algorithm: 'fnv1a64-utf8',
        source: value.source,
        kernelHash: value.basis.kernelHash,
        projectionHash: value.basis.projectionHash,
        pluginSetDigest: value.basis.pluginSetDigest,
        authorizedBindingIds: value.aiContext.construction.authorizedBindingIds,
      },
    );
    expect(styleCommit).toMatchObject({ ok: true, toRevision: 1 });

    const afterStyle = projectDocument(value.document);
    const circle = afterStyle.geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'circle'
      && entity.tags?.includes('nine-point-circle')
    ));
    const center = afterStyle.geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'point'
      && entity.tags?.includes('center')
      && entity.tags.includes('nine-point-circle')
    ));
    if (!circle || !center) throw new TypeError(
      `Styled nine-point geometry was not reprojected: ${JSON.stringify(
        afterStyle.geometryDoc.semantic.ir.entities.map((entity) => ({
          id: entity.id,
          kind: entity.kind,
          tags: entity.tags,
          constructionId: entity.metadata?.constructionId,
        })),
      )}`,
    );

    const centerContext = buildGeometryAiContext(afterStyle.geometryDoc, {
      focusRefs: [circle.id, center.id],
      focusDepth: 3,
    });
    const insertion = centerContext.construction.sourceBindings.find((binding) => (
      binding.id === 'binding:document:tikzpicture-body-end'
    ));
    const centerBinding = centerContext.construction.sourceBindings.find((binding) => (
      binding.id !== insertion?.id
      && afterStyle.geometryDoc.sourceMap.entries.find((entry) => (
        entry.bindingId === binding.id
      ))?.entityIds.includes(center.id)
    ));
    if (!insertion?.createCapabilityFingerprint || !centerBinding) {
      throw new TypeError('Reprojected nine-point center is not label-addressable.');
    }

    const labelIntent: ConstructionIntent = {
      schemaVersion: 'construction-intent/v1',
      intentId: 'label-styled-nine-point-center',
      idempotencyKey: 'label-styled-nine-point-center',
      basis: {
        ...afterStyle.basis,
        kernelHash: afterStyle.basis.kernelHash!,
        projectionHash: afterStyle.basis.projectionHash!,
        pluginSetDigest: afterStyle.basis.pluginSetDigest!,
        constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
      },
      operation: 'create',
      capability: {
        bindingId: 'binding:document:tikzpicture-body-end',
        fingerprint: insertion.createCapabilityFingerprint,
        scopeFingerprint: centerContext.construction.authorizationScopeFingerprint,
      },
      toolId: 'label',
      bindingIds: [centerBinding.id],
      requestedNames: {},
      parameters: { text: '九点圆心' },
    };
    const label = compileAiConstructionIntentProposal(labelIntent, {
      basis: afterStyle.basis,
      bindings: aiBindings(centerContext),
      allowedBindingIds: centerContext.construction.authorizedBindingIds,
      source: afterStyle.snapshot.source,
      geometryDoc: afterStyle.geometryDoc,
    });
    if (!label.ok) throw new TypeError(JSON.stringify(label.errors));
    const labelCommit = new TikzTransactionBroker(value.document).commit(
      label.transaction,
      {
        hash: afterStyle.basis.sourceHash,
        algorithm: 'fnv1a64-utf8',
        source: afterStyle.snapshot.source,
        kernelHash: afterStyle.basis.kernelHash,
        projectionHash: afterStyle.basis.projectionHash,
        pluginSetDigest: afterStyle.basis.pluginSetDigest,
        authorizedBindingIds: centerContext.construction.authorizedBindingIds,
        authorizationScopeFingerprint:
          centerContext.construction.authorizationScopeFingerprint,
        createCapabilityFingerprint: insertion.createCapabilityFingerprint,
      },
    );
    expect(labelCommit).toMatchObject({ ok: true, toRevision: 2 });

    const afterLabel = projectDocument(value.document);
    const nextContext = buildGeometryAiContext(afterLabel.geometryDoc, {
      focusRefs: [circle.id, center.id],
      focusDepth: 4,
    });
    const serialized = JSON.stringify(nextContext);
    expect(afterLabel.snapshot.source).toContain('red,very thick');
    expect(afterLabel.snapshot.source).toContain('{九点圆心}');
    expect(parseManagedConstructionBlocks(afterLabel.snapshot.source)).toHaveLength(2);
    expect(serialized).toContain('九点圆心');
    expect(serialized).toContain('nine-point-circle');
    expect(afterLabel.geometryDoc.basis.revision).toBe(2);
  });
});
