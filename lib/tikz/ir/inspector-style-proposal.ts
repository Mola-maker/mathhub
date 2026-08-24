import {
  managedStyleRecompilePatches,
} from '../authoring/managed-construction-recompile';
import { compileConstructionWriterArtifact } from '../authoring/construction-ir';
import { decodeManagedConstructionPlan } from '../authoring/construction-plan-codec';
import type { TextPatch } from '../document/source-transaction';
import { hashSource } from '../document/source-hash';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import type { ConstructionBinding } from './model';
import type { GeometryDoc, GeometryDocReadonly } from './geometry-doc';
import type { GeometryTransactionRequest } from './transactions';
import { managedBlockBindingId } from './managed-binding-id';

export const INSPECTOR_STYLE_PROPOSAL_SCHEMA_VERSION =
  'inspector-style-proposal/v1' as const;

export interface ManagedInspectorStyleProposalInput {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly constructionId: string;
  readonly bindingIds: readonly string[];
  readonly bodyPatch: TextPatch;
}

export interface ManagedInspectorStyleProposal {
  readonly schemaVersion: typeof INSPECTOR_STYLE_PROPOSAL_SCHEMA_VERSION;
  readonly transaction: GeometryTransactionRequest;
}

type ManagedInspectorBindingCapability = {
  readonly bindingId: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly sourceHash: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly managedConstructionId: string;
  readonly writePolicy: 'managed-recompile-only';
};

function metadataString(
  binding: GeometryDocReadonly<ConstructionBinding>,
  key: string,
): string | undefined {
  const value = binding.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function bindingCapability(
  binding: GeometryDocReadonly<ConstructionBinding>,
  constructionId: string,
  sourceId: string,
  sourceRevision: number,
  sourceHash: string,
  blockRange: { readonly start: number; readonly end: number },
): ManagedInspectorBindingCapability {
  const managedConstructionId = (
    metadataString(binding, 'managedConstructionId')
    ?? metadataString(binding, 'constructionId')
  );
  const writePolicy = metadataString(binding, 'writePolicy');
  if (
    binding.writable
    || managedConstructionId !== constructionId
    || writePolicy !== 'managed-recompile-only'
    || binding.source.document.sourceId !== sourceId
    || binding.source.document.revision !== sourceRevision
    || binding.source.document.hash !== sourceHash
    || binding.source.range.start !== blockRange.start
    || binding.source.range.end !== blockRange.end
  ) {
    throw new TypeError(
      `Binding ${binding.id} is not a current GeometryDoc capability for managed construction ${constructionId}.`,
    );
  }
  return {
    bindingId: binding.id,
    sourceId,
    sourceRevision,
    sourceHash,
    range: { ...binding.source.range },
    managedConstructionId,
    writePolicy,
  };
}

/** Compile an Inspector style intent into the same typed Broker envelope as AI. */
export function compileManagedInspectorStyleProposal(
  input: ManagedInspectorStyleProposalInput,
): ManagedInspectorStyleProposal {
  const basis = input.geometryDoc.basis;
  const sourceId = basis.sourceId;
  if (!sourceId) {
    throw new TypeError('Inspector style proposal requires a source-bound GeometryDoc basis.');
  }
  if (input.bindingIds.length === 0) {
    throw new TypeError('Inspector style proposal requires a managed source binding capability.');
  }
  const blocks = parseManagedConstructionBlocks(input.source).filter((block) => (
    block.id === input.constructionId
  ));
  if (blocks.length !== 1) {
    throw new TypeError(`Managed construction ${input.constructionId} is missing or ambiguous.`);
  }
  const block = blocks[0]!;
  const primarySource = input.geometryDoc.construction.sources.find((source) => (
    source.sourceId === sourceId
  ));
  if (
    !primarySource
    || primarySource.revision !== basis.revision
    || primarySource.hash !== basis.sourceHash
    || primarySource.text !== input.source
  ) {
    throw new TypeError('Inspector style proposal source is detached from its GeometryDoc.');
  }
  if (
    block.metadataStatus !== 'valid'
    || block.integrityStatus !== 'valid'
    || !block.contentFingerprint
  ) {
    throw new TypeError(`Managed construction ${input.constructionId} is not attached and writable.`);
  }
  const decoded = decodeManagedConstructionPlan(input.source, block);
  if (!decoded.ok) {
    throw new TypeError(`Managed construction ${input.constructionId} cannot be decoded for style editing.`);
  }
  const artifact = compileConstructionWriterArtifact(decoded.plan);
  const authoritativeBindingIds = [managedBlockBindingId(input.constructionId)];
  if (!input.bindingIds.includes(authoritativeBindingIds[0]!)) {
    throw new TypeError(
      `Inspector selection does not include the managed block capability for ${input.constructionId}.`,
    );
  }
  const bindingsById = new Map(
    input.geometryDoc.construction.bindings.map((binding) => (
      [binding.id, binding] as const
    )),
  );
  const bindingCapabilities = authoritativeBindingIds.map((bindingId) => {
    const binding = bindingsById.get(bindingId);
    if (!binding) {
      throw new TypeError(`Binding ${bindingId} is not present in the current GeometryDoc.`);
    }
    return bindingCapability(
      binding,
      input.constructionId,
      sourceId,
      basis.revision,
      basis.sourceHash,
      block.range,
    );
  });
  const patches = managedStyleRecompilePatches(
    input.source,
    input.constructionId,
    input.bodyPatch,
  );
  const patch = patches[0];
  if (
    patches.length !== 1
    || !patch
    || patch.from !== block.range.start
    || patch.to !== block.range.end
  ) {
    throw new TypeError('Managed Inspector style compiler did not emit one whole-block patch.');
  }
  const range = { start: patch.from, end: patch.to };
  const expectedText = input.source.slice(patch.from, patch.to);
  const mutationFingerprint = hashSource(JSON.stringify({
    constructionId: input.constructionId,
    bindingIds: authoritativeBindingIds,
    bodyPatch: input.bodyPatch,
    replacement: patch.insert,
  }));
  const transactionId = [
    'inspector-style',
    basis.documentId,
    basis.epoch,
    basis.revision,
    input.constructionId,
    mutationFingerprint,
  ].join(':');
  const resource = { kind: 'source-range' as const, sourceId, range };
  const precondition = {
    kind: 'source-slice-equals' as const,
    sourceId,
    range,
    text: expectedText,
  };
  return {
    schemaVersion: INSPECTOR_STYLE_PROPOSAL_SCHEMA_VERSION,
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
      ...(basis.kernelHash
        ? { expectedKernelHash: basis.kernelHash }
        : {}),
      ...(basis.pluginSetDigest
        ? { pluginSetDigest: basis.pluginSetDigest }
        : {}),
      readSet: [resource],
      writeSet: [resource],
      preconditions: [precondition],
      operations: [{
        operationId: `${transactionId}:source`,
        op: 'source-patch',
        patches: [{
          sourceId,
          range,
          insert: patch.insert,
          expectedText,
        }],
        preconditions: [precondition],
      }],
      metadata: {
        sourceEditOrigin: 'style',
        proposalSchemaVersion: INSPECTOR_STYLE_PROPOSAL_SCHEMA_VERSION,
        managedConstructionOperationKind: 'replace-managed-construction',
        semanticWrite: false,
        bindingIds: authoritativeBindingIds,
        managedConstructionStyleProof: {
          schemaVersion: 'managed-construction-style-proof/v1',
          constructionId: input.constructionId,
          previousContentFingerprint: block.contentFingerprint,
          writerId: artifact.writerId,
          writerRevision: artifact.writerRevision,
          writerArtifactFingerprint: artifact.semanticFingerprint,
          slotIds: artifact.slots.map((slot) => slot.id),
          slotRoles: artifact.slots.map((slot) => slot.role),
          slotSemanticFingerprints:
            artifact.slots.map((slot) => slot.semanticFingerprint),
          bindingIds: authoritativeBindingIds,
          bindingCapabilities,
          bodyPatch: {
            from: input.bodyPatch.from,
            to: input.bodyPatch.to,
            insert: input.bodyPatch.insert,
            expectedText: input.source.slice(
              input.bodyPatch.from,
              input.bodyPatch.to,
            ),
          },
        },
      },
    },
  };
}
