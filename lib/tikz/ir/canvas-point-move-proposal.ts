import {
  compileConstructionWriterArtifact,
  type ConstructionPlan,
  type PrimitiveConstructionPlan,
} from '../authoring/construction-ir';
import {
  constructionPlanSyntaxKind,
  decodeManagedConstructionPlan,
} from '../authoring/construction-plan-codec';
import { managedConstructionPlanRecompilePatches } from '../authoring/managed-construction-recompile';
import {
  coordinateLiteralPatch,
  formatCoordNumber,
} from '../patch/source-patch';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';
import { hashSource } from '../document/source-hash';
import { analyze } from '../analyze';
import type { TextPatch } from '../document/source-transaction';
import type { GeometryDoc } from './geometry-doc';
import { buildDependencyGraph } from './invalidation';
import {
  assertSelectionTransformImpactAcknowledged,
  planSelectionTransform,
  selectionTransformVariableEntityIds,
  type SelectionTransform,
} from '../authoring/selection-transform';
import { managedBlockBindingId } from './managed-binding-id';
import type { JsonObject } from './model';
import type { GeometryTransactionRequest } from './transactions';
import { sourceCoordinateForWorldPoint } from '../subset/coordinate-transform';

export const CANVAS_POINT_MOVE_PROPOSAL_SCHEMA_VERSION =
  'canvas-point-move-proposal/v1' as const;

export interface CanvasPointMoveProposalInput {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly sourceStableId: string;
  readonly pointName: string;
  readonly target: { readonly x: number; readonly y: number };
}

export interface CanvasPointMoveProposal {
  readonly schemaVersion: typeof CANVAS_POINT_MOVE_PROPOSAL_SCHEMA_VERSION;
  readonly transaction: GeometryTransactionRequest;
}

export interface CanvasDragPatchesProposalInput {
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly sourceStableId: string;
  readonly pointName: string;
  readonly mode: 'path-angle' | 'derived-coordinates' | 'selection-transform';
  readonly patches: readonly TextPatch[];
  readonly selectedEntityIds?: readonly string[];
  readonly selectionTransform?: SelectionTransform;
  readonly acknowledgedExternalImpactedEntityIds?: readonly string[];
}

type ManagedBlockCapability = {
  readonly bindingId: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly sourceHash: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly managedConstructionId: string;
  readonly writePolicy: 'managed-recompile-only';
};

type DirectPointCapability = {
  readonly bindingId: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly sourceHash: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly writePolicy: 'direct';
};

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function canonicalCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError('Canvas point target must contain finite coordinates.');
  }
  return Number(formatCoordNumber(value));
}

function movedPointPlan(
  previous: PrimitiveConstructionPlan,
  entityRecordId: string,
  target: { readonly x: number; readonly y: number },
): ConstructionPlan {
  if (previous.primitive.kind !== 'point') {
    throw new TypeError('Canvas point move accepts only a managed primitive point.');
  }
  // Bind the narrowed primitive: the guard above does not narrow the property
  // inside the closure below.
  const previousPoint = previous.primitive;
  const pointEntities = previous.entities.filter((entity) => (
    entity.kind === 'point'
    && entity.id === entityRecordId
    && entity.name === previousPoint.name
  ));
  if (pointEntities.length !== 1) {
    throw new TypeError('Managed point plan does not have one stable point entity record.');
  }
  return {
    ...previous,
    primitive: {
      ...previous.primitive,
      position: target,
    },
    entities: previous.entities.map((entity) => (
      entity.kind === 'point' && entity.id === entityRecordId
        ? { ...entity, position: target }
        : entity
    )),
  };
}

function sourcePatchTransaction(
  input: CanvasPointMoveProposalInput,
  patch: { readonly from: number; readonly to: number; readonly insert: string },
  transactionId: string,
  metadata: NonNullable<GeometryTransactionRequest['metadata']>,
): CanvasPointMoveProposal {
  const basis = input.geometryDoc.basis;
  const sourceId = basis.sourceId!;
  const range = { start: patch.from, end: patch.to };
  const expectedText = input.source.slice(patch.from, patch.to);
  const resource = { kind: 'source-range' as const, sourceId, range };
  const precondition = {
    kind: 'source-slice-equals' as const,
    sourceId,
    range,
    text: expectedText,
  };
  return {
    schemaVersion: CANVAS_POINT_MOVE_PROPOSAL_SCHEMA_VERSION,
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
        patches: [{ sourceId, range, insert: patch.insert, expectedText }],
        preconditions: [precondition],
      }],
      metadata,
    },
  };
}

function directBindingCapability(
  geometryDoc: GeometryDoc,
  semanticEntityId: string,
): { binding: GeometryDoc['construction']['bindings'][number]; capability: DirectPointCapability } {
  const entity = geometryDoc.semantic.ir.entities.find((candidate) => (
    candidate.id === semanticEntityId
  ));
  const bindings = (entity?.sourceBindingIds ?? []).flatMap((bindingId) => {
    const binding = geometryDoc.construction.bindings.find((candidate) => (
      candidate.id === bindingId
      && candidate.writable
      && candidate.targets.some((target) => (
        target.recordType === 'entity' && target.id === semanticEntityId
      ))
    ));
    return binding ? [binding] : [];
  });
  const sourceId = geometryDoc.basis.sourceId;
  if (!sourceId || !entity || bindings.length !== 1) {
    throw new TypeError(`Geometry entity ${semanticEntityId} has no unique direct binding.`);
  }
  const binding = bindings[0]!;
  return {
    binding,
    capability: {
      bindingId: binding.id,
      sourceId,
      sourceRevision: geometryDoc.basis.revision,
      sourceHash: geometryDoc.basis.sourceHash,
      range: { ...binding.source.range },
      writePolicy: 'direct',
    },
  };
}

function coordinateTarget(insert: string): { x: number; y: number } | null {
  const match = /^\(\s*([^,()]+)\s*,\s*([^,()]+)\s*\)$/.exec(insert);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const target = { x: canonicalCoordinate(x), y: canonicalCoordinate(y) };
  return coordinateLiteralPatch('', { start: 0, end: 0 }, target).insert === insert
    ? target
    : null;
}

function derivedUpstreamVariableIds(
  geometryDoc: GeometryDoc,
  semanticEntityId: string,
  pointName: string,
): string[] {
  const dragged = geometryDoc.semantic.ir.entities.filter((entity) => (
    entity.id === semanticEntityId
    && entity.kind === 'point'
    && entity.name === pointName
  ));
  const draggedPoint = dragged[0];
  if (
    dragged.length !== 1
    || !draggedPoint
    || (
      draggedPoint.parameters?.free !== false
      && !draggedPoint.tags?.includes('derived')
    )
  ) {
    throw new TypeError('Derived Canvas drag target is not one current derived point.');
  }
  const graph = buildDependencyGraph(geometryDoc.semantic.ir.relations);
  const knownEntityIds = new Set(
    geometryDoc.semantic.ir.entities.map((entity) => entity.id),
  );
  const ancestors = new Set<string>();
  const queue = [...(graph.dependencies.get(semanticEntityId) ?? [])].sort();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ancestors.has(current) || !knownEntityIds.has(current)) continue;
    ancestors.add(current);
    for (const dependency of graph.dependencies.get(current) ?? []) {
      if (!ancestors.has(dependency)) queue.push(dependency);
    }
    queue.sort();
  }
  return geometryDoc.semantic.ir.entities
    .filter((entity) => (
      ancestors.has(entity.id)
      && entity.kind === 'point'
      && (
        entity.parameters?.free === true
        || entity.tags?.includes('free')
      )
    ))
    .map((entity) => entity.id)
    .sort();
}

/** Compile path-angle and solver-driven coordinate batches into one proof. */
export function compileCanvasDragPatchesProposal(
  input: CanvasDragPatchesProposalInput,
): CanvasPointMoveProposal {
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
    || input.patches.length === 0
  ) {
    throw new TypeError('Canvas drag batch requires the current source-bound GeometryDoc.');
  }
  const analysis = analyze(input.source, basis.revision);
  if (analysis.status !== 'complete' || !analysis.scene) {
    throw new TypeError('Canvas drag batch requires a complete current semantic projection.');
  }
  // The proof travels in transaction metadata, which is JsonValue-typed.
  let proof: JsonObject;
  if (input.mode === 'path-angle') {
    const point = analysis.scene.points.get(input.pointName);
    const angleRanges = point?.constraint?.angleRanges ?? [];
    const targetAngle = input.patches.length > 0
      ? Number(input.patches[0]!.insert)
      : Number.NaN;
    const canonicalAngle = Number(formatCoordNumber(targetAngle));
    const expectedInsert = formatCoordNumber(canonicalAngle);
    const { binding, capability } = directBindingCapability(
      input.geometryDoc,
      input.sourceStableId,
    );
    if (
      !point?.constraint
      || angleRanges.length === 0
      || input.patches.length !== angleRanges.length
      || input.patches.some((patch, index) => (
        patch.from !== angleRanges[index]?.start
        || patch.to !== angleRanges[index]?.end
        || patch.insert !== expectedInsert
        || patch.from < binding.source.range.start
        || patch.to > binding.source.range.end
      ))
    ) {
      throw new TypeError('Canvas path drag does not match its current angle parameters.');
    }
    proof = {
      schemaVersion: 'canvas-point-move-proof/v1',
      mode: 'path-angle',
      pointName: input.pointName,
      sourceStableId: input.sourceStableId,
      targetAngle: canonicalAngle,
      angleRanges: angleRanges.map((range) => ({ ...range })),
      bindingCapability: capability,
    };
  } else {
    const selectedEntityIds = input.mode === 'selection-transform'
      ? [...new Set(input.selectedEntityIds ?? [])].sort()
      : [];
    const authorizedVariableEntityIds = input.mode === 'selection-transform'
      ? selectionTransformVariableEntityIds(input.geometryDoc, selectedEntityIds)
      : derivedUpstreamVariableIds(
        input.geometryDoc,
        input.sourceStableId,
        input.pointName,
      );
    const canonicalSelectionPlan = input.mode === 'selection-transform'
      ? planSelectionTransform(
        input.source,
        input.geometryDoc,
        selectedEntityIds,
        input.selectionTransform ?? (() => { throw new TypeError('Selection transform proof is missing its affine transform.'); })(),
      )
      : null;
    if (canonicalSelectionPlan) {
      assertSelectionTransformImpactAcknowledged(
        canonicalSelectionPlan,
        input.acknowledgedExternalImpactedEntityIds,
      );
    }
    if (
      canonicalSelectionPlan
      && (
        JSON.stringify(canonicalSelectionPlan.variableEntityIds) !== JSON.stringify(authorizedVariableEntityIds)
        || JSON.stringify(canonicalSelectionPlan.patches) !== JSON.stringify(input.patches)
      )
    ) {
      throw new TypeError('Selection transform patches do not match the canonical affine transform of every writable variable.');
    }
    const authorizedVariables = new Set(authorizedVariableEntityIds);
    if (authorizedVariables.size === 0) {
      throw new TypeError('Derived Canvas drag has no writable upstream variables.');
    }
    const freeRanges = [...analysis.freePointRanges.entries()];
    const moves = input.patches.map((patch) => {
      const rangeMatch = freeRanges.filter(([, range]) => (
        range.start === patch.from && range.end === patch.to
      ));
      const target = coordinateTarget(patch.insert);
      if (rangeMatch.length !== 1 || !target) {
        throw new TypeError('Derived Canvas drag patch is not one canonical free-point coordinate.');
      }
      const [pointName, coordinateRange] = rangeMatch[0]!;
      const semanticEntityId = `point:${pointName}`;
      if (!authorizedVariables.has(semanticEntityId)) {
        throw new TypeError(
          `Derived Canvas drag cannot write unrelated point ${pointName}.`,
        );
      }
      const { binding, capability } = directBindingCapability(
        input.geometryDoc,
        semanticEntityId,
      );
      if (
        coordinateRange.start < binding.source.range.start
        || coordinateRange.end > binding.source.range.end
      ) {
        throw new TypeError('Derived Canvas drag coordinate escaped its direct binding.');
      }
      return {
        pointName,
        semanticEntityId,
        target,
        coordinateRange: { ...coordinateRange },
        bindingCapability: capability,
      };
    });
    if (new Set(moves.map((move) => move.semanticEntityId)).size !== moves.length) {
      throw new TypeError('Derived Canvas drag contains duplicate point capabilities.');
    }
    proof = {
      schemaVersion: 'canvas-point-move-proof/v1',
      mode: input.mode,
      pointName: input.pointName,
      sourceStableId: input.sourceStableId,
      ...(input.mode === 'selection-transform' ? { selectedEntityIds } : {}),
      ...(canonicalSelectionPlan ? { transform: canonicalSelectionPlan.transform } : {}),
      ...(canonicalSelectionPlan ? {
        impactedEntityIds: canonicalSelectionPlan.impactedEntityIds,
        externalImpactedEntityIds: canonicalSelectionPlan.externalImpactedEntityIds,
      } : {}),
      authorizedVariableEntityIds,
      moves,
    };
  }
  const mutationFingerprint = hashSource(JSON.stringify({
    mode: input.mode,
    pointName: input.pointName,
    sourceStableId: input.sourceStableId,
    proof,
    patches: input.patches,
  }));
  const transactionId = [
    'canvas-point-move',
    basis.documentId,
    basis.epoch,
    basis.revision,
    input.sourceStableId,
    mutationFingerprint,
  ].join(':');
  const resources = input.patches.map((patch) => ({
    kind: 'source-range' as const,
    sourceId,
    range: { start: patch.from, end: patch.to },
  }));
  const preconditions = input.patches.map((patch) => ({
    kind: 'source-slice-equals' as const,
    sourceId,
    range: { start: patch.from, end: patch.to },
    text: input.source.slice(patch.from, patch.to),
  }));
  return {
    schemaVersion: CANVAS_POINT_MOVE_PROPOSAL_SCHEMA_VERSION,
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
      operations: [{
        operationId: `${transactionId}:source`,
        op: 'source-patch',
        patches: input.patches.map((patch) => ({
          sourceId,
          range: { start: patch.from, end: patch.to },
          insert: patch.insert,
          expectedText: input.source.slice(patch.from, patch.to),
        })),
        preconditions,
      }],
      metadata: {
        sourceEditOrigin: 'geometry',
        proposalSchemaVersion: CANVAS_POINT_MOVE_PROPOSAL_SCHEMA_VERSION,
        semanticWrite: true,
        semanticEntityId: input.sourceStableId,
        canvasPointMoveProof: proof,
      },
    },
  };
}

/**
 * Compile one Canvas point gesture into a typed semantic replacement.
 *
 * Both direct coordinate literals and managed point plans are compiled into a
 * closed proposal. Canvas never receives authority to submit an untyped source
 * patch merely because a point happens to be directly writable.
 */
export function compileCanvasPointMoveProposal(
  input: CanvasPointMoveProposalInput,
): CanvasPointMoveProposal | null {
  const basis = input.geometryDoc.basis;
  const sourceId = basis.sourceId;
  if (!sourceId) {
    throw new TypeError('Canvas point move requires a source-bound GeometryDoc.');
  }
  const primarySource = input.geometryDoc.construction.sources.find((source) => (
    source.sourceId === sourceId
  ));
  if (
    !primarySource
    || primarySource.revision !== basis.revision
    || primarySource.hash !== basis.sourceHash
    || primarySource.text !== input.source
  ) {
    throw new TypeError('Canvas point move source is detached from its GeometryDoc.');
  }
  const target = {
    x: canonicalCoordinate(input.target.x),
    y: canonicalCoordinate(input.target.y),
  };
  const semanticEntities = input.geometryDoc.semantic.ir.entities.filter((entity) => (
    entity.id === input.sourceStableId
    && entity.kind === 'point'
    && entity.name === input.pointName
  ));
  const semanticEntity = semanticEntities[0];
  const sourceBindings = (semanticEntity?.sourceBindingIds ?? []).flatMap((bindingId) => {
    const binding = input.geometryDoc.construction.bindings.find((candidate) => (
      candidate.id === bindingId
      && candidate.targets.some((targetReference) => (
        targetReference.recordType === 'entity'
        && targetReference.id === input.sourceStableId
      ))
    ));
    return binding ? [binding] : [];
  });
  const directBindings = sourceBindings.filter((binding) => binding.writable);
  // The block binding records the owning construction as `constructionId`;
  // per-record bindings additionally carry `managedConstructionId`. Read both,
  // exactly as the Inspector style compiler does.
  const constructionIdOf = (
    binding: { readonly metadata?: { readonly [key: string]: unknown } },
  ): string | undefined => (
    metadataString(binding.metadata?.managedConstructionId)
    ?? metadataString(binding.metadata?.constructionId)
  );
  const managedSourceBindings = sourceBindings.filter((binding) => (
    !binding.writable && constructionIdOf(binding) !== undefined
  ));
  // One managed point legitimately carries several read-only bindings: the
  // block, its entity record and its output record all target the same entity.
  // Uniqueness therefore has to be asserted over the owning construction, and
  // the authoritative writer capability is the block binding — the same rule
  // the Inspector style compiler applies. The block capability is re-verified
  // against the parsed block below, so this selection grants no authority.
  const managedConstructionIds = new Set(managedSourceBindings.flatMap((binding) => {
    const id = constructionIdOf(binding);
    return id === undefined ? [] : [id];
  }));
  const managedBlockBinding = managedConstructionIds.size === 1
    ? managedSourceBindings.find((binding) => (
      binding.id === managedBlockBindingId([...managedConstructionIds][0]!)
    ))
    : undefined;
  const sourceBinding = directBindings.length === 1
    ? directBindings[0]
    : directBindings.length === 0
      ? managedBlockBinding
      : undefined;
  const selectedManagedConstructionId = sourceBinding
    ? constructionIdOf(sourceBinding)
    : undefined;
  if (
    semanticEntities.length !== 1
    || !sourceBinding
    || !sourceBinding.targets.some((targetReference) => (
      targetReference.recordType === 'entity'
      && targetReference.id === input.sourceStableId
    ))
    || sourceBinding.source.document.sourceId !== sourceId
    || sourceBinding.source.document.revision !== basis.revision
    || sourceBinding.source.document.hash !== basis.sourceHash
  ) {
    throw new TypeError(
      `Canvas point ${input.pointName} is not a unique current GeometryDoc selection.`,
    );
  }
  if (sourceBinding.writable) {
    if (selectedManagedConstructionId) {
      throw new TypeError('A direct Canvas point capability cannot also be managed.');
    }
    const analysis = analyze(input.source, basis.revision);
    const coordinateRange = analysis.freePointRanges.get(input.pointName);
    if (
      analysis.status !== 'complete'
      || !coordinateRange
      || coordinateRange.start < sourceBinding.source.range.start
      || coordinateRange.end > sourceBinding.source.range.end
    ) {
      throw new TypeError(
        `Canvas point ${input.pointName} has no complete direct coordinate capability.`,
      );
    }
    const sourceTarget = sourceCoordinateForWorldPoint(
      analysis.freePointTransforms.get(input.pointName),
      target,
    );
    const patch = coordinateLiteralPatch(input.source, coordinateRange, sourceTarget);
    const bindingCapability: DirectPointCapability = {
      bindingId: sourceBinding.id,
      sourceId,
      sourceRevision: basis.revision,
      sourceHash: basis.sourceHash,
      range: { ...sourceBinding.source.range },
      writePolicy: 'direct',
    };
    const mutationFingerprint = hashSource(JSON.stringify({
      mode: 'direct-coordinate',
      pointName: input.pointName,
      sourceStableId: input.sourceStableId,
      target,
      coordinateRange,
      bindingCapability,
      replacement: patch.insert,
    }));
    const transactionId = [
      'canvas-point-move',
      basis.documentId,
      basis.epoch,
      basis.revision,
      input.sourceStableId,
      mutationFingerprint,
    ].join(':');
    return sourcePatchTransaction(input, patch, transactionId, {
      sourceEditOrigin: 'geometry',
      proposalSchemaVersion: CANVAS_POINT_MOVE_PROPOSAL_SCHEMA_VERSION,
      semanticWrite: true,
      bindingId: sourceBinding.id,
      semanticEntityId: input.sourceStableId,
      canvasPointMoveProof: {
        schemaVersion: 'canvas-point-move-proof/v1',
        mode: 'direct-coordinate',
        pointName: input.pointName,
        sourceStableId: input.sourceStableId,
        target,
        coordinateRange: { ...coordinateRange },
        bindingCapability,
      },
    });
  }
  if (
    !selectedManagedConstructionId
    || metadataString(sourceBinding.metadata?.writePolicy)
      !== 'managed-recompile-only'
  ) {
    throw new TypeError(
      `Canvas point ${input.pointName} is neither direct-writable nor a managed writer capability.`,
    );
  }
  const matches = parseManagedConstructionBlocks(input.source).flatMap((block) => {
    if (block.id !== selectedManagedConstructionId) return [];
    const decoded = decodeManagedConstructionPlan(input.source, block);
    if (
      !decoded.ok
      || decoded.plan.kind !== 'primitive'
      || decoded.plan.primitive.kind !== 'point'
      || decoded.plan.primitive.name !== input.pointName
    ) return [];
    const pointEntities = decoded.plan.entities.filter((entity) => (
      entity.kind === 'point' && entity.name === input.pointName
    ));
    return pointEntities.length === 1
      ? [{ block, decoded, entityRecordId: pointEntities[0]!.id }]
      : [];
  });
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new TypeError(`Managed point ${input.pointName} is ambiguous.`);
  }
  const { block, decoded, entityRecordId } = matches[0]!;
  const bindingId = managedBlockBindingId(block.id);
  const binding = input.geometryDoc.construction.bindings.find((candidate) => (
    candidate.id === bindingId
  ));
  const managedConstructionId = metadataString(
    binding?.metadata?.constructionId,
  );
  const writePolicy = metadataString(binding?.metadata?.writePolicy);
  if (
    !binding
    || binding.writable
    || managedConstructionId !== block.id
    || writePolicy !== 'managed-recompile-only'
    || binding.source.document.sourceId !== sourceId
    || binding.source.document.revision !== basis.revision
    || binding.source.document.hash !== basis.sourceHash
    || binding.source.range.start !== block.range.start
    || binding.source.range.end !== block.range.end
  ) {
    throw new TypeError(`Managed point ${input.pointName} has no current GeometryDoc write capability.`);
  }
  const previousPlan = decoded.plan;
  // A managed point move only applies to a primitive plan. Reject any other
  // plan kind here rather than letting it reach the writer.
  if (previousPlan.kind !== 'primitive') {
    throw new TypeError(
      `Managed point ${input.pointName} is not backed by a primitive construction plan.`,
    );
  }
  const nextPlan = movedPointPlan(previousPlan, entityRecordId, target);
  const artifact = compileConstructionWriterArtifact(previousPlan);
  const patches = managedConstructionPlanRecompilePatches(
    input.source,
    block.id,
    nextPlan,
    {
      expectedContentFingerprint: block.contentFingerprint!,
      expectedRange: block.range,
      expectedPlanKind: block.planKind,
      expectedCanonicalPlan: previousPlan,
      expectedWriterId: artifact.writerId,
      expectedWriterRevision: artifact.writerRevision,
      expectedWriterSlotIds: artifact.slots.map((slot) => slot.id),
      expectedWriterSlotSemanticFingerprints:
        artifact.slots.map((slot) => slot.semanticFingerprint),
      ...(decoded.presentation
        ? {
          expectedPresentationFingerprint:
            decoded.presentation.presentationFingerprint,
          expectedAttachmentsFingerprint:
            decoded.presentation.attachmentsFingerprint,
        }
        : {}),
    },
  );
  const patch = patches[0];
  if (
    patches.length !== 1
    || !patch
    || patch.from !== block.range.start
    || patch.to !== block.range.end
  ) {
    throw new TypeError('Canvas point writer did not emit one managed whole-block patch.');
  }
  const bindingCapability: ManagedBlockCapability = {
    bindingId,
    sourceId,
    sourceRevision: basis.revision,
    sourceHash: basis.sourceHash,
    range: { ...block.range },
    managedConstructionId: block.id,
    writePolicy: 'managed-recompile-only',
  };
  const mutationFingerprint = hashSource(JSON.stringify({
    constructionId: block.id,
    entityRecordId,
    pointName: input.pointName,
    sourceStableId: input.sourceStableId,
    target,
    bindingCapability,
    replacement: patch.insert,
  }));
  const transactionId = [
    'canvas-point-move',
    basis.documentId,
    basis.epoch,
    basis.revision,
    block.id,
    mutationFingerprint,
  ].join(':');
  return sourcePatchTransaction(input, patch, transactionId, {
        sourceEditOrigin: 'geometry',
        proposalSchemaVersion: CANVAS_POINT_MOVE_PROPOSAL_SCHEMA_VERSION,
        managedConstructionOperationKind: 'replace-managed-construction',
        semanticWrite: true,
        bindingId,
        semanticEntityId: input.sourceStableId,
        constructionPlanKind: nextPlan.kind,
        constructionSyntaxKind: constructionPlanSyntaxKind(nextPlan),
        constructionPlanId: nextPlan.id,
        managedConstructionRecompileProof: {
          schemaVersion: 'managed-construction-recompile-proof/v1',
          mode: decoded.presentation ? 'lossless-presentation' : 'canonical',
          constructionId: block.id,
          previousContentFingerprint: block.contentFingerprint!,
          writerId: artifact.writerId,
          writerRevision: artifact.writerRevision,
          slotIds: artifact.slots.map((slot) => slot.id),
          slotSemanticFingerprints:
            artifact.slots.map((slot) => slot.semanticFingerprint),
          ...(decoded.presentation
            ? {
              presentationFingerprint:
                decoded.presentation.presentationFingerprint,
              attachmentsFingerprint:
                decoded.presentation.attachmentsFingerprint,
            }
            : {}),
        },
        canvasPointMoveProof: {
          schemaVersion: 'canvas-point-move-proof/v1',
          mode: 'managed-recompile',
          constructionId: block.id,
          entityRecordId,
          pointName: input.pointName,
          sourceStableId: input.sourceStableId,
          target,
          bindingCapability,
        },
  });
}
