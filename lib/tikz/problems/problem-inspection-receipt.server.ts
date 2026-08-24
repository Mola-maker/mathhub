import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { GeometryProblemRecord } from './source-gateway';
import {
  isProblemInspectionReceipt,
  PROBLEM_INSPECTION_RECEIPT_SCHEMA,
  type ProblemInspectionReceipt,
} from './problem-inspection-protocol';

const TOKEN_VERSION = 'v1';
const MIN_SECRET_BYTES = 32;
const RECEIPT_TTL_MS = 10 * 60_000;
const MAX_RECEIPT_TTL_MS = 15 * 60_000;
const CLOCK_SKEW_MS = 30_000;
const developmentSecret = randomBytes(MIN_SECRET_BYTES);

export function problemInspectionSigningSecret(): Buffer | null {
  const value = process.env.PROBLEM_INSPECTION_SECRET?.trim();
  if (!value) return process.env.NODE_ENV === 'production' ? null : developmentSecret;
  const bytes = Buffer.from(value, 'utf8');
  return bytes.byteLength >= MIN_SECRET_BYTES ? bytes : null;
}

export function problemInspectionReceiptConfigured(): boolean {
  return problemInspectionSigningSecret() !== null;
}

function receiptMaterial(receipt: Omit<ProblemInspectionReceipt, 'token'>): string {
  return JSON.stringify({
    schemaVersion: receipt.schemaVersion,
    receiptId: receipt.receiptId,
    source: receipt.source,
    sourceId: receipt.sourceId,
    contentHash: receipt.contentHash,
    provider: receipt.provider,
    title: receipt.title,
    sourceUrl: receipt.sourceUrl,
    datasetUrl: receipt.datasetUrl,
    licenseId: receipt.licenseId,
    sourceMaterialRights: receipt.sourceMaterialRights,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    mode: receipt.mode,
    taint: receipt.taint,
    writeAuthority: receipt.writeAuthority,
  });
}

function signature(
  receipt: Omit<ProblemInspectionReceipt, 'token'>,
  secret: Buffer,
): string {
  return createHmac('sha256', secret)
    .update(`geometry-problem-inspection/v1\0${receiptMaterial(receipt)}`, 'utf8')
    .digest('base64url');
}

export function createProblemInspectionReceipt(
  value: GeometryProblemRecord,
  now = new Date(),
): ProblemInspectionReceipt {
  const secret = problemInspectionSigningSecret();
  if (!secret) throw new TypeError('PROBLEM_INSPECTION_SECRET is not configured');
  const unsigned: Omit<ProblemInspectionReceipt, 'token'> = {
    schemaVersion: PROBLEM_INSPECTION_RECEIPT_SCHEMA,
    receiptId: `problem-inspection-${randomUUID()}`,
    source: value.source,
    sourceId: value.id,
    contentHash: value.contentHash,
    provider: value.provider,
    title: value.title,
    sourceUrl: value.sourceUrl,
    datasetUrl: value.datasetUrl,
    licenseId: value.licenseId,
    sourceMaterialRights: value.rights.sourceMaterialRights,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(),
    mode: 'read-only-analysis',
    taint: 'untrusted-external-reference',
    writeAuthority: 'none',
  };
  return Object.freeze({
    ...unsigned,
    token: `${TOKEN_VERSION}.${signature(unsigned, secret)}`,
  });
}

export function verifyProblemInspectionReceipt(
  value: unknown,
  now = new Date(),
): ProblemInspectionReceipt | null {
  const secret = problemInspectionSigningSecret();
  if (!secret || !isProblemInspectionReceipt(value)) return null;
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  const observedAt = now.getTime();
  if (
    !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || issuedAt > observedAt + CLOCK_SKEW_MS
    || expiresAt <= observedAt
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_RECEIPT_TTL_MS
  ) return null;
  const { token, ...unsigned } = value;
  const expected = Buffer.from(`${TOKEN_VERSION}.${signature(unsigned, secret)}`, 'utf8');
  const observed = Buffer.from(token, 'utf8');
  if (expected.byteLength !== observed.byteLength || !timingSafeEqual(expected, observed)) {
    return null;
  }
  return value;
}
