import { describe, expect, it } from 'vitest';
import { StudioDocument } from '../document/studio-document';
import { minimalTextPatch } from '../document/source-transaction';
import type { GeometryTransactionRequest } from '../ir/transactions';
import { hashSource } from '../semantics/scene-manifest';
import { TikzTransactionBroker } from './broker';
import { createPrimitiveConstructionPlan } from '../authoring/construction-catalog';
import {
  compileConstructionPlan,
  compileConstructionWriterArtifact,
  type ConstructionPlan,
} from '../authoring/construction-ir';
import { constructionPlanSyntaxKind } from '../authoring/construction-plan-codec';
import { compileNewManagedConstructionPlan } from '../authoring/construction-ir-v3';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import { compileManagedInspectorStyleProposal } from '../ir/inspector-style-proposal';
import { analyze } from '../analyze';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from '../ir/tikz-adapter';
import { buildGeometrySourceMap } from '../ir/source-map';
import { createGeometryDoc } from '../ir/geometry-doc';
import { managedBlockBindingId } from '../ir/managed-binding-id';
import {
  compileCanvasDragPatchesProposal,
  compileCanvasPointMoveProposal,
} from '../ir/canvas-point-move-proposal';
import {
  canvasDeletePatchFingerprint,
  compileCanvasDeleteProposal,
} from '../ir/canvas-delete-proposal';
import { planDeletion } from '../authoring/delete-transaction';
import { planGeometryDocDeletion } from '../authoring/geometry-delete-plan';
import { compileCanvasConstructionBatchProposal } from '../ir/canvas-construction-batch-proposal';
import { insertBeforeTikzEndPatch } from '../authoring/source-builder';
import { qualifiedManagedEntityReference } from '../ir/persistent-entity-reference';
import {
  coordinateLiteralPatch,
  styleOptionsPatch,
} from '../patch/source-patch';
import { compileInspectorDirectProposal } from '../ir/inspector-direct-proposal';
import { planSelectionTransform } from '../authoring/selection-transform';
import { createGeometryWorkspaceEdit } from '../ir/geometry-workspace-edit';
import { constructionAuthorizationScopeFingerprint } from '../authoring/construction-authorization';

// analyze() projects a semantic scene only for a complete tikzpicture
// document; a bare statement list yields status 'invalid' and no entities.
const wrap = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n`;

function geometryDocFor(
  document: StudioDocument,
  pluginSetDigest = TIKZ_PLUGIN_SET_DIGEST,
) {
  const snapshot = document.getSnapshot();
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis: analyze(snapshot.source, snapshot.revision),
    source: snapshot.source,
    hashAlgorithm: 'fnv1a64-utf8',
    basis: {
      documentId: snapshot.documentId,
      epoch: snapshot.epoch,
      revision: snapshot.revision,
      sourceHash: hashSource(snapshot.source),
      sourceId: `${snapshot.documentId}:tikz`,
      pluginSetDigest,
    },
  });
  return createGeometryDoc(truths, buildGeometrySourceMap(truths));
}

function requestFor(
  document: StudioDocument,
  pluginSetDigest: string,
): GeometryTransactionRequest {
  const snapshot = document.getSnapshot();
  const sourceId = `${snapshot.documentId}:tikz`;
  const from = snapshot.source.indexOf('(0,0)');
  const to = from + 5;
  return {
    schemaVersion: 'geometry-transaction/v1',
    transactionId: 'transaction-1',
    idempotencyKey: 'transaction-1',
    documentId: snapshot.documentId,
    documentEpoch: snapshot.epoch,
    origin: 'external',
    stage: 'validated',
    expectedRevision: snapshot.revision,
    sourceHash: hashSource(snapshot.source),
    pluginSetDigest,
    readSet: [{
      kind: 'source-range',
      sourceId,
      range: { start: from, end: to },
    }],
    writeSet: [{
      kind: 'source-range',
      sourceId,
      range: { start: from, end: to },
    }],
    preconditions: [{
      kind: 'source-slice-equals',
      sourceId,
      range: { start: from, end: to },
      text: '(0,0)',
    }],
    operations: [{
      operationId: 'operation-1',
      op: 'source-patch',
      patches: [{
        sourceId,
        range: { start: from, end: to },
        insert: '(1,1)',
        expectedText: '(0,0)',
      }],
    }],
  };
}

function aiPatchRequestFor(
  document: StudioDocument,
  bindingId: string,
  range: { start: number; end: number },
): GeometryTransactionRequest {
  const snapshot = document.getSnapshot();
  const sourceId = `${snapshot.documentId}:tikz`;
  const expectedText = snapshot.source.slice(range.start, range.end);
  const sourceOperation = {
    operationId: 'ai-patch-source',
    op: 'source-patch' as const,
    patches: [{
      sourceId,
      range,
      insert: expectedText,
      expectedText,
    }],
  };
  return {
    schemaVersion: 'geometry-transaction/v1',
    transactionId: 'ai-patch-transaction',
    idempotencyKey: 'ai-patch-transaction',
    documentId: snapshot.documentId,
    documentEpoch: snapshot.epoch,
    origin: 'ai',
    stage: 'validated',
    expectedRevision: snapshot.revision,
    sourceHash: hashSource(snapshot.source),
    pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    readSet: [{ kind: 'source-range', sourceId, range }],
    writeSet: [{ kind: 'source-range', sourceId, range }],
    preconditions: [{
      kind: 'source-slice-equals',
      sourceId,
      range,
      text: expectedText,
    }],
    operations: [sourceOperation],
    workspaceEdit: createGeometryWorkspaceEdit([sourceOperation], [{
      operationId: sourceOperation.operationId,
      label: 'Apply AI TikZ edit',
      description: '1 source patch will be applied atomically.',
      patchAnnotations: [{
        label: 'Modify TikZ geometry',
        description: `Update the attested source binding ${bindingId}.`,
      }],
    }]),
    metadata: {
      proposalSchemaVersion: 'ai-patch-proposal/v1',
      focusBindingIds: [bindingId],
      readBindingIds: [bindingId],
      bindingPreconditions: [{
        bindingId,
        sourceId,
        range,
        writable: true,
        opaque: false,
      }],
    },
  };
}

describe('TikzTransactionBroker semantic guards', () => {
  it('rejects an AI patch whose claimed binding is outside the host-authorized scope', () => {
    const document = new StudioDocument(wrap('\\coordinate (A) at (0,0);'));
    const snapshot = document.getSnapshot();
    const doc = geometryDocFor(document);
    const binding = doc.construction.bindings.find((candidate) => (
      candidate.writable
      && candidate.source.range.start < candidate.source.range.end
      && candidate.source.verbatim.includes('(0,0)')
    ));
    expect(binding).toBeDefined();
    const request = aiPatchRequestFor(
      document,
      binding!.id,
      binding!.source.range,
    );

    const result = new TikzTransactionBroker(document).commit(request, {
      hash: hashSource(snapshot.source),
      algorithm: 'fnv1a64-utf8',
      source: snapshot.source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      authorizedBindingIds: [],
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
      message: expect.stringContaining('read/focus binding scope'),
    });
    expect(document.getSnapshot().source).toBe(snapshot.source);
  });

  it('rejects AI review metadata that differs from the current Broker replay', () => {
    const document = new StudioDocument(wrap('\\coordinate (A) at (0,0);'));
    const snapshot = document.getSnapshot();
    const doc = geometryDocFor(document);
    const binding = doc.construction.bindings.find((candidate) => (
      candidate.writable
      && candidate.source.range.start < candidate.source.range.end
      && candidate.source.verbatim.includes('(0,0)')
    ));
    const insertionBinding = doc.construction.bindings.find((candidate) => (
      candidate.id === 'binding:document:tikzpicture-body-end'
    ));
    expect(binding).toBeDefined();
    const createCapabilityFingerprint =
      typeof insertionBinding?.metadata?.capabilityFingerprint === 'string'
        ? insertionBinding.metadata.capabilityFingerprint
        : '';
    const request = aiPatchRequestFor(document, binding!.id, binding!.source.range);
    const forged: GeometryTransactionRequest = {
      ...request,
      workspaceEdit: {
        ...request.workspaceEdit!,
        changeAnnotations: {
          ...request.workspaceEdit!.changeAnnotations,
          'change-1-patch-1': { label: 'Delete every object' },
        },
      },
    };
    const authorizedBindingIds = [binding!.id];
    const result = new TikzTransactionBroker(document).commit(forged, {
      hash: hashSource(snapshot.source),
      algorithm: 'fnv1a64-utf8',
      source: snapshot.source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      authorizedBindingIds,
      createCapabilityFingerprint,
      authorizationScopeFingerprint: constructionAuthorizationScopeFingerprint({
        basis: doc.basis,
        authorizedBindingIds,
        createCapabilityFingerprint,
      }),
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
      message: expect.stringContaining('review metadata'),
    });
    expect(document.getSnapshot()).toMatchObject({ source: snapshot.source, revision: 0 });
  });

  it('commits one mixed v2/v3 Canvas construction batch through canonical replay', () => {
    const source = '\\begin{tikzpicture}\n\\end{tikzpicture}';
    const document = new StudioDocument(source);
    const pointA = createPrimitiveConstructionPlan('point', {
      anchors: [{ name: 'A', position: { x: 0, y: 0 }, existing: false }],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'owned-point-a',
    });
    const pointB = createPrimitiveConstructionPlan('point', {
      anchors: [{ name: 'B', position: { x: 2, y: 0 }, existing: false }],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'owned-point-b',
    });
    const segment = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'segment-a-b',
    });
    const proposal = compileCanvasConstructionBatchProposal({
      source,
      geometryDoc: geometryDocFor(document),
      plans: [pointA, pointB, segment],
      primaryConstructionId: segment.id,
    });

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    const blocks = parseManagedConstructionBlocks(document.getSnapshot().source);
    expect(blocks.map((block) => [block.id, block.schemaVersion])).toEqual([
      ['owned-point-a', 2],
      ['owned-point-b', 2],
      ['segment-a-b', 3],
    ]);
  });

  it('rejects a Canvas plan that carries semantic records outside its catalog footprint', () => {
    const source = '\\begin{tikzpicture}\n\\end{tikzpicture}';
    const document = new StudioDocument(source);
    const pointA = createPrimitiveConstructionPlan('point', {
      anchors: [{ name: 'A', position: { x: 0, y: 0 }, existing: false }],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'owned-point-a',
    });
    const pointB = createPrimitiveConstructionPlan('point', {
      anchors: [{ name: 'B', position: { x: 2, y: 0 }, existing: false }],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'owned-point-b',
    });
    const segment = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'segment-a-b',
    });
    const forged: ConstructionPlan = {
      ...segment,
      relations: [
        ...segment.relations,
        {
          recordType: 'relation',
          id: 'injected-relation',
          kind: 'depends-on',
          from: 'entity-segment-a-b',
          to: 'A',
          directed: true,
        },
      ],
    };

    expect(() => compileCanvasConstructionBatchProposal({
      source,
      geometryDoc: geometryDocFor(document),
      plans: [pointA, pointB, forged],
      primaryConstructionId: forged.id,
    })).toThrow('non-canonical semantic footprint');
  });

  it('rejects a Canvas plan whose external input is absent from GeometryDoc and the batch', () => {
    const source = '\\begin{tikzpicture}\n\\end{tikzpicture}';
    const document = new StudioDocument(source);
    const segment = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'GhostA', position: { x: 0, y: 0 }, existing: true },
        { name: 'GhostB', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'segment-ghost',
    });

    expect(() => compileCanvasConstructionBatchProposal({
      source,
      geometryDoc: geometryDocFor(document),
      plans: [segment],
      primaryConstructionId: segment.id,
    })).toThrow('input capability is stale');
  });

  it('rejects an untyped raw Canvas insertion that creates a managed block', () => {
    const source = '\\begin{tikzpicture}\n\\end{tikzpicture}';
    const document = new StudioDocument(source);
    const plan = createPrimitiveConstructionPlan('point', {
      anchors: [{ name: 'A', position: { x: 0, y: 0 }, existing: false }],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'raw-canvas-point',
    });
    const patch = insertBeforeTikzEndPatch(
      source,
      compileNewManagedConstructionPlan(plan).lines,
    );

    const result = new TikzTransactionBroker(document).commitPatches({
      patches: [patch],
      origin: 'canvas',
      expectedRevision: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
    expect(document.getSnapshot().source).toBe(source);
  });

  it('rejects an untyped Canvas patch that introduces even a detached managed directive', () => {
    const source = '\\begin{tikzpicture}\n\\end{tikzpicture}';
    const document = new StudioDocument(source);
    const insertion = source.indexOf('\\end{tikzpicture}');

    const result = new TikzTransactionBroker(document).commitPatches({
      patches: [{
        from: insertion,
        to: insertion,
        insert: '% @mathgeo begin schema=999 id=detached\n',
      }],
      origin: 'canvas',
      expectedRevision: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
    expect(document.getSnapshot().source).toBe(source);
  });

  it('rejects an untyped raw Canvas deletion of ordinary TikZ', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\draw (A) -- (1,0);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const statement = '\\coordinate (A) at (0,0);\n';

    const result = new TikzTransactionBroker(document).commitPatches({
      patches: [{ from: 0, to: statement.length, insert: '' }],
      origin: 'canvas',
      expectedRevision: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
    expect(document.getSnapshot().source).toBe(source);
  });

  it('does not let Canvas style-origin patches bypass the managed directive guard', () => {
    const source = '\\begin{tikzpicture}\n\\end{tikzpicture}';
    const document = new StudioDocument(source);
    const insertion = source.indexOf('\\end{tikzpicture}');

    const result = new TikzTransactionBroker(document).commitPatches({
      patches: [{
        from: insertion,
        to: insertion,
        insert: '% @mathgeo begin schema=999 id=style-origin-bypass\n',
      }],
      origin: 'style',
      expectedRevision: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
    expect(document.getSnapshot().source).toBe(source);
  });

  it('does not let a style-origin alias bypass typed Canvas deletion', () => {
    const source = wrap('\\coordinate (A) at (0,0);');
    const document = new StudioDocument(source);

    const result = new TikzTransactionBroker(document).commitPatches({
      patches: [{ from: 0, to: source.length, insert: '' }],
      origin: 'style',
      expectedRevision: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
    expect(document.getSnapshot().source).toBe(source);
  });

  it('adopts one raw circle and creates its dependent plan in the same Canvas revision', () => {
    const source = [
      '\\begin{tikzpicture}',
      '\\coordinate (O) at (0,0);',
      '\\coordinate (A) at (3,4);',
      '\\node[draw,circle through=(A)] at (O) {};',
      '\\end{tikzpicture}',
    ].join('\n');
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const rawCircle = geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'circle'
      && typeof entity.metadata?.persistentSourceReference === 'string'
    ));
    expect(rawCircle).toBeDefined();
    if (!rawCircle) return;
    const sourceBindingId = rawCircle.sourceBindingIds?.[0];
    const sourceBinding = geometryDoc.construction.bindings.find((binding) => (
      binding.id === sourceBindingId
    ));
    const sourceStableId = rawCircle.metadata?.persistentSourceReference;
    expect(sourceBinding).toBeDefined();
    if (
      !sourceBinding
      || typeof sourceBindingId !== 'string'
      || typeof sourceStableId !== 'string'
    ) return;
    const managedCircleRef = qualifiedManagedEntityReference(
      'adopted-circle',
      'circle',
    );
    const pointOnCircle: ConstructionPlan = {
      id: 'point-on-adopted-circle',
      kind: 'point-on-circle',
      inputs: [{ id: 'circle', role: 'circle', ref: managedCircleRef }],
      entities: [{
        recordType: 'entity',
        id: 'entity-P',
        name: 'P',
        kind: 'point',
        tags: ['derived', 'on-circle'],
      }],
      constraints: [{
        recordType: 'constraint',
        id: 'constraint-P',
        kind: 'on-circle',
        point: 'P',
        circle: managedCircleRef,
      }],
      relations: [{
        recordType: 'relation',
        id: 'depends-P',
        kind: 'depends-on',
        from: 'P',
        to: managedCircleRef,
        directed: true,
      }],
      outputs: [{
        recordType: 'output',
        id: 'output-P',
        role: 'point',
        ref: 'P',
        kind: 'derived-point',
      }],
      circle: {
        id: managedCircleRef,
        center: 'O',
        through: 'A',
        radius: 5,
        angleDegrees: 30,
      },
      result: 'P',
      selection: ['P'],
      status: 'created P',
    };
    const proposal = compileCanvasConstructionBatchProposal({
      source,
      geometryDoc,
      plans: [pointOnCircle],
      primaryConstructionId: pointOnCircle.id,
      adoptions: [{
        constructionId: 'adopted-circle',
        sourceEntityId: rawCircle.id,
        sourceBindingId,
        managedEntityId: 'circle',
        sourceStableId,
        range: { ...sourceBinding.source.range },
        definition: {
          kind: 'center-through',
          centerName: 'O',
          throughName: 'A',
        },
      }],
    });

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(result.ok && result.toRevision).toBe(1);
    expect(parseManagedConstructionBlocks(document.getSnapshot().source)
      .map((block) => block.id)).toEqual([
      'adopted-circle',
      'point-on-adopted-circle',
    ]);
  });

  it('rejects a dependent plan whose parameters disagree with its adopted circle capability', () => {
    const source = [
      '\\begin{tikzpicture}',
      '\\coordinate (O) at (0,0);',
      '\\coordinate (A) at (3,4);',
      '\\node[draw,circle through=(A)] at (O) {};',
      '\\end{tikzpicture}',
    ].join('\n');
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const rawCircle = geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'circle'
      && typeof entity.metadata?.persistentSourceReference === 'string'
    ));
    expect(rawCircle).toBeDefined();
    if (!rawCircle) return;
    const sourceBindingId = rawCircle.sourceBindingIds?.[0];
    const sourceBinding = geometryDoc.construction.bindings.find((binding) => (
      binding.id === sourceBindingId
    ));
    const sourceStableId = rawCircle.metadata?.persistentSourceReference;
    if (
      !sourceBinding
      || typeof sourceBindingId !== 'string'
      || typeof sourceStableId !== 'string'
    ) return;
    const managedCircleRef = qualifiedManagedEntityReference('adopted-circle', 'circle');
    const forged: ConstructionPlan = {
      id: 'point-on-forged-circle-parameters',
      kind: 'point-on-circle',
      inputs: [{ id: 'circle', role: 'circle', ref: managedCircleRef }],
      entities: [{
        recordType: 'entity', id: 'entity-P', name: 'P', kind: 'point',
        tags: ['derived', 'on-circle'],
      }],
      constraints: [{
        recordType: 'constraint', id: 'constraint-P', kind: 'on-circle',
        point: 'P', circle: managedCircleRef,
      }],
      relations: [{
        recordType: 'relation', id: 'depends-P', kind: 'depends-on',
        from: 'P', to: managedCircleRef, directed: true,
      }],
      outputs: [{
        recordType: 'output', id: 'output-P', role: 'point', ref: 'P',
        kind: 'derived-point',
      }],
      circle: {
        id: managedCircleRef,
        center: 'A',
        through: 'O',
        radius: 5,
        angleDegrees: 30,
      },
      result: 'P',
      selection: ['P'],
      status: 'forged',
    };

    expect(() => compileCanvasConstructionBatchProposal({
      source,
      geometryDoc,
      plans: [forged],
      primaryConstructionId: forged.id,
      adoptions: [{
        constructionId: 'adopted-circle',
        sourceEntityId: rawCircle.id,
        sourceBindingId,
        managedEntityId: 'circle',
        sourceStableId,
        range: { ...sourceBinding.source.range },
        definition: {
          kind: 'center-through',
          centerName: 'O',
          throughName: 'A',
        },
      }],
    })).toThrow('stale circle capability');
  });

  it('rejects raw Canvas deletion of a managed block without a typed delete proof', () => {
    const plan = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-delete-raw',
    });
    const source = wrap(compileNewManagedConstructionPlan(plan).lines.join('\n'));
    const block = parseManagedConstructionBlocks(source)[0]!;
    const document = new StudioDocument(source);

    const result = new TikzTransactionBroker(document).commitPatches({
      patches: [{ from: block.range.start, to: block.range.end, insert: '' }],
      origin: 'canvas',
      expectedRevision: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
  });

  it('commits a managed whole-block deletion through GeometryDoc capability proof', () => {
    const construction = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-delete-typed',
    });
    // `existing: true` anchors are declared outside the block, so the document
    // must actually contain them or the scene fails on undefined points.
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (2,0);',
      ...compileNewManagedConstructionPlan(construction).lines,
    ].join('\n'));
    const analysis = analyze(source, 0);
    expect(analysis.scene).not.toBeNull();
    expect(analysis.stmts).not.toBeNull();
    if (!analysis.scene || !analysis.stmts) return;
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const managedEntity = geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'segment'
    ));
    expect(managedEntity).toBeTruthy();
    if (!managedEntity) return;
    const deletePlan = planGeometryDocDeletion({
      source,
      geometryDoc,
      statements: analysis.stmts,
      targets: managedEntity.id,
      mode: 'block',
    });
    expect(deletePlan.canApply).toBe(true);
    const proposal = compileCanvasDeleteProposal({
      source,
      geometryDoc,
      plan: deletePlan,
    });

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    // Only the managed block is removed; the two anchor coordinates and the
    // tikzpicture wrapper bytes survive, per the source-preservation invariant.
    expect(document.getSnapshot().source).toBe(wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (2,0);',
    ].join('\n')));
  });

  it('commits an ordinary Canvas deletion only after Broker GeometryDoc replay', () => {
    const source = wrap('\\draw (0,0) -- (2,0);');
    const analysis = analyze(source, 0);
    expect(analysis.scene).not.toBeNull();
    expect(analysis.stmts).not.toBeNull();
    if (!analysis.scene || !analysis.stmts) return;
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const entity = geometryDoc.semantic.ir.entities.find((candidate) => (
      candidate.dimension === 1
    ));
    expect(entity).toBeTruthy();
    if (!entity) return;
    const plan = planGeometryDocDeletion({
      source,
      geometryDoc,
      statements: analysis.stmts,
      targets: entity.id,
      mode: 'block',
    });
    expect(plan.canApply).toBe(true);
    const proposal = compileCanvasDeleteProposal({
      source,
      geometryDoc,
      plan,
    });

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    // Block deletion removes the statement's whole line, its terminating
    // newline included; the tikzpicture wrapper bytes stay untouched, per the
    // source-preservation invariant.
    expect(document.getSnapshot().source).toBe('\\begin{tikzpicture}\n\\end{tikzpicture}\n');
  });

  it('rejects a self-hashed Canvas delete proof for an arbitrary ordinary range', () => {
    const source = wrap('\\draw (0,0) -- (2,0);');
    const analysis = analyze(source, 0);
    expect(analysis.scene).not.toBeNull();
    expect(analysis.stmts).not.toBeNull();
    if (!analysis.scene || !analysis.stmts) return;
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const entity = geometryDoc.semantic.ir.entities.find((candidate) => (
      candidate.dimension === 1
    ));
    expect(entity).toBeTruthy();
    if (!entity) return;
    const plan = planGeometryDocDeletion({
      source,
      geometryDoc,
      statements: analysis.stmts,
      targets: entity.id,
      mode: 'block',
    });
    const proposal = compileCanvasDeleteProposal({
      source,
      geometryDoc,
      plan,
    });
    const proof = proposal.transaction.metadata?.canvasDeleteProof as Record<
      string,
      unknown
    >;
    const sourceId = `${document.getSnapshot().documentId}:tikz`;
    const patch = { from: 0, to: 5, insert: '' };
    const range = { start: patch.from, end: patch.to };
    const preconditions = [{
      kind: 'source-slice-equals' as const,
      sourceId,
      range,
      text: source.slice(patch.from, patch.to),
    }];
    const transaction = {
      ...proposal.transaction,
      transactionId: 'forged-ordinary-canvas-delete',
      idempotencyKey: 'forged-ordinary-canvas-delete',
      readSet: [{ kind: 'source-range' as const, sourceId, range }],
      writeSet: [{ kind: 'source-range' as const, sourceId, range }],
      preconditions,
      operations: [{
        operationId: 'forged-ordinary-canvas-delete:source',
        op: 'source-patch' as const,
        patches: [{
          sourceId,
          range,
          insert: '',
          expectedText: source.slice(patch.from, patch.to),
        }],
        preconditions,
      }],
      metadata: {
        ...proposal.transaction.metadata,
        canvasDeleteProof: {
          ...proof,
          patchFingerprint: canvasDeletePatchFingerprint(source, [patch]),
        },
      },
    } satisfies GeometryTransactionRequest;

    const result = new TikzTransactionBroker(document).commit(transaction, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
  });

  it('fails closed when opaque TikZ could hide a deletion dependency', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\unknownofficialcommand (A);',
    ].join('\n'));
    const analysis = analyze(source, 0);
    expect(analysis.status).toBe('partial');
    expect(analysis.scene).not.toBeNull();
    expect(analysis.stmts).not.toBeNull();
    if (!analysis.scene || !analysis.stmts) return;
    const plan = planDeletion({
      source,
      scene: analysis.scene,
      statements: analysis.stmts,
      targets: 'point:A',
      mode: 'block',
    });
    const document = new StudioDocument(source);

    expect(() => compileCanvasDeleteProposal({
      source,
      geometryDoc: geometryDocFor(document),
      plan,
    })).toThrow(/complete current GeometryDoc/);
  });

  it('commits a managed Canvas point move through one typed semantic replacement', () => {
    const plan = createPrimitiveConstructionPlan('point', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: false },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-point-move-1',
    });
    const source = wrap(compileConstructionPlan(plan).lines.join('\n'));
    const document = new StudioDocument(source);
    const proposal = compileCanvasPointMoveProposal({
      source,
      geometryDoc: geometryDocFor(document),
      sourceStableId: 'point:A',
      pointName: 'A',
      target: { x: 3.25, y: -1.5 },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) return;

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source)
      .toContain('\\coordinate (A) at (3.25,-1.5);');
  });

  it('commits a direct point move only through Broker-replayed coordinate proof', () => {
    const source = wrap('\\coordinate (A) at (0,0);');
    const document = new StudioDocument(source);
    const proposal = compileCanvasPointMoveProposal({
      source,
      geometryDoc: geometryDocFor(document),
      sourceStableId: 'point:A',
      pointName: 'A',
      target: { x: 2.5, y: -3 },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) return;

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source)
      .toBe(wrap('\\coordinate (A) at (2.5,-3);'));
  });

  it('inverse-projects a scoped free-point move before Broker source writeback', () => {
    const source = wrap([
      '\\begin{scope}[xshift=2cm]',
      '\\coordinate (A) at (0,0);',
      '\\end{scope}',
    ].join('\n'));
    const document = new StudioDocument(source);
    const proposal = compileCanvasPointMoveProposal({
      source,
      geometryDoc: geometryDocFor(document),
      sourceStableId: 'point:A',
      pointName: 'A',
      target: { x: 5, y: 1 },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) return;

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source).toContain('\\coordinate (A) at (3,1);');
    expect(analyze(document.getSnapshot().source, 1).scene?.points.get('A')?.position)
      .toEqual({ x: 5, y: 1 });
  });

  it('inverse-projects a free-point move through a general affine scope CTM', () => {
    const source = wrap([
      '\\begin{scope}[xscale=2,yslant=.5]',
      '\\coordinate (A) at (1,2);',
      '\\end{scope}',
    ].join('\n'));
    const document = new StudioDocument(source);
    const proposal = compileCanvasPointMoveProposal({
      source,
      geometryDoc: geometryDocFor(document),
      sourceStableId: 'point:A',
      pointName: 'A',
      target: { x: 8, y: 5 },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) return;

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source).toContain('\\coordinate (A) at (4,3);');
    expect(analyze(document.getSnapshot().source, 1).scene?.points.get('A')?.position)
      .toEqual({ x: 8, y: 5 });
  });

  it('commits a solver coordinate batch through one replayed Canvas proof', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (4,0);',
      '\\coordinate (M) at ($(A)!0.5!(B)$);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const analysis = analyze(source, 0);
    const patches = [
      coordinateLiteralPatch(source, analysis.freePointRanges.get('A')!, { x: 1, y: 1 }),
      coordinateLiteralPatch(source, analysis.freePointRanges.get('B')!, { x: 5, y: 1 }),
    ];
    const proposal = compileCanvasDragPatchesProposal({
      source,
      geometryDoc: geometryDocFor(document),
      sourceStableId: 'point:M',
      pointName: 'M',
      mode: 'derived-coordinates',
      patches,
    });

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source).toContain('\\coordinate (A) at (1,1);');
    expect(document.getSnapshot().source).toContain('\\coordinate (B) at (5,1);');
  });

  it('rejects a derived drag that claims one point but writes an unrelated free point', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (4,0);',
      '\\coordinate (Z) at (8,0);',
      '\\coordinate (M) at ($(A)!0.5!(B)$);',
      '\\coordinate (N) at ($(Z)!0.5!(A)$);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const analysis = analyze(source, 0);
    const unrelatedPatch = coordinateLiteralPatch(
      source,
      analysis.freePointRanges.get('Z')!,
      { x: 9, y: 1 },
    );
    const proposalForN = compileCanvasDragPatchesProposal({
      source,
      geometryDoc: geometryDocFor(document),
      sourceStableId: 'point:N',
      pointName: 'N',
      mode: 'derived-coordinates',
      patches: [unrelatedPatch],
    });
    const proofForN = proposalForN.transaction.metadata
      ?.canvasPointMoveProof as Record<string, unknown>;
    const forged = {
      ...proposalForN.transaction,
      transactionId: 'forged-derived-drag-dependency-domain',
      idempotencyKey: 'forged-derived-drag-dependency-domain',
      metadata: {
        ...proposalForN.transaction.metadata,
        semanticEntityId: 'point:M',
        canvasPointMoveProof: {
          ...proofForN,
          pointName: 'M',
          sourceStableId: 'point:M',
          authorizedVariableEntityIds: ['point:Z'],
        },
      },
    } satisfies GeometryTransactionRequest;

    const result = new TikzTransactionBroker(document).commit(forged, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
    expect(document.getSnapshot().source).toBe(source);
  });

  it('replays a whole-selection transform and rejects forged selection authority', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (4,0);',
      '\\coordinate (Z) at (8,0);',
      '\\draw (A) -- (B);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const segment = geometryDoc.semantic.ir.entities.find((entity) => entity.kind === 'polyline')!;
    const plan = planSelectionTransform(source, geometryDoc, [segment.id], {
      kind: 'translate',
      dx: 1,
      dy: 2,
    });
    const proposal = compileCanvasDragPatchesProposal({
      source,
      geometryDoc,
      sourceStableId: segment.id,
      pointName: '@selection',
      mode: 'selection-transform',
      patches: plan.patches,
      selectedEntityIds: [segment.id],
      selectionTransform: plan.transform,
      acknowledgedExternalImpactedEntityIds: plan.externalImpactedEntityIds,
    });
    const proof = proposal.transaction.metadata?.canvasPointMoveProof as Record<string, unknown>;
    const forged = {
      ...proposal.transaction,
      transactionId: 'forged-selection-transform-authority',
      idempotencyKey: 'forged-selection-transform-authority',
      metadata: {
        ...proposal.transaction.metadata,
        canvasPointMoveProof: {
          ...proof,
          selectedEntityIds: ['point:Z'],
          authorizedVariableEntityIds: ['point:A', 'point:B'],
        },
      },
    } satisfies GeometryTransactionRequest;

    const result = new TikzTransactionBroker(document).commit(forged, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });

    expect(result).toMatchObject({ ok: false, code: 'managed-construction-conflict' });
    expect(document.getSnapshot().source).toBe(source);
  });

  it('rejects an incomplete selection transform even inside the authorized variable closure', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (4,0);',
      '\\draw (A) -- (B);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const segment = geometryDoc.semantic.ir.entities.find((entity) => entity.kind === 'polyline')!;
    const plan = planSelectionTransform(source, geometryDoc, [segment.id], {
      kind: 'translate', dx: 1, dy: 2,
    });
    expect(plan.patches).toHaveLength(2);
    expect(() => compileCanvasDragPatchesProposal({
      source,
      geometryDoc,
      sourceStableId: segment.id,
      pointName: '@selection',
      mode: 'selection-transform',
      patches: plan.patches.slice(0, 1),
      selectedEntityIds: [segment.id],
      selectionTransform: plan.transform,
      acknowledgedExternalImpactedEntityIds: plan.externalImpactedEntityIds,
    })).toThrow(/canonical affine transform/i);
    expect(document.getSnapshot().source).toBe(source);
  });

  it('rejects a selection transform until the exact external impact set is acknowledged', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (4,0);',
      '\\coordinate (C) at (0,3);',
      '\\draw (A) -- (B);',
      '\\draw (A) -- (C);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const segments = geometryDoc.semantic.ir.entities.filter((entity) => entity.kind === 'polyline');
    const plan = planSelectionTransform(source, geometryDoc, [segments[0]!.id], {
      kind: 'translate', dx: 1, dy: 0,
    });
    expect(plan.externalImpactedEntityIds).toContain(segments[1]!.id);

    expect(() => compileCanvasDragPatchesProposal({
      source,
      geometryDoc,
      sourceStableId: segments[0]!.id,
      pointName: '@selection',
      mode: 'selection-transform',
      patches: plan.patches,
      selectedEntityIds: [segments[0]!.id],
      selectionTransform: plan.transform,
    })).toThrow(/确认完整影响域/);
  });

  it('commits a direct Inspector style patch through its selected binding proof', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (2,0);',
      '\\draw (A) -- (B);',
      '\\draw[blue] (A) circle (1);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    // Plain source projects a two-point \draw as `polyline`; `segment` is a
    // managed-record semantic kind and never appears without @mathgeo metadata.
    const drawEntity = geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'polyline'
    ));
    expect(drawEntity).toBeDefined();
    if (!drawEntity) return;
    const insertAt = source.indexOf('\\draw') + '\\draw'.length;
    const proposal = compileInspectorDirectProposal({
      source,
      geometryDoc,
      semanticEntityId: drawEntity.id,
      bindingIds: drawEntity.sourceBindingIds ?? [],
      patch: { from: insertAt, to: insertAt, insert: '[red,thick]' },
      propertyKind: 'style',
    });

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source).toContain('\\draw[red,thick]');
  });

  it('allows a selected label anchor presentation change without widening capability', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\node[above] at (A) {$A$};',
      '\\draw[blue] (A) circle (1);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const analysis = analyze(source, 0);
    const node = analysis.stmts?.find((statement) => statement.kind === 'node');
    const label = geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'label'
    ));
    expect(node?.kind).toBe('node');
    expect(label).toBeDefined();
    if (!node || node.kind !== 'node' || !label) return;
    const patch = styleOptionsPatch(
      source,
      node.options?.range ?? null,
      'below right',
      node.range.start + node.kind.length + 1,
    );
    const proposal = compileInspectorDirectProposal({
      source,
      geometryDoc,
      semanticEntityId: label.id,
      bindingIds: label.sourceBindingIds ?? [],
      patch,
      propertyKind: 'style',
    });

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source).toContain('\\node[below right]');
  });

  it('rejects a direct point proof whose patch rewrites outside the coordinate literal', () => {
    const source = wrap('\\coordinate (A) at (0,0);');
    const document = new StudioDocument(source);
    const proposal = compileCanvasPointMoveProposal({
      source,
      geometryDoc: geometryDocFor(document),
      sourceStableId: 'point:A',
      pointName: 'A',
      target: { x: 2, y: 1 },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) return;
    const operation = proposal.transaction.operations[0];
    if (operation?.op !== 'source-patch') return;
    const forged = {
      ...proposal.transaction,
      transactionId: 'forged-direct-point-range',
      idempotencyKey: 'forged-direct-point-range',
      operations: [{
        ...operation,
        patches: [{
          ...operation.patches[0]!,
          range: { start: 0, end: source.length - 1 },
          insert: '\\coordinate (A) at (2,1);',
          expectedText: source.slice(0, -1),
        }],
      }],
      readSet: [{
        kind: 'source-range' as const,
        sourceId: operation.patches[0]!.sourceId,
        range: { start: 0, end: source.length - 1 },
      }],
      writeSet: [{
        kind: 'source-range' as const,
        sourceId: operation.patches[0]!.sourceId,
        range: { start: 0, end: source.length - 1 },
      }],
      preconditions: [{
        kind: 'source-slice-equals' as const,
        sourceId: operation.patches[0]!.sourceId,
        range: { start: 0, end: source.length - 1 },
        text: source.slice(0, -1),
      }],
    } satisfies GeometryTransactionRequest;

    const result = new TikzTransactionBroker(document).commit(forged, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
    expect(document.getSnapshot().source).toBe(source);
  });

  it('rejects a Canvas point replacement whose claimed target differs from its writer output', () => {
    const plan = createPrimitiveConstructionPlan('point', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: false },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-point-move-forged',
    });
    const source = wrap(compileConstructionPlan(plan).lines.join('\n'));
    const document = new StudioDocument(source);
    const proposal = compileCanvasPointMoveProposal({
      source,
      geometryDoc: geometryDocFor(document),
      sourceStableId: 'point:A',
      pointName: 'A',
      target: { x: 2, y: 1 },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) return;
    const proof = proposal.transaction.metadata?.canvasPointMoveProof as Record<
      string,
      unknown
    >;
    const transaction = {
      ...proposal.transaction,
      transactionId: 'forged-canvas-point-target',
      idempotencyKey: 'forged-canvas-point-target',
      metadata: {
        ...proposal.transaction.metadata,
        canvasPointMoveProof: {
          ...proof,
          target: { x: 9, y: 9 },
        },
      },
    } satisfies GeometryTransactionRequest;

    const result = new TikzTransactionBroker(document).commit(transaction, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
  });

  it('commits a managed Inspector style edit only through its typed proof', () => {
    const plan = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-style-1',
    });
    const source = wrap(compileConstructionPlan(plan).lines.join('\n'));
    const document = new StudioDocument(source);
    const insertAt = source.indexOf('\\draw') + '\\draw'.length;
    const proposal = compileManagedInspectorStyleProposal({
      source,
      geometryDoc: geometryDocFor(document, 'plugins-current'),
      constructionId: plan.id,
      bindingIds: [managedBlockBindingId(plan.id)],
      bodyPatch: { from: insertAt, to: insertAt, insert: '[red]' },
    });

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: 'plugins-current',
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source).toContain('\\draw[red] (A) -- (B);');
  });

  it('commits the same Inspector proof against an active schema-v3 writer slot', () => {
    const plan = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-style-v3',
    });
    const source = wrap(compileNewManagedConstructionPlan(plan).lines.join('\n'));
    expect(parseManagedConstructionBlocks(source)[0]!.schemaVersion).toBe(3);
    const document = new StudioDocument(source);
    const insertAt = source.indexOf('\\draw') + '\\draw'.length;
    const proposal = compileManagedInspectorStyleProposal({
      source,
      geometryDoc: geometryDocFor(document, 'plugins-current'),
      constructionId: plan.id,
      bindingIds: [managedBlockBindingId(plan.id)],
      bodyPatch: { from: insertAt, to: insertAt, insert: '[red]' },
    });

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: 'plugins-current',
      },
    );

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source)
      .toContain('\\draw[red] (A) -- (B);');
    expect(parseManagedConstructionBlocks(document.getSnapshot().source)[0]!.schemaVersion)
      .toBe(3);
  });

  it('rejects a managed Inspector style envelope whose proof was removed', () => {
    const plan = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-style-2',
    });
    const source = wrap(compileConstructionPlan(plan).lines.join('\n'));
    const document = new StudioDocument(source);
    const insertAt = source.indexOf('\\draw') + '\\draw'.length;
    const proposal = compileManagedInspectorStyleProposal({
      source,
      geometryDoc: geometryDocFor(document),
      constructionId: plan.id,
      bindingIds: [managedBlockBindingId(plan.id)],
      bodyPatch: { from: insertAt, to: insertAt, insert: '[red]' },
    });
    const {
      managedConstructionStyleProof: _removedProof,
      ...metadata
    } = proposal.transaction.metadata ?? {};
    const transaction = {
      ...proposal.transaction,
      transactionId: 'managed-style-without-proof',
      idempotencyKey: 'managed-style-without-proof',
      metadata,
    } satisfies GeometryTransactionRequest;

    const result = new TikzTransactionBroker(document).commit(transaction, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      // Supply the current digest so the assertion below observes the
      // proof-removal guard rather than an earlier plugin-set mismatch.
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });

    expect(result).toMatchObject({ ok: false, code: 'invalid-request' });
  });

  it('rejects a style proposal that replaces the whole TikZ body instead of its option site', () => {
    const plan = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-style-body-replacement',
    });
    const source = wrap(compileConstructionPlan(plan).lines.join('\n'));
    const document = new StudioDocument(source);
    const block = parseManagedConstructionBlocks(source)[0]!;
    const currentBody = source.slice(
      block.tikzBodyRange.start,
      block.tikzBodyRange.end,
    );
    const proposal = compileManagedInspectorStyleProposal({
      source,
      geometryDoc: geometryDocFor(document),
      constructionId: plan.id,
      bindingIds: [managedBlockBindingId(plan.id)],
      bodyPatch: {
        from: block.tikzBodyRange.start,
        to: block.tikzBodyRange.end,
        insert: currentBody.replace('\\draw', '\\draw[red]'),
      },
    });

    const result = new TikzTransactionBroker(document).commit(
      proposal.transaction,
      {
        hash: hashSource(source),
        algorithm: 'fnv1a64-utf8',
        source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      },
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
  });

  it('rejects binding identities that were not issued by the current GeometryDoc', () => {
    const plan = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-style-forged-binding',
    });
    const source = wrap(compileConstructionPlan(plan).lines.join('\n'));
    const document = new StudioDocument(source);
    const insertAt = source.indexOf('\\draw') + '\\draw'.length;

    expect(() => compileManagedInspectorStyleProposal({
      source,
      geometryDoc: geometryDocFor(document),
      constructionId: plan.id,
      bindingIds: ['binding:managed:unrelated-construction'],
      bodyPatch: { from: insertAt, to: insertAt, insert: '[red]' },
      // The compiler derives the authoritative block binding itself and never
      // resolves a caller-supplied id, so a forged identity is rejected before
      // any GeometryDoc lookup rather than by failing that lookup.
    })).toThrow(/does not include the managed block capability/u);
  });

  it('does not let AI metadata spoof an external origin around managed guards', () => {
    const plan = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'managed-segment-1',
    });
    const source = wrap(compileConstructionPlan(plan).lines.join('\n'));
    const document = new StudioDocument(source);
    const snapshot = document.getSnapshot();
    const sourceId = `${snapshot.documentId}:tikz`;
    // Target the managed block exactly: a whole-document range would be a
    // partial rewrite of the block and reject at an earlier guard.
    const range = { ...parseManagedConstructionBlocks(source)[0]!.range };
    const precondition = {
      kind: 'source-slice-equals' as const,
      sourceId,
      range,
      text: source.slice(range.start, range.end),
    };
    const request: GeometryTransactionRequest = {
      schemaVersion: 'geometry-transaction/v1',
      transactionId: 'spoofed-origin',
      idempotencyKey: 'spoofed-origin',
      documentId: snapshot.documentId,
      documentEpoch: snapshot.epoch,
      origin: 'ai',
      stage: 'validated',
      expectedRevision: snapshot.revision,
      sourceHash: hashSource(source),
      pluginSetDigest: 'plugins-current',
      readSet: [{ kind: 'source-range', sourceId, range }],
      writeSet: [{ kind: 'source-range', sourceId, range }],
      preconditions: [precondition],
      operations: [{
        operationId: 'spoofed-replacement',
        op: 'source-patch',
        patches: [{
          sourceId,
          range,
          insert: source.slice(range.start, range.end),
          expectedText: source.slice(range.start, range.end),
        }],
      }],
      metadata: {
        sourceEditOrigin: 'external',
        proposalSchemaVersion: 'ai-patch-proposal/v1',
      },
    };

    const result = new TikzTransactionBroker(document).commit(request, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: 'plugins-current',
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
      // The raw-AI proof gate now rejects this forged request before the
      // managed-block gate. Earlier rejection is the intended least-authority
      // behavior; the source remains unchanged either way.
      message: expect.stringContaining('closed ai-patch-proposal/v1 proof'),
    });
  });

  it('rejects a canonical typed envelope that changes plan and syntax kind', () => {
    const context = {
      nextName: (prefix: string) => `${prefix}1`,
      nextConstructionId: () => 'managed-shape-1',
    };
    const segment = createPrimitiveConstructionPlan('segment', {
      ...context,
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
    });
    const circle = createPrimitiveConstructionPlan('circle', {
      ...context,
      anchors: [
        { name: 'O', position: { x: 0, y: 0 }, existing: true },
        { name: 'A', position: { x: 2, y: 0 }, existing: true },
      ],
    });
    const source = wrap(compileConstructionPlan(segment).lines.join('\n'));
    const replacement = `${compileConstructionPlan(circle).lines.join('\n')}\n`;
    const currentBlock = parseManagedConstructionBlocks(source)[0]!;
    const artifact = compileConstructionWriterArtifact(segment);
    const document = new StudioDocument(source);
    const snapshot = document.getSnapshot();
    const sourceId = `${snapshot.documentId}:tikz`;
    // Target the managed block exactly: a whole-document range would be a
    // partial rewrite of the block and reject at an earlier guard.
    const range = { ...currentBlock.range };
    const precondition = {
      kind: 'source-slice-equals' as const,
      sourceId,
      range,
      text: source.slice(range.start, range.end),
    };
    const request: GeometryTransactionRequest = {
      schemaVersion: 'geometry-transaction/v1',
      transactionId: 'cross-kind-envelope',
      idempotencyKey: 'cross-kind-envelope',
      documentId: snapshot.documentId,
      documentEpoch: snapshot.epoch,
      origin: 'ai',
      stage: 'validated',
      expectedRevision: snapshot.revision,
      sourceHash: hashSource(source),
      pluginSetDigest: 'plugins-current',
      readSet: [{ kind: 'source-range', sourceId, range }],
      writeSet: [{ kind: 'source-range', sourceId, range }],
      preconditions: [precondition],
      operations: [{
        operationId: 'cross-kind-replacement',
        op: 'source-patch',
        // expectedText must be the block slice, not the whole document, or the
        // patch fails staleness before reaching the plan-identity guard.
        patches: [{ sourceId, range, insert: replacement, expectedText: precondition.text }],
      }],
      metadata: {
        proposalSchemaVersion: 'construction-plan-proposal/v1',
        managedConstructionOperationKind: 'replace-managed-construction',
        managedConstructionRecompileProof: {
          schemaVersion: 'managed-construction-recompile-proof/v1',
          mode: 'canonical',
          constructionId: segment.id,
          previousContentFingerprint: currentBlock.contentFingerprint!,
          writerId: artifact.writerId,
          writerRevision: artifact.writerRevision,
          slotIds: artifact.slots.map((slot) => slot.id),
          slotSemanticFingerprints:
            artifact.slots.map((slot) => slot.semanticFingerprint),
        },
      },
    };

    const result = new TikzTransactionBroker(document).commit(request, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: 'plugins-current',
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
      message: expect.stringContaining('plan/syntax identity'),
    });
  });

  it('rejects a direct AI create proof whose decoded plan has a forged catalog role', () => {
    const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (B) at (2,0);\n\\end{tikzpicture}';
    const canonical = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'ai-forged-create',
    });
    const forged: ConstructionPlan = {
      ...canonical,
      inputs: canonical.inputs.map((entry, index) => (
        index === 0 ? { ...entry, role: 'forged-endpoint' } : entry
      )),
    };
    const insertion = insertBeforeTikzEndPatch(
      source,
      compileNewManagedConstructionPlan(forged).lines,
    );
    const artifact = compileConstructionWriterArtifact(forged);
    const document = new StudioDocument(source);
    const snapshot = document.getSnapshot();
    const sourceId = `${snapshot.documentId}:tikz`;
    const range = { start: insertion.from, end: insertion.to };
    const request: GeometryTransactionRequest = {
      schemaVersion: 'geometry-transaction/v1',
      transactionId: 'ai-forged-create',
      idempotencyKey: 'ai-forged-create',
      documentId: snapshot.documentId,
      documentEpoch: snapshot.epoch,
      origin: 'ai',
      stage: 'validated',
      expectedRevision: snapshot.revision,
      sourceHash: hashSource(source),
      pluginSetDigest: 'plugins-current',
      readSet: [{ kind: 'source-range', sourceId, range }],
      writeSet: [{ kind: 'source-range', sourceId, range }],
      preconditions: [{
        kind: 'source-slice-equals',
        sourceId,
        range,
        text: source.slice(insertion.from, insertion.to),
      }],
      operations: [{
        operationId: 'ai-forged-create-operation',
        op: 'source-patch',
        patches: [{
          sourceId,
          range,
          insert: insertion.insert,
          expectedText: source.slice(insertion.from, insertion.to),
        }],
      }],
      metadata: {
        proposalSchemaVersion: 'construction-plan-proposal/v1',
        managedConstructionOperationKind: 'create-managed-construction',
        managedConstructionCreateProof: {
          schemaVersion: 'managed-construction-create-proof/v1',
          constructionId: forged.id,
          planKind: forged.kind,
          syntaxKind: constructionPlanSyntaxKind(forged),
          writerId: artifact.writerId,
          writerRevision: artifact.writerRevision,
          slotIds: artifact.slots.map((slot) => slot.id),
          slotSemanticFingerprints:
            artifact.slots.map((slot) => slot.semanticFingerprint),
        },
      },
    };

    const result = new TikzTransactionBroker(document).commit(request, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: 'plugins-current',
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'invalid-request',
      message: expect.stringContaining('Typed construction-plan transactions'),
    });
  });

  it('rejects a direct AI replacement proof whose decoded replacement has a forged catalog role', () => {
    const canonical = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'ai-forged-replacement',
    });
    const forged: ConstructionPlan = {
      ...canonical,
      outputs: canonical.outputs.map((entry) => ({
        ...entry,
        role: 'forged-segment-output',
      })),
    };
    const source = wrap(compileNewManagedConstructionPlan(canonical).lines.join('\n'));
    const replacement = `${compileNewManagedConstructionPlan(forged).lines.join('\n')}\n`;
    const currentBlock = parseManagedConstructionBlocks(source)[0]!;
    const artifact = compileConstructionWriterArtifact(canonical);
    const document = new StudioDocument(source);
    const snapshot = document.getSnapshot();
    const sourceId = `${snapshot.documentId}:tikz`;
    // Target the managed block exactly: a whole-document range would be a
    // partial rewrite of the block and reject at an earlier guard.
    const range = { ...currentBlock.range };
    const request: GeometryTransactionRequest = {
      schemaVersion: 'geometry-transaction/v1',
      transactionId: 'ai-forged-replacement',
      idempotencyKey: 'ai-forged-replacement',
      documentId: snapshot.documentId,
      documentEpoch: snapshot.epoch,
      origin: 'ai',
      stage: 'validated',
      expectedRevision: snapshot.revision,
      sourceHash: hashSource(source),
      pluginSetDigest: 'plugins-current',
      readSet: [{ kind: 'source-range', sourceId, range }],
      writeSet: [{ kind: 'source-range', sourceId, range }],
      preconditions: [{
        kind: 'source-slice-equals', sourceId, range, text: source.slice(range.start, range.end),
      }],
      operations: [{
        operationId: 'ai-forged-replacement-operation',
        op: 'source-patch',
        patches: [{
          sourceId, range, insert: replacement, expectedText: source.slice(range.start, range.end),
        }],
      }],
      metadata: {
        proposalSchemaVersion: 'construction-plan-proposal/v1',
        managedConstructionOperationKind: 'replace-managed-construction',
        managedConstructionRecompileProof: {
          schemaVersion: 'managed-construction-recompile-proof/v1',
          mode: 'canonical',
          constructionId: canonical.id,
          previousContentFingerprint: currentBlock.contentFingerprint!,
          writerId: artifact.writerId,
          writerRevision: artifact.writerRevision,
          slotIds: artifact.slots.map((slot) => slot.id),
          slotSemanticFingerprints:
            artifact.slots.map((slot) => slot.semanticFingerprint),
        },
      },
    };

    const result = new TikzTransactionBroker(document).commit(request, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: 'plugins-current',
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
      message: expect.stringContaining('failed independent Broker decoding'),
    });
  });

  it('在最终提交点拒绝不匹配的 kernel hash', () => {
    const document = new StudioDocument(
      '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}',
    );
    const snapshot = document.getSnapshot();
    const result = new TikzTransactionBroker(document).commit(
      {
        ...requestFor(document, 'plugins-current'),
        expectedKernelHash: 'kernel-expected',
      },
      {
        hash: hashSource(snapshot.source),
        algorithm: 'fnv1a64-utf8',
        source: snapshot.source,
        kernelHash: 'kernel-current',
        pluginSetDigest: 'plugins-current',
      },
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'kernel-hash-mismatch',
    });
    expect(document.getSnapshot().source).toBe(snapshot.source);
  });

  it('在最终提交点拒绝不匹配的 plugin set', () => {
    const document = new StudioDocument(
      '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}',
    );
    const snapshot = document.getSnapshot();
    const result = new TikzTransactionBroker(document).commit(
      requestFor(document, 'plugins-expected'),
      {
        hash: hashSource(snapshot.source),
        algorithm: 'fnv1a64-utf8',
        source: snapshot.source,
        pluginSetDigest: 'plugins-current',
      },
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'plugin-set-mismatch',
    });
    expect(document.getSnapshot().source).toBe(snapshot.source);
  });

  it('匹配 guard 后只提交一次，同一幂等请求不会重复应用', () => {
    const document = new StudioDocument(
      '\\begin{tikzpicture}\\coordinate (A) at (0,0);\\end{tikzpicture}',
    );
    const snapshot = document.getSnapshot();
    const broker = new TikzTransactionBroker(document);
    const request = requestFor(document, 'plugins-current');
    const evidence = {
      hash: hashSource(snapshot.source),
      algorithm: 'fnv1a64-utf8',
      source: snapshot.source,
      pluginSetDigest: 'plugins-current',
    };

    expect(broker.commit(request, evidence)).toMatchObject({
      ok: true,
      status: 'committed',
    });
    expect(broker.commit(request, evidence)).toMatchObject({
      ok: true,
      status: 'idempotent',
    });
    expect(document.getSnapshot().source).toContain('(1,1)');
  });
});

describe('repair lane managed-construction authority', () => {
  const managedPlan = () => createPrimitiveConstructionPlan('segment', {
    anchors: [
      { name: 'A', position: { x: 0, y: 0 }, existing: true },
      { name: 'B', position: { x: 2, y: 0 }, existing: true },
    ],
    nextName: (prefix) => `${prefix}1`,
    nextConstructionId: () => 'repair-lane-managed',
  });

  const managedBlockText = () => (
    compileNewManagedConstructionPlan(managedPlan()).lines.join('\n')
  );

  const sourceWithManagedBlock = () => [
    '\begin{tikzpicture}',
    '\coordinate (A) at (0,0);',
    '\coordinate (B) at (2,0);',
    managedBlockText(),
    '\end{tikzpicture}',
    '',
  ].join('\n');

  const commitRepair = (source: string, next: string) => {
    const document = new StudioDocument(source);
    const broker = new TikzTransactionBroker(document);
    const patch = minimalTextPatch(source, next)!;
    const result = broker.commitPatches({
      patches: [patch],
      origin: 'repair',
      expectedRevision: document.getSnapshot().revision,
    });
    return { document, result };
  };

  it('rejects a repair that rewrites managed semantic metadata', () => {
    const source = sourceWithManagedBlock();
    const block = parseManagedConstructionBlocks(source)[0]!;
    const recordRange = block.semanticRecordRanges[0]!;
    const tampered = source.slice(0, recordRange.start)
      + source.slice(recordRange.start, recordRange.end)
        .replace('% @mathgeo', '% @mathgeo ')
      + source.slice(recordRange.end);

    const { document, result } = commitRepair(source, tampered);

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
    // The block must be left intact, not merely detached.
    const after = parseManagedConstructionBlocks(document.getSnapshot().source)[0]!;
    expect(after.integrityStatus).toBe('valid');
  });

  it('rejects a repair that fabricates a well-formed managed block', () => {
    const source = [
      '\begin{tikzpicture}',
      '\coordinate (A) at (0,0);',
      '\coordinate (B) at (2,0);',
      '\end{tikzpicture}',
      '',
    ].join('\n');
    const forged = source.replace(
      '\end{tikzpicture}',
      `${managedBlockText()}\n\end{tikzpicture}`,
    );

    const { document, result } = commitRepair(source, forged);

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
    expect(parseManagedConstructionBlocks(document.getSnapshot().source))
      .toHaveLength(0);
  });

  it('rejects a repair that duplicates an existing managed construction ID', () => {
    const source = sourceWithManagedBlock();
    const duplicated = source.replace(
      '\end{tikzpicture}',
      `${managedBlockText()}\n\end{tikzpicture}`,
    );

    const { document, result } = commitRepair(source, duplicated);

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
    expect(parseManagedConstructionBlocks(document.getSnapshot().source))
      .toHaveLength(1);
  });

  it('rejects a repair that deletes a managed construction', () => {
    const source = sourceWithManagedBlock();
    const block = parseManagedConstructionBlocks(source)[0]!;
    const removed = source.slice(0, block.range.start)
      + source.slice(block.range.end);

    const { document, result } = commitRepair(source, removed);

    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
    });
    expect(parseManagedConstructionBlocks(document.getSnapshot().source))
      .toHaveLength(1);
  });

  it('allows a repair whose single patch spans a byte-identical managed block', () => {
    const source = sourceWithManagedBlock();
    // Edit ordinary source on BOTH sides of the block: minimalTextPatch returns
    // one span covering the untouched block, which must still be accepted.
    const next = source
      .replace('\coordinate (A) at (0,0);', '\coordinate (A) at (0.5,0);')
      .replace('\end{tikzpicture}', '\draw (A) -- (B);\n\end{tikzpicture}');
    const block = parseManagedConstructionBlocks(source)[0]!;
    const patch = minimalTextPatch(source, next)!;
    // The one span genuinely overlaps the block, so a span-overlap gate would
    // reject it; only a byte comparison can tell this repair is harmless.
    expect(patch.from).toBeLessThan(block.range.start);
    expect(patch.to).toBeGreaterThan(block.range.start);

    const { document, result } = commitRepair(source, next);

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    const after = parseManagedConstructionBlocks(document.getSnapshot().source)[0]!;
    expect(after.integrityStatus).toBe('valid');
    expect(document.getSnapshot().source).toContain('(0.5,0)');
  });

  it('allows an ordinary repair in a document with no managed constructions', () => {
    const source = wrap('\coordinate (A) at (0,0);');
    const next = wrap('\coordinate (A) at (1,1);');

    const { document, result } = commitRepair(source, next);

    expect(result).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source).toContain('(1,1)');
  });
});
