import type { ProblemInspectionReceipt } from './problem-inspection-protocol';

export const PROBLEM_CONSTRUCTION_ACTION_SCHEMA =
  'geometry-problem-construction-action/v1' as const;

export interface ProblemConstructionBasis {
  readonly documentId: string;
  readonly epoch: string;
  readonly revision: number;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly kernelHash: string;
  readonly projectionHash: string;
  readonly pluginSetDigest: string;
}

export interface ProblemConstructionPrepareInput {
  readonly inspectionReceipt: ProblemInspectionReceipt;
  readonly basis: ProblemConstructionBasis;
}

export interface ProblemConstructionAction {
  readonly schemaVersion: typeof PROBLEM_CONSTRUCTION_ACTION_SCHEMA;
  readonly actionId: string;
  readonly inspectionReceiptId: string;
  readonly source: ProblemInspectionReceipt['source'];
  readonly sourceId: string;
  readonly contentHash: string;
  readonly provider: ProblemInspectionReceipt['provider'];
  readonly title: string;
  readonly sourceUrl: string;
  readonly datasetUrl: string;
  readonly licenseId: string;
  readonly sourceMaterialRights: ProblemInspectionReceipt['sourceMaterialRights'];
  readonly basis: ProblemConstructionBasis;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly mode: 'semantic-construction-proposal';
  readonly taint: 'untrusted-external-reference';
  readonly writeAuthority: 'construct-only';
  readonly allowedGeometryIntentOperations: readonly ['construct', 'construct-dag'];
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

export function isProblemConstructionBasis(value: unknown): value is ProblemConstructionBasis {
  return record(value)
    && hasExactKeys(value, [
      'documentId',
      'epoch',
      'revision',
      'sourceId',
      'sourceHash',
      'kernelHash',
      'projectionHash',
      'pluginSetDigest',
    ])
    && bounded(value.documentId, 160)
    && bounded(value.epoch, 160)
    && Number.isSafeInteger(value.revision)
    && (value.revision as number) >= 0
    && (value.revision as number) <= Number.MAX_SAFE_INTEGER
    && bounded(value.sourceId, 240)
    && value.sourceId === `${value.documentId}:tikz`
    && typeof value.sourceHash === 'string'
    && /^(?:[a-f0-9]{16}|[a-f0-9]{64})$/u.test(value.sourceHash)
    && bounded(value.kernelHash, 160)
    && bounded(value.projectionHash, 160)
    && bounded(value.pluginSetDigest, 160);
}

export function parseProblemConstructionPrepareInput(
  value: unknown,
): ProblemConstructionPrepareInput | null {
  if (!record(value) || !hasExactKeys(value, ['inspectionReceipt', 'basis'])) return null;
  // The receipt's HMAC and expiry are checked by the server module.  Keeping
  // this parser structural avoids importing node:crypto into the browser.
  const receipt = value.inspectionReceipt;
  if (!record(receipt) || !isProblemConstructionBasis(value.basis)) return null;
  return {
    inspectionReceipt: receipt as unknown as ProblemInspectionReceipt,
    basis: value.basis,
  };
}

export function isProblemConstructionAction(value: unknown): value is ProblemConstructionAction {
  if (!record(value)) return false;
  const rights = ['allowed', 'conditional', 'review-required', 'blocked', 'unknown'];
  const provider = value.provider;
  return hasExactKeys(value, [
    'schemaVersion',
    'actionId',
    'inspectionReceiptId',
    'source',
    'sourceId',
    'contentHash',
    'provider',
    'title',
    'sourceUrl',
    'datasetUrl',
    'licenseId',
    'sourceMaterialRights',
    'basis',
    'issuedAt',
    'expiresAt',
    'mode',
    'taint',
    'writeAuthority',
    'allowedGeometryIntentOperations',
    'token',
  ])
    && value.schemaVersion === PROBLEM_CONSTRUCTION_ACTION_SCHEMA
    && bounded(value.actionId, 160)
    && bounded(value.inspectionReceiptId, 160)
    && bounded(value.source, 64)
    && bounded(value.sourceId, 192)
    && value.sourceId.startsWith(`${value.source}:`)
    && typeof value.contentHash === 'string'
    && /^[a-f0-9]{64}$/u.test(value.contentHash)
    && record(provider)
    && hasExactKeys(provider, [
      'datasetId', 'config', 'split', 'rowIndex', 'revision', 'revisionStatus',
    ])
    && bounded(provider.datasetId, 160)
    && bounded(provider.config, 160)
    && provider.split === 'train'
    && Number.isSafeInteger(provider.rowIndex)
    && (provider.rowIndex as number) >= 0
    && provider.revision === null
    && provider.revisionStatus === 'unpinned-live-viewer'
    && bounded(value.title, 240)
    && bounded(value.sourceUrl, 1_024)
    && value.sourceUrl.startsWith('https://')
    && bounded(value.datasetUrl, 1_024)
    && value.datasetUrl.startsWith('https://')
    && bounded(value.licenseId, 64)
    && typeof value.sourceMaterialRights === 'string'
    && rights.includes(value.sourceMaterialRights)
    && isProblemConstructionBasis(value.basis)
    && bounded(value.issuedAt, 64)
    && bounded(value.expiresAt, 64)
    && value.mode === 'semantic-construction-proposal'
    && value.taint === 'untrusted-external-reference'
    && value.writeAuthority === 'construct-only'
    && Array.isArray(value.allowedGeometryIntentOperations)
    && value.allowedGeometryIntentOperations.length === 2
    && value.allowedGeometryIntentOperations[0] === 'construct'
    && value.allowedGeometryIntentOperations[1] === 'construct-dag'
    && bounded(value.token, 256);
}

export function problemConstructionDraft(action: ProblemConstructionAction): string {
  return [
    '请基于宿主重新核验的题目，在当前主画板画出解题所需的二维几何构图。',
    `题源引用：${action.sourceId}；写入已绑定当前 revision ${action.basis.revision}。`,
    '只允许提交一个 GeometryIntent/v2，operation.kind 必须是 construct 或 construct-dag。',
    '优先使用 Construction Catalog 的类型化构造；不得改样式、删图、变换对象或直接写原始 TikZ。',
    '在自然语言答复中简述构图步骤，不要展开大段 TikZ 代码。',
  ].join('\n');
}

export function problemConstructionBasisMatches(
  action: ProblemConstructionAction,
  current: ProblemConstructionBasis | null | undefined,
): boolean {
  if (!current) return false;
  return (Object.keys(action.basis) as Array<keyof ProblemConstructionBasis>)
    .every((key) => action.basis[key] === current[key]);
}
