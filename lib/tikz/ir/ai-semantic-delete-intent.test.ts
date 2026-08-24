import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { constructionAuthorizationScopeFingerprint } from '../authoring/construction-authorization';
import { hashSource } from '../document/source-hash';
import { StudioDocument } from '../document/studio-document';
import { TikzTransactionBroker } from '../transactions/broker';
import {
  compileAiSemanticDeleteIntent,
  type AiSemanticDeleteIntent,
} from './ai-semantic-delete-intent';
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

function fixture() {
  const document = new StudioDocument(SOURCE);
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
  const allowedBindingIds = geometryDoc.construction.bindings.map((binding) => binding.id);
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
  const pointA = geometryDoc.semantic.ir.entities.find((entity) => entity.name === 'A');
  if (!segment || !pointA) throw new Error('delete fixture entities missing');
  const intent: AiSemanticDeleteIntent = {
    schemaVersion: 'ai-semantic-delete-intent/v1',
    intentId: 'ai-delete-segment',
    idempotencyKey: 'ai-delete-segment',
    basis,
    authorizationScopeFingerprint,
    selectedEntityIds: [segment.id],
    mode: 'block',
  };
  return {
    document,
    geometryDoc,
    basis,
    allowedBindingIds,
    createCapabilityFingerprint,
    authorizationScopeFingerprint,
    segment,
    pointA,
    intent,
  };
}

describe('ai-semantic-delete-intent/v1', () => {
  it('deletes one semantic root through the current dependency planner and Broker replay', () => {
    const current = fixture();
    const compiled = compileAiSemanticDeleteIntent(current.intent, {
      basis: current.basis,
      source: SOURCE,
      geometryDoc: current.geometryDoc,
      allowedBindingIds: current.allowedBindingIds,
    });
    expect(compiled, JSON.stringify(compiled)).toMatchObject({
      ok: true,
      transaction: {
        origin: 'ai',
        stage: 'proposed',
        metadata: {
          proposalSchemaVersion: 'ai-semantic-delete-intent/v1',
          semanticWrite: true,
          canvasDeleteProof: { mode: 'block' },
        },
      },
    });
    if (!compiled.ok) return;
    const result = new TikzTransactionBroker(current.document).commit(
      compiled.transaction,
      {
        hash: hashSource(SOURCE),
        algorithm: 'fnv1a64-utf8',
        source: SOURCE,
        pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
        authorizedBindingIds: current.allowedBindingIds,
        authorizationScopeFingerprint: current.authorizationScopeFingerprint,
        createCapabilityFingerprint: current.createCapabilityFingerprint,
      },
    );
    expect(result).toMatchObject({ ok: true, status: 'committed' });
    const nextSource = current.document.getSnapshot().source;
    expect(nextSource).toContain('\\coordinate (A)');
    expect(nextSource).toContain('\\coordinate (B)');
    expect(nextSource).not.toContain('\\draw (A)--(B)');
  });

  it('rejects model-authored cascade and dependency-blocked roots without changing source', () => {
    const current = fixture();
    expect(compileAiSemanticDeleteIntent({
      ...current.intent,
      mode: 'cascade',
    }, {
      basis: current.basis,
      source: SOURCE,
      geometryDoc: current.geometryDoc,
      allowedBindingIds: current.allowedBindingIds,
    })).toMatchObject({ ok: false, errors: [{ code: 'invalid-shape' }] });
    const blocked = compileAiSemanticDeleteIntent({
      ...current.intent,
      intentId: 'ai-delete-point-a',
      idempotencyKey: 'ai-delete-point-a',
      selectedEntityIds: [current.pointA.id],
    }, {
      basis: current.basis,
      source: SOURCE,
      geometryDoc: current.geometryDoc,
      allowedBindingIds: current.allowedBindingIds,
    });
    expect(blocked).toMatchObject({
      ok: false,
      errors: [{ message: expect.stringContaining('blocked') }],
    });
    expect(current.document.getSnapshot()).toMatchObject({ source: SOURCE, revision: 0 });
  });

  it('rejects a forged semantic root proof at the Broker boundary', () => {
    const current = fixture();
    const compiled = compileAiSemanticDeleteIntent(current.intent, {
      basis: current.basis,
      source: SOURCE,
      geometryDoc: current.geometryDoc,
      allowedBindingIds: current.allowedBindingIds,
    });
    if (!compiled.ok) throw new Error(`delete fixture compilation failed: ${JSON.stringify(compiled)}`);
    const forged = {
      ...compiled.transaction,
      metadata: {
        ...compiled.transaction.metadata,
        aiSemanticDeleteIntentProof: {
          ...current.intent,
          selectedEntityIds: [current.pointA.id],
        },
      },
    } satisfies GeometryTransactionRequest;
    const result = new TikzTransactionBroker(current.document).commit(forged, {
      hash: hashSource(SOURCE),
      algorithm: 'fnv1a64-utf8',
      source: SOURCE,
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
      authorizedBindingIds: current.allowedBindingIds,
      authorizationScopeFingerprint: current.authorizationScopeFingerprint,
      createCapabilityFingerprint: current.createCapabilityFingerprint,
    });
    expect(result).toMatchObject({ ok: false });
    expect(current.document.getSnapshot()).toMatchObject({ source: SOURCE, revision: 0 });
  });
});
