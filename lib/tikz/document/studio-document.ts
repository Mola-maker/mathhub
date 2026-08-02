import { Annotation, type TransactionSpec } from '@codemirror/state';
import type { Tree } from '@lezer/common';
import {
  applyTextPatch,
  applyTextPatches,
  assertTextPatch,
  minimalTextPatch,
  type TextPatch,
} from './source-transaction';

export {
  applyTextPatch,
  applyTextPatches,
  minimalTextPatch,
  rangePatch,
  type TextPatch,
} from './source-transaction';

export type SourceEditOrigin =
  | 'keyboard'
  | 'ai'
  | 'canvas'
  | 'style'
  | 'repair'
  | 'external';

export interface StudioSourceAccess {
  sourceId: string;
  from: number;
  to: number;
  expectedText?: string;
}

export interface StudioTransactionMetadata {
  transactionId?: string;
  idempotencyKey?: string;
  /** Canonical request material; excludes retry-local transaction metadata. */
  requestFingerprint?: string;
  documentId?: string;
  documentEpoch?: string;
  sourceHash?: string;
  hashAlgorithm?: string;
  readSet?: readonly StudioSourceAccess[];
  writeSet?: readonly StudioSourceAccess[];
}

export interface StudioTransactionRecord {
  transactionId: string;
  idempotencyKey: string;
  requestFingerprint?: string;
  fromRevision: number;
  toRevision: number;
  origin: SourceEditOrigin;
  sourceHash?: string;
  hashAlgorithm?: string;
  readSet: readonly StudioSourceAccess[];
  writeSet: readonly StudioSourceAccess[];
  patches: readonly TextPatch[];
  changedRangesAfter: readonly { start: number; end: number }[];
  motionHint: 'insert' | 'update' | 'delete' | 'batch';
  changeDesc: readonly number[] | null;
  committedAt: number;
}

export interface StudioDocumentSnapshot {
  documentId: string;
  epoch: string;
  source: string;
  revision: number;
  cstTree: Tree | null;
  lastTransaction: StudioTransactionRecord | null;
}

type EditorDispatch = (spec: TransactionSpec) => void;

export const studioEditOrigin = Annotation.define<SourceEditOrigin>();
export const studioTransactionMetadata =
  Annotation.define<StudioTransactionMetadata>();

let documentSequence = 0;

function createDocumentIdentity(prefix: string): string {
  documentSequence += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${prefix}-${Date.now().toString(36)}-${documentSequence.toString(36)}`;
}

export class StudioDocument {
  private snapshot: StudioDocumentSnapshot;
  private readonly listeners = new Set<() => void>();
  private editorDispatch: EditorDispatch | null = null;
  private readonly transactions: StudioTransactionRecord[] = [];
  private readonly idempotencyIndex = new Map<string, StudioTransactionRecord>();
  private transactionSequence = 0;

  constructor(
    initialSource: string,
    identity: { documentId?: string; epoch?: string } = {},
  ) {
    this.snapshot = {
      documentId: identity.documentId ?? createDocumentIdentity('tikz-document'),
      epoch: identity.epoch ?? createDocumentIdentity('epoch'),
      source: initialSource,
      revision: 0,
      cstTree: null,
      lastTransaction: null,
    };
  }

  getSnapshot = (): StudioDocumentSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getTransactionsSince(revision: number): readonly StudioTransactionRecord[] {
    return this.transactions.filter((transaction) => transaction.fromRevision >= revision);
  }

  hasAppliedIdempotencyKey(idempotencyKey: string): boolean {
    return this.idempotencyIndex.has(idempotencyKey);
  }

  getTransactionByIdempotencyKey(
    idempotencyKey: string,
  ): StudioTransactionRecord | null {
    return this.idempotencyIndex.get(idempotencyKey) ?? null;
  }

  attachEditor(dispatch: EditorDispatch): () => void {
    this.editorDispatch = dispatch;
    return () => {
      if (this.editorDispatch === dispatch) this.editorDispatch = null;
    };
  }

  commitFromEditor(
    source: string,
    origin: SourceEditOrigin,
    changeDesc: readonly number[] | null,
    patches?: readonly TextPatch[],
    cstTree?: Tree,
    metadata?: StudioTransactionMetadata,
  ): void {
    const before = this.snapshot;
    if (source === before.source) return;
    const fallbackPatch = minimalTextPatch(before.source, source);
    this.commit(
      source,
      origin,
      patches ?? (fallbackPatch ? [fallbackPatch] : []),
      changeDesc,
      cstTree ?? null,
      metadata,
    );
  }

  setCstTree(tree: Tree, expectedRevision: number): boolean {
    if (this.snapshot.revision !== expectedRevision) return false;
    if (this.snapshot.cstTree === tree) return true;
    this.snapshot = { ...this.snapshot, cstTree: tree };
    for (const listener of this.listeners) listener();
    return true;
  }

  replaceSource(
    source: string,
    origin: SourceEditOrigin,
    expectedRevision?: number,
  ): boolean {
    const before = this.snapshot;
    if (expectedRevision !== undefined && expectedRevision !== before.revision) return false;
    const patch = minimalTextPatch(before.source, source);
    if (!patch) return true;
    return this.applyPatch(patch, origin, expectedRevision);
  }

  applyPatch(
    patch: TextPatch,
    origin: SourceEditOrigin,
    expectedRevision?: number,
    metadata?: StudioTransactionMetadata,
  ): boolean {
    return this.applyPatches([patch], origin, expectedRevision, metadata);
  }

  applyPatches(
    patches: readonly TextPatch[],
    origin: SourceEditOrigin,
    expectedRevision?: number,
    metadata?: StudioTransactionMetadata,
  ): boolean {
    const before = this.snapshot;
    if (
      metadata?.documentId !== undefined
      && metadata.documentId !== before.documentId
    ) return false;
    if (
      metadata?.documentEpoch !== undefined
      && metadata.documentEpoch !== before.epoch
    ) return false;
    if (
      metadata?.idempotencyKey
      && this.idempotencyIndex.has(metadata.idempotencyKey)
    ) {
      const existing = this.idempotencyIndex.get(metadata.idempotencyKey);
      return metadata.requestFingerprint !== undefined
        && existing?.requestFingerprint === metadata.requestFingerprint;
    }
    if (expectedRevision !== undefined && expectedRevision !== before.revision) return false;
    for (const patch of patches) assertTextPatch(before.source, patch);
    if (patches.length === 0) return true;
    const nextSource = applyTextPatches(before.source, patches);

    if (this.editorDispatch) {
      this.editorDispatch({
        changes: [...patches].sort((a, b) => a.from - b.from || a.to - b.to),
        annotations: [
          studioEditOrigin.of(origin),
          studioTransactionMetadata.of(metadata ?? {}),
        ],
      });
      return true;
    }

    this.commit(nextSource, origin, patches, null, null, metadata);
    return true;
  }

  private commit(
    source: string,
    origin: SourceEditOrigin,
    patches: readonly TextPatch[],
    changeDesc: readonly number[] | null,
    cstTree: Tree | null,
    metadata?: StudioTransactionMetadata,
  ): void {
    const before = this.snapshot;
    const revision = before.revision + 1;
    const sortedPatches = [...patches].sort((a, b) => a.from - b.from || a.to - b.to);
    let delta = 0;
    const changedRangesAfter = sortedPatches.map((patch) => {
      const start = patch.from + delta;
      const end = start + patch.insert.length;
      delta += patch.insert.length - (patch.to - patch.from);
      return { start, end };
    });
    const onlyPatch = sortedPatches.length === 1 ? sortedPatches[0] : null;
    const motionHint = sortedPatches.length > 1
      ? 'batch'
      : onlyPatch?.from === onlyPatch?.to
        ? 'insert'
        : onlyPatch?.insert.length === 0
          ? 'delete'
          : 'update';
    this.transactionSequence += 1;
    const sourceId = `${before.documentId}:tikz`;
    const defaultAccess = sortedPatches.map((patch): StudioSourceAccess => ({
      sourceId,
      from: patch.from,
      to: patch.to,
      expectedText: before.source.slice(patch.from, patch.to),
    }));
    const transactionId = metadata?.transactionId
      ?? `${revision}:${this.transactionSequence}:${origin}`;
    const idempotencyKey = metadata?.idempotencyKey ?? transactionId;
    const transaction: StudioTransactionRecord = {
      transactionId,
      idempotencyKey,
      requestFingerprint: metadata?.requestFingerprint,
      fromRevision: before.revision,
      toRevision: revision,
      origin,
      sourceHash: metadata?.sourceHash,
      hashAlgorithm: metadata?.hashAlgorithm,
      readSet: metadata?.readSet ?? defaultAccess,
      writeSet: metadata?.writeSet ?? defaultAccess,
      patches: sortedPatches,
      changedRangesAfter,
      motionHint,
      changeDesc,
      committedAt: Date.now(),
    };
    this.snapshot = {
      documentId: before.documentId,
      epoch: before.epoch,
      source,
      revision,
      cstTree,
      lastTransaction: transaction,
    };
    this.transactions.push(transaction);
    this.idempotencyIndex.set(idempotencyKey, transaction);
    if (this.transactions.length > 256) {
      const evicted = this.transactions.shift();
      if (
        evicted
        && this.idempotencyIndex.get(evicted.idempotencyKey) === evicted
      ) {
        this.idempotencyIndex.delete(evicted.idempotencyKey);
      }
    }
    for (const listener of this.listeners) listener();
  }
}
