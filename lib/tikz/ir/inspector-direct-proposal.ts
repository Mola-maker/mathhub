import { analyze } from '../analyze';
import { hashSource } from '../document/source-hash';
import {
  applyTextPatches,
  type TextPatch,
} from '../document/source-transaction';
import type { GeometryDoc } from './geometry-doc';
import type { GeometryTransactionRequest } from './transactions';

export const INSPECTOR_DIRECT_PROPOSAL_SCHEMA_VERSION =
  'inspector-direct-proposal/v1' as const;

export interface InspectorDirectProposalInput {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly semanticEntityId: string;
  readonly bindingIds: readonly string[];
  readonly patch: TextPatch;
  readonly propertyKind: 'style' | 'semantic';
}

export interface InspectorDirectProposal {
  readonly schemaVersion: typeof INSPECTOR_DIRECT_PROPOSAL_SCHEMA_VERSION;
  readonly transaction: GeometryTransactionRequest;
}

export function compileInspectorDirectProposal(
  input: InspectorDirectProposalInput,
): InspectorDirectProposal {
  const basis = input.geometryDoc.basis;
  const sourceId = basis.sourceId;
  const source = input.geometryDoc.construction.sources.find((candidate) => (
    candidate.sourceId === sourceId
  ));
  if (
    !sourceId
    || !source
    || source.revision !== basis.revision
    || source.hash !== basis.sourceHash
    || source.text !== input.source
  ) {
    throw new TypeError('Direct Inspector edit requires the current source-bound GeometryDoc.');
  }
  const entity = input.geometryDoc.semantic.ir.entities.find((candidate) => (
    candidate.id === input.semanticEntityId
  ));
  const allowedBindingIds = new Set(input.bindingIds);
  const bindings = (entity?.sourceBindingIds ?? []).flatMap((bindingId) => {
    if (!allowedBindingIds.has(bindingId)) return [];
    const binding = input.geometryDoc.construction.bindings.find((candidate) => (
      candidate.id === bindingId
      && candidate.writable
      && candidate.targets.some((target) => (
        target.recordType === 'entity' && target.id === input.semanticEntityId
      ))
    ));
    return binding ? [binding] : [];
  });
  if (!entity || bindings.length !== 1) {
    throw new TypeError('Direct Inspector selection has no unique writable entity binding.');
  }
  const binding = bindings[0]!;
  const bindingRange = binding.source.range;
  const patch = input.patch;
  if (
    !Number.isInteger(patch.from)
    || !Number.isInteger(patch.to)
    || patch.from < bindingRange.start
    || patch.to > bindingRange.end
    || patch.to < patch.from
    || (patch.from === patch.to && patch.insert.length === 0)
    || (
      patch.from === bindingRange.start
      && patch.to === bindingRange.end
      && patch.insert.length === 0
    )
  ) {
    throw new TypeError('Direct Inspector patch is outside its writable source binding.');
  }
  const candidateSource = applyTextPatches(input.source, [patch]);
  if (analyze(candidateSource, basis.revision).status !== 'complete') {
    throw new TypeError('Direct Inspector patch would leave an incomplete semantic projection.');
  }
  const bindingCapability = {
    bindingId: binding.id,
    sourceId,
    sourceRevision: basis.revision,
    sourceHash: basis.sourceHash,
    range: { ...bindingRange },
    writePolicy: 'direct' as const,
  };
  const bodyPatch = {
    from: patch.from,
    to: patch.to,
    insert: patch.insert,
    expectedText: input.source.slice(patch.from, patch.to),
  };
  const mutationFingerprint = hashSource(JSON.stringify({
    propertyKind: input.propertyKind,
    semanticEntityId: input.semanticEntityId,
    bindingCapability,
    bodyPatch,
  }));
  const transactionId = [
    'inspector-direct',
    basis.documentId,
    basis.epoch,
    basis.revision,
    input.semanticEntityId,
    mutationFingerprint,
  ].join(':');
  const range = { start: patch.from, end: patch.to };
  const resource = { kind: 'source-range' as const, sourceId, range };
  const precondition = {
    kind: 'source-slice-equals' as const,
    sourceId,
    range,
    text: bodyPatch.expectedText,
  };
  return {
    schemaVersion: INSPECTOR_DIRECT_PROPOSAL_SCHEMA_VERSION,
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
      ...(basis.projectionHash
        ? { expectedProjectionHash: basis.projectionHash }
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
          expectedText: bodyPatch.expectedText,
        }],
        preconditions: [precondition],
      }],
      metadata: {
        sourceEditOrigin: input.propertyKind === 'style' ? 'style' : 'geometry',
        proposalSchemaVersion: INSPECTOR_DIRECT_PROPOSAL_SCHEMA_VERSION,
        semanticWrite: input.propertyKind === 'semantic',
        bindingId: binding.id,
        semanticEntityId: input.semanticEntityId,
        inspectorDirectPatchProof: {
          schemaVersion: 'inspector-direct-patch-proof/v1',
          propertyKind: input.propertyKind,
          semanticEntityId: input.semanticEntityId,
          bindingCapability,
          bodyPatch,
        },
      },
    },
  };
}
