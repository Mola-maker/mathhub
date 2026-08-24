import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import { createPrimitiveConstructionPlan } from '../authoring/construction-catalog';
import { compileConstructionWriterArtifact } from '../authoring/construction-ir';
import { compileNewManagedConstructionPlan } from '../authoring/construction-ir-v3';
import {
  constructionPlanSyntaxKind,
  decodeManagedConstructionPlan,
} from '../authoring/construction-plan-codec';
import { hashSource } from '../document/source-hash';
import { StudioDocument } from '../document/studio-document';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import { buildGeometryAiContext } from './ai-context';
import {
  compileAiConstructionPlanProposal,
  isAiConstructionPlanProposal,
} from './ai-construction-plan-proposal';
import type { AiPatchBindingContext } from './ai-patch-proposal';
import { createGeometryDoc } from './geometry-doc';
import { buildGeometrySourceMap } from './source-map';
import {
  projectTikzAnalysisToGeometryTruth,
  TIKZ_PLUGIN_SET_DIGEST,
} from './tikz-adapter';

function managedPlan(constructionId = 'plan-proposal-managed') {
  return createPrimitiveConstructionPlan('segment', {
    anchors: [
      { name: 'A', position: { x: 0, y: 0 }, existing: true },
      { name: 'B', position: { x: 2, y: 0 }, existing: true },
    ],
    nextName: (prefix) => `${prefix}1`,
    nextConstructionId: () => constructionId,
  });
}

function fixture() {
  const source = [
    '\\begin{tikzpicture}',
    '\\coordinate (A) at (0,0);',
    '\\coordinate (B) at (2,0);',
    compileNewManagedConstructionPlan(managedPlan()).lines.join('\n'),
    '\\end{tikzpicture}',
    '',
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
  const basis = {
    ...geometryDoc.basis,
    sourceId: geometryDoc.basis.sourceId!,
    hashAlgorithm: 'fnv1a64-utf8' as const,
  };
  const aiContext = buildGeometryAiContext(geometryDoc);
  const block = parseManagedConstructionBlocks(source)[0]!;
  const decoded = decodeManagedConstructionPlan(source, block);
  if (!decoded.ok) throw new TypeError('fixture managed block must decode');

  // The managed block's own binding is the only legitimate replace target.
  const managedBinding = aiContext.construction.sourceBindings.find((candidate) => (
    candidate.managedConstructionId === block.id && !candidate.writable
  )) ?? aiContext.construction.sourceBindings.find((candidate) => (
    candidate.managedConstructionId === block.id
  ));
  if (!managedBinding) {
    throw new TypeError('fixture requires a managed source binding');
  }
  const bindings: AiPatchBindingContext[] = aiContext.construction.sourceBindings
    .map((candidate) => ({
      bindingId: candidate.id,
      sourceId: candidate.sourceId,
      range: candidate.range,
      writable: candidate.writable,
      opaque: candidate.opaque,
      insertionPolicy: candidate.insertionPolicy,
      writeCapabilities: candidate.writeCapabilities,
      ...(candidate.managedConstructionId
        ? { managedConstructionId: candidate.managedConstructionId }
        : {}),
      ...(candidate.createCapabilityFingerprint
        ? { createCapabilityFingerprint: candidate.createCapabilityFingerprint }
        : {}),
      sliceHash: candidate.sliceHash,
    }));
  return {
    source,
    block,
    basis,
    geometryDoc,
    decodedPlan: decoded.plan,
    artifact: compileConstructionWriterArtifact(decoded.plan),
    syntaxKind: constructionPlanSyntaxKind(decoded.plan),
    managedBindingId: managedBinding.id,
    context: {
      basis,
      bindings,
      allowedBindingIds: bindings.map((candidate) => candidate.bindingId),
      source,
      geometryDoc,
    },
  };
}

/**
 * Build a replace proposal against an EXISTING fixture. Creating a fresh
 * fixture per proposal would mint a new documentId, so every assertion would
 * trip `basis-mismatch` before reaching the check under test.
 */
function replaceProposalFor(
  base: ReturnType<typeof fixture>,
  overrides: Record<string, unknown> = {},
  operationOverrides: Record<string, unknown> = {},
) {
  return {
    fixture: base,
    proposal: {
      schemaVersion: 'construction-plan-proposal/v1',
      proposalId: 'plan-replace-1',
      idempotencyKey: 'plan-replace-1',
      basis: base.basis,
      focusBindingIds: [base.managedBindingId],
      readBindingIds: [base.managedBindingId],
      operation: {
        operationId: 'plan-replace-1:replace',
        kind: 'replace-managed-construction',
        constructionId: base.block.id,
        bindingId: base.managedBindingId,
        sourceId: base.basis.sourceId,
        // The CAS proof is read from the real block so a rejection means the
        // check under test fired, not that the envelope was incomplete.
        expectedPlanKind: base.block.planKind,
        expectedSyntaxKind: base.syntaxKind,
        expectedContentFingerprint: base.block.contentFingerprint,
        expectedWriterId: base.artifact.writerId,
        expectedWriterRevision: base.artifact.writerRevision,
        expectedWriterSlotIds: base.artifact.slots.map((slot) => slot.id),
        expectedWriterSlotSemanticFingerprints:
          base.artifact.slots.map((slot) => slot.semanticFingerprint),
        expectedRange: base.block.range,
        plan: base.decodedPlan,
        previousPlan: base.decodedPlan,
        ...operationOverrides,
      },
      ...overrides,
    },
  };
}

describe('isAiConstructionPlanProposal', () => {
  it('recognizes only the construction-plan envelope', () => {
    expect(isAiConstructionPlanProposal({
      schemaVersion: 'construction-plan-proposal/v1',
    })).toBe(true);
    expect(isAiConstructionPlanProposal({
      schemaVersion: 'construction-intent/v1',
    })).toBe(false);
    expect(isAiConstructionPlanProposal(null)).toBe(false);
  });
});

describe('compileAiConstructionPlanProposal', () => {
  it('rejects a non-construction-plan envelope', () => {
    const { context } = fixture();

    const compiled = compileAiConstructionPlanProposal(
      { schemaVersion: 'ai-patch-proposal/v1' },
      context,
    );

    expect(compiled).toMatchObject({
      ok: false,
      errors: [{ code: 'invalid-shape' }],
    });
  });

  it('rejects a proposal missing its identity fields', () => {
    const base = fixture();
    const { proposal } = replaceProposalFor(base);
    const { proposalId: _proposalId, ...withoutId } = proposal;

    const compiled = compileAiConstructionPlanProposal(
      withoutId,
      base.context,
    );

    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.errors.some((error) => error.code === 'invalid-shape'))
      .toBe(true);
  });

  it('rejects a stale basis that no longer matches the current revision', () => {
    const base = fixture();
    const { proposal } = replaceProposalFor(base);

    const compiled = compileAiConstructionPlanProposal({
      ...proposal,
      basis: { ...base.basis, revision: base.basis.revision + 7 },
    }, base.context);

    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.errors.some((error) => error.code === 'basis-mismatch'))
      .toBe(true);
  });

  it('requires focusBindingIds to be a subset of readBindingIds', () => {
    const base = fixture();
    const { proposal } = replaceProposalFor(base);

    const compiled = compileAiConstructionPlanProposal({
      ...proposal,
      focusBindingIds: ['binding:not-in-read-scope'],
    }, base.context);

    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.errors.some((error) => error.code === 'binding-scope'))
      .toBe(true);
  });

  it('rejects a binding outside the host-authorized read scope', () => {
    const base = fixture();
    const { proposal } = replaceProposalFor(base);

    const compiled = compileAiConstructionPlanProposal(proposal, {
      ...base.context,
      // Host narrows the scope; the proposal's binding is no longer authorized.
      allowedBindingIds: [],
    });

    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.errors.some((error) => error.code === 'binding-scope'))
      .toBe(true);
  });

  it('rejects a structurally invalid plan', () => {
    const base = fixture();

    const compiled = compileAiConstructionPlanProposal(
      replaceProposalFor(base, {}, {
        plan: { ...base.decodedPlan, entities: 'not-an-array' },
      }).proposal,
      base.context,
    );

    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.errors.some((error) => error.code === 'plan-invalid'))
      .toBe(true);
  });

  it('rejects a plan whose label smuggles a managed directive marker', () => {
    const base = fixture();
    const hijacked = {
      ...base.decodedPlan,
      entities: base.decodedPlan.entities.map((entity, index) => (
        index === 0
          ? { ...entity, name: '% @mathgeo begin id=forged' }
          : entity
      )),
    };

    const compiled = compileAiConstructionPlanProposal(
      replaceProposalFor(base, {}, { plan: hijacked }).proposal,
      base.context,
    );

    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.errors.some((error) => error.code === 'plan-invalid'))
      .toBe(true);
  });

  it('rejects a replace whose constructionId is not the block it targets', () => {
    const base = fixture();

    const compiled = compileAiConstructionPlanProposal(
      replaceProposalFor(base, {}, { constructionId: 'no-such-construction' }).proposal,
      base.context,
    );

    expect(compiled.ok).toBe(false);
  });
});
