import {
  assertSelectionTransformImpactAcknowledged,
  planSelectionTransform,
  type SelectionTransform,
} from '../authoring/selection-transform';
import { hashSource } from '../document/source-hash';
import type { TextPatch } from '../document/source-transaction';
import { compileCanvasPointMoveProposal } from './canvas-point-move-proposal';
import { createGeometryWorkspaceEdit } from './geometry-workspace-edit';
import type { GeometryDoc } from './geometry-doc';
import type { JsonObject } from './model';
import type { GeometryOperation, GeometryTransactionRequest } from './transactions';

export const CANVAS_SELECTION_TRANSFORM_PROPOSAL_SCHEMA_VERSION =
  'canvas-selection-transform-proposal/v1' as const;

export interface CanvasSelectionTransformProposalInput {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly selectedEntityIds: readonly string[];
  readonly transform: SelectionTransform;
  readonly acknowledgedExternalImpactedEntityIds?: readonly string[];
}

export interface CanvasSelectionTransformProposal {
  readonly schemaVersion: typeof CANVAS_SELECTION_TRANSFORM_PROPOSAL_SCHEMA_VERSION;
  readonly transaction: GeometryTransactionRequest;
  readonly patches: readonly TextPatch[];
}

function pointWrite(
  input: CanvasSelectionTransformProposalInput,
  target: {
    readonly semanticEntityId: string;
    readonly pointName: string;
    readonly target: { readonly x: number; readonly y: number };
  },
) {
  const proposal = compileCanvasPointMoveProposal({
    source: input.source,
    geometryDoc: input.geometryDoc,
    sourceStableId: target.semanticEntityId,
    pointName: target.pointName,
    target: target.target,
  });
  if (!proposal) {
    throw new TypeError(`Selection driver ${target.semanticEntityId} has no point writer.`);
  }
  const operation = proposal.transaction.operations[0];
  const patch = operation?.op === 'source-patch' && operation.patches.length === 1
    ? operation.patches[0]
    : null;
  const pointMoveProof = proposal.transaction.metadata?.canvasPointMoveProof;
  if (!patch || !pointMoveProof || typeof pointMoveProof !== 'object') {
    throw new TypeError(`Selection driver ${target.semanticEntityId} has no canonical point writer.`);
  }
  return {
    semanticEntityId: target.semanticEntityId,
    pointName: target.pointName,
    target: target.target,
    patch: {
      from: patch.range.start,
      to: patch.range.end,
      insert: patch.insert,
    },
    pointMoveProof,
    ...(proposal.transaction.metadata?.managedConstructionRecompileProof
      ? {
        managedConstructionRecompileProof:
          proposal.transaction.metadata.managedConstructionRecompileProof,
      }
      : {}),
  };
}

/**
 * Compile a whole selection into one atomic transaction.
 *
 * Each writable driver is independently lowered through the existing trusted
 * point writer. Direct coordinates stay minimal; managed primitive points are
 * replaced as complete construction blocks. The Broker reconstructs this same
 * plan from the current GeometryDoc before accepting any byte.
 */
export function compileCanvasSelectionTransformProposal(
  input: CanvasSelectionTransformProposalInput,
): CanvasSelectionTransformProposal {
  const basis = input.geometryDoc.basis;
  const sourceId = basis.sourceId;
  const primarySource = input.geometryDoc.construction.sources.find((source) => (
    source.sourceId === sourceId
  ));
  if (
    !sourceId
    || !primarySource
    || primarySource.revision !== basis.revision
    || primarySource.hash !== basis.sourceHash
    || primarySource.text !== input.source
  ) {
    throw new TypeError('Selection transform requires the current source-bound GeometryDoc.');
  }
  const plan = planSelectionTransform(
    input.source,
    input.geometryDoc,
    input.selectedEntityIds,
    input.transform,
  );
  assertSelectionTransformImpactAcknowledged(
    plan,
    input.acknowledgedExternalImpactedEntityIds,
  );
  const writes = plan.targets.map((target) => pointWrite(input, target));
  const parameterWrites = plan.parameterWrites.map((write) => {
    if (
      write.range.start < 0
      || write.range.end > input.source.length
      || write.range.end <= write.range.start
    ) {
      throw new TypeError(`Selection parameter slot for ${write.semanticEntityId} is stale.`);
    }
    const { range, insert, ...proof } = write;
    return {
      ...proof,
      patch: {
        from: range.start,
        to: range.end,
        insert,
      },
    };
  });
  const patches = [...writes.map((write) => write.patch), ...parameterWrites.map((write) => write.patch)]
    .sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 1; index < patches.length; index += 1) {
    if (patches[index - 1]!.to > patches[index]!.from) {
      throw new TypeError('Selection transform writers overlap the same source range.');
    }
  }
  if (patches.length !== plan.variableEntityIds.length + plan.parameterWrites.length) {
    throw new TypeError('Selection transform did not produce its complete point and parameter writer set.');
  }
  const proof: JsonObject = {
    schemaVersion: 'canvas-selection-transform-proof/v1',
    selectedEntityIds: plan.selectedEntityIds,
    variableEntityIds: plan.variableEntityIds,
    impactedEntityIds: plan.impactedEntityIds,
    externalImpactedEntityIds: plan.externalImpactedEntityIds,
    transform: plan.transform,
    writes,
    parameterWrites,
  };
  const mutationFingerprint = hashSource(JSON.stringify({ proof, patches }));
  const transactionId = [
    'canvas-selection-transform',
    basis.documentId,
    basis.epoch,
    basis.revision,
    mutationFingerprint,
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
  const sourceOperation = {
    operationId: `${transactionId}:source`,
    op: 'source-patch',
    patches: patches.map((patch) => ({
      sourceId,
      range: { start: patch.from, end: patch.to },
      insert: patch.insert,
      expectedText: input.source.slice(patch.from, patch.to),
    })),
    preconditions,
  } satisfies GeometryOperation;
  const transformLabel = plan.transform.kind === 'translate'
    ? 'Move selection'
    : plan.transform.kind === 'rotate'
      ? 'Rotate selection'
      : plan.transform.kind === 'scale'
        ? 'Scale selection'
        : 'Reflect selection';
  const workspaceEdit = createGeometryWorkspaceEdit([sourceOperation], [{
    operationId: sourceOperation.operationId,
    label: transformLabel,
    description: `${plan.variableEntityIds.length} writable driver${plan.variableEntityIds.length === 1 ? '' : 's'} update ${plan.impactedEntityIds.length} semantic object${plan.impactedEntityIds.length === 1 ? '' : 's'}.`,
    needsConfirmation: plan.externalImpactedEntityIds.length > 0,
    semanticTargetIds: plan.impactedEntityIds,
    patchAnnotations: sourceOperation.patches.map(() => ({
      label: transformLabel,
      semanticTargetIds: plan.impactedEntityIds,
    })),
  }]);
  return {
    schemaVersion: CANVAS_SELECTION_TRANSFORM_PROPOSAL_SCHEMA_VERSION,
    patches,
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
      readSet: resources,
      writeSet: resources,
      preconditions,
      operations: [sourceOperation],
      workspaceEdit,
      metadata: {
        sourceEditOrigin: 'geometry',
        proposalSchemaVersion: CANVAS_SELECTION_TRANSFORM_PROPOSAL_SCHEMA_VERSION,
        semanticWrite: true,
        canvasSelectionTransformProof: proof,
      },
    },
  };
}
