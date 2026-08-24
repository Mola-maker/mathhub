import type {
  GeometryRevisionBasis,
  JsonObject,
  SourceRange,
  SourceTextPatch,
} from './model';
import type {
  GeometryOperation,
  GeometryPrecondition,
  GeometryResourceReference,
  GeometryTransactionRequest,
} from './transactions';
import { createGeometryWorkspaceEdit } from './geometry-workspace-edit';
import { applyTextPatches } from '../document/source-transaction';
import { parseManagedConstructionBlocks } from '../semantics/managed-construction';

/**
 * A narrow, source-preserving write protocol for AI.
 *
 * The proposal is intentionally not a document replacement format. Every
 * operation is scoped to a source binding and is compiled into the existing
 * geometry transaction protocol only after all binding and compare-and-swap
 * guards have been checked.
 */
export const AI_PATCH_PROPOSAL_SCHEMA_VERSION = 'ai-patch-proposal/v1' as const;

export type AiPatchOperationKind = 'insert' | 'replace' | 'delete';
export type AiPatchInsertionPolicy =
  | 'none'
  | 'tikzpicture-body'
  | 'full-document';

export interface AiPatchProposalBasis extends GeometryRevisionBasis {
  /** The source identity used by every operation in this proposal. */
  sourceId: string;
  hashAlgorithm: string;
}

export interface AiPatchBindingContext {
  /** Semantic construction-binding ID, not a statement index. */
  bindingId: string;
  sourceId: string;
  range: SourceRange;
  writable: boolean;
  opaque: boolean;
  insertionPolicy: AiPatchInsertionPolicy;
  /** Optional source slice hash supplied by the caller's verified projection. */
  sliceHash?: string;
  /** Semantic writes are separate from raw byte writability. */
  writeCapabilities?: readonly (
    | 'create-managed-construction'
    | 'replace-managed-construction'
    | 'update-managed-presentation'
  )[];
  managedConstructionId?: string;
  managedPlanKind?: string;
  /** Concrete managed syntax kind (point/segment/circle/...). */
  managedSyntaxKind?: string;
  managedContentFingerprint?: string;
  /** CAS token for a losslessly hydrated non-canonical presentation body. */
  managedPresentationFingerprint?: string;
  managedWriterId?: string;
  managedWriterRevision?: number;
  managedWriterSlotIds?: readonly string[];
  managedWriterSlotSemanticFingerprints?: readonly string[];
  managedAttachmentsFingerprint?: string;
  /** Revision-bound CAS token for the trusted document create capability. */
  createCapabilityFingerprint?: string;
}

export interface AiPatchBindingPreconditions {
  /** Must equal the binding's current source identity. */
  sourceId: string;
  /** Must equal the operation range exactly. */
  range: SourceRange;
  /** AI writes must explicitly opt into a writable binding. */
  writable: boolean;
  /** Opaque construction must never be edited by this protocol. */
  opaque: boolean;
}

export interface AiPatchOperation {
  operationId: string;
  kind: AiPatchOperationKind;
  bindingId: string;
  sourceId: string;
  range: SourceRange;
  /** Empty for delete; inserted source for insert/replace. */
  insert: string;
  /** Exactly one compare-and-swap guard is required. */
  expectedText?: string;
  expectedSliceHash?: string;
  preconditions: AiPatchBindingPreconditions;
}

export interface AiPatchProposal {
  schemaVersion: typeof AI_PATCH_PROPOSAL_SCHEMA_VERSION;
  proposalId: string;
  idempotencyKey: string;
  basis: AiPatchProposalBasis;
  /** Primary objects the model is editing. Must be a subset of read scope. */
  focusBindingIds: readonly string[];
  /** Construction bindings read while producing this patch. */
  readBindingIds: readonly string[];
  operations: readonly AiPatchOperation[];
  rationale?: string;
  metadata?: JsonObject;
}

export interface AiPatchValidationContext {
  /** The already verified current document basis. */
  basis: AiPatchProposalBasis;
  bindings: readonly AiPatchBindingContext[] | ReadonlyMap<string, AiPatchBindingContext>;
  /** Immutable least-privilege scope selected by the trusted caller. */
  allowedBindingIds: readonly string[];
  /** Optional source text enables local expectedText/hash verification. */
  source?: string;
  /** Hash implementation matching the source projection's declared algorithm. */
  hashSource?: (source: string) => string;
  hashSlice?: (source: string) => string;
}

export type AiPatchValidationErrorCode =
  | 'invalid-shape'
  | 'schema-version'
  | 'invalid-identity'
  | 'basis-mismatch'
  | 'binding-scope'
  | 'binding-precondition'
  | 'range-invalid'
  | 'range-outside-binding'
  | 'expected-guard'
  | 'expected-text-mismatch'
  | 'expected-slice-hash-mismatch'
  | 'insertion-policy'
  | 'overlapping-operations'
  | 'operation-kind'
  | 'plan-invalid';

export interface AiPatchValidationError {
  code: AiPatchValidationErrorCode;
  message: string;
  operationId?: string;
  operationIndex?: number;
  bindingId?: string;
}

export interface ValidatedAiPatchProposal {
  ok: true;
  proposal: AiPatchProposal;
  bindings: ReadonlyMap<string, AiPatchBindingContext>;
}

export interface InvalidAiPatchProposal {
  ok: false;
  errors: readonly AiPatchValidationError[];
}

export type AiPatchValidationResult =
  | ValidatedAiPatchProposal
  | InvalidAiPatchProposal;

export interface AiPatchCompileOptions {
  /** Optional actor/correlation information for the kernel transaction. */
  actorId?: string;
  correlationId?: string;
  pluginSetDigest?: string;
  expectedKernelHash?: string;
  metadata?: JsonObject;
}

export interface CompiledAiPatchProposal {
  ok: true;
  transaction: GeometryTransactionRequest;
  proposal: AiPatchProposal;
}

export interface FailedAiPatchCompilation {
  ok: false;
  errors: readonly AiPatchValidationError[];
}

export type AiPatchCompilationResult =
  | CompiledAiPatchProposal
  | FailedAiPatchCompilation;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);
}

function validRange(range: unknown): range is SourceRange {
  return isRecord(range)
    && finiteInteger(range.start)
    && finiteInteger(range.end)
    && range.start >= 0
    && range.end >= range.start;
}

function sameRange(left: SourceRange, right: SourceRange): boolean {
  return left.start === right.start && left.end === right.end;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function bindingMap(
  bindings: readonly AiPatchBindingContext[] | ReadonlyMap<string, AiPatchBindingContext>,
): ReadonlyMap<string, AiPatchBindingContext> {
  // Array.isArray does not narrow a readonly array out of this union, so test
  // for a Map-only member instead.
  if ('get' in bindings) return bindings;
  return new Map(bindings.map((binding): [string, AiPatchBindingContext] => [binding.bindingId, binding]));
}

function uniqueStrings(values: unknown): values is readonly string[] {
  return Array.isArray(values)
    && values.every((value) => typeof value === 'string' && value.length > 0)
    && new Set(values).size === values.length;
}

function basisMatches(
  proposal: AiPatchProposalBasis,
  current: AiPatchProposalBasis,
): boolean {
  return proposal.documentId === current.documentId
    && proposal.epoch === current.epoch
    && proposal.revision === current.revision
    && proposal.sourceHash === current.sourceHash
    && proposal.sourceId === current.sourceId
    && proposal.hashAlgorithm === current.hashAlgorithm
    && (proposal.kernelHash === undefined || proposal.kernelHash === current.kernelHash)
    && (proposal.projectionHash === undefined || proposal.projectionHash === current.projectionHash)
    && proposal.pluginSetDigest === current.pluginSetDigest;
}

function operationRangeInsideBinding(
  operation: AiPatchOperation,
  binding: AiPatchBindingContext,
): boolean {
  if (operation.kind === 'insert') {
    return operation.range.start === operation.range.end
      && operation.range.start >= binding.range.start
      && operation.range.start <= binding.range.end;
  }
  return operation.range.start >= binding.range.start
    && operation.range.end <= binding.range.end;
}

function overlap(
  left: AiPatchOperation,
  right: AiPatchOperation,
): boolean {
  const leftInsert = left.range.start === left.range.end;
  const rightInsert = right.range.start === right.range.end;
  if (leftInsert && rightInsert) return left.range.start === right.range.start;
  if (leftInsert) return left.range.start >= right.range.start && left.range.start < right.range.end;
  if (rightInsert) return right.range.start >= left.range.start && right.range.start < left.range.end;
  return left.range.start < right.range.end && right.range.start < left.range.end;
}

function sourceSlice(
  source: string | undefined,
  range: SourceRange,
): string | undefined {
  return source === undefined ? undefined : source.slice(range.start, range.end);
}

interface TikzpictureEnvironmentMarker {
  kind: 'begin' | 'end';
  start: number;
  end: number;
}

function skipTexComment(source: string, start: number): number {
  let index = start;
  while (
    index < source.length
    && source[index] !== '\n'
    && source[index] !== '\r'
  ) {
    index += 1;
  }
  return index;
}

function skipTexTrivia(source: string, start: number): number {
  let index = start;
  for (;;) {
    while (index < source.length && /\s/u.test(source[index])) index += 1;
    if (source[index] !== '%') return index;
    index = skipTexComment(source, index + 1);
  }
}

function readEnvironmentName(
  source: string,
  start: number,
): { name: string; end: number } | null {
  let index = skipTexTrivia(source, start);
  if (source[index] !== '{') return null;
  index += 1;
  let depth = 1;
  let name = '';
  while (index < source.length && depth > 0) {
    const character = source[index];
    if (character === '%') {
      index = skipTexComment(source, index + 1);
      continue;
    }
    if (character === '{') {
      depth += 1;
      if (depth > 1) name += character;
      index += 1;
      continue;
    }
    if (character === '}') {
      depth -= 1;
      if (depth > 0) name += character;
      index += 1;
      continue;
    }
    name += character;
    index += 1;
  }
  if (depth !== 0) return null;
  return {
    name: name.replace(/\s/gu, ''),
    end: index,
  };
}

function tikzpictureEnvironmentMarkers(
  source: string,
): readonly TikzpictureEnvironmentMarker[] {
  const markers: TikzpictureEnvironmentMarker[] = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] === '%') {
      index = skipTexComment(source, index + 1);
      continue;
    }
    if (source[index] !== '\\') {
      index += 1;
      continue;
    }
    const commandStart = index;
    index += 1;
    if (!/[A-Za-z@]/u.test(source[index] ?? '')) {
      index += 1;
      continue;
    }
    const wordStart = index;
    while (/[A-Za-z@]/u.test(source[index] ?? '')) index += 1;
    const command = source.slice(wordStart, index);
    if (command !== 'begin' && command !== 'end') continue;
    const environment = readEnvironmentName(source, index);
    if (!environment) continue;
    index = environment.end;
    if (environment.name !== 'tikzpicture') continue;
    markers.push({
      kind: command,
      start: commandStart,
      end: environment.end,
    });
  }
  return markers;
}

function texTriviaOnly(source: string, start: number, end: number): boolean {
  return skipTexTrivia(source.slice(start, end), 0) === end - start;
}

function hasTikzpictureEnvironment(source: string): boolean {
  return tikzpictureEnvironmentMarkers(source).length > 0;
}

function isSingleTikzpictureDocument(source: string): boolean {
  const markers = tikzpictureEnvironmentMarkers(source);
  return (
    markers.length === 2
    && markers[0].kind === 'begin'
    && markers[1].kind === 'end'
    && markers[0].end <= markers[1].start
    && texTriviaOnly(source, 0, markers[0].start)
    && texTriviaOnly(source, markers[1].end, source.length)
  );
}

function operationError(
  code: AiPatchValidationErrorCode,
  message: string,
  index: number,
  operation: Partial<AiPatchOperation> | undefined,
): AiPatchValidationError {
  return {
    code,
    message,
    operationIndex: index,
    ...(typeof operation?.operationId === 'string' ? { operationId: operation.operationId } : {}),
    ...(typeof operation?.bindingId === 'string' ? { bindingId: operation.bindingId } : {}),
  };
}

/**
 * Validate an untrusted AI proposal without mutating document or kernel state.
 * The caller may omit `source` when it has already verified the basis hash;
 * any expected guard is still carried into the compiled transaction.
 */
export function validateAiPatchProposal(
  value: unknown,
  context: AiPatchValidationContext,
): AiPatchValidationResult {
  const errors: AiPatchValidationError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [{ code: 'invalid-shape', message: 'AI patch proposal must be an object' }] };
  }
  if (value.schemaVersion !== AI_PATCH_PROPOSAL_SCHEMA_VERSION) {
    errors.push({ code: 'schema-version', message: `Unsupported proposal schema: ${String(value.schemaVersion)}` });
  }

  const proposal = value as Partial<AiPatchProposal>;
  if (!nonEmptyString(proposal.proposalId) || !nonEmptyString(proposal.idempotencyKey)) {
    errors.push({ code: 'invalid-identity', message: 'proposalId and idempotencyKey are required' });
  }
  if (!isRecord(proposal.basis)
    || !nonEmptyString(proposal.basis.documentId)
    || !nonEmptyString(proposal.basis.epoch)
    || !finiteInteger(proposal.basis.revision)
    || proposal.basis.revision < 0
    || !nonEmptyString(proposal.basis.sourceHash)
    || !nonEmptyString(proposal.basis.sourceId)
    || !nonEmptyString(proposal.basis.hashAlgorithm)) {
    errors.push({ code: 'invalid-identity', message: 'basis must include documentId, epoch, revision, sourceHash, sourceId and hashAlgorithm' });
  } else if (!basisMatches(proposal.basis as AiPatchProposalBasis, context.basis)) {
    errors.push({ code: 'basis-mismatch', message: 'Proposal basis is stale or belongs to another document' });
  }
  if (!uniqueStrings(proposal.focusBindingIds) || !uniqueStrings(proposal.readBindingIds)) {
    errors.push({ code: 'binding-scope', message: 'focusBindingIds and readBindingIds must be unique string arrays' });
  }
  if (
    uniqueStrings(proposal.focusBindingIds)
    && uniqueStrings(proposal.readBindingIds)
  ) {
    const read = new Set(proposal.readBindingIds);
    for (const bindingId of proposal.focusBindingIds) {
      if (!read.has(bindingId)) {
        errors.push({ code: 'binding-scope', message: `Focus binding ${bindingId} is not in read scope`, bindingId });
      }
    }
  }
  if (!Array.isArray(proposal.operations) || proposal.operations.length === 0) {
    errors.push({ code: 'invalid-shape', message: 'operations must contain at least one source patch' });
  }

  const bindings = bindingMap(context.bindings);
  const allowedBindingIds = new Set(context.allowedBindingIds);
  if (
    !uniqueStrings(context.allowedBindingIds)
    || [...allowedBindingIds].some((bindingId) => !bindings.has(bindingId))
  ) {
    errors.push({
      code: 'binding-scope',
      message: 'Trusted allowedBindingIds must be unique and refer to known bindings',
    });
  }
  if (uniqueStrings(proposal.focusBindingIds) && uniqueStrings(proposal.readBindingIds)) {
    for (const bindingId of [...proposal.focusBindingIds, ...proposal.readBindingIds]) {
      if (!bindings.has(bindingId)) {
        errors.push({ code: 'binding-scope', message: `Unknown source binding in read scope: ${bindingId}`, bindingId });
      } else if (!allowedBindingIds.has(bindingId)) {
        errors.push({ code: 'binding-scope', message: `Source binding is outside the authorized scope: ${bindingId}`, bindingId });
      }
    }
  }
  const operations: AiPatchOperation[] = [];
  if (Array.isArray(proposal.operations)) {
    const operationIds = new Set<string>();
    proposal.operations.forEach((candidate, index) => {
      if (!isRecord(candidate)) {
        errors.push(operationError('invalid-shape', 'Operation must be an object', index, undefined));
        return;
      }
      const operation = candidate as Partial<AiPatchOperation>;
      const operationId = operation.operationId;
      const bindingId = operation.bindingId;
      if (!nonEmptyString(operationId) || operationIds.has(operationId)) {
        errors.push(operationError('invalid-identity', 'operationId must be unique and non-empty', index, operation));
      } else {
        operationIds.add(operationId);
      }
      if (!nonEmptyString(bindingId)) {
        errors.push(operationError('binding-scope', 'bindingId is required', index, operation));
      }
      const binding = typeof bindingId === 'string' ? bindings.get(bindingId) : undefined;
      if (!binding) {
        errors.push(operationError('binding-scope', `Unknown source binding: ${String(bindingId)}`, index, operation));
      } else if (!allowedBindingIds.has(binding.bindingId)) {
        errors.push(operationError('binding-scope', `Source binding is outside the authorized scope: ${binding.bindingId}`, index, operation));
      }
      if (operation.kind !== 'insert' && operation.kind !== 'replace' && operation.kind !== 'delete') {
        errors.push(operationError('operation-kind', 'kind must be insert, replace, or delete', index, operation));
      }
      if (!validRange(operation.range)) {
        errors.push(operationError('range-invalid', 'range must be a non-negative half-open range', index, operation));
      }
      if (typeof operation.sourceId !== 'string' || !operation.sourceId) {
        errors.push(operationError('binding-precondition', 'sourceId is required', index, operation));
      }
      if (typeof operation.insert !== 'string') {
        errors.push(operationError('invalid-shape', 'insert must be a string', index, operation));
      }
      const hasExpectedText = typeof operation.expectedText === 'string';
      const hasExpectedSliceHash = typeof operation.expectedSliceHash === 'string' && operation.expectedSliceHash.length > 0;
      if (hasExpectedText === hasExpectedSliceHash) {
        errors.push(operationError('expected-guard', 'Provide exactly one of expectedText or expectedSliceHash', index, operation));
      } else if (
        hasExpectedSliceHash
        && (context.source === undefined || !context.hashSlice)
      ) {
        errors.push(operationError(
          'expected-guard',
          'expectedSliceHash requires trusted source text and a hashSlice verifier',
          index,
          operation,
        ));
      }
      const preconditions = operation.preconditions;
      if (!isRecord(preconditions)
        || typeof preconditions.sourceId !== 'string'
        || !validRange(preconditions.range)
        || typeof preconditions.writable !== 'boolean'
        || typeof preconditions.opaque !== 'boolean') {
        errors.push(operationError('binding-precondition', 'sourceId, range, writable, and opaque preconditions are required', index, operation));
      }

      if (!binding || !validRange(operation.range)) return;
      const range = operation.range as SourceRange;
      if (!operationRangeInsideBinding(operation as AiPatchOperation, binding)) {
        errors.push(operationError('range-outside-binding', 'Operation range must stay inside its source binding', index, operation));
      }
      if (operation.sourceId !== context.basis.sourceId || operation.sourceId !== binding.sourceId) {
        errors.push(operationError('binding-precondition', 'Operation sourceId does not match the verified source', index, operation));
      }
      if (
        !isRecord(preconditions)
        || preconditions.sourceId !== binding.sourceId
        || !validRange(preconditions.range)
        || !sameRange(preconditions.range as SourceRange, range)
        || preconditions.writable !== binding.writable
        || preconditions.opaque !== binding.opaque
        || preconditions.writable !== true
        || preconditions.opaque !== false
      ) {
        errors.push(operationError('binding-precondition', 'Binding must be writable, non-opaque, and match source/range preconditions', index, operation));
      }
      if (operation.kind === 'insert' && (range.start !== range.end || operation.insert === '')) {
        errors.push(operationError('operation-kind', 'Insert requires a non-empty insertion point', index, operation));
      }
      if (operation.kind === 'replace' && (range.start === range.end || operation.insert === '')) {
        errors.push(operationError('operation-kind', 'Replace requires a non-empty range and inserted text', index, operation));
      }
      if (operation.kind === 'delete' && (range.start === range.end || operation.insert !== '')) {
        errors.push(operationError('operation-kind', 'Delete requires a non-empty range and empty insert', index, operation));
      }
      if (binding.insertionPolicy === 'full-document') {
        if (
          operation.kind !== 'insert'
          || context.source === undefined
          || context.source.trim() !== ''
          || range.start !== 0
          || range.end !== 0
          || typeof operation.insert !== 'string'
          || !isSingleTikzpictureDocument(operation.insert)
        ) {
          errors.push(operationError(
            'insertion-policy',
            'An empty document requires exactly one complete tikzpicture environment',
            index,
            operation,
          ));
        }
      } else if (
        binding.insertionPolicy === 'tikzpicture-body'
        && typeof operation.insert === 'string'
        && hasTikzpictureEnvironment(operation.insert)
      ) {
        errors.push(operationError(
          'insertion-policy',
          'A non-empty document insertion must contain tikzpicture body statements only',
          index,
          operation,
        ));
      }

      const slice = sourceSlice(context.source, range);
      if (context.source !== undefined && range.end > context.source.length) {
        errors.push(operationError('range-invalid', 'Operation range exceeds the verified source length', index, operation));
      }
      if (slice !== undefined && hasExpectedText && operation.expectedText !== slice) {
        errors.push(operationError('expected-text-mismatch', 'expectedText does not match the current source slice', index, operation));
      }
      if (slice !== undefined && hasExpectedSliceHash && context.hashSlice && operation.expectedSliceHash !== context.hashSlice(slice)) {
        errors.push(operationError('expected-slice-hash-mismatch', 'expectedSliceHash does not match the current source slice', index, operation));
      }
      operations.push(operation as AiPatchOperation);
    });
  }

  if (uniqueStrings(proposal.readBindingIds)) {
    const read = new Set(proposal.readBindingIds);
    for (const operation of operations) {
      if (!read.has(operation.bindingId)) {
        errors.push({
          code: 'binding-scope',
          message: `Operation ${operation.operationId} is outside read scope`,
          operationId: operation.operationId,
          bindingId: operation.bindingId,
        });
      }
    }
  }

  if (context.source !== undefined && context.hashSource && context.hashSource(context.source) !== context.basis.sourceHash) {
    errors.push({ code: 'basis-mismatch', message: 'Verified source text does not match basis.sourceHash' });
  }

  const ordered = [...operations].sort((left, right) => (
    left.range.start - right.range.start
    || left.range.end - right.range.end
    || left.operationId.localeCompare(right.operationId)
  ));
  for (let index = 1; index < ordered.length; index += 1) {
    if (overlap(ordered[index - 1], ordered[index])) {
      errors.push({
        code: 'overlapping-operations',
        message: `Operations ${ordered[index - 1].operationId} and ${ordered[index].operationId} overlap`,
        operationId: ordered[index].operationId,
      });
    }
  }

  if (context.source !== undefined && errors.length === 0) {
    try {
      const previousCounts = new Map<string, number>();
      for (const block of parseManagedConstructionBlocks(context.source)) {
        previousCounts.set(block.id, (previousCounts.get(block.id) ?? 0) + 1);
      }
      const candidate = applyTextPatches(
        context.source,
        operations.map((operation) => ({
          from: operation.range.start,
          to: operation.range.end,
          insert: operation.insert,
        })),
      );
      const createsManagedBlock = parseManagedConstructionBlocks(candidate)
        .some((block) => {
          const remaining = previousCounts.get(block.id) ?? 0;
          if (remaining === 0) return true;
          previousCounts.set(block.id, remaining - 1);
          return false;
        });
      if (createsManagedBlock) {
        errors.push({
          code: 'operation-kind',
          message: 'Raw AI patches cannot create managed constructions; use construction-plan-proposal/v1.',
        });
      }
    } catch (error) {
      errors.push({
        code: 'overlapping-operations',
        message: error instanceof Error
          ? error.message
          : 'Raw AI patch set cannot be applied atomically.',
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, proposal: proposal as AiPatchProposal, bindings };
}

function sourceRangeReference(sourceId: string, range: SourceRange, sliceHash?: string): GeometryResourceReference {
  return {
    kind: 'source-range',
    sourceId,
    range,
    ...(sliceHash ? { sliceHash } : {}),
  };
}

function sourceSlicePrecondition(operation: AiPatchOperation): GeometryPrecondition {
  return {
    kind: 'source-slice-equals',
    sourceId: operation.sourceId,
    range: operation.range,
    ...(operation.expectedText !== undefined ? { text: operation.expectedText } : {}),
    ...(operation.expectedSliceHash !== undefined ? { sliceHash: operation.expectedSliceHash } : {}),
  };
}

/**
 * Compile a validated proposal into the kernel's existing transaction format.
 * Binding authorization is validated above, then lowered to the source-only
 * read/write set understood by the Studio Broker. The validated semantic read
 * scope and binding preconditions remain in immutable transaction metadata so
 * a future persistent coordinator can attest the same decision without making
 * the source Broker accept unverified semantic resources.
 */
export function compileAiPatchProposal(
  proposal: unknown,
  context: AiPatchValidationContext,
  options: AiPatchCompileOptions = {},
): AiPatchCompilationResult {
  const validated = validateAiPatchProposal(proposal, context);
  if (!validated.ok) return validated;

  const { proposal: valid } = validated;
  const patches: SourceTextPatch[] = valid.operations.map((operation) => ({
    sourceId: operation.sourceId,
    range: operation.range,
    insert: operation.insert,
    ...(operation.expectedText !== undefined ? { expectedText: operation.expectedText } : {}),
    ...(operation.expectedSliceHash !== undefined ? { expectedSliceHash: operation.expectedSliceHash } : {}),
  }));

  const sourceReadSet = valid.operations.map((operation) => sourceRangeReference(
    operation.sourceId,
    operation.range,
    operation.expectedSliceHash,
  ));
  const readSet: GeometryResourceReference[] = sourceReadSet;
  const writeSet: GeometryResourceReference[] = valid.operations.map((operation) => sourceRangeReference(
    operation.sourceId,
    operation.range,
    operation.expectedSliceHash,
  ));

  const preconditions: GeometryPrecondition[] = [];
  valid.operations.forEach((operation) => {
    preconditions.push(sourceSlicePrecondition(operation));
  });

  const sourceOperation = {
    operationId: `${valid.proposalId}:source-patch`,
    op: 'source-patch',
    patches,
    preconditions,
  } satisfies GeometryOperation;
  const workspaceEdit = createGeometryWorkspaceEdit([sourceOperation], [{
    operationId: sourceOperation.operationId,
    label: 'Apply AI TikZ edit',
    description: `${patches.length} source patch${patches.length === 1 ? '' : 'es'} will be applied atomically.`,
    patchAnnotations: valid.operations.map((operation) => ({
      label: operation.kind === 'insert'
        ? 'Add TikZ geometry'
        : operation.kind === 'delete'
          ? 'Delete TikZ geometry'
          : 'Modify TikZ geometry',
      description: `Update the attested source binding ${operation.bindingId}.`,
    })),
  }]);
  const transaction: GeometryTransactionRequest = {
    schemaVersion: 'geometry-transaction/v1',
    transactionId: valid.proposalId,
    idempotencyKey: valid.idempotencyKey,
    documentId: valid.basis.documentId,
    documentEpoch: valid.basis.epoch,
    origin: 'ai',
    stage: 'proposed',
    expectedRevision: valid.basis.revision,
    sourceHash: valid.basis.sourceHash,
    ...(options.expectedKernelHash ?? valid.basis.kernelHash
      ? { expectedKernelHash: options.expectedKernelHash ?? valid.basis.kernelHash }
      : {}),
    ...(valid.basis.projectionHash
      ? { expectedProjectionHash: valid.basis.projectionHash }
      : {}),
    ...(options.pluginSetDigest ?? valid.basis.pluginSetDigest
      ? { pluginSetDigest: options.pluginSetDigest ?? valid.basis.pluginSetDigest }
      : {}),
    readSet,
    writeSet,
    preconditions,
    operations: [sourceOperation],
    workspaceEdit,
    ...(options.actorId ? { actorId: options.actorId } : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    metadata: {
      ...(valid.metadata ?? {}),
      ...(options.metadata ?? {}),
      proposalSchemaVersion: AI_PATCH_PROPOSAL_SCHEMA_VERSION,
      proposalId: valid.proposalId,
      focusBindingIds: valid.focusBindingIds,
      readBindingIds: valid.readBindingIds,
      semanticReadSet: [...new Set([
        ...valid.readBindingIds,
        ...valid.focusBindingIds,
      ])].map((bindingId) => ({
        recordType: 'source-binding',
        id: bindingId,
      })),
      bindingPreconditions: valid.operations.map((operation) => ({
        bindingId: operation.bindingId,
        sourceId: operation.preconditions.sourceId,
        range: {
          start: operation.preconditions.range.start,
          end: operation.preconditions.range.end,
        },
        writable: operation.preconditions.writable,
        opaque: operation.preconditions.opaque,
      })),
      sourceId: valid.basis.sourceId,
      ...(valid.basis.hashAlgorithm ? { hashAlgorithm: valid.basis.hashAlgorithm } : {}),
    },
  };

  return { ok: true, transaction, proposal: valid };
}

/** Narrow runtime guard for callers receiving JSON from an AI provider. */
export function isAiPatchProposal(value: unknown): value is AiPatchProposal {
  return isRecord(value) && value.schemaVersion === AI_PATCH_PROPOSAL_SCHEMA_VERSION;
}
