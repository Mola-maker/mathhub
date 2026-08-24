import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { createPrimitiveConstructionPlan } from '../authoring/construction-catalog';
import { compileConstructionPlan } from '../authoring/construction-ir';
import { StudioDocument } from '../document/studio-document';
import { hashSource } from '../document/source-hash';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import { TikzTransactionBroker } from '../transactions/broker';
import { createGeometryDoc } from './geometry-doc';
import { buildGeometrySourceMap } from './source-map';
import { projectTikzAnalysisToGeometryTruth, TIKZ_PLUGIN_SET_DIGEST } from './tikz-adapter';
import type { GeometryTransactionRequest } from './transactions';
import { compileCanvasSelectionTransformProposal } from './canvas-selection-transform-proposal';

const wrap = (body: string) => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n`;

function managedPoint(name: string, x: number, y: number, id: string) {
  const plan = createPrimitiveConstructionPlan('point', {
    anchors: [{ name, position: { x, y }, existing: false }],
    nextName: (prefix) => `${prefix}1`,
    nextConstructionId: () => id,
  });
  return compileConstructionPlan(plan).lines.join('\n');
}

function geometryDocFor(document: StudioDocument) {
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
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
  });
  return createGeometryDoc(truths, buildGeometrySourceMap(truths));
}

describe('canvas-selection-transform-proposal/v1', () => {
  it('atomically translates managed point drivers through whole-block writers', () => {
    const source = wrap([
      managedPoint('A', 0, 0, 'selection-point-a'),
      managedPoint('B', 2, 0, 'selection-point-b'),
      '\\draw (A)--(B);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const segment = geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'polyline'
      && Array.isArray(entity.parameters?.references)
      && entity.parameters.references.includes('A')
      && entity.parameters.references.includes('B')
    ));
    expect(segment).toBeDefined();
    if (!segment) return;

    const proposal = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc,
      selectedEntityIds: [segment.id],
      transform: { kind: 'translate', dx: 1, dy: 2 },
      acknowledgedExternalImpactedEntityIds: [],
    });
    const blocks = parseManagedConstructionBlocks(source);
    expect(proposal.patches).toHaveLength(2);
    expect(proposal.patches.map((patch) => [patch.from, patch.to])).toEqual(
      blocks.map((block) => [block.range.start, block.range.end]),
    );
    expect(proposal.transaction.workspaceEdit).toMatchObject({
      schemaVersion: 'geometry-workspace-edit/v1',
      failureHandling: 'atomic',
      operationAnnotations: [{
        patchAnnotationIds: ['change-1-patch-1', 'change-1-patch-2'],
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
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(result).toMatchObject({ ok: true, status: 'committed' });
    const next = analyze(document.getSnapshot().source, 1);
    expect(next.scene?.points.get('A')).toMatchObject({ position: { x: 1, y: 2 } });
    expect(next.scene?.points.get('B')).toMatchObject({ position: { x: 3, y: 2 } });
    expect(document.getSnapshot().revision).toBe(1);
  });

  it('rejects forged Canvas review annotations even when the transform proof is unchanged', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (B) at (2,0);',
      '\\draw (A)--(B);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const segment = geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'polyline'
      && Array.isArray(entity.parameters?.references)
      && entity.parameters.references.includes('A')
      && entity.parameters.references.includes('B')
    ));
    expect(segment).toBeDefined();
    if (!segment) return;
    const proposal = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc,
      selectedEntityIds: [segment.id],
      transform: { kind: 'translate', dx: 1, dy: 2 },
      acknowledgedExternalImpactedEntityIds: [],
    });
    const forged: GeometryTransactionRequest = {
      ...proposal.transaction,
      workspaceEdit: {
        ...proposal.transaction.workspaceEdit!,
        changeAnnotations: {
          ...proposal.transaction.workspaceEdit!.changeAnnotations,
          'change-1': { label: 'Rotate unrelated geometry' },
        },
      },
    };
    const result = new TikzTransactionBroker(document).commit(forged, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'managed-construction-conflict',
      message: expect.stringContaining('canonical replay'),
    });
    expect(document.getSnapshot()).toMatchObject({ source, revision: 0 });
  });

  it('rejects a forged transform that drops one managed driver patch', () => {
    const source = wrap([
      managedPoint('A', 0, 0, 'forged-selection-point-a'),
      managedPoint('B', 2, 0, 'forged-selection-point-b'),
      '\\draw (A)--(B);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const segment = geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'polyline'
      && Array.isArray(entity.parameters?.references)
      && entity.parameters.references.includes('A')
      && entity.parameters.references.includes('B')
    ));
    if (!segment) throw new Error('segment fixture missing');
    const proposal = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc,
      selectedEntityIds: [segment.id],
      transform: { kind: 'translate', dx: 1, dy: 2 },
      acknowledgedExternalImpactedEntityIds: [],
    });
    const operation = proposal.transaction.operations[0];
    if (!operation || operation.op !== 'source-patch') return;
    const keptPatch = operation.patches[0]!;
    const forged = {
      ...proposal.transaction,
      transactionId: 'forged-selection-transform-subset',
      idempotencyKey: 'forged-selection-transform-subset',
      readSet: [proposal.transaction.readSet[0]!],
      writeSet: [proposal.transaction.writeSet[0]!],
      preconditions: [proposal.transaction.preconditions![0]!],
      operations: [{
        ...operation,
        patches: [keptPatch],
        preconditions: [operation.preconditions![0]!],
      }],
    } satisfies GeometryTransactionRequest;

    const result = new TikzTransactionBroker(document).commit(forged, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });
    expect(result).toMatchObject({ ok: false });
    expect(document.getSnapshot().source).toBe(source);
    expect(document.getSnapshot().revision).toBe(0);
  });

  it('combines direct and managed point writers in the same atomic transform', () => {
    const source = wrap([
      managedPoint('A', 0, 0, 'mixed-selection-point-a'),
      '\\coordinate (C) at (3,0);',
      '\\draw (A)--(C);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const segment = geometryDoc.semantic.ir.entities.find((entity) => (
      entity.kind === 'polyline'
      && Array.isArray(entity.parameters?.references)
      && entity.parameters.references.includes('A')
      && entity.parameters.references.includes('C')
    ));
    if (!segment) throw new Error('mixed segment fixture missing');
    const proposal = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc,
      selectedEntityIds: [segment.id],
      transform: { kind: 'translate', dx: 1, dy: 1 },
      acknowledgedExternalImpactedEntityIds: [],
    });
    const managedRange = parseManagedConstructionBlocks(source)[0]!.range;
    expect(proposal.patches).toHaveLength(2);
    expect(proposal.patches).toContainEqual(expect.objectContaining({
      from: managedRange.start,
      to: managedRange.end,
    }));
    expect(proposal.patches).toContainEqual(expect.objectContaining({ insert: '(4,1)' }));

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
    const next = analyze(document.getSnapshot().source, 1);
    expect(next.scene?.points.get('A')).toMatchObject({ position: { x: 1, y: 1 } });
    expect(next.scene?.points.get('C')).toMatchObject({ position: { x: 4, y: 1 } });
  });

  it('atomically scales a center-radius circle and Broker-replays the radius slot', () => {
    const source = wrap([
      '\\coordinate (O) at (1,1);',
      '\\draw (O) circle (2);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const circle = geometryDoc.semantic.ir.entities.find((entity) => entity.kind === 'circle');
    if (!circle) throw new Error('circle fixture missing');

    const proposal = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc,
      selectedEntityIds: [circle.id],
      transform: { kind: 'scale', factor: 2, center: 'selection' },
      acknowledgedExternalImpactedEntityIds: [],
    });
    expect(proposal.patches).toHaveLength(2);
    expect(proposal.patches).toContainEqual(expect.objectContaining({ insert: '(4)' }));

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
    expect(document.getSnapshot()).toMatchObject({ revision: 1 });
    expect(document.getSnapshot().source).toContain('\\draw (O) circle (4);');
    const next = analyze(document.getSnapshot().source, 1);
    expect(next.scene?.elements.find((element) => element.kind === 'circle'))
      .toMatchObject({ radius: 4 });
  });

  it('rejects a forged circle scale that omits the radius slot', () => {
    const source = wrap([
      '\\coordinate (O) at (1,1);',
      '\\draw (O) circle (2);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const circle = geometryDoc.semantic.ir.entities.find((entity) => entity.kind === 'circle');
    if (!circle) throw new Error('circle fixture missing');
    const proposal = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc,
      selectedEntityIds: [circle.id],
      transform: { kind: 'scale', factor: 2, center: 'selection' },
      acknowledgedExternalImpactedEntityIds: [],
    });
    const operation = proposal.transaction.operations[0];
    if (!operation || operation.op !== 'source-patch') throw new Error('source operation missing');
    const kept = operation.patches.find((patch) => patch.insert !== '(4)');
    if (!kept) throw new Error('center patch missing');
    const forged = {
      ...proposal.transaction,
      transactionId: 'forged-circle-scale-without-radius',
      idempotencyKey: 'forged-circle-scale-without-radius',
      readSet: [proposal.transaction.readSet.find((resource) => (
        resource.kind === 'source-range'
        && resource.range.start === kept.range.start
        && resource.range.end === kept.range.end
      ))!],
      writeSet: [proposal.transaction.writeSet.find((resource) => (
        resource.kind === 'source-range'
        && resource.range.start === kept.range.start
        && resource.range.end === kept.range.end
      ))!],
      preconditions: [operation.preconditions![0]!],
      operations: [{ ...operation, patches: [kept], preconditions: [operation.preconditions![0]!] }],
    } satisfies GeometryTransactionRequest;

    const result = new TikzTransactionBroker(document).commit(forged, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });
    expect(result).toMatchObject({ ok: false });
    expect(document.getSnapshot()).toMatchObject({ source, revision: 0 });
  });

  it('atomically rotates an arc and Broker-replays both angle slots', () => {
    const source = wrap([
      '\\coordinate (A) at (2,0);',
      '\\draw (A) arc (0:90:2);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const arc = geometryDoc.semantic.ir.entities.find((entity) => entity.kind === 'circular-arc');
    if (!arc) throw new Error('arc fixture missing');

    const proposal = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc,
      selectedEntityIds: [arc.id],
      transform: { kind: 'rotate', degrees: 30, center: 'selection' },
      acknowledgedExternalImpactedEntityIds: [],
    });
    expect(proposal.patches).toHaveLength(3);
    expect(proposal.patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ insert: '30' }),
      expect.objectContaining({ insert: '120' }),
    ]));

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
    expect(document.getSnapshot().source).toContain('arc (30:120:2)');
    const nextArc = analyze(document.getSnapshot().source, 1).scene?.elements
      .find((element) => element.kind === 'circular-arc');
    expect(nextArc).toMatchObject({ startAngleDeg: 30, endAngleDeg: 120, radius: 2 });
  });

  it('atomically rotates all four named cubic Bezier roles', () => {
    const source = wrap([
      '\\coordinate (A) at (0,0);',
      '\\coordinate (C1) at (1,2);',
      '\\coordinate (C2) at (3,2);',
      '\\coordinate (B) at (4,0);',
      '\\draw (A) .. controls (C1) and (C2) .. (B);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const curve = geometryDoc.semantic.ir.entities.find((entity) => entity.kind === 'cubic-bezier');
    if (!curve) throw new Error('cubic fixture missing');

    const proposal = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc,
      selectedEntityIds: [curve.id],
      transform: { kind: 'rotate', degrees: 90, center: 'selection' },
      acknowledgedExternalImpactedEntityIds: [],
    });
    expect(proposal.patches).toHaveLength(4);

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
    const nextCurve = analyze(document.getSnapshot().source, 1).scene?.elements
      .find((element) => element.kind === 'cubic-bezier');
    expect(nextCurve).toMatchObject({
      start: { x: 3, y: -1 },
      control1: { x: 1, y: 0 },
      control2: { x: 1, y: 2 },
      end: { x: 3, y: 3 },
    });
  });

  it('atomically scales an ellipse and rejects omission of either radius slot', () => {
    const source = wrap([
      '\\coordinate (O) at (1,2);',
      '\\draw (O) ellipse (2 and 1);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const ellipse = geometryDoc.semantic.ir.entities.find((entity) => entity.kind === 'ellipse');
    if (!ellipse) throw new Error('ellipse fixture missing');
    const proposal = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc,
      selectedEntityIds: [ellipse.id],
      transform: { kind: 'scale', factor: 2, center: 'selection' },
      acknowledgedExternalImpactedEntityIds: [],
    });
    expect(proposal.patches).toHaveLength(3);
    expect(proposal.patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ insert: '4' }),
      expect.objectContaining({ insert: '2' }),
    ]));

    const operation = proposal.transaction.operations[0];
    if (!operation || operation.op !== 'source-patch') throw new Error('source operation missing');
    const omitted = operation.patches.find((patch) => patch.insert === '2' && (
      source.slice(patch.range.start, patch.range.end) === '1'
    ));
    if (!omitted) throw new Error('ellipse y radius patch missing');
    const keptPatches = operation.patches.filter((patch) => patch !== omitted);
    const keptRanges = new Set(keptPatches.map((patch) => `${patch.range.start}:${patch.range.end}`));
    const forged = {
      ...proposal.transaction,
      transactionId: 'forged-ellipse-scale-without-y-radius',
      idempotencyKey: 'forged-ellipse-scale-without-y-radius',
      readSet: proposal.transaction.readSet.filter((resource) => (
        resource.kind === 'source-range'
        && keptRanges.has(`${resource.range.start}:${resource.range.end}`)
      )),
      writeSet: proposal.transaction.writeSet.filter((resource) => (
        resource.kind === 'source-range'
        && keptRanges.has(`${resource.range.start}:${resource.range.end}`)
      )),
      preconditions: proposal.transaction.preconditions?.filter((precondition) => (
        precondition.kind === 'source-slice-equals'
        && keptRanges.has(`${precondition.range.start}:${precondition.range.end}`)
      )),
      operations: [{
        ...operation,
        patches: keptPatches,
        preconditions: operation.preconditions?.filter((precondition) => (
          precondition.kind === 'source-slice-equals'
          && keptRanges.has(`${precondition.range.start}:${precondition.range.end}`)
        )),
      }],
    } satisfies GeometryTransactionRequest;
    const rejected = new TikzTransactionBroker(document).commit(forged, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });
    expect(rejected).toMatchObject({ ok: false });
    expect(document.getSnapshot()).toMatchObject({ source, revision: 0 });

    const committed = new TikzTransactionBroker(document).commit(proposal.transaction, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });
    expect(committed).toMatchObject({ ok: true, status: 'committed' });
    expect(document.getSnapshot().source).toContain('ellipse (4 and 2)');
  });

  it('Broker-replays an ellipse rotation from its path-local numeric slot', () => {
    const source = wrap([
      '\\coordinate (O) at (1,2);',
      '\\draw[rotate=10] (O) ellipse (2 and 1);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const ellipse = geometryDoc.semantic.ir.entities.find((entity) => entity.kind === 'ellipse');
    if (!ellipse) throw new Error('ellipse fixture missing');
    const proposal = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc,
      selectedEntityIds: [ellipse.id],
      transform: { kind: 'rotate', degrees: 30, center: 'selection' },
      acknowledgedExternalImpactedEntityIds: [],
    });
    expect(proposal.patches).toHaveLength(2);
    expect(proposal.patches).toContainEqual(expect.objectContaining({ insert: '40' }));

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
    expect(document.getSnapshot()).toMatchObject({ revision: 1 });
    expect(document.getSnapshot().source).toContain('\\draw[rotate=40]');
    const nextEllipse = analyze(document.getSnapshot().source, 1).scene?.elements
      .find((element) => element.kind === 'ellipse');
    expect(nextEllipse).toMatchObject({ kind: 'ellipse', rotationDegrees: 40 });
  });

  it('rejects a forged arc rotation that omits one angle slot', () => {
    const source = wrap([
      '\\coordinate (A) at (2,0);',
      '\\draw (A) arc (0:90:2);',
    ].join('\n'));
    const document = new StudioDocument(source);
    const geometryDoc = geometryDocFor(document);
    const arc = geometryDoc.semantic.ir.entities.find((entity) => entity.kind === 'circular-arc');
    if (!arc) throw new Error('arc fixture missing');
    const proposal = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc,
      selectedEntityIds: [arc.id],
      transform: { kind: 'rotate', degrees: 30, center: 'selection' },
      acknowledgedExternalImpactedEntityIds: [],
    });
    const operation = proposal.transaction.operations[0];
    if (!operation || operation.op !== 'source-patch') throw new Error('source operation missing');
    const keptPatches = operation.patches.filter((patch) => patch.insert !== '120');
    const keptRanges = new Set(keptPatches.map((patch) => `${patch.range.start}:${patch.range.end}`));
    const keepResource = (resource: GeometryTransactionRequest['readSet'][number]) => (
      resource.kind === 'source-range'
      && keptRanges.has(`${resource.range.start}:${resource.range.end}`)
    );
    const keepPrecondition = (precondition: NonNullable<GeometryTransactionRequest['preconditions']>[number]) => (
      precondition.kind === 'source-slice-equals'
      && keptRanges.has(`${precondition.range.start}:${precondition.range.end}`)
    );
    const forged = {
      ...proposal.transaction,
      transactionId: 'forged-arc-rotation-without-end-angle',
      idempotencyKey: 'forged-arc-rotation-without-end-angle',
      readSet: proposal.transaction.readSet.filter(keepResource),
      writeSet: proposal.transaction.writeSet.filter(keepResource),
      preconditions: proposal.transaction.preconditions?.filter(keepPrecondition),
      operations: [{
        ...operation,
        patches: keptPatches,
        preconditions: operation.preconditions?.filter(keepPrecondition),
      }],
    } satisfies GeometryTransactionRequest;

    const result = new TikzTransactionBroker(document).commit(forged, {
      hash: hashSource(source),
      algorithm: 'fnv1a64-utf8',
      source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    });
    expect(result).toMatchObject({ ok: false });
    expect(document.getSnapshot()).toMatchObject({ source, revision: 0 });
  });
});
