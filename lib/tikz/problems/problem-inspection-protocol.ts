import {
  isGeometryProblemSourceId,
  type GeometryProblemSourceId,
  type GeometryProblemSourceMaterialRights,
} from './source-catalog';
import type { GeometryProblemProviderSnapshot } from './source-gateway';

export const PROBLEM_INSPECTION_RECEIPT_SCHEMA =
  'geometry-problem-inspection-receipt/v1' as const;

export interface ProblemInspectionReferenceInput {
  readonly source: GeometryProblemSourceId;
  readonly id: string;
  readonly contentHash: string;
  readonly provider: GeometryProblemProviderSnapshot;
}

export interface ProblemInspectionReceipt {
  readonly schemaVersion: typeof PROBLEM_INSPECTION_RECEIPT_SCHEMA;
  readonly receiptId: string;
  readonly source: GeometryProblemSourceId;
  readonly sourceId: string;
  readonly contentHash: string;
  readonly provider: GeometryProblemProviderSnapshot;
  readonly title: string;
  readonly sourceUrl: string;
  readonly datasetUrl: string;
  readonly licenseId: string;
  readonly sourceMaterialRights: GeometryProblemSourceMaterialRights;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly mode: 'read-only-analysis';
  readonly taint: 'untrusted-external-reference';
  readonly writeAuthority: 'none';
  readonly token: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= max
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function providerSnapshot(value: unknown): value is GeometryProblemProviderSnapshot {
  return record(value)
    && hasExactKeys(value, [
      'datasetId',
      'config',
      'split',
      'rowIndex',
      'revision',
      'revisionStatus',
    ])
    && bounded(value.datasetId, 160)
    && bounded(value.config, 160)
    && value.split === 'train'
    && Number.isSafeInteger(value.rowIndex)
    && (value.rowIndex as number) >= 0
    && (value.rowIndex as number) <= 1_000_000
    && value.revision === null
    && value.revisionStatus === 'unpinned-live-viewer';
}

export function parseProblemInspectionReferenceInput(
  value: unknown,
): ProblemInspectionReferenceInput | null {
  if (!record(value)) return null;
  if (
    typeof value.source !== 'string'
    || !isGeometryProblemSourceId(value.source)
    || !bounded(value.id, 192)
    || !value.id.startsWith(`${value.source}:`)
    || typeof value.contentHash !== 'string'
    || !/^[a-f0-9]{64}$/u.test(value.contentHash)
    || !providerSnapshot(value.provider)
  ) return null;
  return {
    source: value.source,
    id: value.id,
    contentHash: value.contentHash,
    provider: {
      datasetId: value.provider.datasetId,
      config: value.provider.config,
      split: value.provider.split,
      rowIndex: value.provider.rowIndex,
      revision: null,
      revisionStatus: 'unpinned-live-viewer',
    },
  };
}

export function isProblemInspectionReceipt(
  value: unknown,
): value is ProblemInspectionReceipt {
  if (!record(value)) return false;
  const rights = ['allowed', 'conditional', 'review-required', 'blocked', 'unknown'];
  return hasExactKeys(value, [
    'schemaVersion',
    'receiptId',
    'source',
    'sourceId',
    'contentHash',
    'provider',
    'title',
    'sourceUrl',
    'datasetUrl',
    'licenseId',
    'sourceMaterialRights',
    'issuedAt',
    'expiresAt',
    'mode',
    'taint',
    'writeAuthority',
    'token',
  ])
    && value.schemaVersion === PROBLEM_INSPECTION_RECEIPT_SCHEMA
    && bounded(value.receiptId, 160)
    && typeof value.source === 'string'
    && isGeometryProblemSourceId(value.source)
    && bounded(value.sourceId, 192)
    && value.sourceId.startsWith(`${value.source}:`)
    && typeof value.contentHash === 'string'
    && /^[a-f0-9]{64}$/u.test(value.contentHash)
    && providerSnapshot(value.provider)
    && bounded(value.title, 240)
    && bounded(value.sourceUrl, 1_024)
    && value.sourceUrl.startsWith('https://')
    && bounded(value.datasetUrl, 1_024)
    && value.datasetUrl.startsWith('https://')
    && bounded(value.licenseId, 64)
    && typeof value.sourceMaterialRights === 'string'
    && rights.includes(value.sourceMaterialRights)
    && bounded(value.issuedAt, 64)
    && bounded(value.expiresAt, 64)
    && value.mode === 'read-only-analysis'
    && value.taint === 'untrusted-external-reference'
    && value.writeAuthority === 'none'
    && bounded(value.token, 256);
}

export function problemInspectionDraft(receipt: ProblemInspectionReceipt): string {
  return [
    '请只读分析宿主已重新核验的几何题目，并给出清晰的几何关系与分步推导。',
    `题源引用：${receipt.sourceId}；当前只允许分析，不允许修改画板。`,
    '如果适合，可附带一个只读步骤卡片；不要提交 GeometryIntent、补丁或原始 TikZ 写入。',
    '不要在聊天正文展开大段 TikZ 代码。',
  ].join('\n');
}
