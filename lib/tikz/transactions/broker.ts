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
import {
  managedConstructionDocumentReferenceIssueKey,
  managedConstructionDocumentReferenceIssues,
  parseManagedConstructionBlocks,
  type ManagedConstructionBlock,
} from '../semantics/managed-construction';

export interface SourceHashEvidence {
  hash: string;
  algorithm: string;
  /** Exact source material used to calculate `hash`. Never persisted. */
  source: string;
  /** Trusted semantic projection identity for guarded AI/Canvas writes. */
  kernelHash?: string;
  /** Trusted grammar/plugin bundle identity for guarded writes. */
  pluginSetDigest?: string;
}

export type TikzTransactionConflictCode =
  | 'document-mismatch'
  | 'document-epoch-mismatch'
  | 'idempotency-key-reused'
  | 'semantic-projection-stale'
  | 'revision-mismatch'
  | 'source-hash-mismatch'
  | 'kernel-hash-mismatch'
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
  if (
    declared === 'keyboard'
    || declared === 'ai'
    || declared === 'canvas'
    || declared === 'style'
    || declared === 'repair'
    || declared === 'external'
  ) return declared;
  if (request.origin === 'ai') return 'ai';
  if (request.origin === 'canvas') return 'canvas';
  if (request.origin === 'source') return 'keyboard';
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

function validManagedReplacement(
  insert: string,
  expectedBlockId: string,
): boolean {
  if (insert.length === 0) return true;
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

function managedPatchConflict(
  source: string,
  patches: readonly TextPatch[],
  request: GeometryTransactionRequest,
): string | null {
  const blocks = parseManagedConstructionBlocks(source);
  if (blocks.length === 0) return null;
  const origin = sourceOriginForRequest(request);

  for (const patch of patches) {
    for (const block of blocks) {
      if (!patchTouchesBlock(patch, block)) continue;
      if (replacesWholeBlock(patch, block)) {
        if (
          origin === 'ai'
          && (
            request.metadata?.proposalSchemaVersion !== 'construction-plan-proposal/v1'
            || patch.insert.length === 0
          )
        ) {
          return `AI may replace managed construction ${block.id} only through a typed construction-plan proposal; raw patches and deletion are forbidden.`;
        }
        if (
          origin === 'keyboard'
          || origin === 'external'
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
    if (
      request.expectedKernelHash !== undefined
      && request.expectedKernelHash !== evidence.kernelHash
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
