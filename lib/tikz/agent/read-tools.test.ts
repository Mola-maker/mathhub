import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { analyze } from '@/lib/tikz/analyze';
import { hashSource } from '@/lib/tikz/document/source-hash';
import {
  buildGeometrySourceMap,
  createGeometryDoc,
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from '@/lib/tikz/ir';
import { buildGeometryAiContext } from '@/lib/tikz/ir/ai-context';
import {
  CONSTRUCTION_CATALOG_DIGEST,
  createPrimitiveConstructionPlan,
} from '@/lib/tikz/authoring/construction-catalog';
import { compileNewManagedConstructionPlan } from '@/lib/tikz/authoring/construction-ir-v3';
import { constructionAuthorizationScopeFingerprint } from '@/lib/tikz/authoring/construction-authorization';
import {
  compactGeometryProblemRecords,
  executeTikzAgentReadTool,
} from './read-tools';

const source = '\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (B) at (2,0);\n\\coordinate (C) at (4,0);\n\\coordinate (D) at (0,2);\n\\draw (A) -- (B);\n\\end{tikzpicture}';

function toolContextFor(
  tikzSource: string,
  focusRefs: readonly string[],
  allowedEntityIds?: readonly string[],
) {
  const revision = 2;
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis: analyze(tikzSource, revision),
    source: tikzSource,
    basis: {
      documentId: 'doc', epoch: 'epoch', revision,
      sourceId: 'doc:tikz', sourceHash: hashSource(tikzSource),
      pluginSetDigest: TIKZ_PLUGIN_SET_DIGEST,
    },
    hashAlgorithm: 'fnv1a64-utf8',
  });
  const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
  const semantic = buildGeometryAiContext(geometryDoc, { focusRefs });
  return {
    geometryDoc,
    semantic,
    context: {
      runId: 'run-read-tools',
      geometryDoc,
      allowedEntityIds: allowedEntityIds
        ?? semantic.focus.closureEntityIds,
      basis: {
        ...geometryDoc.basis,
        sourceId: 'doc:tikz',
        source: tikzSource,
        hashAlgorithm: 'fnv1a64-utf8' as const,
        bindings: semantic.construction.sourceBindings.map((binding) => ({
          bindingId: binding.id,
          sourceId: binding.sourceId,
          range: binding.range,
          writable: binding.writable,
          opaque: binding.opaque,
          insertionPolicy: binding.insertionPolicy,
          writeCapabilities: binding.writeCapabilities,
          managedConstructionId: binding.managedConstructionId,
          managedPlanKind: binding.managedPlanKind,
          managedSyntaxKind: binding.managedSyntaxKind,
          managedContentFingerprint: binding.managedContentFingerprint,
          managedPresentationFingerprint: binding.managedPresentationFingerprint,
          managedWriterId: binding.managedWriterId,
          managedWriterRevision: binding.managedWriterRevision,
          managedWriterSlotIds: binding.managedWriterSlotIds,
          managedWriterSlotSemanticFingerprints:
            binding.managedWriterSlotSemanticFingerprints,
          managedAttachmentsFingerprint: binding.managedAttachmentsFingerprint,
          createCapabilityFingerprint: binding.createCapabilityFingerprint,
        })),
        readBindingIds: semantic.construction.authorizedBindingIds,
        userIntent: '新增线段 AB',
      },
    },
  };
}

const base = toolContextFor(source, ['A']);
const doc = base.geometryDoc;
const ai = base.semantic;
const context = base.context;

describe('TikZ agent read tools', () => {
  it('inspects GeometryDoc without returning write authority', async () => {
    const result = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'inspect-1',
      name: 'inspect-geometry',
      arguments: { refs: ['A'] },
    }, context);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.payload)).toContain('A');
    expect(JSON.stringify(result.payload)).not.toContain('authorizedBindingIds');
  });

  it('returns the bounded related geometry subgraph for complex reasoning', async () => {
    const result = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'inspect-neighborhood',
      name: 'inspect-geometry',
      arguments: { refs: ['A'] },
    }, context);

    expect(result.ok).toBe(true);
    expect(result.payload.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'A' }),
      expect.objectContaining({ name: 'B' }),
      expect.objectContaining({
        kind: 'polyline',
        parameters: expect.objectContaining({ references: ['A', 'B'] }),
      }),
    ]));
    expect(result.payload.ranking).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: 'point:A',
        distance: 0,
        reasons: expect.arrayContaining(['explicit-focus']),
      }),
      expect.objectContaining({ entityId: 'point:B' }),
    ]));
  });

  it('explains an evidence-backed relation path inside the attested scope', async () => {
    const result = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'explain-ab',
      name: 'explain-relation',
      arguments: { from: 'A', to: 'B', maxHops: 4 },
    }, context);

    expect(result).toMatchObject({
      ok: true,
      payload: {
        explanation: {
          status: 'connected',
          fromEntityId: 'point:A',
          toEntityId: 'point:B',
        },
      },
    });
    expect((result.payload.explanation as { path: unknown[] }).path.length).toBeGreaterThan(0);
  });

  it('verifies numeric geometry claims without creating write authority', async () => {
    const broad = toolContextFor(
      source,
      ['A'],
      doc.semantic.ir.entities.map((entity) => entity.id),
    ).context;
    const collinear = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'verify-collinear',
      name: 'verify-geometry-claim',
      arguments: {
        claim: { kind: 'collinear', pointRefs: ['A', 'B', 'C'] },
      },
    }, broad);
    const perpendicular = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'verify-perpendicular',
      name: 'verify-geometry-claim',
      arguments: {
        claim: { kind: 'perpendicular', pointRefs: ['A', 'B', 'A', 'D'] },
      },
    }, broad);

    expect(collinear).toMatchObject({
      ok: true,
      payload: { verdict: 'numerically-satisfied', method: 'normalized-cross-product' },
    });
    expect(perpendicular).toMatchObject({
      ok: true,
      payload: { verdict: 'numerically-satisfied', method: 'normalized-dot-product' },
    });
    expect(JSON.stringify(collinear.payload)).not.toContain('authorizedBindingIds');
  });

  it('builds a bounded proof state without upgrading measurements to proofs', async () => {
    const broad = toolContextFor(
      source,
      ['A'],
      doc.semantic.ir.entities.map((entity) => entity.id),
    ).context;
    const result = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'proof-state',
      name: 'build-proof-state',
      arguments: {
        claims: [
          { claimId: 'goal-collinear', kind: 'collinear', pointRefs: ['A', 'B', 'C'] },
          {
            claimId: 'goal-perpendicular',
            kind: 'perpendicular',
            pointRefs: ['A', 'B', 'A', 'D'],
          },
        ],
      },
    }, broad);

    expect(result).toMatchObject({
      ok: true,
      payload: {
        proofState: {
          schemaVersion: 'geometry-proof-state/v1',
          completion: 'open',
          obligations: [
            { claimId: 'goal-collinear', status: 'numerically-satisfied' },
            { claimId: 'goal-perpendicular', status: 'numerically-satisfied' },
          ],
        },
        proofPlan: {
          schemaVersion: 'geometry-proof-plan/v1',
          owner: { observationCallId: 'proof-state', runId: 'run-read-tools' },
          authoritativeForWrite: true,
          goals: [
            { claimId: 'goal-collinear', status: 'numerically-satisfied' },
            { claimId: 'goal-perpendicular', status: 'numerically-satisfied' },
          ],
        },
      },
    });
    expect(JSON.stringify(result.payload)).not.toContain('authorizedBindingIds');
  });

  it('verifies the equal-radius invariant in the competition nine-point-circle fixture', async () => {
    const competitionSource = readFileSync(path.join(
      process.cwd(),
      'lib/tikz/__fixtures__/competition/nine-point-circle.tikz',
    ), 'utf8');
    const initial = toolContextFor(competitionSource, []);
    const competition = toolContextFor(
      competitionSource,
      ['N'],
      initial.geometryDoc.semantic.ir.entities.map((entity) => entity.id),
    ).context;
    const result = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'verify-nine-point-radius',
      name: 'verify-geometry-claim',
      arguments: {
        claim: {
          kind: 'equal-distance',
          pointRefs: ['N', 'Mab', 'Mac', 'Mbc'],
          tolerance: 1e-9,
        },
      },
    }, competition);

    expect(result).toMatchObject({
      ok: true,
      payload: {
        // The source circle is defined only through Mab. Equal radii to Mac
        // and Mbc are true in this coordinate snapshot but are not encoded as
        // required on-circle constraints, so the verifier must not invent a
        // formal proof.
        verdict: 'numerically-satisfied',
        method: 'normalized-radius-spread',
        residual: 0,
      },
    });
  });

  it('simulates a typed construction intent without mutating the source document', async () => {
    const bindingFor = (entityId: string) => ai.construction.sourceBindings.find((binding) => (
      binding.entityIds.includes(entityId)
    ))?.id;
    const insertion = ai.construction.sourceBindings.find((binding) => (
      binding.id === 'binding:document:tikzpicture-body-end'
    ));
    const bindingIds = [bindingFor('point:A'), bindingFor('point:B')];
    expect(bindingIds.every(Boolean)).toBe(true);
    expect(insertion?.createCapabilityFingerprint).toBeTruthy();
    const intent = {
      schemaVersion: 'construction-intent/v1' as const,
      intentId: 'simulate-midpoint',
      idempotencyKey: 'simulate-midpoint',
      basis: {
        documentId: doc.basis.documentId,
        epoch: doc.basis.epoch,
        revision: doc.basis.revision,
        sourceId: doc.basis.sourceId,
        sourceHash: doc.basis.sourceHash,
        hashAlgorithm: 'fnv1a64-utf8' as const,
        kernelHash: doc.basis.kernelHash!,
        projectionHash: doc.basis.projectionHash!,
        pluginSetDigest: doc.basis.pluginSetDigest!,
        constructionCatalogDigest: CONSTRUCTION_CATALOG_DIGEST,
      },
      operation: 'create' as const,
      capability: {
        bindingId: 'binding:document:tikzpicture-body-end' as const,
        fingerprint: insertion!.createCapabilityFingerprint!,
        scopeFingerprint: constructionAuthorizationScopeFingerprint({
          basis: doc.basis,
          authorizedBindingIds: ai.construction.authorizedBindingIds,
          createCapabilityFingerprint: insertion!.createCapabilityFingerprint!,
        }),
      },
      toolId: 'midpoint',
      bindingIds: bindingIds as string[],
      requestedNames: { midpoint: 'M' },
      parameters: {},
    };
    const before = context.basis.source;
    const result = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'simulate-midpoint',
      name: 'simulate-intent',
      arguments: {
        intent,
        postconditionClaims: [{
          claimId: 'created-midpoint',
          kind: 'midpoint',
          pointRefs: ['M', 'A', 'B'],
        }],
      },
    }, context);

    expect(result).toMatchObject({
      ok: true,
      payload: {
        valid: true,
        simulatedOnly: true,
        patchCount: 1,
        addedEntities: expect.arrayContaining([
          expect.objectContaining({ kind: 'point' }),
        ]),
        postProofState: {
          completion: 'formal-proof-complete',
          obligations: [{ claimId: 'created-midpoint', status: 'formally-proven' }],
        },
        postProofPlan: {
          owner: { observationCallId: 'simulate-midpoint', runId: 'run-read-tools' },
          authoritativeForWrite: false,
        },
        proofDelta: { formallyProvenClaimIds: ['created-midpoint'] },
      },
    });
    expect(context.basis.source).toBe(before);
    expect(JSON.stringify(result.payload)).not.toContain('sourceTransaction');
    expect(JSON.stringify(result.payload)).not.toContain('expectedText');
  });

  it('retrieves the canonical plan owning a managed construction output', async () => {
    const plan = createPrimitiveConstructionPlan('segment', {
      anchors: [
        { name: 'A', position: { x: 0, y: 0 }, existing: true },
        { name: 'B', position: { x: 2, y: 0 }, existing: true },
      ],
      nextName: (prefix) => `${prefix}1`,
      nextConstructionId: () => 'inspect-segment',
    });
    const block = compileNewManagedConstructionPlan(plan).lines.join('\n');
    const managedSource = `\\begin{tikzpicture}\n\\coordinate (A) at (0,0);\n\\coordinate (B) at (2,0);\n${block}\n\\end{tikzpicture}`;
    const managedBase = toolContextFor(managedSource, []);
    const output = managedBase.geometryDoc.semantic.ir.entities.find((entity) => (
      entity.sourceBindingIds?.some((bindingId) => bindingId.includes('inspect-segment'))
    ));
    expect(output).toBeDefined();
    const managed = toolContextFor(
      managedSource,
      [output!.id],
      managedBase.geometryDoc.semantic.ir.entities.map((entity) => entity.id),
    );
    const result = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'inspect-managed-segment',
      name: 'inspect-construction',
      arguments: { refs: [output!.id] },
    }, managed.context);

    expect(result).toMatchObject({
      ok: true,
      payload: {
        constructions: expect.arrayContaining([
          expect.objectContaining({
            managedConstructionId: 'inspect-segment',
            plan: expect.objectContaining({ kind: 'primitive' }),
          }),
        ]),
      },
    });
  });

  it('validates a candidate without mutating source truth', async () => {
    const before = context.basis.source;
    const result = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'validate-1',
      name: 'validate-tikz-action',
      arguments: { body: '\\draw (A) -- (B);' },
    }, context);
    expect(result).toMatchObject({ ok: true, payload: { valid: true, patchCount: 1 } });
    expect(context.basis.source).toBe(before);
  });

  it('rejects invalid tool arguments', async () => {
    const result = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'validate-2',
      name: 'validate-tikz-action',
      arguments: { body: '' },
    }, context);
    expect(result).toMatchObject({ ok: false, payload: { code: 'invalid-action-body' } });
  });

  it('does not expand inspection outside the server-attested focus closure', async () => {
    const result = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'inspect-outside',
      name: 'inspect-geometry',
      arguments: { refs: ['B'] },
    }, { ...context, allowedEntityIds: ['point:A'] });
    expect(result).toMatchObject({
      ok: false,
      payload: { code: 'reference-outside-focus-scope' },
    });
    const relation = await executeTikzAgentReadTool({
      schemaVersion: 'tikz-agent-tool-call/v1',
      callId: 'explain-outside',
      name: 'explain-relation',
      arguments: { from: 'A', to: 'C' },
    }, { ...context, allowedEntityIds: ['point:A'] });
    expect(relation).toMatchObject({
      ok: false,
      payload: { code: 'reference-outside-focus-scope', refs: ['C'] },
    });
  });

  it('keeps problem-search observations bounded while preserving attribution', () => {
    const records = Array.from({ length: 6 }, (_, index) => ({
      id: `mathnet:${index}`,
      source: 'mathnet' as const,
      title: `Problem ${index}`,
      statement: 'S'.repeat(10_000),
      solutions: ['T'.repeat(12_000)],
      topics: ['Geometry > Circles'],
      sourceUrl: `https://mathnet.mit.edu/explorer.html?p=${index}`,
      datasetUrl: 'https://huggingface.co/datasets/ShadenA/MathNet',
      license: 'CC BY 4.0',
      licenseId: 'CC-BY-4.0',
      contentHash: index.toString(16).padStart(64, '0'),
      contentHashAlgorithm: 'sha256-utf8' as const,
      contentHashScope: 'normalized-live-snapshot' as const,
      solutionProvenance: 'dataset-provided' as const,
      hasImages: true,
      assets: [{
        assetId: `mathnet:${index}:asset:images[0]`,
        role: 'problem-diagram' as const,
        providerField: 'images[0]',
        integrity: 'unverified-live-reference' as const,
        rightsDecision: 'review-required' as const,
      }],
      provider: {
        datasetId: 'ShadenA/MathNet',
        config: 'all',
        split: 'train',
        rowIndex: index,
        revision: null,
        revisionStatus: 'unpinned-live-viewer' as const,
      },
      rights: {
        datasetLicenseId: 'CC-BY-4.0',
        codeLicenseId: 'unknown',
        sourceMaterialRights: 'conditional' as const,
        redistribution: 'review-required' as const,
        commercial: 'review-required' as const,
        training: 'review-required' as const,
        rowOverride: 'not-exposed' as const,
        evidenceUrls: ['https://huggingface.co/datasets/ShadenA/MathNet'],
        notice: 'Original competition rights may remain with their owners.',
      },
      taint: 'untrusted-external-reference' as const,
      admission: 'search-reference-only' as const,
      retrievedAt: '2026-08-16T00:00:00.000Z',
    }));
    const compact = compactGeometryProblemRecords(records);
    expect(compact.length).toBeGreaterThan(0);
    expect(JSON.stringify(compact).length).toBeLessThanOrEqual(28_000);
    expect(compact[0]).toMatchObject({
      statementPreview: 'S'.repeat(800),
      solutionCount: 1,
      sourceUrl: 'https://mathnet.mit.edu/explorer.html?p=0',
      license: 'CC BY 4.0',
      licenseId: 'CC-BY-4.0',
      solutionProvenance: 'dataset-provided',
      contentHashAlgorithm: 'sha256-utf8',
      admission: 'search-reference-only',
      taint: 'untrusted-external-reference',
      rights: {
        redistribution: 'review-required',
        commercial: 'review-required',
        training: 'review-required',
      },
    });
    expect(compact[0]).not.toHaveProperty('statement');
    expect(compact[0]).not.toHaveProperty('solutions');
  });
});
