import type { SelectionTransform } from '../authoring/selection-transform';
import type { AiPatchProposalBasis, AiPatchCompileOptions, AiPatchValidationError } from './ai-patch-proposal';
import { compileCanvasSelectionTransformProposal } from './canvas-selection-transform-proposal';
import type { GeometryDoc } from './geometry-doc';
import type { JsonObject } from './model';
import type { GeometryTransactionRequest } from './transactions';

export const AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION =
  'ai-selection-transform-intent/v1' as const;

/**
 * Host-only lowering target for GeometryIntent/v2.
 *
 * The model never emits this schema. The host resolves semantic names to exact
 * entity IDs and attaches the current authorization-scope fingerprint before
 * server/browser compilation and Broker replay.
 */
export interface AiSelectionTransformIntent {
  readonly schemaVersion: typeof AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly basis: AiPatchProposalBasis;
  readonly authorizationScopeFingerprint: string;
  readonly selectedEntityIds: readonly string[];
  readonly transform: SelectionTransform;
}

export interface AiSelectionTransformValidationContext {
  readonly basis: AiPatchProposalBasis;
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly allowedBindingIds: readonly string[];
}

export type AiSelectionTransformIntentCompilation =
  | {
    readonly ok: true;
    readonly proposal: AiSelectionTransformIntent;
    readonly transaction: GeometryTransactionRequest;
  }
  | {
    readonly ok: false;
    readonly errors: readonly AiPatchValidationError[];
  };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function nonEmpty(value: unknown, maximum = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function point(value: unknown): value is { readonly x: number; readonly y: number } {
  return record(value)
    && exactKeys(value, ['x', 'y'])
    && finite(value.x)
    && finite(value.y);
}

function validBasis(value: unknown): value is AiPatchProposalBasis {
  return record(value)
    && exactKeys(value, [
      'documentId',
      'epoch',
      'hashAlgorithm',
      ...(value.kernelHash === undefined ? [] : ['kernelHash']),
      ...(value.pluginSetDigest === undefined ? [] : ['pluginSetDigest']),
      ...(value.projectionHash === undefined ? [] : ['projectionHash']),
      'revision',
      'sourceHash',
      'sourceId',
    ])
    && nonEmpty(value.documentId)
    && nonEmpty(value.epoch)
    && Number.isInteger(value.revision)
    && (value.revision as number) >= 0
    && nonEmpty(value.sourceHash)
    && nonEmpty(value.sourceId)
    && nonEmpty(value.hashAlgorithm)
    && (value.kernelHash === undefined || nonEmpty(value.kernelHash))
    && (value.projectionHash === undefined || nonEmpty(value.projectionHash))
    && (value.pluginSetDigest === undefined || nonEmpty(value.pluginSetDigest));
}

function validTransform(value: unknown): value is SelectionTransform {
  if (!record(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'translate') {
    return exactKeys(value, ['dx', 'dy', 'kind']) && finite(value.dx) && finite(value.dy);
  }
  if (value.kind === 'rotate') {
    return exactKeys(value, ['center', 'degrees', 'kind'])
      && finite(value.degrees)
      && (value.center === 'selection' || point(value.center));
  }
  if (value.kind === 'scale') {
    return exactKeys(value, ['center', 'factor', 'kind'])
      && finite(value.factor)
      && value.factor > 0
      && (value.center === 'selection' || point(value.center));
  }
  if (value.kind === 'reflect') {
    return exactKeys(value, ['kind', 'lineEnd', 'lineStart'])
      && point(value.lineStart)
      && point(value.lineEnd)
      && (value.lineStart.x !== value.lineEnd.x || value.lineStart.y !== value.lineEnd.y);
  }
  return false;
}

function uniqueStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 64
    && value.every((item) => nonEmpty(item))
    && new Set(value).size === value.length;
}

export function isAiSelectionTransformIntent(
  value: unknown,
): value is AiSelectionTransformIntent {
  return record(value)
    && exactKeys(value, [
      'authorizationScopeFingerprint',
      'basis',
      'idempotencyKey',
      'intentId',
      'schemaVersion',
      'selectedEntityIds',
      'transform',
    ])
    && value.schemaVersion === AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION
    && nonEmpty(value.intentId)
    && nonEmpty(value.idempotencyKey)
    && validBasis(value.basis)
    && nonEmpty(value.authorizationScopeFingerprint)
    && uniqueStrings(value.selectedEntityIds)
    && validTransform(value.transform);
}

function sameBasis(left: AiPatchProposalBasis, right: AiPatchProposalBasis): boolean {
  return left.documentId === right.documentId
    && left.epoch === right.epoch
    && left.revision === right.revision
    && left.sourceHash === right.sourceHash
    && left.sourceId === right.sourceId
    && left.hashAlgorithm === right.hashAlgorithm
    && left.kernelHash === right.kernelHash
    && left.projectionHash === right.projectionHash
    && left.pluginSetDigest === right.pluginSetDigest;
}

function sameGeometryDocBasis(
  left: AiPatchProposalBasis,
  right: GeometryDoc['basis'],
): boolean {
  return left.documentId === right.documentId
    && left.epoch === right.epoch
    && left.revision === right.revision
    && left.sourceHash === right.sourceHash
    && left.sourceId === right.sourceId
    && left.kernelHash === right.kernelHash
    && left.projectionHash === right.projectionHash
    && left.pluginSetDigest === right.pluginSetDigest;
}

function fail(code: string, message: string): AiSelectionTransformIntentCompilation {
  return { ok: false, errors: [{ code, message }] };
}

function entityBindingIds(
  geometryDoc: GeometryDoc,
  entityId: string,
  allowed: ReadonlySet<string>,
): string[] {
  const entity = geometryDoc.semantic.ir.entities.find((candidate) => candidate.id === entityId);
  if (!entity) return [];
  return [...new Set((entity.sourceBindingIds ?? []).filter((bindingId) => (
    allowed.has(bindingId)
  )))].sort();
}

function patchBindingIds(
  geometryDoc: GeometryDoc,
  patches: readonly { readonly from: number; readonly to: number }[],
  allowed: ReadonlySet<string>,
): string[] | null {
  const selected = new Set<string>();
  for (const patch of patches) {
    const owners = geometryDoc.sourceMap.entries.filter((entry) => (
      allowed.has(entry.bindingId)
      && entry.sourceId === geometryDoc.basis.sourceId
      && entry.range.start <= patch.from
      && entry.range.end >= patch.to
    ));
    if (owners.length === 0) return null;
    for (const owner of owners) selected.add(owner.bindingId);
  }
  return [...selected].sort();
}

/** Compile the host-resolved semantic transform through the Canvas planner. */
export function compileAiSelectionTransformIntent(
  value: unknown,
  context: AiSelectionTransformValidationContext,
  options: AiPatchCompileOptions = {},
): AiSelectionTransformIntentCompilation {
  if (!isAiSelectionTransformIntent(value)) {
    return fail('invalid-shape', 'AI selection transform intent has an invalid or open shape.');
  }
  if (!sameBasis(value.basis, context.basis)) {
    return fail('basis-mismatch', 'AI selection transform intent is stale or belongs to another document.');
  }
  if (!sameGeometryDocBasis(value.basis, context.geometryDoc.basis)) {
    return fail(
      'basis-mismatch',
      'AI selection transform GeometryDoc is stale or detached from the requested source basis.',
    );
  }
  const allowed = new Set(context.allowedBindingIds);
  if (allowed.size !== context.allowedBindingIds.length) {
    return fail('binding-scope', 'AI selection transform authorization scope is malformed.');
  }
  const focusBindingIds = [...new Set(value.selectedEntityIds.flatMap((entityId) => (
    entityBindingIds(context.geometryDoc, entityId, allowed)
  )))].sort();
  if (
    focusBindingIds.length === 0
    || value.selectedEntityIds.some((entityId) => (
      entityBindingIds(context.geometryDoc, entityId, allowed).length === 0
    ))
  ) {
    return fail('binding-scope', 'One or more transform targets are outside the current authorized semantic scope.');
  }

  let canvas: ReturnType<typeof compileCanvasSelectionTransformProposal>;
  try {
    canvas = compileCanvasSelectionTransformProposal({
      source: context.source,
      geometryDoc: context.geometryDoc,
      selectedEntityIds: value.selectedEntityIds,
      transform: value.transform,
      // Model output can never acknowledge collateral changes. A future ACP
      // permission receipt must recompile with the exact current impact set.
      acknowledgedExternalImpactedEntityIds: [],
    });
  } catch (error) {
    return fail(
      'operation-kind',
      error instanceof Error ? error.message : 'AI selection transform could not be planned.',
    );
  }
  const readBindingIds = patchBindingIds(context.geometryDoc, canvas.patches, allowed);
  if (!readBindingIds) {
    return fail('binding-scope', 'The transform would write outside the current authorized source bindings.');
  }
  const transaction: GeometryTransactionRequest = {
    ...canvas.transaction,
    transactionId: value.intentId,
    idempotencyKey: value.idempotencyKey,
    origin: 'ai',
    stage: 'proposed',
    ...(options.actorId ? { actorId: options.actorId } : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    metadata: {
      ...(canvas.transaction.metadata ?? {}),
      ...(options.metadata ?? {}),
      proposalSchemaVersion: AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION,
      sourceEditOrigin: 'geometry',
      semanticWrite: true,
      focusBindingIds,
      readBindingIds: [...new Set([...focusBindingIds, ...readBindingIds])].sort(),
      aiSelectionTransformIntentProof: value as unknown as JsonObject,
    },
  };
  return { ok: true, proposal: value, transaction };
}
