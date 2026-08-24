import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { constructionAuthorizationScopeFingerprint } from '../authoring/construction-authorization';
import { hashSource } from '../document/source-hash';
import { StudioDocument } from '../document/studio-document';
import { TikzTransactionBroker } from '../transactions/broker';
import {
  compileAiSelectionTransformIntent,
  type AiSelectionTransformIntent,
} from './ai-selection-transform-intent';
import { createGeometryDoc } from './geometry-doc';
import { buildGeometrySourceMap } from './source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from './tikz-adapter';
import type { GeometryTransactionRequest } from './transactions';

const SOURCE = `\\begin{tikzpicture}
\\coordinate (A) at (0,0);
\\coordinate (B) at (2,0);
\\draw (A)--(B);
\\end{tikzpicture}
`;

function fixture(source = SOURCE) {
  const document = new StudioDocument(source);
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
  const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
  const basis = {
    ...geometryDoc.basis,
    sourceId: geometryDoc.basis.sourceId!,
    hashAlgorithm: 'fnv1a64-utf8',
  };
  const allowedBindingIds = geometryDoc.construction.bindings
    .map((binding) => binding.id);
  const insertion = geometryDoc.construction.bindings.find((binding) => (
    binding.id === 'binding:document:tikzpicture-body-end'
  ));
  const createCapabilityFingerprint =
    typeof insertion?.metadata?.capabilityFingerprint === 'string'
      ? insertion.metadata.capabilityFingerprint
      : '';
  const authorizationScopeFingerprint = constructionAuthorizationScopeFingerprint({
    basis,
    authorizedBindingIds: allowedBindingIds,
    createCapabilityFingerprint,
  });
  const segment = geometryDoc.semantic.ir.entities.find((entity) => (
    entity.kind === 'polyline'
  ));
  if (!segment) throw new Error('segment fixture missing');
  const intent: AiSelectionTransformIntent = {
    schemaVersion: 'ai-selection-transform-intent/v1',
    intentId: 'ai-transform-segment',
    idempotencyKey: 'ai-transform-segment',
    basis,
    authorizationScopeFingerprint,
    selectedEntityIds: [segment.id],
    transform: { kind: 'translate', dx: 1, dy: 2 },
  };
  return {
    source,
    document,
    geometryDoc,
    basis,
    allowedBindingIds,
    createCapabilityFingerprint,
    authorizationScopeFingerprint,
    intent,
  };
}

describe('ai-selection-transform-intent/v1', () => {
  it('host-lowers one semantic transform and Broker independently commits it', () => {
    const current = fixture();
    const compiled = compileAiSelectionTransformIntent(current.intent, {
      basis: current.basis,
      source: current.source,
      geometryDoc: current.geometryDoc,
      allowedBindingIds: current.allowedBindingIds,
    });
    expect(compiled).toMatchObject({
      ok: true,
      transaction: {
        origin: 'ai',
        stage: 'proposed',
        metadata: {
          proposalSchemaVersion: 'ai-selection-transform-intent/v1',
          semanticWrite: true,
        },
      },
    });
    if (!compiled.ok) return;
    const result = new TikzTransactionBroker(current.document).commit(
      compiled.transaction,
      {
        hash: hashSource(current.source),
        algorithm: 'fnv1a64-utf8',
        source: current.source,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
        authorizedBindingIds: current.allowedBindingIds,
        authorizationScopeFingerprint: current.authorizationScopeFingerprint,
        createCapabilityFingerprint: current.createCapabilityFingerprint,
      },
    );
    expect(result).toMatchObject({ ok: true, status: 'committed' });
    const next = analyze(current.document.getSnapshot().source, 1);
    expect(next.scene?.points.get('A')).toMatchObject({ position: { x: 1, y: 2 } });
    expect(next.scene?.points.get('B')).toMatchObject({ position: { x: 3, y: 2 } });
  });

  it('rejects a forged transform proof without changing source bytes', () => {
    const current = fixture();
    const compiled = compileAiSelectionTransformIntent(current.intent, {
      basis: current.basis,
      source: current.source,
      geometryDoc: current.geometryDoc,
      allowedBindingIds: current.allowedBindingIds,
    });
    if (!compiled.ok) throw new Error('fixture compilation failed');
    const forged = {
      ...compiled.transaction,
      metadata: {
        ...compiled.transaction.metadata,
        aiSelectionTransformIntentProof: {
          ...current.intent,
          transform: { kind: 'translate', dx: 99, dy: 2 },
        },
      },
    } satisfies GeometryTransactionRequest;
    const result = new TikzTransactionBroker(current.document).commit(forged, {
      hash: hashSource(current.source),
      algorithm: 'fnv1a64-utf8',
      source: current.source,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      authorizedBindingIds: current.allowedBindingIds,
      authorizationScopeFingerprint: current.authorizationScopeFingerprint,
      createCapabilityFingerprint: current.createCapabilityFingerprint,
    });
    expect(result).toMatchObject({ ok: false });
    expect(current.document.getSnapshot()).toMatchObject({
      source: current.source,
      revision: 0,
    });
  });

  it('rejects a GeometryDoc detached from the requested source basis', () => {
    const current = fixture();
    const detached = fixture();
    const result = compileAiSelectionTransformIntent(current.intent, {
      basis: current.basis,
      source: current.source,
      geometryDoc: detached.geometryDoc,
      allowedBindingIds: current.allowedBindingIds,
    });
    expect(result).toMatchObject({
      ok: false,
      errors: [{
        code: 'basis-mismatch',
        message: expect.stringContaining('GeometryDoc'),
      }],
    });
    expect(current.document.getSnapshot()).toMatchObject({
      source: current.source,
      revision: 0,
    });
  });

  it('does not let model output acknowledge collateral dependency changes', () => {
    const current = fixture(`\\begin{tikzpicture}
\\coordinate (A) at (0,0);
\\coordinate (B) at (2,0);
\\coordinate (C) at (0,2);
\\draw (A)--(B);
\\draw (A)--(C);
\\end{tikzpicture}
`);
    const segments = current.geometryDoc.semantic.ir.entities.filter((entity) => (
      entity.kind === 'polyline'
    ));
    const selected = segments.find((entity) => (
      Array.isArray(entity.parameters?.references)
      && entity.parameters.references.includes('B')
    ));
    if (!selected) throw new Error('selected segment fixture missing');
    const result = compileAiSelectionTransformIntent({
      ...current.intent,
      intentId: 'ai-transform-with-collateral-impact',
      idempotencyKey: 'ai-transform-with-collateral-impact',
      selectedEntityIds: [selected.id],
    }, {
      basis: current.basis,
      source: current.source,
      geometryDoc: current.geometryDoc,
      allowedBindingIds: current.allowedBindingIds,
    });
    expect(result).toMatchObject({
      ok: false,
      errors: [{ message: expect.stringContaining('需要确认完整影响域') }],
    });
    expect(current.document.getSnapshot()).toMatchObject({
      source: current.source,
      revision: 0,
    });
  });
});
