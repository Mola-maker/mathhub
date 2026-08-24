export const TIKZ_ASYNC_WORK_ITEM_SCHEMA_VERSION =
  'tikz-async-work-item/v1' as const;

export type TikzAsyncWorkKind =
  | 'constraint-solve'
  | 'exact-render'
  | 'visual-audit';

export type TikzAsyncWorkStatus =
  | 'queued'
  | 'running'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface TikzAsyncWorkBasis {
  readonly documentId: string;
  readonly epoch: string;
  readonly sourceId: string;
  readonly revision: number;
  readonly sourceHash: string;
  readonly pluginSetDigest?: string;
  readonly kernelHash?: string;
  readonly projectionHash?: string;
}

export interface TikzAsyncWorkItem<
  Kind extends TikzAsyncWorkKind = TikzAsyncWorkKind,
> {
  readonly schemaVersion: typeof TIKZ_ASYNC_WORK_ITEM_SCHEMA_VERSION;
  readonly itemId: string;
  readonly kind: Kind;
  readonly basis: TikzAsyncWorkBasis;
  readonly status: TikzAsyncWorkStatus;
  readonly requestedAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
  readonly ownerRunId?: string;
  readonly ownerMessageId?: string;
  readonly errorCode?: string;
}

let fallbackWorkItemSequence = 0;

export function createTikzAsyncWorkItemId(kind: TikzAsyncWorkKind): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${kind}:${globalThis.crypto.randomUUID()}`;
  }
  fallbackWorkItemSequence += 1;
  return `${kind}:${Date.now().toString(36)}:${fallbackWorkItemSequence.toString(36)}`;
}

export function sameTikzAsyncWorkBasis(
  first: TikzAsyncWorkBasis,
  second: TikzAsyncWorkBasis,
): boolean {
  return first.documentId === second.documentId
    && first.epoch === second.epoch
    && first.sourceId === second.sourceId
    && first.revision === second.revision
    && first.sourceHash === second.sourceHash
    && first.pluginSetDigest === second.pluginSetDigest
    && first.kernelHash === second.kernelHash
    && first.projectionHash === second.projectionHash;
}

export function tikzAsyncWorkItemOwnsBasis(
  activeItemId: string | null,
  itemId: string,
  capturedBasis: TikzAsyncWorkBasis,
  currentBasis: TikzAsyncWorkBasis,
): boolean {
  return activeItemId === itemId
    && sameTikzAsyncWorkBasis(capturedBasis, currentBasis);
}

export function canAdvanceTikzAsyncWorkItem(
  current: TikzAsyncWorkItem,
  next: TikzAsyncWorkItem,
): boolean {
  if (
    current.itemId !== next.itemId
    || current.kind !== next.kind
    || current.requestedAt !== next.requestedAt
    || !sameTikzAsyncWorkBasis(current.basis, next.basis)
    || next.updatedAt < current.updatedAt
  ) return false;
  if (
    current.status === 'ready'
    || current.status === 'failed'
    || current.status === 'cancelled'
  ) return next.status === current.status;
  if (current.status === 'running' && next.status === 'queued') return false;
  return true;
}

function boundedText(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

export function parseTikzAsyncWorkItem(
  value: unknown,
  expectedKind?: TikzAsyncWorkKind,
): TikzAsyncWorkItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<TikzAsyncWorkItem>;
  const kinds: readonly TikzAsyncWorkKind[] = [
    'constraint-solve',
    'exact-render',
    'visual-audit',
  ];
  const statuses: readonly TikzAsyncWorkStatus[] = [
    'queued',
    'running',
    'ready',
    'failed',
    'cancelled',
  ];
  const basis = item.basis as Partial<TikzAsyncWorkBasis> | undefined;
  if (
    item.schemaVersion !== TIKZ_ASYNC_WORK_ITEM_SCHEMA_VERSION
    || !boundedText(item.itemId, 256)
    || !kinds.includes(item.kind as TikzAsyncWorkKind)
    || (expectedKind !== undefined && item.kind !== expectedKind)
    || !statuses.includes(item.status as TikzAsyncWorkStatus)
    || !Number.isSafeInteger(item.requestedAt)
    || (item.requestedAt ?? -1) < 0
    || !Number.isSafeInteger(item.updatedAt)
    || (item.updatedAt ?? -1) < (item.requestedAt ?? 0)
    || (item.completedAt !== undefined
      && (!Number.isSafeInteger(item.completedAt) || item.completedAt < (item.updatedAt ?? 0)))
    || !basis
    || !boundedText(basis.documentId)
    || !boundedText(basis.epoch)
    || !boundedText(basis.sourceId)
    || !Number.isSafeInteger(basis.revision)
    || (basis.revision ?? -1) < 0
    || !boundedText(basis.sourceHash, 256)
    || (basis.pluginSetDigest !== undefined && !boundedText(basis.pluginSetDigest, 256))
    || (basis.kernelHash !== undefined && !boundedText(basis.kernelHash, 256))
    || (basis.projectionHash !== undefined && !boundedText(basis.projectionHash, 256))
    || (item.ownerRunId !== undefined && !boundedText(item.ownerRunId, 256))
    || (item.ownerMessageId !== undefined && !boundedText(item.ownerMessageId, 256))
    || (item.errorCode !== undefined && !boundedText(item.errorCode, 128))
  ) return null;
  return item as TikzAsyncWorkItem;
}
