import type { DeletePlan } from '../authoring/delete-transaction';
import { hashSource } from '../document/source-hash';
import type { TextPatch } from '../document/source-transaction';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import type { GeometryDoc } from './geometry-doc';
import { managedBlockBindingId } from './managed-binding-id';
import type { GeometryTransactionRequest } from './transactions';

export const CANVAS_DELETE_PROPOSAL_SCHEMA_VERSION =
  'canvas-delete-proposal/v1' as const;

export interface CanvasDeleteProposal {
  readonly schemaVersion: typeof CANVAS_DELETE_PROPOSAL_SCHEMA_VERSION;
  readonly transaction: GeometryTransactionRequest;
}

// A type alias, not an interface: the proof travels in transaction metadata as
// JsonValue, and only a type alias carries the implicit index signature that
// JsonObject requires. The sibling proposal capabilities are declared the same way.
export type CanvasDeleteManagedCapability = {
  readonly constructionId: string;
  readonly bindingId: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly sourceHash: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly contentFingerprint: string;
  readonly writePolicy: 'managed-recompile-only';
};

function overlaps(
  left: { readonly start: number; readonly end: number },
  right: { readonly start: number; readonly end: number },
): boolean {
  return left.start < right.end && left.end > right.start;
}

/**
 * A TextPatch addresses source as {from,to}; ranges use {start,end}. Passing a
 * patch straight into overlaps() silently compares undefined offsets, which
 * yields an empty closure and a proof asserting nothing was affected.
 */
function patchRange(patch: TextPatch): { readonly start: number; readonly end: number } {
  return { start: patch.from, end: patch.to };
}

export function canvasDeletePatchFingerprint(
  source: string,
  patches: readonly TextPatch[],
): string {
  return hashSource(JSON.stringify(patches.map((patch) => ({
    from: patch.from,
    to: patch.to,
    insert: patch.insert,
    expectedText: source.slice(patch.from, patch.to),
  }))));
}

function metadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Upgrade a GeometryDoc-authoritative deletion plan into a revision-bound
 * semantic transaction. Source patch generation remains a compatibility
 * adapter, but its statement closure has already been required to equal the
 * GeometryDoc dependency closure exactly.
 */
export function compileCanvasDeleteProposal(input: {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly plan: DeletePlan;
}): CanvasDeleteProposal {
  const { basis } = input.geometryDoc;
  const sourceId = basis.sourceId;
  if (!sourceId) {
    throw new TypeError('Canvas delete requires a source-bound GeometryDoc.');
  }
  const primarySource = input.geometryDoc.construction.sources.find((source) => (
    source.sourceId === sourceId
  ));
  if (
    !primarySource
    || primarySource.text !== input.source
    || primarySource.revision !== basis.revision
    || primarySource.hash !== basis.sourceHash
    || input.geometryDoc.semantic.status !== 'complete'
    || !input.plan.canApply
    || input.plan.patches.length === 0
    || input.plan.mode === 'detach'
  ) {
    throw new TypeError(
      'Canvas delete requires a complete current GeometryDoc and an attached, applicable dependency plan.',
    );
  }
  const patches = [...input.plan.patches].sort((left, right) => (
    left.from - right.from || left.to - right.to
  ));
  if (patches.some((patch, index) => (
    patch.insert !== ''
    || patch.from < 0
    || patch.to <= patch.from
    || patch.to > input.source.length
    || (index > 0 && patch.from < patches[index - 1]!.to)
  ))) {
    throw new TypeError('Canvas semantic delete requires ordered, disjoint empty patches.');
  }

  const blocks = parseManagedConstructionBlocks(input.source);
  const touchedBlocks = blocks.filter((block) => patches.some((patch) => (
    overlaps(patchRange(patch), block.range)
  )));
  const managedDeletions: CanvasDeleteManagedCapability[] = touchedBlocks.map((block) => {
    const patch = patches.find((candidate) => (
      candidate.from === block.range.start
      && candidate.to === block.range.end
      && candidate.insert === ''
    ));
    const bindingId = managedBlockBindingId(block.id);
    const binding = input.geometryDoc.construction.bindings.find((candidate) => (
      candidate.id === bindingId
    ));
    const managedOwner = binding
      ? metadataString(binding.metadata, 'managedConstructionId')
        ?? metadataString(binding.metadata, 'constructionId')
      : undefined;
    if (
      !patch
      || !block.contentFingerprint
      || block.metadataStatus !== 'valid'
      || block.integrityStatus !== 'valid'
      || !binding
      || binding.writable
      || managedOwner !== block.id
      || metadataString(binding.metadata, 'writePolicy') !== 'managed-recompile-only'
      || binding.source.document.sourceId !== sourceId
      || binding.source.document.revision !== basis.revision
      || binding.source.document.hash !== basis.sourceHash
      || binding.source.range.start !== block.range.start
      || binding.source.range.end !== block.range.end
    ) {
      throw new TypeError(
        `Managed construction ${block.id} has no current whole-block delete capability.`,
      );
    }
    return {
      constructionId: block.id,
      bindingId,
      sourceId,
      sourceRevision: basis.revision,
      sourceHash: basis.sourceHash,
      range: { ...block.range },
      contentFingerprint: block.contentFingerprint,
      writePolicy: 'managed-recompile-only',
    };
  });

  const affectedEntries = input.geometryDoc.sourceMap.entries.filter((entry) => (
    entry.sourceId === sourceId
    && patches.some((patch) => overlaps(patchRange(patch), entry.range))
  ));
  const closure = {
    rootNodeIds: [...input.plan.rootNodeIds].sort(),
    affectedNodeIds: [...input.plan.affectedNodeIds].sort(),
    removedNodeIds: [...input.plan.removedNodeIds].sort(),
    removedStatementIndices: [...input.plan.removedStatementIndices].sort((a, b) => a - b),
    bindingIds: [...new Set(affectedEntries.map((entry) => entry.bindingId))].sort(),
    entityIds: [...new Set(affectedEntries.flatMap((entry) => entry.entityIds))].sort(),
    semanticTargets: [...new Set(affectedEntries.flatMap((entry) => (
      entry.semanticTargets.map((target) => `${target.recordType}:${target.id}`)
    )))].sort(),
  };
  const patchFingerprint = canvasDeletePatchFingerprint(input.source, patches);
  const closureFingerprint = hashSource(JSON.stringify(closure));
  const transactionId = [
    'canvas-delete',
    basis.documentId,
    basis.epoch,
    basis.revision,
    patchFingerprint,
    closureFingerprint,
  ].join(':');
  const resources = patches.map((patch) => ({
    kind: 'source-range' as const,
    sourceId,
    range: { start: patch.from, end: patch.to },
  }));
  const preconditions = patches.map((patch) => ({
    kind: 'source-slice-equals' as const,
    sourceId,
    range: { start: patch.from, end: patch.to },
    text: input.source.slice(patch.from, patch.to),
  }));
  return {
    schemaVersion: CANVAS_DELETE_PROPOSAL_SCHEMA_VERSION,
    transaction: {
      schemaVersion: 'geometry-transaction/v1',
      transactionId,
      idempotencyKey: transactionId,
      documentId: basis.documentId,
      documentEpoch: basis.epoch,
      origin: 'canvas',
      stage: 'validated',
      expectedRevision: basis.revision,
      sourceHash: basis.sourceHash,
      ...(basis.kernelHash ? { expectedKernelHash: basis.kernelHash } : {}),
      ...(basis.pluginSetDigest ? { pluginSetDigest: basis.pluginSetDigest } : {}),
      readSet: resources,
      writeSet: resources,
      preconditions,
      operations: [{
        operationId: `${transactionId}:source`,
        op: 'source-patch',
        patches: patches.map((patch) => ({
          sourceId,
          range: { start: patch.from, end: patch.to },
          insert: '',
          expectedText: input.source.slice(patch.from, patch.to),
        })),
        preconditions,
      }],
      metadata: {
        sourceEditOrigin: 'canvas',
        proposalSchemaVersion: CANVAS_DELETE_PROPOSAL_SCHEMA_VERSION,
        semanticWrite: true,
        canvasDeleteProof: {
          schemaVersion: 'canvas-delete-proof/v1',
          mode: input.plan.mode,
          patchFingerprint,
          closureFingerprint,
          closure,
          managedDeletions,
        },
      },
    },
  };
}
