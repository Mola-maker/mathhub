import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { CONSTRUCTION_CATALOG_DIGEST } from '../authoring/construction-catalog';
import type { ConstructionIntent } from '../authoring/construction-intent';
import { hashSource } from '../document/source-hash';
import { StudioDocument } from '../document/studio-document';
import { buildGeometryAiContext } from './ai-context';
import { compileAiWriteProposal } from './ai-write-proposal';
import type { AiPatchBindingContext } from './ai-patch-proposal';
import { createGeometryDoc } from './geometry-doc';
import { buildGeometrySourceMap } from './source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from './tikz-adapter';

/**
 * `compileAiWriteProposal` is the trust-policy router reached by
 * app/api/tikz/route.ts. It decides which of three separate policies an
 * untrusted model payload is judged under, so the routing itself is the
 * security boundary under test here — not the individual compilers.
 */
function fixture(source = '\\begin{tikzpicture}\n\\end{tikzpicture}') {
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
    intentId: 'router-intent-create',
    idempotencyKey: 'router-intent-create',
    basis: { ...basis, constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST },
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
  return {
    source,
    basis,
    geometryDoc,
    context: {
      basis,
      bindings,
      allowedBindingIds: ['binding:document:tikzpicture-body-end'],
      source,
      geometryDoc,
    },
    intent,
  };
}

describe('compileAiWriteProposal trust routing', () => {
  it('routes a construction-intent payload through the Catalog intent policy', () => {
    const { context, intent } = fixture();

    const compiled = compileAiWriteProposal(intent, context);

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.transaction.metadata?.authoringSchemaVersion)
      .toBe('construction-intent/v1');
    expect(compiled.transaction.origin).toBe('ai');
  });

  it('refuses plan-shaped managed creation so AI cannot bypass the intent policy', () => {
    const { context, basis } = fixture();
    // A model that emits an internal-only plan proposal must not be lowered
    // through the plan compiler; managed creation is intent-only.
    const planProposal = {
      schemaVersion: 'construction-plan-proposal/v1',
      proposalId: 'router-plan-create',
      idempotencyKey: 'router-plan-create',
      basis,
      focusBindingIds: [],
      readBindingIds: ['binding:document:tikzpicture-body-end'],
      operation: {
        operationId: 'router-plan-create:create',
        kind: 'create-managed-construction',
        bindingId: 'binding:document:tikzpicture-body-end',
        sourceId: basis.sourceId,
        plan: {
          schemaVersion: 'construction-plan/v1',
          id: 'router-forged',
          kind: 'primitive',
          status: 'complete',
          selection: [],
          entities: [],
          statements: [],
        },
      },
    };

    const compiled = compileAiWriteProposal(planProposal, context);

    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.errors[0]).toMatchObject({ code: 'plan-invalid' });
    expect(compiled.errors[0]!.message).toContain('construction-intent/v1');
  });

  it('falls back to the raw-patch policy for an unrecognized payload', () => {
    const { context } = fixture();

    const compiled = compileAiWriteProposal(
      { schemaVersion: 'something-else/v1' },
      context,
    );

    // The router must not silently accept an unknown envelope; the raw-patch
    // compiler rejects it rather than treating it as a construction proposal.
    expect(compiled.ok).toBe(false);
  });

  it('rejects an intent whose capability fingerprint is not host-authorized', () => {
    const { context, intent } = fixture();

    const compiled = compileAiWriteProposal({
      ...intent,
      capability: { ...intent.capability, fingerprint: 'forged-capability' },
    }, context);

    expect(compiled.ok).toBe(false);
  });
});
