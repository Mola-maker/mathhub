import type {
  GeometryResourceReference,
  GeometryTransactionOrigin,
  GeometryTransactionRequest,
} from '../ir/transactions';
import {
  type SourceEditOrigin,
  type StudioSourceAccess,
  type StudioTransactionRecord,
  type StudioDocument,
} from '../document/studio-document';
import {
  applyTextPatches,
  type TextPatch,
} from '../document/source-transaction';
import { hashSource } from '../document/source-hash';
import { analyze } from '../analyze';
import {
  MANAGED_CONSTRUCTION_SCHEMA_V3,
  managedConstructionDocumentReferenceIssueKey,
  managedConstructionDocumentReferenceIssues,
  parseManagedConstructionBlocks,
  type ManagedConstructionBlock,
} from '../semantics/managed-construction';
import {
  managedConstructionV3OutsideSlotsMatches,
  readManagedConstructionV3Envelope,
} from '../semantics/managed-construction-v3';
import {
  compactCanonicalConstructionPlan,
  constructionPlanSyntaxKind,
  decodeManagedConstructionPlan,
  validateConstructionPlanWriterSafety,
} from '../authoring/construction-plan-codec';
import {
  compileConstructionWriterArtifact,
  validateConstructionPlan,
  type ConstructionPlan,
} from '../authoring/construction-ir';
import { compileNewManagedConstructionPlan } from '../authoring/construction-ir-v3';
import { validateConstructionPlanSemanticFootprint } from '../authoring/construction-plan-footprint';
import {
  canvasDeletePatchFingerprint,
  compileCanvasDeleteProposal,
} from '../ir/canvas-delete-proposal';
import {
  compileCanvasConstructionBatchProposal,
  type CanvasCircleAdoptionIntent,
} from '../ir/canvas-construction-batch-proposal';
import { planGeometryDocDeletion } from '../authoring/geometry-delete-plan';
import { projectTikzAnalysisToGeometryTruth } from '../ir/tikz-adapter';
import { buildGeometrySourceMap } from '../ir/source-map';
import { createGeometryDoc } from '../ir/geometry-doc';
import {
  compileCanvasDragPatchesProposal,
} from '../ir/canvas-point-move-proposal';
import { compileCanvasSelectionTransformProposal } from '../ir/canvas-selection-transform-proposal';
import {
  AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION,
  compileAiSelectionTransformIntent,
  isAiSelectionTransformIntent,
} from '../ir/ai-selection-transform-intent';
import {
  AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION,
  compileAiSemanticDeleteIntent,
  isAiSemanticDeleteIntent,
} from '../ir/ai-semantic-delete-intent';
import { compileInspectorDirectProposal } from '../ir/inspector-direct-proposal';
import { insertBeforeTikzEndPatch } from '../authoring/source-builder';
import {
  managedPresentationEnvelopeMatches,
  managedPresentationOptionSiteTarget,
  managedPresentationOptionPatchMatches,
} from '../authoring/managed-presentation';
import { managedStyleRecompilePatches } from '../authoring/managed-construction-recompile';
import {
  managedBlockBindingId,
  managedRecordBindingId,
} from '../ir/managed-binding-id';
import {
  coordinateLiteralPatch,
  formatCoordNumber,
} from '../patch/source-patch';
import {
  compileConstructionIntent,
  isConstructionIntent,
} from '../authoring/construction-intent';
import {
  compileConstructionDagIntent,
  isConstructionDagIntent,
} from '../authoring/construction-dag-intent';
import {
  AI_CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION,
} from '../ir/ai-construction-dag-intent';
import { constructionAuthorizationScopeFingerprint } from '../authoring/construction-authorization';
import {
  HOST_SEMANTIC_ACTION_BATCH_SCHEMA_VERSION,
  isHostSemanticActionBatch,
} from '../ir/host-semantic-action-batch';
import {
  HOST_SEMANTIC_ACTION_SET_SCHEMA_VERSION,
  isHostSemanticActionSet,
} from '../ir/host-semantic-action-set';
import { sourceCoordinateForWorldPoint } from '../subset/coordinate-transform';
import {
  createGeometryWorkspaceEdit,
  validateGeometryWorkspaceEdit,
} from '../ir/geometry-workspace-edit';

export interface SourceHashEvidence {
  hash: string;
  algorithm: string;
  /** Exact source material used to calculate `hash`. Never persisted. */
  source: string;
  /** Optional caller cache; Broker independently derives guarded identities. */
  kernelHash?: string;
  /** Optional caller cache; never the final projection authority. */
  projectionHash?: string;
  /** Trusted grammar/plugin bundle identity for guarded writes. */
  pluginSetDigest?: string;
  /** Host-authorized semantic read/create scope, independent of AI metadata. */
  authorizedBindingIds?: readonly string[];
  authorizationScopeFingerprint?: string;
  createCapabilityFingerprint?: string;
}

export type TikzTransactionConflictCode =
  | 'document-mismatch'
  | 'document-epoch-mismatch'
  | 'idempotency-key-reused'
  | 'semantic-projection-stale'
  | 'revision-mismatch'
  | 'source-hash-mismatch'
  | 'kernel-hash-mismatch'
  | 'projection-hash-mismatch'
  | 'plugin-set-mismatch'
  | 'source-range-conflict'
  | 'managed-construction-conflict'
  | 'precondition-failed'
  | 'unsupported-operation'
  | 'unsupported-resource'
  | 'invalid-request';

export type TikzTransactionBrokerResult =
  | {
    ok: true;
    status: 'committed' | 'idempotent';
    transactionId: string;
    idempotencyKey: string;
    fromRevision: number;
    toRevision: number;
    record: StudioTransactionRecord | null;
  }
  | {
    ok: false;
    status: 'conflict' | 'rejected';
    transactionId: string;
    code: TikzTransactionConflictCode;
    message: string;
    expectedRevision: number;
    currentRevision: number;
  };

export interface CommitPatchTransactionInput {
  patches: readonly TextPatch[];
  origin: SourceEditOrigin;
  expectedRevision?: number;
  transactionId?: string;
  idempotencyKey?: string;
}

function isRange(value: unknown): value is { start: number; end: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const range = value as { start?: unknown; end?: unknown };
  return Number.isInteger(range.start)
    && Number.isInteger(range.end)
    && (range.start as number) >= 0
    && (range.end as number) >= (range.start as number);
}

function sourceOriginForRequest(request: GeometryTransactionRequest): SourceEditOrigin {
  const declared = request.metadata?.sourceEditOrigin;
  if (request.origin === 'ai') return 'ai';
  if (request.origin === 'canvas') return declared === 'style' ? 'style' : 'canvas';
  if (request.origin === 'source') return 'keyboard';
  if (declared === 'repair') return 'repair';
  return 'external';
}

function geometryOriginForSource(origin: SourceEditOrigin): GeometryTransactionOrigin {
  if (origin === 'keyboard') return 'source';
  if (origin === 'ai') return 'ai';
  if (origin === 'canvas' || origin === 'style') return 'canvas';
  return 'system';
}

function resourceAccess(
  resource: GeometryResourceReference,
  source: string,
  expectedSourceId: string,
): StudioSourceAccess | null {
  if (
    resource.kind !== 'source-range'
    || resource.sourceId !== expectedSourceId
    || !isRange(resource.range)
    || resource.range.end > source.length
  ) return null;
  return {
    sourceId: resource.sourceId,
    from: resource.range.start,
    to: resource.range.end,
    expectedText: source.slice(resource.range.start, resource.range.end),
  };
}

function containsExactAccess(
  accesses: readonly StudioSourceAccess[],
  sourceId: string,
  patch: TextPatch,
): boolean {
  return accesses.some((access) => (
    access.sourceId === sourceId
    && access.from === patch.from
    && access.to === patch.to
  ));
}

function patchTouchesRange(
  patch: TextPatch,
  range: { start: number; end: number },
): boolean {
  if (patch.from === patch.to) {
    return patch.from > range.start && patch.from < range.end;
  }
  return patch.from < range.end && patch.to > range.start;
}

function patchTouchesBlock(
  patch: TextPatch,
  block: ManagedConstructionBlock,
): boolean {
  return patchTouchesRange(patch, block.range);
}

function replacesWholeBlock(
  patch: TextPatch,
  block: ManagedConstructionBlock,
): boolean {
  return patch.from === block.range.start && patch.to === block.range.end;
}

/**
 * True when applying `patches` leaves every managed block's bytes exactly as
 * they are, ignoring the offset shift caused by edits before them.
 *
 * `repair` commits LLM-authored whole-document text, so it is untrusted in the
 * same way `ai` is — but unlike `ai` it arrives as one `minimalTextPatch`, which
 * is a single span. Editing ordinary source on both sides of a managed block
 * therefore yields a patch that *spans* the block without changing it. Testing
 * span overlap would reject that legitimate repair, so compare bytes instead.
 */
function managedBlocksBytePreserved(
  source: string,
  patches: readonly TextPatch[],
): boolean {
  const before = parseManagedConstructionBlocks(source);
  let candidate: string;
  try {
    candidate = applyTextPatches(source, patches);
  } catch {
    return false;
  }
  // A count change covers both directions: fabricating a block from clean source
  // and deleting or duplicating an existing one.
  const after = parseManagedConstructionBlocks(candidate);
  if (after.length !== before.length) return false;
  if (before.length === 0) return true;
  return before.every((block, index) => (
    after[index]!.id === block.id
    && source.slice(block.range.start, block.range.end)
      === candidate.slice(after[index]!.range.start, after[index]!.range.end)
  ));
}

function repairPreservesDocumentShape(
  source: string,
  patches: readonly TextPatch[],
): boolean {
  let candidate: string;
  try {
    candidate = applyTextPatches(source, patches);
  } catch {
    return false;
  }
  if (!candidate.trim()) return false;
  const before = analyze(source);
  const after = analyze(candidate);
  const beforeStatements = before.cst.statements.length;
  const afterStatements = after.cst.statements.length;
  if (beforeStatements > 0 && afterStatements === 0) return false;
  if (beforeStatements >= 2 && afterStatements < Math.ceil(beforeStatements * 0.6)) {
    return false;
  }
  const beforePoints = new Set(before.scene?.points.keys() ?? []);
  const afterPoints = new Set(after.scene?.points.keys() ?? []);
  return [...beforePoints].every((name) => afterPoints.has(name));
}

function aiRawPatchProofConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
  hashAlgorithm: string,
  evidence: SourceHashEvidence,
): string | null {
  const metadata = request.metadata;
  const bindingPreconditions = metadata?.bindingPreconditions;
  const readBindingIds = metadata?.readBindingIds;
  const focusBindingIds = metadata?.focusBindingIds;
  if (
    request.origin !== 'ai'
    || metadata?.proposalSchemaVersion !== 'ai-patch-proposal/v1'
    || !Array.isArray(bindingPreconditions)
    || !Array.isArray(readBindingIds)
    || !Array.isArray(focusBindingIds)
    || bindingPreconditions.length !== patches.length
  ) {
    return 'AI raw source writes require a closed ai-patch-proposal/v1 proof.';
  }
  let doc: ReturnType<typeof currentGeometryDoc>;
  try {
    doc = currentGeometryDoc(source, request, hashAlgorithm);
  } catch (error) {
    return `AI patch proof could not rebuild the current GeometryDoc: ${error instanceof Error ? error.message : 'unknown projection failure'}`;
  }
  const bindingMap = new Map(doc.construction.bindings.map((binding) => [binding.id, binding]));
  const authorizedBindingIds = evidence.authorizedBindingIds;
  const hostAuthorized = Array.isArray(authorizedBindingIds)
    && authorizedBindingIds.every((value) => typeof value === 'string')
    && new Set(authorizedBindingIds).size === authorizedBindingIds.length
      ? new Set(authorizedBindingIds)
      : null;
  const readIds = new Set(readBindingIds.filter((value): value is string => typeof value === 'string'));
  const focusIds = focusBindingIds.filter((value): value is string => typeof value === 'string');
  const currentInsertionBinding = bindingMap.get('binding:document:tikzpicture-body-end');
  const currentCreateCapabilityFingerprint =
    typeof currentInsertionBinding?.metadata?.capabilityFingerprint === 'string'
      ? currentInsertionBinding.metadata.capabilityFingerprint
      : '';
  const expectedAuthorizationScopeFingerprint = hostAuthorized
    ? constructionAuthorizationScopeFingerprint({
      basis: doc.basis,
      authorizedBindingIds: authorizedBindingIds as readonly string[],
      createCapabilityFingerprint: currentCreateCapabilityFingerprint,
    })
    : '';
  if (
    readIds.size !== readBindingIds.length
    || focusIds.length !== focusBindingIds.length
    || focusIds.some((id) => !readIds.has(id))
    || !hostAuthorized
    || [...readIds].some((id) => !hostAuthorized.has(id))
    || evidence.createCapabilityFingerprint !== currentCreateCapabilityFingerprint
    || evidence.authorizationScopeFingerprint
      !== expectedAuthorizationScopeFingerprint
  ) return 'AI patch read/focus binding scope is malformed.';
  const canonicalBindingIds: string[] = [];
  for (let index = 0; index < patches.length; index += 1) {
    const proof = bindingPreconditions[index];
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
      return 'AI patch binding proof is malformed.';
    }
    const record = proof as Record<string, unknown>;
    const range = record.range as { start?: unknown; end?: unknown } | undefined;
    const bindingId = record.bindingId;
    const binding = typeof bindingId === 'string' ? bindingMap.get(bindingId) : undefined;
    const patch = patches[index]!;
    if (
      !binding
      || !readIds.has(binding.id)
      || binding.writable !== true
      || binding.source.document.sourceId !== `${request.documentId}:tikz`
      || record.sourceId !== binding.source.document.sourceId
      || record.writable !== true
      || record.opaque !== false
      || range?.start !== patch.from
      || range.end !== patch.to
      || patch.from < binding.source.range.start
      || patch.to > binding.source.range.end
    ) return 'AI patch no longer matches its current writable GeometryDoc binding.';
    canonicalBindingIds.push(binding.id);
  }
  const sourceOperation = request.operations[0];
  if (!sourceOperation || sourceOperation.op !== 'source-patch') {
    return 'AI patch is missing its canonical source operation.';
  }
  const canonicalWorkspaceEdit = createGeometryWorkspaceEdit([sourceOperation], [{
    operationId: sourceOperation.operationId,
    label: 'Apply AI TikZ edit',
    description: `${patches.length} source patch${patches.length === 1 ? '' : 'es'} will be applied atomically.`,
    patchAnnotations: patches.map((patch, index) => ({
      label: patch.from === patch.to
        ? 'Add TikZ geometry'
        : patch.insert.length === 0
          ? 'Delete TikZ geometry'
          : 'Modify TikZ geometry',
      description: `Update the attested source binding ${canonicalBindingIds[index]}.`,
    })),
  }]);
  if (JSON.stringify(request.workspaceEdit) !== JSON.stringify(canonicalWorkspaceEdit)) {
    return 'AI patch review metadata differs from the Broker-replayed workspace edit.';
  }
  return null;
}

function validManagedReplacement(
  insert: string,
  expectedBlockId: string,
): boolean {
  if (insert.length === 0) return false;
  const blocks = parseManagedConstructionBlocks(insert);
  return (
    blocks.length === 1
    && blocks[0].range.start === 0
    && blocks[0].range.end === insert.length
    && blocks[0].id === expectedBlockId
    && blocks[0].metadataStatus === 'valid'
    && blocks[0].integrityStatus === 'valid'
  );
}

function canvasDeleteProofConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
  hashAlgorithm: string,
  expectedEnvelope: {
    readonly proposalSchemaVersion: string;
    readonly sourceEditOrigin: string;
  } = {
    proposalSchemaVersion: 'canvas-delete-proposal/v1',
    sourceEditOrigin: 'canvas',
  },
): string | null {
  if (
    request.metadata?.proposalSchemaVersion !== expectedEnvelope.proposalSchemaVersion
    || request.metadata?.semanticWrite !== true
    || request.metadata?.sourceEditOrigin !== expectedEnvelope.sourceEditOrigin
  ) {
    return 'Canvas semantic delete is missing a typed proposal envelope.';
  }
  const value = request.metadata?.canvasDeleteProof;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Canvas semantic delete is missing a Broker-verifiable proof.';
  }
  const proof = value as Record<string, unknown>;
  const closure = proof.closure;
  const managedValue = proof.managedDeletions;
  if (
    JSON.stringify(Object.keys(proof).sort()) !== JSON.stringify([
      'closure',
      'closureFingerprint',
      'managedDeletions',
      'mode',
      'patchFingerprint',
      'schemaVersion',
    ])
    || proof.schemaVersion !== 'canvas-delete-proof/v1'
    || (proof.mode !== 'block' && proof.mode !== 'cascade')
    || typeof proof.patchFingerprint !== 'string'
    || proof.patchFingerprint !== canvasDeletePatchFingerprint(source, patches)
    || !closure
    || typeof closure !== 'object'
    || Array.isArray(closure)
    || typeof proof.closureFingerprint !== 'string'
    || proof.closureFingerprint !== hashSource(JSON.stringify(closure))
    || !Array.isArray(managedValue)
    || patches.length === 0
    || patches.some((patch, index) => (
      patch.insert !== ''
      || patch.from < 0
      || patch.to <= patch.from
      || patch.to > source.length
      || (index > 0 && patch.from < patches[index - 1]!.to)
    ))
  ) {
    return 'Canvas semantic delete has a stale or malformed proof envelope.';
  }

  const closureRecord = closure as Record<string, unknown>;
  const deleteMode = proof.mode as 'block' | 'cascade';
  const rootNodeIds = stringArray(closureRecord.rootNodeIds);
  if (
    JSON.stringify(Object.keys(closureRecord).sort()) !== JSON.stringify([
      'affectedNodeIds',
      'bindingIds',
      'entityIds',
      'removedNodeIds',
      'removedStatementIndices',
      'rootNodeIds',
      'semanticTargets',
    ])
    || !rootNodeIds
    || rootNodeIds.length === 0
    || !stringArray(closureRecord.affectedNodeIds)
    || !stringArray(closureRecord.bindingIds)
    || !stringArray(closureRecord.entityIds)
    || !stringArray(closureRecord.removedNodeIds)
    || !stringArray(closureRecord.semanticTargets)
    || !Array.isArray(closureRecord.removedStatementIndices)
    || !closureRecord.removedStatementIndices.every((value) => Number.isInteger(value))
  ) {
    return 'Canvas semantic delete closure is malformed or has no authoritative roots.';
  }

  /*
   * Reproject the current source and rebuild the delete plan at the Broker.
   * A client-supplied hash only proves self-consistency; this canonical replay
   * proves that every patch still belongs to current GeometryDoc bindings and
   * to the current dependency closure.
   */
  const analysis = analyze(source, request.expectedRevision);
  if (analysis.status !== 'complete' || !analysis.scene || !analysis.stmts) {
    return 'Canvas semantic delete requires a complete current semantic projection; opaque or invalid source is fail-closed.';
  }
  let canonicalProposal: ReturnType<typeof compileCanvasDeleteProposal>;
  try {
    const basis = {
      documentId: request.documentId,
      epoch: request.documentEpoch,
      revision: request.expectedRevision,
      sourceHash: request.sourceHash,
      sourceId: `${request.documentId}:tikz`,
      ...(request.expectedKernelHash
        ? { kernelHash: request.expectedKernelHash }
        : {}),
      ...(request.pluginSetDigest
        ? { pluginSetDigest: request.pluginSetDigest }
        : {}),
    };
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis,
      source,
      basis,
      hashAlgorithm,
    });
    const geometryDoc = createGeometryDoc(
      truths,
      buildGeometrySourceMap(truths),
    );
    const canonicalPlan = planGeometryDocDeletion({
      source,
      geometryDoc,
      statements: analysis.stmts,
      targets: rootNodeIds,
      mode: deleteMode,
    });
    canonicalProposal = compileCanvasDeleteProposal({
      source,
      geometryDoc,
      plan: canonicalPlan,
    });
  } catch (error) {
    return `Canvas semantic delete could not reproduce an authoritative GeometryDoc capability: ${error instanceof Error ? error.message : 'unknown projection failure'}`;
  }
  const canonicalOperation = canonicalProposal.transaction.operations[0];
  const canonicalPatches = canonicalOperation?.op === 'source-patch'
    ? canonicalOperation.patches.map((patch) => ({
      from: patch.range.start,
      to: patch.range.end,
      insert: patch.insert,
    }))
    : [];
  const canonicalProof = canonicalProposal.transaction.metadata?.canvasDeleteProof;
  if (
    JSON.stringify(canonicalPatches) !== JSON.stringify(patches)
    || JSON.stringify(canonicalProof) !== JSON.stringify(proof)
  ) {
    return 'Canvas semantic delete does not match the Broker-replayed GeometryDoc binding closure.';
  }

  const sourceId = `${request.documentId}:tikz`;
  const capabilities = managedValue.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const record = candidate as Record<string, unknown>;
    const range = record.range;
    if (
      JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([
        'bindingId',
        'constructionId',
        'contentFingerprint',
        'range',
        'sourceHash',
        'sourceId',
        'sourceRevision',
        'writePolicy',
      ])
      || typeof record.constructionId !== 'string'
      || typeof record.bindingId !== 'string'
      || typeof record.contentFingerprint !== 'string'
      || record.sourceId !== sourceId
      || record.sourceRevision !== request.expectedRevision
      || record.sourceHash !== request.sourceHash
      || record.writePolicy !== 'managed-recompile-only'
      || !range
      || typeof range !== 'object'
      || Array.isArray(range)
    ) return [];
    const rangeRecord = range as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(rangeRecord).sort())
        !== JSON.stringify(['end', 'start'])
      || !Number.isInteger(rangeRecord.start)
      || !Number.isInteger(rangeRecord.end)
    ) return [];
    return [{
      constructionId: record.constructionId,
      bindingId: record.bindingId,
      contentFingerprint: record.contentFingerprint,
      range: {
        start: rangeRecord.start as number,
        end: rangeRecord.end as number,
      },
    }];
  });
  if (
    capabilities.length !== managedValue.length
    || new Set(capabilities.map((item) => item.constructionId)).size
      !== capabilities.length
  ) {
    return 'Canvas semantic delete contains invalid or duplicate managed capabilities.';
  }

  const blocks = parseManagedConstructionBlocks(source);
  const touchedBlocks = blocks.filter((block) => patches.some((patch) => (
    patch.from < block.range.end && patch.to > block.range.start
  )));
  if (touchedBlocks.length !== capabilities.length) {
    return 'Canvas semantic delete managed capability set does not match touched blocks.';
  }
  for (const block of touchedBlocks) {
    const capability = capabilities.find((candidate) => (
      candidate.constructionId === block.id
    ));
    const patch = patches.find((candidate) => (
      candidate.from === block.range.start
      && candidate.to === block.range.end
      && candidate.insert === ''
    ));
    if (
      !capability
      || !patch
      || capability.bindingId !== managedBlockBindingId(block.id)
      || capability.contentFingerprint !== block.contentFingerprint
      || capability.range.start !== block.range.start
      || capability.range.end !== block.range.end
      || block.metadataStatus !== 'valid'
      || block.integrityStatus !== 'valid'
    ) {
      return `Canvas semantic delete capability for ${block.id} is stale or does not cover the whole block.`;
    }
  }
  return null;
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.length > 0)
    ? value
    : null;
}

interface InspectorBindingCapabilityProof {
  readonly bindingId: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly sourceHash: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly managedConstructionId: string;
  readonly writePolicy: 'managed-recompile-only';
}

function inspectorBindingCapabilities(
  value: unknown,
): readonly InspectorBindingCapabilityProof[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const expectedKeys = [
    'bindingId',
    'managedConstructionId',
    'range',
    'sourceHash',
    'sourceId',
    'sourceRevision',
    'writePolicy',
  ];
  const capabilities: InspectorBindingCapabilityProof[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const range = record.range;
    if (
      JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)
      || !range
      || typeof range !== 'object'
      || Array.isArray(range)
      || JSON.stringify(Object.keys(range).sort())
        !== JSON.stringify(['end', 'start'])
      || typeof record.bindingId !== 'string'
      || record.bindingId.length === 0
      || typeof record.sourceId !== 'string'
      || record.sourceId.length === 0
      || !Number.isInteger(record.sourceRevision)
      || (record.sourceRevision as number) < 0
      || typeof record.sourceHash !== 'string'
      || record.sourceHash.length === 0
      || typeof record.managedConstructionId !== 'string'
      || record.managedConstructionId.length === 0
      || record.writePolicy !== 'managed-recompile-only'
      || !isRange(range)
    ) return null;
    capabilities.push({
      bindingId: record.bindingId,
      sourceId: record.sourceId,
      sourceRevision: record.sourceRevision as number,
      sourceHash: record.sourceHash,
      range,
      managedConstructionId: record.managedConstructionId,
      writePolicy: record.writePolicy,
    });
  }
  return capabilities;
}

/**
 * Recompute the presentation proof at the final commit boundary. The proof is
 * not trusted metadata: every field is matched against the current source and
 * the replacement is decoded again before Broker accepts the write.
 */
function managedRecompileProofConflict(
  source: string,
  block: ManagedConstructionBlock,
  patch: TextPatch,
  request: GeometryTransactionRequest,
): string | null {
  const value = request.metadata?.managedConstructionRecompileProof;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `Managed replacement ${block.id} is missing a Broker-verifiable recompile proof.`;
  }
  const proof = value as Record<string, unknown>;
  if (
    proof.schemaVersion !== 'managed-construction-recompile-proof/v1'
    || proof.constructionId !== block.id
    || proof.previousContentFingerprint !== block.contentFingerprint
    || (proof.mode !== 'canonical' && proof.mode !== 'lossless-presentation')
  ) {
    return `Managed replacement ${block.id} has a stale or invalid recompile proof envelope.`;
  }
  const current = decodeManagedConstructionPlan(source, block);
  const replacementBlocks = parseManagedConstructionBlocks(patch.insert);
  const replacementBlock = replacementBlocks.length === 1
    ? replacementBlocks[0]
    : undefined;
  const replacement = replacementBlock
    ? decodeManagedConstructionPlan(patch.insert, replacementBlock)
    : null;
  if (
    !replacementBlock
    || replacementBlock.schemaVersion !== block.schemaVersion
    || !current.ok
    || !replacement?.ok
  ) {
    return `Managed replacement ${block.id} failed independent Broker decoding.`;
  }
  const currentFootprintIssues = validateConstructionPlanSemanticFootprint(current.plan);
  const replacementFootprintIssues = validateConstructionPlanSemanticFootprint(
    replacement.plan,
  );
  if (currentFootprintIssues.length > 0 || replacementFootprintIssues.length > 0) {
    const issue = currentFootprintIssues[0] ?? replacementFootprintIssues[0]!;
    return `Managed replacement ${block.id} has a non-canonical ${issue.path} semantic footprint.`;
  }
  const currentArtifact = compileConstructionWriterArtifact(current.plan);
  const replacementArtifact = compileConstructionWriterArtifact(replacement.plan);
  const proofSlotIds = stringArray(proof.slotIds);
  const proofSlotFingerprints = stringArray(proof.slotSemanticFingerprints);
  const currentSlotIds = currentArtifact.slots.map((slot) => slot.id);
  const currentSlotFingerprints = currentArtifact.slots.map((slot) => (
    slot.semanticFingerprint
  ));
  if (
    current.plan.id !== replacement.plan.id
    || current.plan.kind !== replacement.plan.kind
    || constructionPlanSyntaxKind(current.plan)
      !== constructionPlanSyntaxKind(replacement.plan)
    || proof.writerId !== currentArtifact.writerId
    || proof.writerRevision !== currentArtifact.writerRevision
    || !proofSlotIds
    || !proofSlotFingerprints
    || JSON.stringify(proofSlotIds) !== JSON.stringify(currentSlotIds)
    || JSON.stringify(proofSlotFingerprints)
      !== JSON.stringify(currentSlotFingerprints)
    || replacementArtifact.writerId !== currentArtifact.writerId
    || replacementArtifact.writerRevision !== currentArtifact.writerRevision
    || JSON.stringify(replacementArtifact.slots.map((slot) => slot.id))
      !== JSON.stringify(currentSlotIds)
  ) {
    return `Managed replacement ${block.id} changed plan/syntax identity or does not match the current writer ABI.`;
  }
  if (!current.presentation) {
    if (proof.mode !== 'canonical' || replacement.presentation) {
      return `Managed replacement ${block.id} cannot introduce presentation attachments into a canonical block.`;
    }
    return null;
  }
  if (
    proof.mode !== 'lossless-presentation'
    || proof.presentationFingerprint
      !== current.presentation.presentationFingerprint
    || proof.writerId !== current.presentation.writerId
    || proof.writerRevision !== current.presentation.writerRevision
    || proof.attachmentsFingerprint
      !== current.presentation.attachmentsFingerprint
  ) {
    return `Managed replacement ${block.id} presentation proof does not match the current writer projection.`;
  }
  if (
    !replacement.presentation
    || replacement.presentation.writerId !== current.presentation.writerId
    || replacement.presentation.writerRevision
      !== current.presentation.writerRevision
    || replacement.presentation.attachmentsFingerprint
      !== current.presentation.attachmentsFingerprint
    || JSON.stringify(replacement.presentation.slots.map((slot) => slot.slotId))
      !== JSON.stringify(current.presentation.slots.map((slot) => slot.slotId))
    || JSON.stringify(replacement.presentation.opaqueSlots)
      !== JSON.stringify(current.presentation.opaqueSlots)
  ) {
    return `Managed replacement ${block.id} did not preserve its presentation attachments and writer ABI.`;
  }
  return null;
}

function aiManagedCreateProofConflict(
  previousSource: string,
  source: string,
  patch: TextPatch,
  createdBlocks: readonly ManagedConstructionBlock[],
  request: GeometryTransactionRequest,
  evidence: SourceHashEvidence,
): string | null {
  const value = request.metadata?.managedConstructionCreateProof;
  const intentValue = request.metadata?.constructionIntentProof;
  if (value === undefined && intentValue === undefined) {
    return createdBlocks.length === 0
      ? null
      : 'AI managed creation requires a Broker-replayed construction-intent/v1.';
  }
  if (
    request.metadata?.proposalSchemaVersion !== 'construction-plan-proposal/v1'
    || request.metadata?.authoringSchemaVersion !== 'construction-intent/v1'
    || createdBlocks.length !== 1
    || !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || !isConstructionIntent(intentValue)
  ) {
    return 'AI managed creation requires exactly one closed construction-intent/v1 and one trusted writer proof.';
  }
  const block = createdBlocks[0]!;
  const proof = value as Record<string, unknown>;
  const authorizedBindingIds = evidence.authorizedBindingIds;
  const decoded = decodeManagedConstructionPlan(source, block);
  if (!decoded.ok || decoded.presentation) {
    return `AI managed creation ${block.id} is not canonical trusted-writer output.`;
  }
  const footprintIssues = validateConstructionPlanSemanticFootprint(decoded.plan);
  if (footprintIssues.length > 0) {
    return `AI managed creation ${block.id} has a non-canonical ${footprintIssues[0]!.path} semantic footprint.`;
  }

  if (
    evidence.algorithm !== 'fnv1a64-utf8'
    || intentValue.intentId !== request.transactionId
    || intentValue.idempotencyKey !== request.idempotencyKey
    || intentValue.basis.documentId !== request.documentId
    || intentValue.basis.epoch !== request.documentEpoch
    || intentValue.basis.revision !== request.expectedRevision
    || intentValue.basis.sourceHash !== request.sourceHash
    || intentValue.basis.sourceId !== `${request.documentId}:tikz`
    || intentValue.basis.kernelHash !== request.expectedKernelHash
    || intentValue.basis.projectionHash !== request.expectedProjectionHash
    || intentValue.basis.pluginSetDigest !== request.pluginSetDigest
    || !Array.isArray(authorizedBindingIds)
    || authorizedBindingIds.some((bindingId) => typeof bindingId !== 'string')
    || new Set(authorizedBindingIds).size !== authorizedBindingIds.length
    || intentValue.capability.scopeFingerprint
      !== evidence.authorizationScopeFingerprint
    || intentValue.capability.fingerprint !== evidence.createCapabilityFingerprint
  ) {
    return `AI managed creation ${block.id} has a stale intent basis or transaction identity.`;
  }

  let canonicalPlan: ConstructionPlan;
  try {
    const analysis = analyze(previousSource, request.expectedRevision);
    if (analysis.status !== 'complete') {
      return `AI managed creation ${block.id} requires a complete current semantic projection.`;
    }
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis,
      source: previousSource,
      basis: {
        documentId: request.documentId,
        epoch: request.documentEpoch,
        revision: request.expectedRevision,
        sourceHash: request.sourceHash,
        sourceId: intentValue.basis.sourceId,
        kernelHash: intentValue.basis.kernelHash,
        projectionHash: intentValue.basis.projectionHash,
        pluginSetDigest: intentValue.basis.pluginSetDigest,
      },
      hashAlgorithm: evidence.algorithm,
    });
    const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
    canonicalPlan = compileConstructionIntent({
      source: previousSource,
      geometryDoc,
      allowedBindingIds: authorizedBindingIds,
      intent: intentValue,
    }).plan;
  } catch (error) {
    return `AI managed creation ${block.id} failed independent intent replay: ${error instanceof Error ? error.message : 'unknown replay failure'}`;
  }
  if (!canonicalJsonEqual(
    compactCanonicalConstructionPlan(decoded.plan),
    compactCanonicalConstructionPlan(canonicalPlan),
  )) {
    return `AI managed creation ${block.id} differs from Broker Catalog intent replay.`;
  }

  const artifact = compileConstructionWriterArtifact(decoded.plan);
  let trustedPatch: TextPatch;
  try {
    trustedPatch = insertBeforeTikzEndPatch(
      previousSource,
      compileNewManagedConstructionPlan(canonicalPlan).lines,
    );
  } catch {
    return `AI managed creation ${block.id} has no trusted document insertion site.`;
  }
  const slotIds = stringArray(proof.slotIds);
  const slotFingerprints = stringArray(proof.slotSemanticFingerprints);
  if (
    proof.schemaVersion !== 'managed-construction-create-proof/v1'
    || proof.constructionId !== block.id
    || proof.planKind !== decoded.plan.kind
    || proof.syntaxKind !== constructionPlanSyntaxKind(decoded.plan)
    || proof.writerId !== artifact.writerId
    || proof.writerRevision !== artifact.writerRevision
    || patch.from !== trustedPatch.from
    || patch.to !== trustedPatch.to
    || patch.insert !== trustedPatch.insert
    || !slotIds
    || !slotFingerprints
    || JSON.stringify(slotIds)
      !== JSON.stringify(artifact.slots.map((slot) => slot.id))
    || JSON.stringify(slotFingerprints)
      !== JSON.stringify(artifact.slots.map((slot) => slot.semanticFingerprint))
  ) {
    return `AI managed creation ${block.id} has an invalid writer proof.`;
  }
  return null;
}

function canvasCircleDefinition(value: unknown): CanvasCircleAdoptionIntent['definition'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.kind === 'center-through'
    && JSON.stringify(Object.keys(record).sort())
      === JSON.stringify(['centerName', 'kind', 'throughName'])
    && typeof record.centerName === 'string'
    && record.centerName.length > 0
    && typeof record.throughName === 'string'
    && record.throughName.length > 0
  ) {
    return {
      kind: 'center-through',
      centerName: record.centerName,
      throughName: record.throughName,
    };
  }
  if (
    record.kind === 'center-radius'
    && JSON.stringify(Object.keys(record).sort())
      === JSON.stringify(['centerName', 'kind', 'radius'])
    && typeof record.centerName === 'string'
    && record.centerName.length > 0
    && typeof record.radius === 'number'
    && Number.isFinite(record.radius)
    && record.radius > 0
  ) {
    return {
      kind: 'center-radius',
      centerName: record.centerName,
      radius: record.radius,
    };
  }
  return null;
}

const CANVAS_COMPACT_PLAN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  primitive: ['primitive'],
  'rectangle-by-opposite-corners': ['first', 'opposite', 'second', 'fourth'],
  midpoint: ['a', 'b', 'result'],
  'perpendicular-foot': ['point', 'lineStart', 'lineEnd', 'result'],
  'point-on-circle': ['circle', 'result'],
  'parallel-line': ['through', 'referenceStart', 'referenceEnd', 'result'],
  'perpendicular-line': ['through', 'referenceStart', 'referenceEnd', 'result'],
  'perpendicular-bisector': ['a', 'b', 'midpoint', 'result', 'line'],
  'angle-bisector': ['armA', 'vertex', 'armB', 'result', 'line'],
  circumcircle: ['a', 'b', 'c', 'center', 'circle'],
  'nine-point-circle': [
    'a', 'b', 'c', 'midpointBC', 'midpointCA', 'midpointAB',
    'footA', 'footB', 'footC', 'orthocenter',
    'vertexMidpointA', 'vertexMidpointB', 'vertexMidpointC',
    'center', 'circle',
  ],
  'simson-line': [
    'a', 'b', 'c', 'center', 'circle', 'point',
    'footAB', 'footBC', 'footCA', 'line', 'angleDegrees',
  ],
  'fermat-point': [
    'a', 'b', 'c', 'equilateralAB', 'equilateralAC', 'torricelli',
    'result', 'line1', 'line2', 'triangleAB', 'triangleAC',
    'rayA', 'rayB', 'rayC', 'rotationABDegrees', 'rotationACDegrees',
    'resultSource',
  ],
  'tangent-at-point': ['touch', 'circle', 'result', 'line'],
  'reflect-point': ['point', 'center', 'result'],
  'reflect-line': ['point', 'lineStart', 'lineEnd', 'foot', 'result'],
  'rotate-90': ['point', 'center', 'result'],
  'homothety-2': ['point', 'center', 'result'],
  'inversion-point': ['point', 'center', 'radiusPoint', 'result', 'guide'],
  'radical-axis': ['circle1', 'circle2', 'result', 'direction', 'line'],
  'cyclic-quadrilateral': [
    'a', 'b', 'c', 'direction', 'center', 'result', 'circle', 'secant', 'polygon',
  ],
  'complete-quadrilateral': [
    'a', 'b', 'c', 'd', 'firstIntersection', 'secondIntersection',
    'lineAB', 'lineBC', 'lineCD', 'lineDA', 'diagonal',
  ],
};

const CANVAS_COMPACT_PLAN_BASE_FIELDS = [
  'constraints', 'entities', 'id', 'inputs', 'kind', 'outputs', 'relations',
] as const;

function hydrateCanvasCompactPlan(value: unknown): ConstructionPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const compact = value as Record<string, unknown>;
  const kind = compact.kind;
  if (typeof kind !== 'string') return null;
  const fields = CANVAS_COMPACT_PLAN_FIELDS[kind];
  if (!fields) return null;
  const expectedKeys = [...CANVAS_COMPACT_PLAN_BASE_FIELDS, ...fields].sort();
  if (JSON.stringify(Object.keys(compact).sort()) !== JSON.stringify(expectedKeys)) {
    return null;
  }
  const hydrated = { ...compact, selection: [], status: '' };
  // validateConstructionPlan is the runtime gate: the cast is only reached once
  // the hydrated value has been fully validated as a ConstructionPlan.
  if (validateConstructionPlan(hydrated).length > 0) return null;
  const plan = hydrated as unknown as ConstructionPlan;
  if (validateConstructionPlanWriterSafety(plan).length > 0) return null;
  return plan;
}

function canonicalJsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function canvasConstructionBatchProofConflict(
  previousSource: string,
  candidateSource: string,
  patches: readonly TextPatch[],
  createdBlocks: readonly ManagedConstructionBlock[],
  request: GeometryTransactionRequest,
  hashAlgorithm: string,
): string | null {
  const proposalSchemaVersion = request.metadata?.proposalSchemaVersion;
  if (
    proposalSchemaVersion !== 'canvas-construction-batch-proposal/v1'
    && proposalSchemaVersion !== 'ai-construction-intent-batch-proposal/v1'
    && proposalSchemaVersion !== AI_CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION
  ) {
    return createdBlocks.length === 0
      ? null
      : 'Construction batch creation requires a typed batch proposal.';
  }
  if (
    request.metadata?.sourceEditOrigin !== 'geometry'
    || request.metadata?.semanticWrite !== true
  ) {
    return createdBlocks.length === 0
      ? null
      : 'Canvas may create managed constructions only through a typed batch proposal.';
  }
  const value = request.metadata?.canvasConstructionBatchProof;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Canvas construction batch is missing a Broker-verifiable proof.';
  }
  const proof = value as Record<string, unknown>;
  const planValues = proof.planProofs;
  const adoptionValues = proof.adoptionProofs;
  const insertionValue = proof.insertionCapability;
  if (
    JSON.stringify(Object.keys(proof).sort()) !== JSON.stringify([
      'adoptionProofs',
      'insertionCapability',
      'patchFingerprint',
      'planProofs',
      'primaryConstructionId',
      'schemaVersion',
    ])
    || proof.schemaVersion !== 'canvas-construction-batch-proof/v1'
    || typeof proof.primaryConstructionId !== 'string'
    || proof.primaryConstructionId.length === 0
    || typeof proof.patchFingerprint !== 'string'
    || !Array.isArray(planValues)
    || planValues.length === 0
    || planValues.length > 64
    || !Array.isArray(adoptionValues)
    || adoptionValues.length > 32
    || patches.length > 65
    || patches.reduce((size, patch) => size + patch.insert.length, 0) > 1024 * 1024
    || !insertionValue
    || typeof insertionValue !== 'object'
    || Array.isArray(insertionValue)
  ) {
    return 'Canvas construction batch has a malformed proof envelope.';
  }
  const insertion = insertionValue as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(insertion).sort()) !== JSON.stringify([
      'bindingId',
      'capability',
      'capabilityFingerprint',
      'range',
      'sourceFingerprint',
      'sourceHash',
      'sourceId',
      'sourceRevision',
      'syntaxNodeType',
    ])
    || insertion.capability !== 'create-managed-construction-batch'
    || typeof insertion.capabilityFingerprint !== 'string'
    || insertion.bindingId !== 'binding:document:tikzpicture-body-end'
    || insertion.sourceId !== `${request.documentId}:tikz`
    || insertion.sourceRevision !== request.expectedRevision
    || insertion.sourceHash !== request.sourceHash
    || !isRange(insertion.range)
    || typeof insertion.sourceFingerprint !== 'string'
    || typeof insertion.syntaxNodeType !== 'string'
  ) {
    return 'Canvas construction batch has a stale insertion capability.';
  }

  const planIds: string[] = [];
  const attestedPlans: ConstructionPlan[] = [];
  for (const candidate of planValues) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return 'Canvas construction batch contains a malformed plan proof.';
    }
    const record = candidate as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([
        'compactPlan',
        'constructionId',
        'planKind',
        'slotIds',
        'slotSemanticFingerprints',
        'syntaxKind',
        'writerId',
        'writerRevision',
      ])
      || typeof record.constructionId !== 'string'
      || record.constructionId.length === 0
      || typeof record.planKind !== 'string'
      || typeof record.syntaxKind !== 'string'
      || typeof record.writerId !== 'string'
      || !Number.isInteger(record.writerRevision)
      || !stringArray(record.slotIds)
      || !stringArray(record.slotSemanticFingerprints)
    ) {
      return 'Canvas construction batch contains a malformed plan proof.';
    }
    const plan = hydrateCanvasCompactPlan(record.compactPlan);
    if (
      !plan
      || plan.id !== record.constructionId
      || plan.kind !== record.planKind
      || constructionPlanSyntaxKind(plan) !== record.syntaxKind
    ) {
      return 'Canvas construction batch contains an invalid compact plan proof.';
    }
    const semanticFootprintIssues = validateConstructionPlanSemanticFootprint(plan);
    if (semanticFootprintIssues.length > 0) {
      return `Canvas construction plan ${plan.id} has a non-canonical ${semanticFootprintIssues[0]!.path} footprint.`;
    }
    const artifact = compileConstructionWriterArtifact(plan);
    if (
      record.writerId !== artifact.writerId
      || record.writerRevision !== artifact.writerRevision
      || JSON.stringify(record.slotIds)
        !== JSON.stringify(artifact.slots.map((slot) => slot.id))
      || JSON.stringify(record.slotSemanticFingerprints)
        !== JSON.stringify(artifact.slots.map((slot) => slot.semanticFingerprint))
    ) {
      return `Canvas construction plan ${plan.id} has an invalid writer proof.`;
    }
    planIds.push(record.constructionId);
    attestedPlans.push(plan);
  }
  const adoptions: CanvasCircleAdoptionIntent[] = [];
  const adoptionIds: string[] = [];
  for (const candidate of adoptionValues) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return 'Canvas construction batch contains a malformed circle adoption proof.';
    }
    const record = candidate as Record<string, unknown>;
    const range = record.range;
    const definition = canvasCircleDefinition(record.definition);
    if (
      JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([
        'bindingId',
        'constructionId',
        'definition',
        'managedEntityId',
        'range',
        'sourceEntityId',
        'sourceFingerprint',
        'sourceStableId',
      ])
      || typeof record.constructionId !== 'string'
      || record.constructionId.length === 0
      || typeof record.sourceEntityId !== 'string'
      || record.sourceEntityId.length === 0
      || typeof record.managedEntityId !== 'string'
      || record.managedEntityId !== 'circle'
      || typeof record.sourceStableId !== 'string'
      || record.sourceStableId.length === 0
      || record.bindingId !== `binding:${record.sourceEntityId}`
      || typeof record.sourceFingerprint !== 'string'
      || !isRange(range)
      || !definition
    ) {
      return 'Canvas construction batch contains a malformed circle adoption proof.';
    }
    adoptionIds.push(record.constructionId);
    adoptions.push({
      constructionId: record.constructionId,
      sourceEntityId: record.sourceEntityId,
      sourceBindingId: record.bindingId,
      managedEntityId: record.managedEntityId,
      sourceStableId: record.sourceStableId,
      range: { start: range.start, end: range.end },
      definition,
    });
  }
  const expectedCreatedIds = [...planIds, ...adoptionIds];
  if (
    new Set(expectedCreatedIds).size !== expectedCreatedIds.length
    || !planIds.includes(proof.primaryConstructionId)
    || createdBlocks.length !== expectedCreatedIds.length
    || createdBlocks.some((block) => !expectedCreatedIds.includes(block.id))
    || expectedCreatedIds.some((id) => (
      createdBlocks.filter((block) => block.id === id).length !== 1
    ))
  ) {
    return 'Canvas construction batch created blocks outside its attested ID set.';
  }

  const decodedPlans: ConstructionPlan[] = [];
  for (const [index, planId] of planIds.entries()) {
    const block = createdBlocks.find((candidate) => candidate.id === planId)!;
    const decoded = decodeManagedConstructionPlan(candidateSource, block);
    const attested = attestedPlans[index]!;
    if (decoded.ok && !decoded.presentation) {
      if (!canonicalJsonEqual(
        compactCanonicalConstructionPlan(decoded.plan),
        compactCanonicalConstructionPlan(attested),
      )) {
        return `Canvas managed creation ${planId} differs from its compact plan proof.`;
      }
      decodedPlans.push(decoded.plan);
      continue;
    }
    if (
      attested.kind !== 'point-on-circle'
      && attested.kind !== 'tangent-at-point'
      && attested.kind !== 'radical-axis'
    ) {
      return `Canvas managed creation ${planId} is not canonical trusted-writer output.`;
    }
    decodedPlans.push(attested);
  }

  const analysis = analyze(previousSource, request.expectedRevision);
  if (analysis.status !== 'complete' || !analysis.scene || !analysis.stmts) {
    return 'Canvas construction batch requires a complete current semantic projection.';
  }
  const candidateAnalysis = analyze(candidateSource, request.expectedRevision + 1);
  if (candidateAnalysis.status !== 'complete') {
    return 'Canvas construction batch produced an incomplete semantic projection.';
  }
  let canonicalProposal: ReturnType<typeof compileCanvasConstructionBatchProposal>;
  try {
    const basis = {
      documentId: request.documentId,
      epoch: request.documentEpoch,
      revision: request.expectedRevision,
      sourceHash: request.sourceHash,
      sourceId: `${request.documentId}:tikz`,
      ...(request.expectedKernelHash
        ? { kernelHash: request.expectedKernelHash }
        : {}),
      ...(request.pluginSetDigest
        ? { pluginSetDigest: request.pluginSetDigest }
        : {}),
    };
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis,
      source: previousSource,
      basis,
      hashAlgorithm,
    });
    const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
    canonicalProposal = compileCanvasConstructionBatchProposal({
      source: previousSource,
      geometryDoc,
      plans: decodedPlans,
      primaryConstructionId: proof.primaryConstructionId,
      adoptions,
    });
  } catch (error) {
    return `Canvas construction batch could not replay its authoritative GeometryDoc capabilities: ${error instanceof Error ? error.message : 'unknown replay failure'}`;
  }
  const canonicalOperation = canonicalProposal.transaction.operations[0];
  const canonicalPatches = canonicalOperation?.op === 'source-patch'
    ? canonicalOperation.patches.map((patch) => ({
      from: patch.range.start,
      to: patch.range.end,
      insert: patch.insert,
    }))
    : [];
  const canonicalProof = canonicalProposal.transaction.metadata
    ?.canvasConstructionBatchProof;
  if (
    JSON.stringify(canonicalPatches) !== JSON.stringify(patches)
    || JSON.stringify(canonicalProof) !== JSON.stringify(proof)
  ) {
    return 'Canvas construction batch does not match Broker canonical replay.';
  }
  return null;
}

/**
 * AI raw-circle creation is authorized by the closed construction intent, not
 * by the batch proof alone. The generic batch replay proves source/adoption
 * correctness; this second replay proves that its exact plan and adoptions are
 * the only output of the current Catalog intent under the host-owned scope.
 */
function aiConstructionIntentBatchProofConflict(
  previousSource: string,
  candidateSource: string,
  patches: readonly TextPatch[],
  createdBlocks: readonly ManagedConstructionBlock[],
  request: GeometryTransactionRequest,
  evidence: SourceHashEvidence,
): string | null {
  const intentValue = request.metadata?.constructionIntentProof;
  const authorizedBindingIds = evidence.authorizedBindingIds;
  if (
    request.metadata?.proposalSchemaVersion
      !== 'ai-construction-intent-batch-proposal/v1'
    || request.metadata?.authoringSchemaVersion !== 'construction-intent/v1'
    || !isConstructionIntent(intentValue)
    || evidence.algorithm !== 'fnv1a64-utf8'
    || intentValue.intentId !== request.transactionId
    || intentValue.idempotencyKey !== request.idempotencyKey
    || intentValue.basis.documentId !== request.documentId
    || intentValue.basis.epoch !== request.documentEpoch
    || intentValue.basis.revision !== request.expectedRevision
    || intentValue.basis.sourceHash !== request.sourceHash
    || intentValue.basis.sourceId !== `${request.documentId}:tikz`
    || intentValue.basis.kernelHash !== request.expectedKernelHash
    || intentValue.basis.projectionHash !== request.expectedProjectionHash
    || intentValue.basis.pluginSetDigest !== request.pluginSetDigest
    || !Array.isArray(authorizedBindingIds)
    || authorizedBindingIds.some((bindingId) => typeof bindingId !== 'string')
    || new Set(authorizedBindingIds).size !== authorizedBindingIds.length
    || intentValue.capability.scopeFingerprint
      !== evidence.authorizationScopeFingerprint
    || intentValue.capability.fingerprint
      !== evidence.createCapabilityFingerprint
  ) {
    return 'AI construction batch has a stale intent basis, capability, or transaction identity.';
  }

  const batchConflict = canvasConstructionBatchProofConflict(
    previousSource,
    candidateSource,
    patches,
    createdBlocks,
    request,
    evidence.algorithm,
  );
  if (batchConflict) return batchConflict;

  try {
    const analysis = analyze(previousSource, request.expectedRevision);
    if (analysis.status !== 'complete') {
      return 'AI construction batch requires a complete current semantic projection.';
    }
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis,
      source: previousSource,
      basis: {
        documentId: request.documentId,
        epoch: request.documentEpoch,
        revision: request.expectedRevision,
        sourceHash: request.sourceHash,
        sourceId: intentValue.basis.sourceId,
        kernelHash: intentValue.basis.kernelHash,
        projectionHash: intentValue.basis.projectionHash,
        pluginSetDigest: intentValue.basis.pluginSetDigest,
      },
      hashAlgorithm: evidence.algorithm,
    });
    const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
    const compilation = compileConstructionIntent({
      source: previousSource,
      geometryDoc,
      allowedBindingIds: authorizedBindingIds,
      intent: intentValue,
    });
    if (compilation.adoptions.length === 0) {
      return 'AI construction batch did not originate from a raw-circle adoption intent.';
    }
    const canonical = compileCanvasConstructionBatchProposal({
      source: previousSource,
      geometryDoc,
      plans: [compilation.plan],
      primaryConstructionId: compilation.plan.id,
      adoptions: compilation.adoptions,
    });
    const operation = canonical.transaction.operations[0];
    const canonicalPatches = operation?.op === 'source-patch'
      ? operation.patches.map((patch) => ({
        from: patch.range.start,
        to: patch.range.end,
        insert: patch.insert,
      }))
      : [];
    if (
      JSON.stringify(canonicalPatches) !== JSON.stringify(patches)
      || JSON.stringify(
        canonical.transaction.metadata?.canvasConstructionBatchProof,
      ) !== JSON.stringify(request.metadata?.canvasConstructionBatchProof)
    ) {
      return 'AI construction batch differs from Broker Catalog intent replay.';
    }
  } catch (error) {
    return `AI construction batch failed independent intent replay: ${error instanceof Error ? error.message : 'unknown replay failure'}`;
  }
  return null;
}

/**
 * Rebuild a model-facing multi-step construction from the current Catalog.
 * The compact plans inside the generic batch proof are never authority: they
 * must be byte-for-byte consequences of this closed host-resolved DAG intent.
 */
function aiConstructionDagIntentProofConflict(
  previousSource: string,
  candidateSource: string,
  patches: readonly TextPatch[],
  createdBlocks: readonly ManagedConstructionBlock[],
  request: GeometryTransactionRequest,
  evidence: SourceHashEvidence,
): string | null {
  const intentValue = request.metadata?.constructionDagIntentProof;
  const authorizedBindingIds = evidence.authorizedBindingIds;
  if (
    request.metadata?.proposalSchemaVersion !== AI_CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION
    || request.metadata?.authoringSchemaVersion !== 'construction-dag-intent/v1'
    || !isConstructionDagIntent(intentValue)
    || evidence.algorithm !== 'fnv1a64-utf8'
    || intentValue.intentId !== request.transactionId
    || intentValue.idempotencyKey !== request.idempotencyKey
    || intentValue.basis.documentId !== request.documentId
    || intentValue.basis.epoch !== request.documentEpoch
    || intentValue.basis.revision !== request.expectedRevision
    || intentValue.basis.sourceHash !== request.sourceHash
    || intentValue.basis.sourceId !== `${request.documentId}:tikz`
    || intentValue.basis.kernelHash !== request.expectedKernelHash
    || intentValue.basis.projectionHash !== request.expectedProjectionHash
    || intentValue.basis.pluginSetDigest !== request.pluginSetDigest
    || !Array.isArray(authorizedBindingIds)
    || authorizedBindingIds.some((bindingId) => typeof bindingId !== 'string')
    || new Set(authorizedBindingIds).size !== authorizedBindingIds.length
    || intentValue.capability.scopeFingerprint !== evidence.authorizationScopeFingerprint
    || intentValue.capability.fingerprint !== evidence.createCapabilityFingerprint
  ) {
    return 'AI construction DAG has a stale basis, capability, or transaction identity.';
  }

  const batchConflict = canvasConstructionBatchProofConflict(
    previousSource,
    candidateSource,
    patches,
    createdBlocks,
    request,
    evidence.algorithm,
  );
  if (batchConflict) return batchConflict;

  try {
    const analysis = analyze(previousSource, request.expectedRevision);
    if (analysis.status !== 'complete') {
      return 'AI construction DAG requires a complete current semantic projection.';
    }
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis,
      source: previousSource,
      basis: {
        documentId: request.documentId,
        epoch: request.documentEpoch,
        revision: request.expectedRevision,
        sourceHash: request.sourceHash,
        sourceId: intentValue.basis.sourceId,
        kernelHash: intentValue.basis.kernelHash,
        projectionHash: intentValue.basis.projectionHash,
        pluginSetDigest: intentValue.basis.pluginSetDigest,
      },
      hashAlgorithm: evidence.algorithm,
    });
    const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
    const compilation = compileConstructionDagIntent({
      source: previousSource,
      geometryDoc,
      allowedBindingIds: authorizedBindingIds,
      intent: intentValue,
    });
    const canonical = compileCanvasConstructionBatchProposal({
      source: previousSource,
      geometryDoc,
      plans: compilation.plans,
      primaryConstructionId: compilation.primaryConstructionId,
      adoptions: compilation.adoptions,
    });
    const operation = canonical.transaction.operations[0];
    const canonicalPatches = operation?.op === 'source-patch'
      ? operation.patches.map((patch) => ({
        from: patch.range.start,
        to: patch.range.end,
        insert: patch.insert,
      }))
      : [];
    if (
      JSON.stringify(canonicalPatches) !== JSON.stringify(patches)
      || JSON.stringify(canonical.transaction.metadata?.canvasConstructionBatchProof)
        !== JSON.stringify(request.metadata?.canvasConstructionBatchProof)
    ) {
      return 'AI construction DAG differs from Broker Catalog replay.';
    }
  } catch (error) {
    return `AI construction DAG failed independent replay: ${
      error instanceof Error ? error.message : 'unknown replay failure'
    }`;
  }
  return null;
}

/** Independently attest a managed Inspector style-only whole-block rewrite. */
function managedInspectorStyleProofConflict(
  source: string,
  block: ManagedConstructionBlock,
  patch: TextPatch,
  request: GeometryTransactionRequest,
  evidence: SourceHashEvidence,
): string | null {
  const proposalSchemaVersion = request.metadata?.proposalSchemaVersion;
  if (
    proposalSchemaVersion !== 'inspector-style-proposal/v1'
      && proposalSchemaVersion !== 'managed-presentation-intent/v1'
    || request.metadata?.managedConstructionOperationKind
      !== 'replace-managed-construction'
  ) {
    return `Managed Inspector style replacement ${block.id} is missing a typed proposal envelope.`;
  }
  const value = request.metadata?.managedConstructionStyleProof;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `Managed Inspector style replacement ${block.id} is missing a Broker-verifiable proof.`;
  }
  const proof = value as Record<string, unknown>;
  const proofSlotIds = stringArray(proof.slotIds);
  const proofSlotRoles = stringArray(proof.slotRoles);
  const proofSlotFingerprints = stringArray(proof.slotSemanticFingerprints);
  const proofBindingIds = stringArray(proof.bindingIds);
  const bindingCapabilities = inspectorBindingCapabilities(
    proof.bindingCapabilities,
  );
  const requestBindingIds = stringArray(request.metadata?.bindingIds);
  const bodyPatchValue = proof.bodyPatch;
  const bodyPatchRecord = (
    bodyPatchValue
    && typeof bodyPatchValue === 'object'
    && !Array.isArray(bodyPatchValue)
  )
    ? bodyPatchValue as Record<string, unknown>
    : null;
  const bodyPatch = bodyPatchRecord
    && Number.isInteger(bodyPatchRecord.from)
    && Number.isInteger(bodyPatchRecord.to)
    && (bodyPatchRecord.from as number) >= 0
    && (bodyPatchRecord.to as number) >= (bodyPatchRecord.from as number)
    && typeof bodyPatchRecord.insert === 'string'
    && typeof bodyPatchRecord.expectedText === 'string'
    ? {
      from: bodyPatchRecord.from as number,
      to: bodyPatchRecord.to as number,
      insert: bodyPatchRecord.insert,
    }
    : null;
  if (
    proof.schemaVersion !== 'managed-construction-style-proof/v1'
    || proof.constructionId !== block.id
    || proof.previousContentFingerprint !== block.contentFingerprint
    || !proofSlotIds
    || !proofSlotRoles
    || !proofSlotFingerprints
    || !proofBindingIds
    || !bindingCapabilities
    || proofBindingIds.length === 0
    || new Set(proofBindingIds).size !== proofBindingIds.length
    || !requestBindingIds
    || new Set(requestBindingIds).size !== requestBindingIds.length
    || JSON.stringify(proofBindingIds) !== JSON.stringify(requestBindingIds)
    || !bodyPatch
    || bodyPatchRecord?.expectedText
      !== source.slice(bodyPatch.from, bodyPatch.to)
  ) {
    return `Managed Inspector style replacement ${block.id} has a stale or invalid proof envelope.`;
  }
  let replayed: readonly TextPatch[];
  try {
    replayed = managedStyleRecompilePatches(source, block.id, bodyPatch);
  } catch {
    return `Managed Inspector style replacement ${block.id} could not replay its trusted style patch.`;
  }
  if (
    replayed.length !== 1
    || replayed[0]?.from !== patch.from
    || replayed[0]?.to !== patch.to
    || replayed[0]?.insert !== patch.insert
  ) {
    return `Managed Inspector style replacement ${block.id} does not match the trusted style recompiler.`;
  }
  const replacementBlocks = parseManagedConstructionBlocks(patch.insert);
  const replacementBlock = replacementBlocks.length === 1
    ? replacementBlocks[0]
    : undefined;
  const current = decodeManagedConstructionPlan(source, block);
  const replacement = replacementBlock
    ? decodeManagedConstructionPlan(patch.insert, replacementBlock)
    : null;
  const currentBlockText = source.slice(block.range.start, block.range.end);
  let presentationEnvelopeMatches = managedPresentationEnvelopeMatches(
    currentBlockText,
    patch.insert,
  );
  let presentationSource = source.slice(
    block.tikzBodyRange.start,
    block.tikzBodyRange.end,
  );
  let presentationSourceStart = block.tikzBodyRange.start;
  if (
    block.schemaVersion === MANAGED_CONSTRUCTION_SCHEMA_V3
    && replacementBlock?.schemaVersion === MANAGED_CONSTRUCTION_SCHEMA_V3
  ) {
    const currentLocalBlock = parseManagedConstructionBlocks(currentBlockText)[0];
    if (currentLocalBlock) {
      const currentEnvelope = readManagedConstructionV3Envelope(
        currentBlockText,
        currentLocalBlock,
      );
      const replacementEnvelope = readManagedConstructionV3Envelope(
        patch.insert,
        replacementBlock,
      );
      presentationEnvelopeMatches = (
        currentEnvelope.slots.length === 1
        && replacementEnvelope.slots.length === 1
        && managedConstructionV3OutsideSlotsMatches(
          currentBlockText,
          currentEnvelope,
          patch.insert,
          replacementEnvelope,
        )
      );
      if (currentEnvelope.slots.length === 1) {
        const slot = currentEnvelope.slots[0]!;
        presentationSource = currentBlockText.slice(
          slot.sourceRange.start,
          slot.sourceRange.end,
        );
        presentationSourceStart = block.range.start + slot.sourceRange.start;
      }
    } else {
      presentationEnvelopeMatches = false;
    }
  }
  if (
    !replacementBlock
    || replacementBlock.range.start !== 0
    || replacementBlock.range.end !== patch.insert.length
    || !current.ok
    || !replacement?.ok
    || !presentationEnvelopeMatches
  ) {
    return `Managed Inspector style replacement ${block.id} changed bytes outside its presentation body.`;
  }
  const currentArtifact = compileConstructionWriterArtifact(current.plan);
  const replacementArtifact = compileConstructionWriterArtifact(replacement.plan);
  const currentSlotIds = currentArtifact.slots.map((slot) => slot.id);
  const currentSlotRoles = currentArtifact.slots.map((slot) => slot.role);
  const currentSlotFingerprints = currentArtifact.slots.map((slot) => (
    slot.semanticFingerprint
  ));
  const currentConstructionBlocks = parseManagedConstructionBlocks(source)
    .filter((candidate) => candidate.id === block.id);
  const blockBindingId = managedBlockBindingId(block.id);
  const allowedBindingIds = new Set([
    blockBindingId,
    ...block.records.map((record) => managedRecordBindingId(
      blockBindingId,
      record.recordType,
      record.id,
    )),
  ]);
  const expectedSourceId = `${request.documentId}:tikz`;
  const bindingCapabilityConflict = (
    currentConstructionBlocks.length !== 1
    || bindingCapabilities.length !== proofBindingIds.length
    || bindingCapabilities.some((capability, index) => (
      capability.bindingId !== proofBindingIds[index]
      || !allowedBindingIds.has(capability.bindingId)
      || capability.sourceId !== expectedSourceId
      || capability.sourceRevision !== request.expectedRevision
      || capability.sourceHash !== request.sourceHash
      || capability.range.start !== block.range.start
      || capability.range.end !== block.range.end
      || capability.managedConstructionId !== block.id
      || capability.writePolicy !== 'managed-recompile-only'
    ))
  );
  const relativeBodyPatch = {
    from: bodyPatch.from - presentationSourceStart,
    to: bodyPatch.to - presentationSourceStart,
    insert: bodyPatch.insert,
  };
  const aiPresentationIntent = proposalSchemaVersion
    === 'managed-presentation-intent/v1';
  const targetEntityId = request.metadata?.managedPresentationTargetEntityId;
  let targetSlots: typeof currentArtifact.slots = [];
  if (aiPresentationIntent && typeof targetEntityId === 'string') {
    try {
      const doc = currentGeometryDoc(source, request, evidence.algorithm);
      const sourceRecordIds = new Set(doc.construction.bindings.flatMap((candidate) => {
        const constructionId = candidate.metadata?.constructionId
          ?? candidate.metadata?.managedConstructionId;
        const sourceRecordId = candidate.metadata?.sourceRecordId;
        const entry = doc.sourceMap.entries.find((item) => (
          item.bindingId === candidate.id
        ));
        return constructionId === block.id
          && typeof sourceRecordId === 'string'
          && entry?.entityIds.length === 1
          && entry.entityIds[0] === targetEntityId
          ? [sourceRecordId]
          : [];
      }));
      targetSlots = currentArtifact.slots.filter((slot) => (
        slot.optionSites.length === 1
        && slot.owners.some((owner) => (
          owner.startsWith('entity:')
          && sourceRecordIds.has(owner.slice('entity:'.length))
        ))
      ));
    } catch {
      targetSlots = [];
    }
  }
  const targetSite = targetSlots.length === 1
    ? managedPresentationOptionSiteTarget(
      current.plan,
      presentationSource,
      targetSlots[0]!.id,
    )
    : null;
  const focusBindingIds = stringArray(request.metadata?.focusBindingIds);
  const readBindingIds = stringArray(request.metadata?.readBindingIds);
  const authorizedBindingIds = evidence.authorizedBindingIds;
  const aiScopeConflict = aiPresentationIntent && (
    !focusBindingIds
    || !readBindingIds
    || !authorizedBindingIds
    || proofBindingIds.some((bindingId) => (
      !focusBindingIds.includes(bindingId)
      || !readBindingIds.includes(bindingId)
      || !authorizedBindingIds.includes(bindingId)
    ))
    || !targetSite
    || targetSite.from !== relativeBodyPatch.from
    || targetSite.to !== relativeBodyPatch.to
  );
  if (
    !managedPresentationOptionPatchMatches(
      current.plan,
      presentationSource,
      relativeBodyPatch,
    )
    || bindingCapabilityConflict
    || aiScopeConflict
    || JSON.stringify(canonicalValue(current.plan))
      !== JSON.stringify(canonicalValue(replacement.plan))
    || proof.writerId !== currentArtifact.writerId
    || proof.writerRevision !== currentArtifact.writerRevision
    || proof.writerArtifactFingerprint !== currentArtifact.semanticFingerprint
    || JSON.stringify(proofSlotIds) !== JSON.stringify(currentSlotIds)
    || JSON.stringify(proofSlotRoles) !== JSON.stringify(currentSlotRoles)
    || JSON.stringify(proofSlotFingerprints)
      !== JSON.stringify(currentSlotFingerprints)
    || replacementArtifact.writerId !== currentArtifact.writerId
    || replacementArtifact.writerRevision !== currentArtifact.writerRevision
    || replacementArtifact.semanticFingerprint
      !== currentArtifact.semanticFingerprint
  ) {
    return `Managed Inspector style replacement ${block.id} changed semantic plan or writer ABI.`;
  }
  const currentOpaque = current.presentation?.opaqueSlots ?? [];
  const replacementOpaque = replacement.presentation?.opaqueSlots ?? [];
  if (JSON.stringify(currentOpaque) !== JSON.stringify(replacementOpaque)) {
    return `Managed Inspector style replacement ${block.id} did not preserve opaque presentation slots.`;
  }
  for (const presentation of [current.presentation, replacement.presentation]) {
    if (!presentation) continue;
    if (
      presentation.writerId !== currentArtifact.writerId
      || presentation.writerRevision !== currentArtifact.writerRevision
      || JSON.stringify(presentation.slots.map((slot) => slot.slotId))
        !== JSON.stringify(currentSlotIds)
    ) {
      return `Managed Inspector style replacement ${block.id} detached its presentation from the writer ABI.`;
    }
  }
  return null;
}

function canonicalPointCoordinate(value: number): number {
  return Number(formatCoordNumber(value));
}

function closedRange(value: unknown): { start: number; end: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return JSON.stringify(Object.keys(record).sort())
      === JSON.stringify(['end', 'start'])
    && isRange(record)
    ? { start: record.start as number, end: record.end as number }
    : null;
}

/** Rebuild a direct point binding and its minimal literal patch at the Broker. */
function canvasDirectPointMoveProofConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
  hashAlgorithm: string,
): string | null {
  const value = request.metadata?.canvasPointMoveProof;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Direct Canvas point move is missing a typed proof.';
  }
  const proof = value as Record<string, unknown>;
  const targetValue = proof.target;
  const targetRecord = targetValue && typeof targetValue === 'object'
    && !Array.isArray(targetValue)
    ? targetValue as Record<string, unknown>
    : null;
  const target = targetRecord
    && JSON.stringify(Object.keys(targetRecord).sort())
      === JSON.stringify(['x', 'y'])
    && typeof targetRecord.x === 'number'
    && Number.isFinite(targetRecord.x)
    && typeof targetRecord.y === 'number'
    && Number.isFinite(targetRecord.y)
    ? {
      x: canonicalPointCoordinate(targetRecord.x),
      y: canonicalPointCoordinate(targetRecord.y),
    }
    : null;
  const capabilityValue = proof.bindingCapability;
  const capability = capabilityValue && typeof capabilityValue === 'object'
    && !Array.isArray(capabilityValue)
    ? capabilityValue as Record<string, unknown>
    : null;
  const capabilityRange = closedRange(capability?.range);
  const coordinateRange = closedRange(proof.coordinateRange);
  if (
    JSON.stringify(Object.keys(proof).sort()) !== JSON.stringify([
      'bindingCapability',
      'coordinateRange',
      'mode',
      'pointName',
      'schemaVersion',
      'sourceStableId',
      'target',
    ])
    || proof.schemaVersion !== 'canvas-point-move-proof/v1'
    || proof.mode !== 'direct-coordinate'
    || typeof proof.pointName !== 'string'
    || proof.pointName.length === 0
    || typeof proof.sourceStableId !== 'string'
    || proof.sourceStableId.length === 0
    || !target
    || target.x !== targetRecord?.x
    || target.y !== targetRecord?.y
    || !coordinateRange
    || !capability
    || JSON.stringify(Object.keys(capability).sort()) !== JSON.stringify([
      'bindingId',
      'range',
      'sourceHash',
      'sourceId',
      'sourceRevision',
      'writePolicy',
    ])
    || typeof capability.bindingId !== 'string'
    || capability.bindingId.length === 0
    || capability.sourceId !== `${request.documentId}:tikz`
    || capability.sourceRevision !== request.expectedRevision
    || capability.sourceHash !== request.sourceHash
    || capability.writePolicy !== 'direct'
    || !capabilityRange
    || request.metadata?.bindingId !== capability.bindingId
    || request.metadata?.semanticEntityId !== proof.sourceStableId
  ) {
    return 'Direct Canvas point move has a stale or malformed capability proof.';
  }

  const analysis = analyze(source, request.expectedRevision);
  if (analysis.status !== 'complete') {
    return 'Direct Canvas point move requires a complete current semantic projection.';
  }
  try {
    const truths = projectTikzAnalysisToGeometryTruth({
      analysis,
      source,
      basis: {
        documentId: request.documentId,
        epoch: request.documentEpoch,
        revision: request.expectedRevision,
        sourceHash: request.sourceHash,
        sourceId: `${request.documentId}:tikz`,
        ...(request.pluginSetDigest
          ? { pluginSetDigest: request.pluginSetDigest }
          : {}),
      },
      hashAlgorithm,
    });
    const geometryDoc = createGeometryDoc(truths, buildGeometrySourceMap(truths));
    const entityMatches = geometryDoc.semantic.ir.entities.filter((entity) => (
      entity.id === proof.sourceStableId
      && entity.kind === 'point'
      && entity.name === proof.pointName
      && entity.sourceBindingIds?.includes(capability.bindingId as string)
    ));
    const binding = geometryDoc.construction.bindings.find((candidate) => (
      candidate.id === capability.bindingId
    ));
    const currentCoordinateRange = analysis.freePointRanges.get(proof.pointName);
    if (
      entityMatches.length !== 1
      || !binding
      || !binding.writable
      || binding.metadata?.managedConstructionId !== undefined
      || !binding.targets.some((reference) => (
        reference.recordType === 'entity'
        && reference.id === proof.sourceStableId
      ))
      || binding.source.document.sourceId !== capability.sourceId
      || binding.source.document.revision !== capability.sourceRevision
      || binding.source.document.hash !== capability.sourceHash
      || binding.source.range.start !== capabilityRange.start
      || binding.source.range.end !== capabilityRange.end
      || !currentCoordinateRange
      || currentCoordinateRange.start !== coordinateRange.start
      || currentCoordinateRange.end !== coordinateRange.end
      || coordinateRange.start < capabilityRange.start
      || coordinateRange.end > capabilityRange.end
    ) {
      return 'Direct Canvas point move no longer matches its GeometryDoc binding.';
    }
    const canonicalPatch = coordinateLiteralPatch(
      source,
      coordinateRange,
      sourceCoordinateForWorldPoint(
        analysis.freePointTransforms.get(proof.pointName),
        target,
      ),
    );
    if (
      patches.length !== 1
      || patches[0]?.from !== canonicalPatch.from
      || patches[0]?.to !== canonicalPatch.to
      || patches[0]?.insert !== canonicalPatch.insert
    ) {
      return 'Direct Canvas point move differs from the Broker-replayed coordinate patch.';
    }
  } catch (error) {
    return `Direct Canvas point move could not be replayed: ${error instanceof Error ? error.message : 'unknown projection failure'}`;
  }
  return null;
}

function currentGeometryDoc(
  source: string,
  request: GeometryTransactionRequest,
  hashAlgorithm: string,
) {
  const analysis = analyze(source, request.expectedRevision);
  if (analysis.status !== 'complete') {
    throw new TypeError('Current TikZ source does not have a complete semantic projection.');
  }
  const truths = projectTikzAnalysisToGeometryTruth({
    analysis,
    source,
    basis: {
      documentId: request.documentId,
      epoch: request.documentEpoch,
      revision: request.expectedRevision,
      sourceHash: request.sourceHash,
      sourceId: `${request.documentId}:tikz`,
      ...(request.pluginSetDigest
        ? { pluginSetDigest: request.pluginSetDigest }
        : {}),
    },
    hashAlgorithm,
  });
  return createGeometryDoc(truths, buildGeometrySourceMap(truths));
}

function canvasDragPatchesProofConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
  hashAlgorithm: string,
): string | null {
  const proofValue = request.metadata?.canvasPointMoveProof;
  if (!proofValue || typeof proofValue !== 'object' || Array.isArray(proofValue)) {
    return 'Canvas drag batch is missing a typed point-move proof.';
  }
  const proof = proofValue as Record<string, unknown>;
  if (
    (
      proof.mode !== 'path-angle'
      && proof.mode !== 'derived-coordinates'
      && proof.mode !== 'selection-transform'
    )
    || typeof proof.pointName !== 'string'
    || typeof proof.sourceStableId !== 'string'
    || proof.pointName.length === 0
    || proof.sourceStableId.length === 0
  ) {
    return 'Canvas drag batch proof mode or point identity is malformed.';
  }
  try {
    const canonical = compileCanvasDragPatchesProposal({
      source,
      geometryDoc: currentGeometryDoc(source, request, hashAlgorithm),
      sourceStableId: proof.sourceStableId,
      pointName: proof.pointName,
      mode: proof.mode,
      patches,
      ...(proof.mode === 'selection-transform' && Array.isArray(proof.selectedEntityIds)
        ? { selectedEntityIds: proof.selectedEntityIds.filter((id): id is string => typeof id === 'string') }
        : {}),
      ...(proof.mode === 'selection-transform' && proof.transform && typeof proof.transform === 'object'
        ? { selectionTransform: proof.transform as never }
        : {}),
      ...(proof.mode === 'selection-transform' && Array.isArray(proof.externalImpactedEntityIds)
        ? {
          acknowledgedExternalImpactedEntityIds: proof.externalImpactedEntityIds
            .filter((id): id is string => typeof id === 'string'),
        }
        : {}),
    });
    if (
      JSON.stringify(canonical.transaction.metadata?.canvasPointMoveProof)
        !== JSON.stringify(proof)
    ) {
      return 'Canvas drag batch differs from Broker canonical replay.';
    }
  } catch (error) {
    return `Canvas drag batch could not be replayed: ${error instanceof Error ? error.message : 'unknown projection failure'}`;
  }
  return null;
}

function canvasSelectionTransformProofConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
  hashAlgorithm: string,
): string | null {
  const proofValue = request.metadata?.canvasSelectionTransformProof;
  if (!proofValue || typeof proofValue !== 'object' || Array.isArray(proofValue)) {
    return 'Canvas selection transform is missing its typed proof.';
  }
  const proof = proofValue as Record<string, unknown>;
  if (
    proof.schemaVersion !== 'canvas-selection-transform-proof/v1'
    || !Array.isArray(proof.selectedEntityIds)
    || !proof.transform
    || typeof proof.transform !== 'object'
    || !Array.isArray(proof.externalImpactedEntityIds)
  ) {
    return 'Canvas selection transform proof is malformed.';
  }
  try {
    const canonical = compileCanvasSelectionTransformProposal({
      source,
      geometryDoc: currentGeometryDoc(source, request, hashAlgorithm),
      selectedEntityIds: proof.selectedEntityIds.filter(
        (id): id is string => typeof id === 'string',
      ),
      transform: proof.transform as never,
      acknowledgedExternalImpactedEntityIds:
        proof.externalImpactedEntityIds.filter(
          (id): id is string => typeof id === 'string',
        ),
    });
    if (
      JSON.stringify(canonical.transaction.metadata?.canvasSelectionTransformProof)
        !== JSON.stringify(proof)
      || JSON.stringify(canonical.patches) !== JSON.stringify(patches)
      || JSON.stringify(canonical.transaction.workspaceEdit)
        !== JSON.stringify(request.workspaceEdit)
    ) {
      return 'Canvas selection transform differs from Broker canonical replay.';
    }
  } catch (error) {
    return `Canvas selection transform could not be replayed: ${
      error instanceof Error ? error.message : 'unknown projection failure'
    }`;
  }
  return null;
}

function aiSelectionTransformProofConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
  evidence: SourceHashEvidence,
): string | null {
  const intent = request.metadata?.aiSelectionTransformIntentProof;
  const authorizedBindingIds = evidence.authorizedBindingIds;
  if (
    request.origin !== 'ai'
    || request.metadata?.proposalSchemaVersion
      !== AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION
    || !isAiSelectionTransformIntent(intent)
    || intent.intentId !== request.transactionId
    || intent.idempotencyKey !== request.idempotencyKey
    || intent.basis.documentId !== request.documentId
    || intent.basis.epoch !== request.documentEpoch
    || intent.basis.revision !== request.expectedRevision
    || intent.basis.sourceHash !== request.sourceHash
    || intent.basis.sourceId !== `${request.documentId}:tikz`
    || intent.basis.hashAlgorithm !== evidence.algorithm
    || intent.basis.kernelHash !== request.expectedKernelHash
    || intent.basis.projectionHash !== request.expectedProjectionHash
    || intent.basis.pluginSetDigest !== request.pluginSetDigest
    || !Array.isArray(authorizedBindingIds)
    || authorizedBindingIds.some((bindingId) => typeof bindingId !== 'string')
    || new Set(authorizedBindingIds).size !== authorizedBindingIds.length
  ) {
    return 'AI selection transform has a stale intent basis, scope, or transaction identity.';
  }

  try {
    const geometryDoc = currentGeometryDoc(source, request, evidence.algorithm);
    const insertionBinding = geometryDoc.construction.bindings.find((binding) => (
      binding.id === 'binding:document:tikzpicture-body-end'
    ));
    const currentCreateCapabilityFingerprint =
      typeof insertionBinding?.metadata?.capabilityFingerprint === 'string'
        ? insertionBinding.metadata.capabilityFingerprint
        : '';
    const expectedScopeFingerprint = constructionAuthorizationScopeFingerprint({
      basis: geometryDoc.basis,
      authorizedBindingIds,
      createCapabilityFingerprint: currentCreateCapabilityFingerprint,
    });
    if (
      intent.authorizationScopeFingerprint !== expectedScopeFingerprint
      || evidence.authorizationScopeFingerprint !== expectedScopeFingerprint
      || evidence.createCapabilityFingerprint !== currentCreateCapabilityFingerprint
    ) {
      return 'AI selection transform authorization scope no longer matches the current GeometryDoc.';
    }

    const canonical = compileAiSelectionTransformIntent(intent, {
      basis: intent.basis,
      source,
      geometryDoc,
      allowedBindingIds: authorizedBindingIds,
    }, {
      ...(request.actorId ? { actorId: request.actorId } : {}),
      ...(request.correlationId ? { correlationId: request.correlationId } : {}),
      ...(typeof request.metadata?.agentRunId === 'string'
        ? { metadata: { agentRunId: request.metadata.agentRunId } }
        : {}),
    });
    if (!canonical.ok) {
      return `AI selection transform failed host intent replay: ${canonical.errors[0]?.message ?? 'unknown validation failure'}`;
    }
    const operation = canonical.transaction.operations[0];
    const canonicalPatches = operation?.op === 'source-patch'
      ? operation.patches.map((patch) => ({
        from: patch.range.start,
        to: patch.range.end,
        insert: patch.insert,
      }))
      : [];
    if (
      !canonicalJsonEqual(canonicalPatches, patches)
      || !canonicalJsonEqual(canonical.transaction.operations, request.operations)
      || !canonicalJsonEqual(canonical.transaction.readSet, request.readSet)
      || !canonicalJsonEqual(canonical.transaction.writeSet, request.writeSet)
      || !canonicalJsonEqual(canonical.transaction.preconditions, request.preconditions)
      || !canonicalJsonEqual(canonical.transaction.workspaceEdit, request.workspaceEdit)
      || !canonicalJsonEqual(
        canonical.transaction.metadata?.canvasSelectionTransformProof,
        request.metadata?.canvasSelectionTransformProof,
      )
      || !canonicalJsonEqual(
        canonical.transaction.metadata?.focusBindingIds,
        request.metadata?.focusBindingIds,
      )
      || !canonicalJsonEqual(
        canonical.transaction.metadata?.readBindingIds,
        request.metadata?.readBindingIds,
      )
    ) {
      return 'AI selection transform differs from Broker canonical host replay.';
    }
  } catch (error) {
    return `AI selection transform could not be replayed: ${
      error instanceof Error ? error.message : 'unknown projection failure'
    }`;
  }

  return canvasSelectionTransformProofConflict(
    source,
    patches,
    request,
    evidence.algorithm,
  );
}

function aiSemanticDeleteProofConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
  evidence: SourceHashEvidence,
): string | null {
  const intent = request.metadata?.aiSemanticDeleteIntentProof;
  const authorizedBindingIds = evidence.authorizedBindingIds;
  if (
    request.origin !== 'ai'
    || request.metadata?.proposalSchemaVersion
      !== AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION
    || !isAiSemanticDeleteIntent(intent)
    || intent.intentId !== request.transactionId
    || intent.idempotencyKey !== request.idempotencyKey
    || intent.basis.documentId !== request.documentId
    || intent.basis.epoch !== request.documentEpoch
    || intent.basis.revision !== request.expectedRevision
    || intent.basis.sourceHash !== request.sourceHash
    || intent.basis.sourceId !== `${request.documentId}:tikz`
    || intent.basis.hashAlgorithm !== evidence.algorithm
    || intent.basis.kernelHash !== request.expectedKernelHash
    || intent.basis.projectionHash !== request.expectedProjectionHash
    || intent.basis.pluginSetDigest !== request.pluginSetDigest
    || !Array.isArray(authorizedBindingIds)
    || authorizedBindingIds.some((bindingId) => typeof bindingId !== 'string')
    || new Set(authorizedBindingIds).size !== authorizedBindingIds.length
  ) {
    return 'AI semantic delete has a stale intent basis, scope, or transaction identity.';
  }

  try {
    const geometryDoc = currentGeometryDoc(source, request, evidence.algorithm);
    const insertionBinding = geometryDoc.construction.bindings.find((binding) => (
      binding.id === 'binding:document:tikzpicture-body-end'
    ));
    const currentCreateCapabilityFingerprint =
      typeof insertionBinding?.metadata?.capabilityFingerprint === 'string'
        ? insertionBinding.metadata.capabilityFingerprint
        : '';
    const expectedScopeFingerprint = constructionAuthorizationScopeFingerprint({
      basis: geometryDoc.basis,
      authorizedBindingIds,
      createCapabilityFingerprint: currentCreateCapabilityFingerprint,
    });
    if (
      intent.authorizationScopeFingerprint !== expectedScopeFingerprint
      || evidence.authorizationScopeFingerprint !== expectedScopeFingerprint
      || evidence.createCapabilityFingerprint !== currentCreateCapabilityFingerprint
    ) {
      return 'AI semantic delete authorization scope no longer matches the current GeometryDoc.';
    }

    const canonical = compileAiSemanticDeleteIntent(intent, {
      basis: intent.basis,
      source,
      geometryDoc,
      allowedBindingIds: authorizedBindingIds,
    }, {
      ...(request.actorId ? { actorId: request.actorId } : {}),
      ...(request.correlationId ? { correlationId: request.correlationId } : {}),
      ...(typeof request.metadata?.agentRunId === 'string'
        ? { metadata: { agentRunId: request.metadata.agentRunId } }
        : {}),
    });
    if (!canonical.ok) {
      return `AI semantic delete failed host intent replay: ${canonical.errors[0]?.message ?? 'unknown validation failure'}`;
    }
    const operation = canonical.transaction.operations[0];
    const canonicalPatches = operation?.op === 'source-patch'
      ? operation.patches.map((patch) => ({
        from: patch.range.start,
        to: patch.range.end,
        insert: patch.insert,
      }))
      : [];
    if (
      !canonicalJsonEqual(canonicalPatches, patches)
      || !canonicalJsonEqual(canonical.transaction.operations, request.operations)
      || !canonicalJsonEqual(canonical.transaction.readSet, request.readSet)
      || !canonicalJsonEqual(canonical.transaction.writeSet, request.writeSet)
      || !canonicalJsonEqual(canonical.transaction.preconditions, request.preconditions)
      || !canonicalJsonEqual(canonical.transaction.workspaceEdit, request.workspaceEdit)
      || !canonicalJsonEqual(
        canonical.transaction.metadata?.canvasDeleteProof,
        request.metadata?.canvasDeleteProof,
      )
      || !canonicalJsonEqual(
        canonical.transaction.metadata?.focusBindingIds,
        request.metadata?.focusBindingIds,
      )
      || !canonicalJsonEqual(
        canonical.transaction.metadata?.readBindingIds,
        request.metadata?.readBindingIds,
      )
    ) {
      return 'AI semantic delete differs from Broker canonical host replay.';
    }
  } catch (error) {
    return `AI semantic delete could not be replayed: ${
      error instanceof Error ? error.message : 'unknown projection failure'
    }`;
  }

  return canvasDeleteProofConflict(
    source,
    patches,
    request,
    evidence.algorithm,
    {
      proposalSchemaVersion: AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION,
      sourceEditOrigin: 'geometry',
    },
  );
}

function semanticRecordsForDirectInspector(
  doc: ReturnType<typeof currentGeometryDoc>,
  selectedEntityId: string,
  propertyKind: 'style' | 'semantic',
) {
  const projectionOnlyKeys = new Set([
    'metadata',
    'sourceBindingIds',
    'range',
    'sourceRange',
    'cstRanges',
    'parameterRanges',
    'interpretedRange',
    'keyRange',
    'valueRange',
  ]);
  const semanticPayload = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(semanticPayload);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(record).flatMap(([key, item]) => (
      projectionOnlyKeys.has(key)
        ? []
        : [[key, semanticPayload(item)] as const]
    )));
  };
  const selected = doc.semantic.ir.entities.find((entity) => (
    entity.id === selectedEntityId
  ));
  const comparableEntity = (entity: typeof doc.semantic.ir.entities[number]) => {
    const payload = semanticPayload(entity) as Record<string, unknown>;
    if (propertyKind === 'style' && entity.id === selectedEntityId) {
      const parameters = payload.parameters;
      if (parameters && typeof parameters === 'object' && !Array.isArray(parameters)) {
        const {
          anchor: _presentationAnchor,
          ...semanticParameters
        } = parameters as Record<string, unknown>;
        payload.parameters = semanticParameters;
      }
    }
    return payload;
  };
  return {
    selectedIdentity: selected
      ? { id: selected.id, kind: selected.kind, name: selected.name }
      : null,
    entities: doc.semantic.ir.entities
      .filter((entity) => propertyKind === 'style' || entity.id !== selectedEntityId)
      .map(comparableEntity),
    constraints: doc.semantic.ir.constraints.map(semanticPayload),
    relations: doc.semantic.ir.relations.map(semanticPayload),
    styles: propertyKind === 'style'
      ? doc.semantic.ir.styles.filter((style) => (
        !style.selector.entityIds?.includes(selectedEntityId)
      )).map(semanticPayload)
      : doc.semantic.ir.styles.map(semanticPayload),
  };
}

function inspectorDirectPatchProofConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
  hashAlgorithm: string,
): string | null {
  const value = request.metadata?.inspectorDirectPatchProof;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Direct Inspector edit is missing a typed proof.';
  }
  const proof = value as Record<string, unknown>;
  const capabilityValue = proof.bindingCapability;
  const capability = capabilityValue && typeof capabilityValue === 'object'
    && !Array.isArray(capabilityValue)
    ? capabilityValue as Record<string, unknown>
    : null;
  if (
    JSON.stringify(Object.keys(proof).sort()) !== JSON.stringify([
      'bindingCapability',
      'bodyPatch',
      'propertyKind',
      'schemaVersion',
      'semanticEntityId',
    ])
    || proof.schemaVersion !== 'inspector-direct-patch-proof/v1'
    || (proof.propertyKind !== 'style' && proof.propertyKind !== 'semantic')
    || typeof proof.semanticEntityId !== 'string'
    || proof.semanticEntityId.length === 0
    || !capability
    || typeof capability.bindingId !== 'string'
    || capability.bindingId.length === 0
    || patches.length !== 1
  ) {
    return 'Direct Inspector proof is malformed.';
  }
  try {
    const currentDoc = currentGeometryDoc(source, request, hashAlgorithm);
    const canonical = compileInspectorDirectProposal({
      source,
      geometryDoc: currentDoc,
      semanticEntityId: proof.semanticEntityId,
      bindingIds: [capability.bindingId],
      patch: patches[0]!,
      propertyKind: proof.propertyKind,
    });
    if (
      JSON.stringify(canonical.transaction.metadata?.inspectorDirectPatchProof)
        !== JSON.stringify(proof)
    ) {
      return 'Direct Inspector edit differs from Broker canonical capability replay.';
    }
    const candidateSource = applyTextPatches(source, patches);
    const candidateAnalysis = analyze(candidateSource, request.expectedRevision);
    if (candidateAnalysis.status !== 'complete') {
      return 'Direct Inspector edit would leave an incomplete semantic projection.';
    }
    const candidateTruths = projectTikzAnalysisToGeometryTruth({
      analysis: candidateAnalysis,
      source: candidateSource,
      basis: {
        documentId: request.documentId,
        epoch: request.documentEpoch,
        revision: request.expectedRevision,
        sourceHash: hashSource(candidateSource),
        sourceId: `${request.documentId}:tikz`,
        ...(request.pluginSetDigest
          ? { pluginSetDigest: request.pluginSetDigest }
          : {}),
      },
      hashAlgorithm,
    });
    const candidateDoc = createGeometryDoc(
      candidateTruths,
      buildGeometrySourceMap(candidateTruths),
    );
    if (!canonicalJsonEqual(
      semanticRecordsForDirectInspector(
        currentDoc,
        proof.semanticEntityId,
        proof.propertyKind,
      ),
      semanticRecordsForDirectInspector(
        candidateDoc,
        proof.semanticEntityId,
        proof.propertyKind,
      ),
    )) {
      return 'Direct Inspector edit changed records outside its selected semantic capability.';
    }
  } catch (error) {
    return `Direct Inspector edit could not be replayed: ${error instanceof Error ? error.message : 'unknown projection failure'}`;
  }
  return null;
}

/** Independently prove that Canvas changed only one managed point position. */
function canvasPointMoveProofConflict(
  source: string,
  block: ManagedConstructionBlock,
  patch: TextPatch,
  request: GeometryTransactionRequest,
): string | null {
  const value = request.metadata?.canvasPointMoveProof;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `Canvas point replacement ${block.id} is missing a typed point-move proof.`;
  }
  const proof = value as Record<string, unknown>;
  const targetValue = proof.target;
  const targetRecord = (
    targetValue
    && typeof targetValue === 'object'
    && !Array.isArray(targetValue)
  )
    ? targetValue as Record<string, unknown>
    : null;
  const target = (
    targetRecord
    && JSON.stringify(Object.keys(targetRecord).sort())
      === JSON.stringify(['x', 'y'])
    && typeof targetRecord.x === 'number'
    && Number.isFinite(targetRecord.x)
    && typeof targetRecord.y === 'number'
    && Number.isFinite(targetRecord.y)
  )
    ? {
      x: canonicalPointCoordinate(targetRecord.x),
      y: canonicalPointCoordinate(targetRecord.y),
    }
    : null;
  const capabilities = inspectorBindingCapabilities(
    proof.bindingCapability ? [proof.bindingCapability] : null,
  );
  const capability = capabilities?.[0];
  if (
    JSON.stringify(Object.keys(proof).sort()) !== JSON.stringify([
      'bindingCapability',
      'constructionId',
      'entityRecordId',
      'mode',
      'pointName',
      'schemaVersion',
      'sourceStableId',
      'target',
    ])
    || proof.schemaVersion !== 'canvas-point-move-proof/v1'
    || proof.mode !== 'managed-recompile'
    || proof.constructionId !== block.id
    || typeof proof.entityRecordId !== 'string'
    || proof.entityRecordId.length === 0
    || typeof proof.pointName !== 'string'
    || proof.pointName.length === 0
    || typeof proof.sourceStableId !== 'string'
    || proof.sourceStableId.length === 0
    || !target
    || !capability
    || capability.bindingId !== managedBlockBindingId(block.id)
    || capability.sourceId !== `${request.documentId}:tikz`
    || capability.sourceRevision !== request.expectedRevision
    || capability.sourceHash !== request.sourceHash
    || capability.range.start !== block.range.start
    || capability.range.end !== block.range.end
    || capability.managedConstructionId !== block.id
    || request.metadata?.bindingId !== capability.bindingId
    || request.metadata?.semanticEntityId !== proof.sourceStableId
    || request.metadata?.constructionPlanKind !== 'primitive'
    || request.metadata?.constructionSyntaxKind !== 'point'
    || request.metadata?.constructionPlanId !== block.id
  ) {
    return `Canvas point replacement ${block.id} has a stale or invalid capability proof.`;
  }
  const current = decodeManagedConstructionPlan(source, block);
  const replacementBlocks = parseManagedConstructionBlocks(patch.insert);
  const replacementBlock = replacementBlocks.length === 1
    ? replacementBlocks[0]
    : undefined;
  const replacement = replacementBlock
    ? decodeManagedConstructionPlan(patch.insert, replacementBlock)
    : null;
  if (
    !current.ok
    || !replacement?.ok
    || current.plan.kind !== 'primitive'
    || current.plan.primitive.kind !== 'point'
    || replacement.plan.kind !== 'primitive'
    || replacement.plan.primitive.kind !== 'point'
    || current.plan.primitive.name !== proof.pointName
  ) {
    return `Canvas point replacement ${block.id} is not one decodable primitive point.`;
  }
  const currentPointEntities = current.plan.entities.filter((entity) => (
    entity.kind === 'point'
    && entity.id === proof.entityRecordId
    && entity.name === proof.pointName
  ));
  if (currentPointEntities.length !== 1) {
    return `Canvas point replacement ${block.id} lost its stable point entity identity.`;
  }
  const expectedPlan = {
    ...current.plan,
    primitive: {
      ...current.plan.primitive,
      position: target,
    },
    entities: current.plan.entities.map((entity) => (
      entity.kind === 'point' && entity.id === proof.entityRecordId
        ? { ...entity, position: target }
        : entity
    )),
  };
  if (
    JSON.stringify(canonicalValue(expectedPlan))
      !== JSON.stringify(canonicalValue(replacement.plan))
  ) {
    return `Canvas point replacement ${block.id} changed data outside the attested point position.`;
  }
  return null;
}

function hostSemanticActionBatchStyleConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
  evidence: SourceHashEvidence,
): string | null {
  const proofValue = request.metadata?.hostSemanticActionBatchProof;
  if (!isHostSemanticActionBatch(proofValue)) {
    return 'Host semantic action batch is missing its closed host proof.';
  }
  const constructionId = proofValue.styleIntent.operation.constructionId;
  const blocks = parseManagedConstructionBlocks(source).filter((block) => (
    block.id === constructionId
  ));
  const block = blocks[0];
  if (blocks.length !== 1 || !block || patches.length !== 2) {
    return 'Host semantic action batch must target one attached managed construction with two patches.';
  }
  const stylePatches = patches.filter((patch) => replacesWholeBlock(patch, block));
  if (stylePatches.length !== 1 || !stylePatches[0]?.insert) {
    return 'Host semantic action batch must contain one managed whole-block style replacement.';
  }
  const styleRequest: GeometryTransactionRequest = {
    ...request,
    transactionId: proofValue.styleIntent.intentId,
    idempotencyKey: proofValue.styleIntent.idempotencyKey,
    operations: [{
      operationId: `${proofValue.styleIntent.intentId}:source`,
      op: 'source-patch',
      patches: [{
        sourceId: `${request.documentId}:tikz`,
        range: { start: stylePatches[0].from, end: stylePatches[0].to },
        insert: stylePatches[0].insert,
        expectedText: source.slice(stylePatches[0].from, stylePatches[0].to),
      }],
    }],
    metadata: {
      ...(request.metadata ?? {}),
      proposalSchemaVersion: 'managed-presentation-intent/v1',
      managedConstructionOperationKind: 'replace-managed-construction',
      focusBindingIds: proofValue.styleIntent.focusBindingIds,
      readBindingIds: proofValue.styleIntent.readBindingIds,
      managedPresentationTargetEntityId:
        proofValue.styleIntent.operation.targetEntityId,
    },
  };
  return managedInspectorStyleProofConflict(
    source,
    block,
    stylePatches[0],
    styleRequest,
    evidence,
  );
}

function hostSemanticActionBatchCreateConflict(
  previousSource: string,
  source: string,
  patches: readonly TextPatch[],
  createdBlocks: readonly ManagedConstructionBlock[],
  request: GeometryTransactionRequest,
  evidence: SourceHashEvidence,
): string | null {
  const proofValue = request.metadata?.hostSemanticActionBatchProof;
  if (!isHostSemanticActionBatch(proofValue)) {
    return 'Host semantic action batch is missing its closed host proof.';
  }
  const styleConstructionId = proofValue.styleIntent.operation.constructionId;
  const currentBlock = parseManagedConstructionBlocks(previousSource).find((block) => (
    block.id === styleConstructionId
  ));
  if (!currentBlock) return 'Host semantic action batch style owner is detached.';
  const labelPatches = patches.filter((patch) => !replacesWholeBlock(patch, currentBlock));
  if (labelPatches.length !== 1) {
    return 'Host semantic action batch must contain one distinct label insertion patch.';
  }
  const labelRequest: GeometryTransactionRequest = {
    ...request,
    transactionId: proofValue.labelIntent.intentId,
    idempotencyKey: proofValue.labelIntent.idempotencyKey,
    operations: [{
      operationId: `${proofValue.labelIntent.intentId}:source`,
      op: 'source-patch',
      patches: [{
        sourceId: `${request.documentId}:tikz`,
        range: { start: labelPatches[0].from, end: labelPatches[0].to },
        insert: labelPatches[0].insert,
        expectedText: previousSource.slice(labelPatches[0].from, labelPatches[0].to),
      }],
    }],
    metadata: {
      ...(request.metadata ?? {}),
      proposalSchemaVersion: 'construction-plan-proposal/v1',
      authoringSchemaVersion: 'construction-intent/v1',
      constructionIntentProof: proofValue.labelIntent as unknown as import('../ir/model').JsonObject,
      managedConstructionOperationKind: 'create-managed-construction',
    },
  };
  return aiManagedCreateProofConflict(
    previousSource,
    source,
    labelPatches[0],
    createdBlocks,
    labelRequest,
    evidence,
  );
}

function hostSemanticActionSetStyleConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
  evidence: SourceHashEvidence,
): string | null {
  const proofValue = request.metadata?.hostSemanticActionSetProof;
  if (!isHostSemanticActionSet(proofValue)) {
    return 'Host semantic action set is missing its closed host proof.';
  }
  const constructionId = proofValue.styleIntent.operation.constructionId;
  const blocks = parseManagedConstructionBlocks(source).filter((block) => (
    block.id === constructionId
  ));
  const block = blocks[0];
  if (blocks.length !== 1 || !block || patches.length !== 2) {
    return 'Host semantic action set must target one attached managed construction with two patches.';
  }
  const stylePatches = patches.filter((patch) => replacesWholeBlock(patch, block));
  if (stylePatches.length !== 1 || !stylePatches[0]?.insert) {
    return 'Host semantic action set must contain one managed whole-block style replacement.';
  }
  const styleRequest: GeometryTransactionRequest = {
    ...request,
    transactionId: proofValue.styleIntent.intentId,
    idempotencyKey: proofValue.styleIntent.idempotencyKey,
    operations: [{
      operationId: `${proofValue.styleIntent.intentId}:source`,
      op: 'source-patch',
      patches: [{
        sourceId: `${request.documentId}:tikz`,
        range: { start: stylePatches[0].from, end: stylePatches[0].to },
        insert: stylePatches[0].insert,
        expectedText: source.slice(stylePatches[0].from, stylePatches[0].to),
      }],
    }],
    metadata: {
      ...(request.metadata ?? {}),
      proposalSchemaVersion: 'managed-presentation-intent/v1',
      managedConstructionOperationKind: 'replace-managed-construction',
      focusBindingIds: proofValue.styleIntent.focusBindingIds,
      readBindingIds: proofValue.styleIntent.readBindingIds,
      managedPresentationTargetEntityId:
        proofValue.styleIntent.operation.targetEntityId,
    },
  };
  return managedInspectorStyleProofConflict(
    source,
    block,
    stylePatches[0],
    styleRequest,
    evidence,
  );
}

function hostSemanticActionSetCreateConflict(
  previousSource: string,
  source: string,
  patches: readonly TextPatch[],
  createdBlocks: readonly ManagedConstructionBlock[],
  request: GeometryTransactionRequest,
  evidence: SourceHashEvidence,
): string | null {
  const proofValue = request.metadata?.hostSemanticActionSetProof;
  if (!isHostSemanticActionSet(proofValue)) {
    return 'Host semantic action set is missing its closed host proof.';
  }
  const currentBlock = parseManagedConstructionBlocks(previousSource).find((block) => (
    block.id === proofValue.styleIntent.operation.constructionId
  ));
  if (!currentBlock) return 'Host semantic action set style owner is detached.';
  const labelPatches = patches.filter((patch) => !replacesWholeBlock(patch, currentBlock));
  const proofList = request.metadata?.managedConstructionCreateProofs;
  const intentProofList = request.metadata?.constructionIntentProofs;
  if (
    labelPatches.length !== 1
    || createdBlocks.length !== proofValue.labelIntents.length
    || !Array.isArray(proofList)
    || proofList.length !== proofValue.labelIntents.length
    || !Array.isArray(intentProofList)
    || JSON.stringify(canonicalValue(intentProofList))
      !== JSON.stringify(canonicalValue(proofValue.labelIntents))
  ) {
    return 'Host semantic action set must contain one merged label insertion with matching intent and writer proofs.';
  }
  const authorizedBindingIds = evidence.authorizedBindingIds;
  if (!Array.isArray(authorizedBindingIds)) {
    return 'Host semantic action set has no authorized binding scope.';
  }

  let geometryDoc: ReturnType<typeof currentGeometryDoc>;
  try {
    geometryDoc = currentGeometryDoc(previousSource, request, evidence.algorithm);
  } catch (error) {
    return `Host semantic action set could not rebuild GeometryDoc: ${
      error instanceof Error ? error.message : 'unknown projection failure'
    }`;
  }

  const expectedInsertions: TextPatch[] = [];
  const expectedPlans: ConstructionPlan[] = [];
  const expectedProofs: unknown[] = [];
  for (const intent of proofValue.labelIntents) {
    if (
      intent.basis.documentId !== request.documentId
      || intent.basis.epoch !== request.documentEpoch
      || intent.basis.revision !== request.expectedRevision
      || intent.basis.sourceHash !== request.sourceHash
      || intent.basis.sourceId !== `${request.documentId}:tikz`
      || intent.basis.kernelHash !== request.expectedKernelHash
      || intent.basis.projectionHash !== request.expectedProjectionHash
      || intent.basis.pluginSetDigest !== request.pluginSetDigest
      || intent.capability.scopeFingerprint
        !== evidence.authorizationScopeFingerprint
      || intent.capability.fingerprint !== evidence.createCapabilityFingerprint
    ) {
      return 'Host semantic action set contains a stale label intent basis or capability.';
    }
    try {
      const plan = compileConstructionIntent({
        source: previousSource,
        geometryDoc,
        allowedBindingIds: authorizedBindingIds,
        intent,
      }).plan;
      const insertion = insertBeforeTikzEndPatch(
        previousSource,
        compileNewManagedConstructionPlan(plan).lines,
      );
      const artifact = compileConstructionWriterArtifact(plan);
      expectedPlans.push(plan);
      expectedInsertions.push(insertion);
      expectedProofs.push({
        schemaVersion: 'managed-construction-create-proof/v1',
        constructionId: plan.id,
        planKind: plan.kind,
        syntaxKind: constructionPlanSyntaxKind(plan),
        writerId: artifact.writerId,
        writerRevision: artifact.writerRevision,
        slotIds: artifact.slots.map((slot) => slot.id),
        slotSemanticFingerprints:
          artifact.slots.map((slot) => slot.semanticFingerprint),
      });
    } catch (error) {
      return `Host semantic action set failed label intent replay: ${
        error instanceof Error ? error.message : 'unknown replay failure'
      }`;
    }
  }
  const labelPatch = labelPatches[0]!;
  const firstInsertion = expectedInsertions[0]!;
  if (
    labelPatch.from !== firstInsertion.from
    || labelPatch.to !== firstInsertion.to
    || labelPatch.insert !== expectedInsertions.map((patch) => patch.insert).join('')
    || JSON.stringify(canonicalValue(proofList))
      !== JSON.stringify(canonicalValue(expectedProofs))
  ) {
    return 'Host semantic action set label insertion differs from Broker Catalog replay.';
  }
  const blocksById = new Map(createdBlocks.map((block) => [block.id, block]));
  for (const plan of expectedPlans) {
    const block = blocksById.get(plan.id);
    const decoded = block ? decodeManagedConstructionPlan(source, block) : null;
    if (
      !decoded?.ok
      || decoded.presentation
      || !canonicalJsonEqual(
        compactCanonicalConstructionPlan(decoded.plan),
        compactCanonicalConstructionPlan(plan),
      )
    ) {
      return `Host semantic action set created label ${plan.id} outside trusted writer output.`;
    }
  }
  return null;
}

function managedPatchConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
  evidence: SourceHashEvidence,
): string | null {
  const blocks = parseManagedConstructionBlocks(source);
  const origin = sourceOriginForRequest(request);
  const proposalSchemaVersion = String(
    request.metadata?.proposalSchemaVersion ?? '',
  );
  const allowedCanvasSchemas = new Set([
    'canvas-construction-batch-proposal/v1',
    'canvas-delete-proposal/v1',
    'canvas-point-move-proposal/v1',
    'canvas-selection-transform-proposal/v1',
    'inspector-direct-proposal/v1',
    'inspector-style-proposal/v1',
  ]);
  if (request.origin === 'canvas' && !allowedCanvasSchemas.has(proposalSchemaVersion)) {
    return 'Canvas source writes require a Broker-replayed typed proposal; raw patches are forbidden.';
  }
  const allowedAiSchemas = new Set([
    'ai-patch-proposal/v1',
    AI_CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION,
    AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION,
    AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION,
    'construction-plan-proposal/v1',
    'ai-construction-intent-batch-proposal/v1',
    'managed-presentation-intent/v1',
    HOST_SEMANTIC_ACTION_BATCH_SCHEMA_VERSION,
    HOST_SEMANTIC_ACTION_SET_SCHEMA_VERSION,
  ]);
  if (origin === 'ai' && !allowedAiSchemas.has(proposalSchemaVersion)) {
    return 'AI source writes require a Broker-replayed typed proposal; raw transactions are forbidden.';
  }
  if (origin === 'ai' && proposalSchemaVersion === 'ai-patch-proposal/v1') {
    const proofConflict = aiRawPatchProofConflict(
      source,
      patches,
      request,
      evidence.algorithm,
      evidence,
    );
    if (proofConflict) return proofConflict;
  }
  if (
    origin === 'ai'
    && proposalSchemaVersion === AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION
  ) {
    const proofConflict = aiSemanticDeleteProofConflict(
      source,
      patches,
      request,
      evidence,
    );
    if (proofConflict) return proofConflict;
  }
  if (
    origin === 'ai'
    && proposalSchemaVersion === AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION
  ) {
    const proofConflict = aiSelectionTransformProofConflict(
      source,
      patches,
      request,
      evidence,
    );
    if (proofConflict) return proofConflict;
  }
  if (
    origin === 'ai'
    && proposalSchemaVersion === HOST_SEMANTIC_ACTION_BATCH_SCHEMA_VERSION
  ) {
    const proofConflict = hostSemanticActionBatchStyleConflict(
      source,
      patches,
      request,
      evidence,
    );
    if (proofConflict) return proofConflict;
  }
  if (
    origin === 'ai'
    && proposalSchemaVersion === HOST_SEMANTIC_ACTION_SET_SCHEMA_VERSION
  ) {
    const proofConflict = hostSemanticActionSetStyleConflict(
      source,
      patches,
      request,
      evidence,
    );
    if (proofConflict) return proofConflict;
  }
  // `repair` text is model-authored, so it gets no managed-block authority: it may
  // freely edit source around a block but must leave every block byte-identical.
  // Human-owned lanes (`keyboard`, `external`) stay exempt — a person editing or
  // pasting into the buffer owns those bytes outright.
  if (origin === 'repair' && !managedBlocksBytePreserved(source, patches)) {
    return 'Repair may not create, delete, or edit managed constructions; use a typed recompile proposal.';
  }
  if (origin === 'repair' && !repairPreservesDocumentShape(source, patches)) {
    return 'Repair may not erase the document construction or remove existing named points.';
  }
  const typedCanvasDelete = (
    origin === 'canvas'
    && request.metadata?.proposalSchemaVersion === 'canvas-delete-proposal/v1'
  );
  if (typedCanvasDelete) {
    const deleteConflict = canvasDeleteProofConflict(
      source,
      patches,
      request,
      evidence.algorithm,
    );
    if (deleteConflict) return deleteConflict;
  }
  if (proposalSchemaVersion === 'inspector-direct-proposal/v1') {
    return inspectorDirectPatchProofConflict(
      source,
      patches,
      request,
      evidence.algorithm,
    );
  }
  if (
    request.metadata?.proposalSchemaVersion === 'inspector-style-proposal/v1'
    || request.metadata?.proposalSchemaVersion === 'managed-presentation-intent/v1'
  ) {
    const proof = request.metadata?.managedConstructionStyleProof;
    const constructionId = (
      proof
      && typeof proof === 'object'
      && !Array.isArray(proof)
      && typeof (proof as Record<string, unknown>).constructionId === 'string'
    )
      ? (proof as Record<string, unknown>).constructionId
      : null;
    const targets = patches.flatMap((patch) => blocks.filter((block) => (
      replacesWholeBlock(patch, block)
    )));
    if (
      patches.length !== 1
      || patches[0]!.insert.length === 0
      || targets.length !== 1
      || !constructionId
      || targets[0]!.id !== constructionId
    ) {
      return 'Typed Inspector style transaction must replace exactly its attested managed construction.';
    }
  }
  if (request.metadata?.proposalSchemaVersion === 'canvas-point-move-proposal/v1') {
    const proof = request.metadata?.canvasPointMoveProof;
    const mode = proof && typeof proof === 'object' && !Array.isArray(proof)
      ? (proof as Record<string, unknown>).mode
      : null;
    if (mode === 'direct-coordinate') {
      return canvasDirectPointMoveProofConflict(
        source,
        patches,
        request,
        evidence.algorithm,
      );
    }
    if (
      mode === 'path-angle'
      || mode === 'derived-coordinates'
      || mode === 'selection-transform'
    ) {
      return canvasDragPatchesProofConflict(
        source,
        patches,
        request,
        evidence.algorithm,
      );
    }
    const constructionId = (
      proof
      && typeof proof === 'object'
      && !Array.isArray(proof)
      && typeof (proof as Record<string, unknown>).constructionId === 'string'
    )
      ? (proof as Record<string, unknown>).constructionId
      : null;
    const targets = patches.flatMap((patch) => blocks.filter((block) => (
      replacesWholeBlock(patch, block)
    )));
    if (
      mode !== 'managed-recompile'
      || patches.length !== 1
      || patches[0]!.insert.length === 0
      || targets.length !== 1
      || !constructionId
      || targets[0]!.id !== constructionId
    ) {
      return 'Typed Canvas point move must replace exactly its attested managed construction.';
    }
  }
  if (
    request.metadata?.proposalSchemaVersion
      === 'canvas-selection-transform-proposal/v1'
  ) {
    const conflict = canvasSelectionTransformProofConflict(
      source,
      patches,
      request,
      evidence.algorithm,
    );
    if (conflict) return conflict;
  }

  for (const patch of patches) {
    for (const block of blocks) {
      if (!patchTouchesBlock(patch, block)) continue;
      if (replacesWholeBlock(patch, block)) {
        if (typedCanvasDelete && patch.insert.length === 0) continue;
        if (origin === 'canvas' && patch.insert.length === 0) {
          return `Canvas managed deletion ${block.id} requires canvas-delete-proposal/v1 proof.`;
        }
        if (
          origin === 'ai'
          && request.metadata?.proposalSchemaVersion
            === AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION
          && patch.insert.length === 0
        ) {
          // The current GeometryDoc dependency closure and whole-block delete
          // capability were independently rebuilt by aiSemanticDeleteProofConflict.
          continue;
        }
        if (
          origin === 'ai'
          && request.metadata?.proposalSchemaVersion
            === 'managed-presentation-intent/v1'
          && patch.insert.length > 0
        ) {
          const proofConflict = managedInspectorStyleProofConflict(
            source,
            block,
            patch,
            request,
            evidence,
          );
          if (proofConflict) return proofConflict;
          continue;
        }
        if (
          origin === 'ai'
          && (
            request.metadata?.proposalSchemaVersion
              === HOST_SEMANTIC_ACTION_BATCH_SCHEMA_VERSION
            || request.metadata?.proposalSchemaVersion
              === HOST_SEMANTIC_ACTION_SET_SCHEMA_VERSION
          )
          && patch.insert.length > 0
        ) {
          // The style replacement was independently replayed above; the
          // second patch is a disjoint trusted Catalog insertion.
          continue;
        }
        if (
          origin === 'ai'
          && request.metadata?.proposalSchemaVersion
            === AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION
          && patch.insert.length > 0
        ) {
          // The current GeometryDoc, complete writer set, impact closure and
          // whole-block replacements were independently rebuilt above.
          continue;
        }
        if (
          origin === 'ai'
          && (
            request.metadata?.proposalSchemaVersion !== 'construction-plan-proposal/v1'
            || patch.insert.length === 0
          )
        ) {
          return `AI may replace managed construction ${block.id} only through a typed construction-plan proposal; raw patches and deletion are forbidden.`;
        }
        if (origin === 'ai') {
          const proofConflict = managedRecompileProofConflict(
            source,
            block,
            patch,
            request,
          );
          if (proofConflict) return proofConflict;
        }
        if (
          origin === 'canvas'
          && request.metadata?.proposalSchemaVersion
            === 'canvas-selection-transform-proposal/v1'
          && patch.insert.length > 0
        ) {
          // The complete multi-writer transaction was independently rebuilt
          // above. Managed point drivers are therefore allowed only as the
          // exact whole-block replacements emitted by that canonical replay.
          continue;
        }
        if (
          origin === 'canvas'
          && request.metadata?.proposalSchemaVersion
            === 'canvas-point-move-proposal/v1'
          && patch.insert.length > 0
        ) {
          const recompileConflict = managedRecompileProofConflict(
            source,
            block,
            patch,
            request,
          );
          if (recompileConflict) return recompileConflict;
          const pointMoveConflict = canvasPointMoveProofConflict(
            source,
            block,
            patch,
            request,
          );
          if (pointMoveConflict) return pointMoveConflict;
          continue;
        }
        if (
          (origin === 'canvas' || origin === 'style')
          && patch.insert.length > 0
        ) {
          const proofConflict = managedInspectorStyleProofConflict(
            source,
            block,
            patch,
            request,
            evidence,
          );
          if (proofConflict) return proofConflict;
          continue;
        }
        if (
          origin === 'keyboard'
          || origin === 'external'
          // `repair` reaches here only for a span that preserves the block's
          // bytes; the gate above already rejected anything else.
          || origin === 'repair'
          || validManagedReplacement(patch.insert, block.id)
        ) continue;
        return `受管构造 ${block.id} 只能整块删除或由受信任 recompiler 整块替换。`;
      }
      if (
        origin === 'keyboard'
        || origin === 'external'
        || origin === 'repair'
      ) continue;
      if (origin === 'ai') {
        return `AI 不能用 raw patch 局部改写受管构造 ${block.id}。`;
      }
      if (origin === 'canvas' || origin === 'style') {
        return `受管构造 ${block.id} 必须由 recompiler 整块更新，不能局部改写 TikZ body。`;
      }
      const protectedRanges = [
        block.headerRange,
        ...block.semanticRecordRanges,
        block.endRange,
      ];
      if (protectedRanges.some((range) => patchTouchesRange(patch, range))) {
        return `补丁触及受管构造 ${block.id} 的 schema/semantic metadata。`;
      }
      if (
        patch.from < block.tikzBodyRange.start
        || patch.to > block.tikzBodyRange.end
      ) {
        return `补丁越过受管构造 ${block.id} 的 TikZ body 边界。`;
      }
    }
  }
  return null;
}

function newlyIntroducedManagedReferenceIssue(
  previousSource: string,
  nextSource: string,
): string | null {
  const previous = new Set(
    managedConstructionDocumentReferenceIssues(previousSource)
      .map(managedConstructionDocumentReferenceIssueKey),
  );
  const introduced = managedConstructionDocumentReferenceIssues(nextSource)
    .find((item) => !previous.has(managedConstructionDocumentReferenceIssueKey(item)));
  return introduced?.message ?? null;
}

function newlyIntroducedManagedDirective(
  previousSource: string,
  nextSource: string,
): string | null {
  const linesOf = (source: string) => (
    source.match(/^[ \t]*%[ \t]*@mathgeo\b[^\r\n]*(?:\r?\n|$)/gmi) ?? []
  );
  const remaining = new Map<string, number>();
  for (const line of linesOf(previousSource)) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }
  for (const line of linesOf(nextSource)) {
    const count = remaining.get(line) ?? 0;
    if (count === 0) return line.trim();
    remaining.set(line, count - 1);
  }
  return null;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    normalized[key] = canonicalValue(record[key]);
  }
  return normalized;
}

/** Bound untrusted request shape before canonical request fingerprinting. */
function requestResourceLimitConflict(request: unknown): string | null {
  const stack: Array<{ value: unknown; depth: number; leave?: boolean }> = [{
    value: request,
    depth: 0,
  }];
  const active = new WeakSet<object>();
  let nodes = 0;
  let stringUnits = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.leave) {
      if (current.value && typeof current.value === 'object') active.delete(current.value);
      continue;
    }
    nodes += 1;
    if (nodes > 50_000 || current.depth > 32) {
      return 'Transaction request exceeds the structural complexity limit.';
    }
    if (typeof current.value === 'string') {
      stringUnits += current.value.length;
      if (current.value.length > 1024 * 1024 || stringUnits > 2 * 1024 * 1024) {
        return 'Transaction request exceeds the text payload limit.';
      }
      continue;
    }
    if (
      current.value === null
      || typeof current.value === 'number'
      || typeof current.value === 'boolean'
      || current.value === undefined
    ) continue;
    if (typeof current.value !== 'object') {
      return 'Transaction request contains a non-JSON value.';
    }
    if (active.has(current.value)) {
      return 'Transaction request contains a cyclic value.';
    }
    active.add(current.value);
    stack.push({ value: current.value, depth: current.depth, leave: true });
    if (Array.isArray(current.value)) {
      if (current.value.length > 512) {
        return 'Transaction request contains an oversized array.';
      }
      current.value.forEach((value) => stack.push({
        value,
        depth: current.depth + 1,
      }));
      continue;
    }
    const values = Object.values(current.value as Record<string, unknown>);
    if (values.length > 256) {
      return 'Transaction request contains an oversized object.';
    }
    values.forEach((value) => stack.push({
      value,
      depth: current.depth + 1,
    }));
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return 'Transaction request must be an object.';
  }
  const record = request as Record<string, unknown>;
  if (
    !Array.isArray(record.operations)
    || record.operations.length === 0
    || record.operations.length > 256
    || !Array.isArray(record.readSet)
    || record.readSet.length > 256
    || !Array.isArray(record.writeSet)
    || record.writeSet.length > 256
    || (record.preconditions !== undefined
      && (!Array.isArray(record.preconditions) || record.preconditions.length > 256))
  ) {
    return 'Transaction request exceeds the operation or resource limit.';
  }
  const metadata = record.metadata;
  if (
    metadata
    && typeof metadata === 'object'
    && !Array.isArray(metadata)
    && [
      'canvas-construction-batch-proposal/v1',
      'ai-construction-intent-batch-proposal/v1',
      AI_CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION,
    ].includes(String(
      (metadata as Record<string, unknown>).proposalSchemaVersion ?? '',
    ))
  ) {
    const proof = (metadata as Record<string, unknown>).canvasConstructionBatchProof;
    const proofRecord = proof && typeof proof === 'object' && !Array.isArray(proof)
      ? proof as Record<string, unknown>
      : null;
    const planProofs = proofRecord?.planProofs;
    const adoptionProofs = proofRecord?.adoptionProofs;
    const operation = record.operations[0];
    const operationRecord = operation && typeof operation === 'object' && !Array.isArray(operation)
      ? operation as Record<string, unknown>
      : null;
    const sourcePatches = operationRecord?.patches;
    if (
      record.operations.length !== 1
      || !Array.isArray(planProofs)
      || planProofs.length === 0
      || planProofs.length > 64
      || !Array.isArray(adoptionProofs)
      || adoptionProofs.length > 32
      || !Array.isArray(sourcePatches)
      || sourcePatches.length === 0
      || sourcePatches.length > 65
      || record.readSet.length > 65
      || record.writeSet.length > 65
      || (Array.isArray(record.preconditions) && record.preconditions.length > 65)
    ) {
      return 'Canvas construction batch exceeds its proof or patch limit.';
    }
    for (const candidate of planProofs) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return 'Canvas construction batch contains a malformed plan proof.';
      }
      const planProof = candidate as Record<string, unknown>;
      const slotIds = planProof.slotIds;
      const slotFingerprints = planProof.slotSemanticFingerprints;
      if (
        !Array.isArray(slotIds)
        || !Array.isArray(slotFingerprints)
        || slotIds.length > 256
        || slotFingerprints.length > 256
        || [...slotIds, ...slotFingerprints].some((value) => (
          typeof value !== 'string' || value.length === 0 || value.length > 4096
        ))
      ) {
        return 'Canvas construction batch exceeds its writer proof limit.';
      }
    }
    let insertedUnits = 0;
    for (const patch of sourcePatches) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return 'Canvas construction batch contains a malformed source patch.';
      }
      const insert = (patch as Record<string, unknown>).insert;
      if (typeof insert !== 'string') {
        return 'Canvas construction batch contains a non-text source patch.';
      }
      insertedUnits += insert.length;
      if (insertedUnits > 1024 * 1024) {
        return 'Canvas construction batch exceeds the source insertion limit.';
      }
    }
  }
  return null;
}

/**
 * Exact, deterministic request identity for in-process replay checks.
 *
 * `transactionId`, `idempotencyKey`, lifecycle stage and correlationId are
 * retry-local metadata. All document basis, resources, preconditions and
 * operations remain in the fingerprint, so reusing a key for a different
 * edit is rejected even when the caller reuses the transaction id.
 *
 * Cross-process persistence will replace this exact canonical string with its
 * SHA-256 digest; exact comparison here has no collision risk.
 */
function requestFingerprint(request: GeometryTransactionRequest): string {
  const material = { ...request } as Record<string, unknown>;
  delete material.transactionId;
  delete material.idempotencyKey;
  delete material.stage;
  delete material.correlationId;
  return JSON.stringify(canonicalValue(material));
}

function rejected(
  request: GeometryTransactionRequest,
  currentRevision: number,
  code: TikzTransactionConflictCode,
  message: string,
  status: 'conflict' | 'rejected' = 'rejected',
): TikzTransactionBrokerResult {
  return {
    ok: false,
    status,
    transactionId: request.transactionId,
    code,
    message,
    expectedRevision: request.expectedRevision,
    currentRevision,
  };
}

/**
 * Runtime authority for source-changing Geometry transactions.
 *
 * Semantic and Canvas operations must first compile to `source-patch`
 * operations. This broker validates the revision-bound source lane and only
 * then delegates one atomic CodeMirror-backed commit to StudioDocument.
 */
export class TikzTransactionBroker {
  constructor(private readonly document: StudioDocument) {}

  commit(
    request: GeometryTransactionRequest,
    evidence: SourceHashEvidence,
  ): TikzTransactionBrokerResult {
    const snapshot = this.document.getSnapshot();
    if (request.schemaVersion !== 'geometry-transaction/v1') {
      return rejected(request, snapshot.revision, 'invalid-request', '不支持的事务版本');
    }
    if (request.documentId !== snapshot.documentId) {
      return rejected(request, snapshot.revision, 'document-mismatch', '事务不属于当前文档', 'conflict');
    }
    if (request.documentEpoch !== snapshot.epoch) {
      return rejected(
        request,
        snapshot.revision,
        'document-epoch-mismatch',
        '事务属于已替换的文档历史',
        'conflict',
      );
    }

    const resourceLimitConflict = requestResourceLimitConflict(request);
    if (resourceLimitConflict) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        resourceLimitConflict,
      );
    }

    const workspaceEditIssue = validateGeometryWorkspaceEdit(request)[0];
    if (workspaceEditIssue) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        `Invalid GeometryWorkspaceEdit at ${workspaceEditIssue.path}: ${workspaceEditIssue.message}`,
      );
    }

    const fingerprint = requestFingerprint(request);
    const applied = this.document.getTransactionByIdempotencyKey(request.idempotencyKey);
    if (applied) {
      if (applied.requestFingerprint !== fingerprint) {
        return rejected(
          request,
          snapshot.revision,
          'idempotency-key-reused',
          '幂等键已绑定到不同的事务内容',
          'conflict',
        );
      }
      return {
        ok: true,
        status: 'idempotent',
        transactionId: applied.transactionId,
        idempotencyKey: request.idempotencyKey,
        fromRevision: applied.fromRevision,
        toRevision: applied.toRevision,
        record: applied,
      };
    }

    if (request.expectedRevision !== snapshot.revision) {
      return rejected(
        request,
        snapshot.revision,
        'revision-mismatch',
        '源码 revision 已变化',
        'conflict',
      );
    }
    if (
      request.sourceHash !== evidence.hash
      || snapshot.source !== evidence.source
    ) {
      return rejected(
        request,
        snapshot.revision,
        'source-hash-mismatch',
        '源码 hash 与事务基线不一致',
        'conflict',
      );
    }
    let brokerProjectionBasis: ReturnType<
      typeof projectTikzAnalysisToGeometryTruth
    >['semantic']['basis'] | null = null;
    if (
      request.expectedKernelHash !== undefined
      || request.expectedProjectionHash !== undefined
    ) {
      try {
        brokerProjectionBasis = projectTikzAnalysisToGeometryTruth({
          analysis: analyze(snapshot.source, snapshot.revision),
          source: snapshot.source,
          basis: {
            documentId: snapshot.documentId,
            epoch: snapshot.epoch,
            revision: snapshot.revision,
            sourceHash: request.sourceHash,
            sourceId: `${snapshot.documentId}:tikz`,
            ...(request.pluginSetDigest
              ? { pluginSetDigest: request.pluginSetDigest }
              : {}),
          },
          hashAlgorithm: evidence.algorithm,
        }).semantic.basis;
      } catch {
        return rejected(
          request,
          snapshot.revision,
          'semantic-projection-stale',
          'Broker could not derive the current semantic/projection identities.',
          'conflict',
        );
      }
    }
    if (
      request.expectedKernelHash !== undefined
      && request.expectedKernelHash !== brokerProjectionBasis?.kernelHash
    ) {
      return rejected(
        request,
        snapshot.revision,
        'kernel-hash-mismatch',
        '语义内核投影已变化',
        'conflict',
      );
    }
    if (
      request.expectedProjectionHash !== undefined
      && request.expectedProjectionHash !== brokerProjectionBasis?.projectionHash
    ) {
      return rejected(
        request,
        snapshot.revision,
        'projection-hash-mismatch',
        'Source-map/render projection changed before the transaction could commit.',
        'conflict',
      );
    }
    if (
      request.pluginSetDigest !== undefined
      && request.pluginSetDigest !== evidence.pluginSetDigest
    ) {
      return rejected(
        request,
        snapshot.revision,
        'plugin-set-mismatch',
        'TikZ 语义插件集合已变化',
        'conflict',
      );
    }

    const sourceId = `${snapshot.documentId}:tikz`;
    const readSet = request.readSet.map((resource) =>
      resourceAccess(resource, snapshot.source, sourceId));
    const writeSet = request.writeSet.map((resource) =>
      resourceAccess(resource, snapshot.source, sourceId));
    if (readSet.some((access) => access === null) || writeSet.some((access) => access === null)) {
      return rejected(
        request,
        snapshot.revision,
        'unsupported-resource',
        '源码事务只能读写当前 TikZ source lane',
      );
    }
    const validReadSet = readSet as StudioSourceAccess[];
    const validWriteSet = writeSet as StudioSourceAccess[];

    for (const precondition of request.preconditions ?? []) {
      if (
        precondition.kind !== 'source-slice-equals'
        || precondition.sourceId !== sourceId
        || !isRange(precondition.range)
        || precondition.range.end > snapshot.source.length
      ) {
        return rejected(
          request,
          snapshot.revision,
          'unsupported-resource',
          '源码 Broker 不接受当前前置条件',
        );
      }
      const actual = snapshot.source.slice(precondition.range.start, precondition.range.end);
      if (precondition.text !== undefined && precondition.text !== actual) {
        return rejected(
          request,
          snapshot.revision,
          'precondition-failed',
          '源码片段前置条件失败',
          'conflict',
        );
      }
    }

    if (
      request.metadata?.proposalSchemaVersion
        === 'construction-plan-proposal/v1'
      && (
        request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length !== 1
        || (
          request.metadata?.managedConstructionOperationKind
            !== 'create-managed-construction'
          && request.metadata?.managedConstructionOperationKind
            !== 'replace-managed-construction'
        )
        || (
          request.metadata?.managedConstructionOperationKind
            === 'create-managed-construction'
          && (
            request.metadata?.managedConstructionCreateProof === undefined
            || request.metadata?.managedConstructionRecompileProof !== undefined
            || request.metadata?.authoringSchemaVersion !== 'construction-intent/v1'
            // See the intent-batch gate below: a null proof is a shape
            // violation, so reject it here rather than as a replay conflict.
            || typeof request.metadata?.constructionIntentProof !== 'object'
            || request.metadata.constructionIntentProof === null
            || typeof request.expectedProjectionHash !== 'string'
            || request.expectedProjectionHash.length === 0
          )
        )
        || (
          request.metadata?.managedConstructionOperationKind
            === 'replace-managed-construction'
          && (
            request.metadata?.managedConstructionRecompileProof === undefined
            || request.metadata?.managedConstructionCreateProof !== undefined
            || request.metadata?.constructionIntentProof !== undefined
          )
        )
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'Typed construction-plan transactions must contain exactly one source-patch operation and one patch.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === 'inspector-style-proposal/v1'
      && (
        request.origin !== 'canvas'
        || request.metadata?.sourceEditOrigin !== 'style'
        || request.metadata?.managedConstructionOperationKind
          !== 'replace-managed-construction'
        || request.metadata?.managedConstructionStyleProof === undefined
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length !== 1
        || request.operations[0].patches[0]?.insert.length === 0
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'Typed Inspector style transactions must contain exactly one managed whole-block source patch.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === 'managed-presentation-intent/v1'
      && (
        request.origin !== 'ai'
        || request.metadata?.sourceEditOrigin !== 'ai'
        || request.metadata?.managedConstructionOperationKind
          !== 'replace-managed-construction'
        || request.metadata?.managedConstructionStyleProof === undefined
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length !== 1
        || request.operations[0].patches[0]?.insert.length === 0
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'Typed managed presentation intents must contain exactly one attested managed whole-block source patch.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === HOST_SEMANTIC_ACTION_BATCH_SCHEMA_VERSION
      && (
        request.origin !== 'ai'
        || request.metadata?.sourceEditOrigin !== 'ai'
        || request.metadata?.semanticWrite !== true
        || request.metadata?.managedConstructionOperationKind
          !== 'create-managed-construction'
        || !isHostSemanticActionBatch(
          request.metadata?.hostSemanticActionBatchProof,
        )
        || request.metadata?.managedConstructionStyleProof === undefined
        || request.metadata?.managedConstructionCreateProof === undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.metadata?.authoringSchemaVersion !== 'construction-intent/v1'
        || typeof request.expectedProjectionHash !== 'string'
        || request.expectedProjectionHash.length === 0
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length !== 2
        || request.operations[0].patches.some((patch) => patch.insert.length === 0)
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'Host semantic action batches require one style replacement and one Catalog label insertion in a single atomic transaction.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === HOST_SEMANTIC_ACTION_SET_SCHEMA_VERSION
      && (
        request.origin !== 'ai'
        || request.metadata?.sourceEditOrigin !== 'ai'
        || request.metadata?.semanticWrite !== true
        || request.metadata?.managedConstructionOperationKind
          !== 'create-managed-construction'
        || !isHostSemanticActionSet(
          request.metadata?.hostSemanticActionSetProof,
        )
        || request.metadata?.managedConstructionStyleProof === undefined
        || !Array.isArray(request.metadata?.managedConstructionCreateProofs)
        || !Array.isArray(request.metadata?.constructionIntentProofs)
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.constructionIntentProof !== undefined
        || request.metadata?.hostSemanticActionBatchProof !== undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.metadata?.authoringSchemaVersion !== 'construction-intent/v1'
        || typeof request.expectedProjectionHash !== 'string'
        || request.expectedProjectionHash.length === 0
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length !== 2
        || request.operations[0].patches.some((patch) => patch.insert.length === 0)
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'Host semantic action sets require one style replacement and one merged Catalog label insertion in a single atomic transaction.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === 'canvas-point-move-proposal/v1'
      && (
        !request.metadata?.canvasPointMoveProof
        || typeof request.metadata.canvasPointMoveProof !== 'object'
        || Array.isArray(request.metadata.canvasPointMoveProof)
        || request.origin !== 'canvas'
        || request.metadata?.sourceEditOrigin !== 'geometry'
        || request.metadata?.semanticWrite !== true
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.managedConstructionStyleProof !== undefined
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length === 0
        || request.operations[0].patches.some((patch) => patch.insert.length === 0)
        || (() => {
          const proof = request.metadata!.canvasPointMoveProof as Record<string, unknown>;
          if (proof.mode === 'managed-recompile') {
            return request.operations[0]!.op !== 'source-patch'
              || request.operations[0].patches.length !== 1
              || request.metadata?.managedConstructionOperationKind
                !== 'replace-managed-construction'
              || request.metadata?.managedConstructionRecompileProof === undefined;
          }
          if (proof.mode === 'direct-coordinate') {
            return request.operations[0]!.op !== 'source-patch'
              || request.operations[0].patches.length !== 1
              || request.metadata?.managedConstructionOperationKind !== undefined
              || request.metadata?.managedConstructionRecompileProof !== undefined;
          }
          if (
            proof.mode === 'path-angle'
            || proof.mode === 'derived-coordinates'
            || proof.mode === 'selection-transform'
          ) {
            return request.metadata?.managedConstructionOperationKind !== undefined
              || request.metadata?.managedConstructionRecompileProof !== undefined;
          }
          return true;
        })()
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'Typed Canvas point moves must contain exactly one closed direct or managed semantic source patch.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === 'canvas-selection-transform-proposal/v1'
      && (
        !request.metadata?.canvasSelectionTransformProof
        || typeof request.metadata.canvasSelectionTransformProof !== 'object'
        || Array.isArray(request.metadata.canvasSelectionTransformProof)
        || request.origin !== 'canvas'
        || request.metadata?.sourceEditOrigin !== 'geometry'
        || request.metadata?.semanticWrite !== true
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.metadata?.managedConstructionStyleProof !== undefined
        || request.metadata?.canvasPointMoveProof !== undefined
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length === 0
        || request.operations[0].patches.some((patch) => patch.insert.length === 0)
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'Typed Canvas selection transforms must contain one canonical atomic source-patch batch.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION
      && (
        !isAiSelectionTransformIntent(
          request.metadata?.aiSelectionTransformIntentProof,
        )
        || !request.metadata?.canvasSelectionTransformProof
        || typeof request.metadata.canvasSelectionTransformProof !== 'object'
        || Array.isArray(request.metadata.canvasSelectionTransformProof)
        || request.origin !== 'ai'
        || request.stage !== 'proposed'
        || request.metadata?.sourceEditOrigin !== 'geometry'
        || request.metadata?.semanticWrite !== true
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.metadata?.managedConstructionStyleProof !== undefined
        || request.metadata?.canvasPointMoveProof !== undefined
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length === 0
        || request.operations[0].patches.some((patch) => patch.insert.length === 0)
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'AI semantic selection transforms require one host-lowered canonical atomic source-patch batch.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === 'inspector-direct-proposal/v1'
      && (
        request.origin !== 'canvas'
        || (
          request.metadata?.sourceEditOrigin !== 'style'
          && request.metadata?.sourceEditOrigin !== 'geometry'
        )
        || request.metadata?.inspectorDirectPatchProof === undefined
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.metadata?.managedConstructionStyleProof !== undefined
        || request.metadata?.canvasPointMoveProof !== undefined
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length !== 1
        || (
          request.operations[0].patches[0]?.range.start
            === request.operations[0].patches[0]?.range.end
          && request.operations[0].patches[0]?.insert.length === 0
        )
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'Typed direct Inspector edits must contain one closed binding-scoped source patch.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === 'canvas-delete-proposal/v1'
      && (
        request.origin !== 'canvas'
        || request.metadata?.sourceEditOrigin !== 'canvas'
        || request.metadata?.semanticWrite !== true
        || request.metadata?.canvasDeleteProof === undefined
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.metadata?.managedConstructionStyleProof !== undefined
        || request.metadata?.canvasPointMoveProof !== undefined
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length === 0
        || request.operations[0].patches.some((patch) => (
          patch.insert !== '' || patch.range.start === patch.range.end
        ))
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'Typed Canvas delete must contain one non-empty semantic source-patch operation.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION
      && (
        !isAiSemanticDeleteIntent(request.metadata?.aiSemanticDeleteIntentProof)
        || !request.metadata?.canvasDeleteProof
        || typeof request.metadata.canvasDeleteProof !== 'object'
        || Array.isArray(request.metadata.canvasDeleteProof)
        || request.origin !== 'ai'
        || request.stage !== 'proposed'
        || request.metadata?.sourceEditOrigin !== 'geometry'
        || request.metadata?.semanticWrite !== true
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.metadata?.managedConstructionStyleProof !== undefined
        || request.metadata?.canvasPointMoveProof !== undefined
        || request.metadata?.canvasSelectionTransformProof !== undefined
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length === 0
        || request.operations[0].patches.some((patch) => (
          patch.insert !== '' || patch.range.start === patch.range.end
        ))
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'AI semantic delete requires one host-lowered block-only dependency deletion batch.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === AI_CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION
      && (
        request.origin !== 'ai'
        || request.stage !== 'proposed'
        || request.metadata?.sourceEditOrigin !== 'geometry'
        || request.metadata?.semanticWrite !== true
        || request.metadata?.authoringSchemaVersion !== 'construction-dag-intent/v1'
        || !isConstructionDagIntent(request.metadata?.constructionDagIntentProof)
        || typeof request.expectedProjectionHash !== 'string'
        || request.expectedProjectionHash.length === 0
        || typeof request.pluginSetDigest !== 'string'
        || request.pluginSetDigest.length === 0
        || request.metadata?.canvasConstructionBatchProof === undefined
        || request.metadata?.constructionIntentProof !== undefined
        || request.metadata?.canvasDeleteProof !== undefined
        || request.metadata?.canvasPointMoveProof !== undefined
        || request.metadata?.canvasSelectionTransformProof !== undefined
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.metadata?.managedConstructionStyleProof !== undefined
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length === 0
        || request.operations[0].patches.some((patch) => patch.insert.length === 0)
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'AI construction DAG intents require one closed host-lowered atomic Catalog batch.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === 'ai-construction-intent-batch-proposal/v1'
      && (
        request.origin !== 'ai'
        || request.metadata?.sourceEditOrigin !== 'geometry'
        || request.metadata?.semanticWrite !== true
        || request.metadata?.authoringSchemaVersion !== 'construction-intent/v1'
        // A null proof is a shape violation, not a replay conflict: testing only
        // for undefined let it through this gate and deferred the rejection to
        // the intent comparison, which reported a misleading conflict code.
        || typeof request.metadata?.constructionIntentProof !== 'object'
        || request.metadata.constructionIntentProof === null
        || typeof request.expectedProjectionHash !== 'string'
        || request.expectedProjectionHash.length === 0
        || typeof request.pluginSetDigest !== 'string'
        || request.pluginSetDigest.length === 0
        || request.metadata?.canvasConstructionBatchProof === undefined
        || request.metadata?.canvasDeleteProof !== undefined
        || request.metadata?.canvasPointMoveProof !== undefined
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.metadata?.managedConstructionStyleProof !== undefined
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length < 2
        || request.operations[0].patches.some((patch) => patch.insert.length === 0)
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'Typed AI construction adoption must contain one closed intent and one atomic semantic batch.',
      );
    }
    if (
      request.metadata?.proposalSchemaVersion
        === 'canvas-construction-batch-proposal/v1'
      && (
        request.origin !== 'canvas'
        || request.metadata?.sourceEditOrigin !== 'geometry'
        || request.metadata?.semanticWrite !== true
        || typeof request.pluginSetDigest !== 'string'
        || request.pluginSetDigest.length === 0
        || request.metadata?.canvasConstructionBatchProof === undefined
        || request.metadata?.canvasDeleteProof !== undefined
        || request.metadata?.canvasPointMoveProof !== undefined
        || request.metadata?.managedConstructionCreateProof !== undefined
        || request.metadata?.managedConstructionRecompileProof !== undefined
        || request.metadata?.managedConstructionStyleProof !== undefined
        || request.operations.length !== 1
        || request.operations[0]?.op !== 'source-patch'
        || request.operations[0].patches.length === 0
        || request.operations[0].patches.some((patch) => patch.insert.length === 0)
      )
    ) {
      return rejected(
        request,
        snapshot.revision,
        'invalid-request',
        'Typed Canvas construction batch must contain one atomic semantic source-patch operation.',
      );
    }

    const patches: TextPatch[] = [];
    for (const operation of request.operations) {
      if (operation.op !== 'source-patch') {
        return rejected(
          request,
          snapshot.revision,
          'unsupported-operation',
          '语义操作必须先由插件编译为 source-patch',
        );
      }
      for (const sourcePatch of operation.patches) {
        if (
          sourcePatch.sourceId !== sourceId
          || !isRange(sourcePatch.range)
          || sourcePatch.range.end > snapshot.source.length
        ) {
          return rejected(
            request,
            snapshot.revision,
            'source-range-conflict',
            '源码补丁范围无效',
          );
        }
        const patch: TextPatch = {
          from: sourcePatch.range.start,
          to: sourcePatch.range.end,
          insert: sourcePatch.insert,
        };
        const actual = snapshot.source.slice(patch.from, patch.to);
        if (
          sourcePatch.expectedText !== undefined
          && sourcePatch.expectedText !== actual
        ) {
          return rejected(
            request,
            snapshot.revision,
            'precondition-failed',
            '源码补丁 expectedText 已过期',
            'conflict',
          );
        }
        if (
          !containsExactAccess(validReadSet, sourceId, patch)
          || !containsExactAccess(validWriteSet, sourceId, patch)
        ) {
          return rejected(
            request,
            snapshot.revision,
            'source-range-conflict',
            '补丁范围未被 read/write set 精确声明',
          );
        }
        patches.push(patch);
      }
    }
    if (patches.length === 0) {
      return rejected(request, snapshot.revision, 'invalid-request', '事务没有源码补丁');
    }
    const requestSourceOrigin = sourceOriginForRequest(request);
    const managedConflict = managedPatchConflict(
      snapshot.source,
      patches,
      request,
      evidence,
    );
    if (managedConflict) {
      return rejected(
        request,
        snapshot.revision,
        'managed-construction-conflict',
        managedConflict,
      );
    }
    let candidateSource: string;
    try {
      candidateSource = applyTextPatches(snapshot.source, patches);
    } catch (error) {
      return rejected(
        request,
        snapshot.revision,
        'source-range-conflict',
        error instanceof Error ? error.message : '源码补丁相互冲突',
      );
    }
    if (requestSourceOrigin === 'ai') {
      const candidateBlocks = parseManagedConstructionBlocks(candidateSource);
      if (![
        'construction-plan-proposal/v1',
        AI_CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION,
        'ai-construction-intent-batch-proposal/v1',
        'managed-presentation-intent/v1',
        AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION,
        AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION,
        HOST_SEMANTIC_ACTION_BATCH_SCHEMA_VERSION,
        HOST_SEMANTIC_ACTION_SET_SCHEMA_VERSION,
      ].includes(String(request.metadata?.proposalSchemaVersion ?? ''))) {
        const directive = newlyIntroducedManagedDirective(
          snapshot.source,
          candidateSource,
        );
        if (directive) {
          return rejected(
            request,
            snapshot.revision,
            'managed-construction-conflict',
            `AI raw patches cannot introduce managed directives: ${directive}`,
          );
        }
      }
      const candidateIds = new Set<string>();
      const duplicateId = candidateBlocks.find((block) => {
        if (candidateIds.has(block.id)) return true;
        candidateIds.add(block.id);
        return false;
      })?.id;
      if (duplicateId) {
        return rejected(
          request,
          snapshot.revision,
          'managed-construction-conflict',
          `AI transaction would create duplicate managed construction ID ${duplicateId}.`,
        );
      }
      const previousIdCounts = new Map<string, number>();
      for (const block of parseManagedConstructionBlocks(snapshot.source)) {
        previousIdCounts.set(block.id, (previousIdCounts.get(block.id) ?? 0) + 1);
      }
      const createdBlocks = candidateBlocks
        .filter((block) => {
          const remaining = previousIdCounts.get(block.id) ?? 0;
          if (remaining === 0) return true;
          previousIdCounts.set(block.id, remaining - 1);
          return false;
        });
      const proposalSchemaVersion = request.metadata?.proposalSchemaVersion;
      let createConflict: string | null;
      if (proposalSchemaVersion === AI_CONSTRUCTION_DAG_INTENT_SCHEMA_VERSION) {
        createConflict = aiConstructionDagIntentProofConflict(
          snapshot.source,
          candidateSource,
          patches,
          createdBlocks,
          request,
          evidence,
        );
      } else if (proposalSchemaVersion === 'ai-construction-intent-batch-proposal/v1') {
        createConflict = aiConstructionIntentBatchProofConflict(
          snapshot.source,
          candidateSource,
          patches,
          createdBlocks,
          request,
          evidence,
        );
      } else if (proposalSchemaVersion === AI_SEMANTIC_DELETE_INTENT_SCHEMA_VERSION) {
        createConflict = createdBlocks.length === 0
          ? null
          : 'AI semantic deletes cannot create managed constructions.';
      } else if (proposalSchemaVersion === AI_SELECTION_TRANSFORM_INTENT_SCHEMA_VERSION) {
        createConflict = createdBlocks.length === 0
          ? null
          : 'AI selection transforms cannot create managed constructions.';
      } else if (proposalSchemaVersion === HOST_SEMANTIC_ACTION_BATCH_SCHEMA_VERSION) {
        createConflict = hostSemanticActionBatchCreateConflict(
          snapshot.source,
          candidateSource,
          patches,
          createdBlocks,
          request,
          evidence,
        );
      } else if (proposalSchemaVersion === HOST_SEMANTIC_ACTION_SET_SCHEMA_VERSION) {
        createConflict = hostSemanticActionSetCreateConflict(
          snapshot.source,
          candidateSource,
          patches,
          createdBlocks,
          request,
          evidence,
        );
      } else {
        createConflict = aiManagedCreateProofConflict(
          snapshot.source,
          candidateSource,
          patches[0]!,
          createdBlocks,
          request,
          evidence,
        );
      }
      if (createConflict) {
        return rejected(
          request,
          snapshot.revision,
          'managed-construction-conflict',
          createConflict,
        );
      }
    }
    if (request.origin === 'canvas') {
      const candidateBlocks = parseManagedConstructionBlocks(candidateSource);
      if (![
        'canvas-construction-batch-proposal/v1',
        'canvas-delete-proposal/v1',
        'canvas-point-move-proposal/v1',
        'canvas-selection-transform-proposal/v1',
        'inspector-style-proposal/v1',
      ].includes(String(request.metadata?.proposalSchemaVersion ?? ''))) {
        const directive = newlyIntroducedManagedDirective(
          snapshot.source,
          candidateSource,
        );
        if (directive) {
          return rejected(
            request,
            snapshot.revision,
            'managed-construction-conflict',
            `Canvas raw patches cannot introduce managed directives: ${directive}`,
          );
        }
      }
      const previousIdCounts = new Map<string, number>();
      for (const block of parseManagedConstructionBlocks(snapshot.source)) {
        previousIdCounts.set(block.id, (previousIdCounts.get(block.id) ?? 0) + 1);
      }
      const createdBlocks = candidateBlocks.filter((block) => {
        const remaining = previousIdCounts.get(block.id) ?? 0;
        if (remaining === 0) return true;
        previousIdCounts.set(block.id, remaining - 1);
        return false;
      });
      if (
        request.metadata?.proposalSchemaVersion
          === 'canvas-construction-batch-proposal/v1'
      ) {
        const candidateIds = candidateBlocks.map((block) => block.id);
        if (new Set(candidateIds).size !== candidateIds.length) {
          return rejected(
            request,
            snapshot.revision,
            'managed-construction-conflict',
            'Canvas construction batch would create a duplicate managed construction ID.',
          );
        }
      }
      const createConflict = canvasConstructionBatchProofConflict(
        snapshot.source,
        candidateSource,
        patches,
        createdBlocks,
        request,
        evidence.algorithm,
      );
      if (createConflict) {
        return rejected(
          request,
          snapshot.revision,
          'managed-construction-conflict',
          createConflict,
        );
      }
    }

    if (
      requestSourceOrigin !== 'keyboard'
      && requestSourceOrigin !== 'external'
      && requestSourceOrigin !== 'repair'
    ) {
      const referenceConflict = newlyIntroducedManagedReferenceIssue(
        snapshot.source,
        candidateSource,
      );
      if (referenceConflict) {
        return rejected(
          request,
          snapshot.revision,
          'managed-construction-conflict',
          referenceConflict,
        );
      }
    }

    const committed = this.document.applyPatches(
      patches,
      requestSourceOrigin,
      request.expectedRevision,
      {
        transactionId: request.transactionId,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint: fingerprint,
        documentId: request.documentId,
        documentEpoch: request.documentEpoch,
        sourceHash: request.sourceHash,
        hashAlgorithm: evidence.algorithm,
        readSet: validReadSet,
        writeSet: validWriteSet,
      },
    );
    if (!committed) {
      return rejected(
        request,
        this.document.getSnapshot().revision,
        'revision-mismatch',
        '提交前源码 revision 已变化',
        'conflict',
      );
    }
    const record = this.document.getTransactionByIdempotencyKey(request.idempotencyKey);
    return {
      ok: true,
      status: 'committed',
      transactionId: request.transactionId,
      idempotencyKey: request.idempotencyKey,
      fromRevision: request.expectedRevision,
      toRevision: record?.toRevision ?? request.expectedRevision + 1,
      record,
    };
  }

  commitPatches(input: CommitPatchTransactionInput): TikzTransactionBrokerResult {
    const snapshot = this.document.getSnapshot();
    const expectedRevision = input.expectedRevision ?? snapshot.revision;
    const sourceId = `${snapshot.documentId}:tikz`;
    const evidence: SourceHashEvidence = {
      hash: hashSource(snapshot.source),
      algorithm: 'fnv1a64-utf8',
      source: snapshot.source,
    };
    const patchIdentity = hashSource(JSON.stringify(input.patches));
    const transactionId = input.transactionId
      ?? `${input.origin}:${snapshot.documentId}:${snapshot.epoch}:${expectedRevision}:${patchIdentity}`;
    const idempotencyKey = input.idempotencyKey ?? transactionId;
    const resources = input.patches.map((patch) => ({
      kind: 'source-range' as const,
      sourceId,
      range: { start: patch.from, end: patch.to },
    }));
    const request: GeometryTransactionRequest = {
      schemaVersion: 'geometry-transaction/v1',
      transactionId,
      idempotencyKey,
      documentId: snapshot.documentId,
      documentEpoch: snapshot.epoch,
      origin: geometryOriginForSource(input.origin),
      stage: 'validated',
      expectedRevision,
      sourceHash: evidence.hash,
      readSet: resources,
      writeSet: resources,
      preconditions: input.patches.map((patch) => ({
        kind: 'source-slice-equals' as const,
        sourceId,
        range: { start: patch.from, end: patch.to },
        text: snapshot.source.slice(patch.from, patch.to),
      })),
      operations: [{
        op: 'source-patch',
        operationId: `${transactionId}:source`,
        patches: input.patches.map((patch) => ({
          sourceId,
          range: { start: patch.from, end: patch.to },
          insert: patch.insert,
          expectedText: snapshot.source.slice(patch.from, patch.to),
        })),
      }],
      metadata: { sourceEditOrigin: input.origin },
    };
    return this.commit(request, evidence);
  }
}
