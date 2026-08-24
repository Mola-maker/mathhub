import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { GeometryProblemRecord } from './source-gateway';
import type { ProblemInspectionReceipt } from './problem-inspection-protocol';
import { problemInspectionSigningSecret } from './problem-inspection-receipt.server';
import {
  isProblemConstructionAction,
  PROBLEM_CONSTRUCTION_ACTION_SCHEMA,
  type ProblemConstructionAction,
  type ProblemConstructionBasis,
} from './problem-construction-protocol';

const TOKEN_VERSION = 'v1';
const ACTION_TTL_MS = 3 * 60_000;
const MAX_ACTION_TTL_MS = 5 * 60_000;
const CLOCK_SKEW_MS = 30_000;

function actionMaterial(action: Omit<ProblemConstructionAction, 'token'>): string {
  return JSON.stringify(action);
}

function signature(
  action: Omit<ProblemConstructionAction, 'token'>,
  secret: Buffer,
): string {
  return createHmac('sha256', secret)
    .update(`geometry-problem-construction/v1\0${actionMaterial(action)}`, 'utf8')
    .digest('base64url');
}

export function createProblemConstructionAction(
  problem: GeometryProblemRecord,
  receipt: ProblemInspectionReceipt,
  basis: ProblemConstructionBasis,
  now = new Date(),
): ProblemConstructionAction {
  const secret = problemInspectionSigningSecret();
  if (!secret) throw new TypeError('PROBLEM_INSPECTION_SECRET is not configured');
  const unsigned: Omit<ProblemConstructionAction, 'token'> = {
    schemaVersion: PROBLEM_CONSTRUCTION_ACTION_SCHEMA,
    actionId: `problem-construction-${randomUUID()}`,
    inspectionReceiptId: receipt.receiptId,
    source: problem.source,
    sourceId: problem.id,
    contentHash: problem.contentHash,
    provider: problem.provider,
    title: problem.title,
    sourceUrl: problem.sourceUrl,
    datasetUrl: problem.datasetUrl,
    licenseId: problem.licenseId,
    sourceMaterialRights: problem.rights.sourceMaterialRights,
    basis,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ACTION_TTL_MS).toISOString(),
    mode: 'semantic-construction-proposal',
    taint: 'untrusted-external-reference',
    writeAuthority: 'construct-only',
    allowedGeometryIntentOperations: ['construct', 'construct-dag'],
  };
  return Object.freeze({
    ...unsigned,
    token: `${TOKEN_VERSION}.${signature(unsigned, secret)}`,
  });
}

export function verifyProblemConstructionAction(
  value: unknown,
  now = new Date(),
): ProblemConstructionAction | null {
  const secret = problemInspectionSigningSecret();
  if (!secret || !isProblemConstructionAction(value)) return null;
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  const observedAt = now.getTime();
  if (
    !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || issuedAt > observedAt + CLOCK_SKEW_MS
    || expiresAt <= observedAt
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_ACTION_TTL_MS
  ) return null;
  const { token, ...unsigned } = value;
  const expected = Buffer.from(`${TOKEN_VERSION}.${signature(unsigned, secret)}`, 'utf8');
  const observed = Buffer.from(token, 'utf8');
  if (expected.byteLength !== observed.byteLength || !timingSafeEqual(expected, observed)) {
    return null;
  }
  return value;
}
