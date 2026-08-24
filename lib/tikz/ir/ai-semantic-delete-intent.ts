import { analyze } from '../analyze';
import { planGeometryDocDeletion } from '../authoring/geometry-delete-plan';
import type {
  AiPatchCompileOptions,
  AiPatchProposalBasis,
  AiPatchValidationError,
} from './ai-patch-proposal';
import { compileCanvasDeleteProposal } from './canvas-delete-proposal';
import type { GeometryDoc } from './geometry-doc';
import type { JsonObject } from './model';
import type { GeometryTransactionRequest } from './transactions';

export const AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION =
  'ai-semantic-delete-intent/v1' as const;

/**
 * Host-only lowering target for GeometryIntent/v2 delete operations.
 *
 * The model supplies semantic references only. The host binds those references
 * to current entity IDs and the Broker reconstructs the complete dependency
 * closure and source deletion ranges from the current GeometryDoc.
 */
export interface AiSemanticDeleteIntent {
  readonly schemaVersion: typeof AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly basis: AiPatchProposalBasis;
  readonly authorizationScopeFingerprint: string;
  readonly selectedEntityIds: readonly string[];
  /** AI deletion is block-only until a host permission receipt attests cascade. */
  readonly mode: 'block';
}

export interface AiSemanticDeleteValidationContext {
  readonly basis: AiPatchProposalBasis;
  readonly source: string;
  readonly geometryDoc: GeometryDoc;
  readonly allowedBindingIds: readonly string[];
}

export type AiSemanticDeleteIntentCompilation =
  | {
    readonly ok: true;
    readonly proposal: AiSemanticDeleteIntent;
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

function uniqueStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= 64
    && value.every((item) => nonEmpty(item))
    && new Set(value).size === value.length;
}

export function isAiSemanticDeleteIntent(value: unknown): value is AiSemanticDeleteIntent {
  return record(value)
    && exactKeys(value, [
      'authorizationScopeFingerprint',
      'basis',
      'idempotencyKey',
      'intentId',
      'mode',
      'schemaVersion',
      'selectedEntityIds',
    ])
    && value.schemaVersion === AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION
    && nonEmpty(value.intentId)
    && nonEmpty(value.idempotencyKey)
    && validBasis(value.basis)
    && nonEmpty(value.authorizationScopeFingerprint)
    && uniqueStrings(value.selectedEntityIds)
    && value.mode === 'block';
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

function fail(code: string, message: string): AiSemanticDeleteIntentCompilation {
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
  patches: readonly { readonly range: { readonly start: number; readonly end: number } }[],
  allowed: ReadonlySet<string>,
): string[] | null {
  const selected = new Set<string>();
  for (const patch of patches) {
    const owners = geometryDoc.sourceMap.entries.filter((entry) => (
      allowed.has(entry.bindingId)
      && entry.sourceId === geometryDoc.basis.sourceId
      && entry.range.start <= patch.range.start
      && entry.range.end >= patch.range.end
    ));
    if (owners.length === 0) return null;
    for (const owner of owners) selected.add(owner.bindingId);
  }
  return [...selected].sort();
}

/** Compile a host-resolved semantic delete through the Canvas delete planner. */
export function compileAiSemanticDeleteIntent(
  value: unknown,
  context: AiSemanticDeleteValidationContext,
  options: AiPatchCompileOptions = {},
): AiSemanticDeleteIntentCompilation {
  if (!isAiSemanticDeleteIntent(value)) {
    return fail('invalid-shape', 'AI semantic delete intent has an invalid or open shape.');
  }
  if (
    !sameBasis(value.basis, context.basis)
    || !sameGeometryDocBasis(value.basis, context.geometryDoc.basis)
  ) {
    return fail('basis-mismatch', 'AI semantic delete is stale or detached from the current GeometryDoc.');
  }
  const allowed = new Set(context.allowedBindingIds);
  if (allowed.size !== context.allowedBindingIds.length) {
    return fail('binding-scope', 'AI semantic delete authorization scope is malformed.');
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
    return fail('binding-scope', 'One or more delete targets are outside the current authorized semantic scope.');
  }

  const analysis = analyze(context.source, context.basis.revision);
  if (analysis.status !== 'complete' || !analysis.stmts) {
    return fail(
      'operation-kind',
      'AI semantic delete requires a complete current semantic projection.',
    );
  }

  let canvas: ReturnType<typeof compileCanvasDeleteProposal>;
  try {
    const plan = planGeometryDocDeletion({
      source: context.source,
      geometryDoc: context.geometryDoc,
      statements: analysis.stmts,
      targets: value.selectedEntityIds,
      mode: value.mode,
    });
    canvas = compileCanvasDeleteProposal({
      source: context.source,
      geometryDoc: context.geometryDoc,
      plan,
    });
  } catch (error) {
    return fail(
      'operation-kind',
      error instanceof Error ? error.message : 'AI semantic delete could not be planned.',
    );
  }

  const sourceOperation = canvas.transaction.operations[0];
  if (!sourceOperation || sourceOperation.op !== 'source-patch') {
    return fail('operation-kind', 'AI semantic delete produced no canonical source patch operation.');
  }
  const patchOwners = patchBindingIds(context.geometryDoc, sourceOperation.patches, allowed);
  if (!patchOwners) {
    return fail('binding-scope', 'The delete would write outside the current authorized source bindings.');
  }

  const transaction: GeometryTransactionRequest = {
    ...canvas.transaction,
    transactionId: value.intentId,
    idempotencyKey: value.idempotencyKey,
    origin: 'ai',
    stage: 'proposed',
    ...(value.basis.projectionHash
      ? { expectedProjectionHash: value.basis.projectionHash }
      : {}),
    ...(options.actorId ? { actorId: options.actorId } : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    metadata: {
      ...(canvas.transaction.metadata ?? {}),
      ...(options.metadata ?? {}),
      proposalSchemaVersion: AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION,
      sourceEditOrigin: 'geometry',
      semanticWrite: true,
      focusBindingIds,
      readBindingIds: [...new Set([...focusBindingIds, ...patchOwners])].sort(),
      aiSemanticDeleteIntentProof: value as unknown as JsonObject,
    },
  };
  return { ok: true, proposal: value, transaction };
}
