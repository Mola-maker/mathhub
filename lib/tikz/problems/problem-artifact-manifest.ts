import { createHash } from 'node:crypto';
import {
  getGeometryProblemSourceDescriptor,
  isGeometryProblemSourceId,
  type GeometryProblemSourceId,
} from './source-catalog';

/**
 * A provenance and rights boundary for material imported from a geometry
 * dataset.  This file intentionally contains no fetch/import code.  A
 * gateway may construct these values, but this validator only attests bounded
 * metadata and provenance declarations.  An asset loader still needs its own
 * DNS/redirect policy, streamed byte hash, and MIME-sniffing gate before any
 * external bytes are fetched or decoded.
 */

export const PROBLEM_ARTIFACT_MANIFEST_SCHEMA = 'ProblemArtifactManifest/v1' as const;
export const PROBLEM_TASK_SCHEMA = 'ProblemTask/v1' as const;
export const PROBLEM_EXTERNAL_TAINT = 'untrusted-external-reference' as const;

export type ProblemArtifactManifestSchema = typeof PROBLEM_ARTIFACT_MANIFEST_SCHEMA;
export type ProblemTaskSchema = typeof PROBLEM_TASK_SCHEMA;
export type ProblemExternalTaint = typeof PROBLEM_EXTERNAL_TAINT;

export type ProblemRightsDecision =
  | 'allowed'
  | 'prohibited'
  | 'unknown'
  | 'review-required';

export type ProblemAssetRole =
  | 'diagram'
  | 'problem-diagram'
  | 'solution-diagram'
  | 'illustration'
  | 'thumbnail'
  | 'reference';

export type ProblemImageMediaType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'image/avif';

export type ProblemTextKind = 'inline' | 'reference';

export interface ProblemTextArtifact {
  readonly kind: ProblemTextKind;
  /** Inline text is bounded and hashed before it crosses the gateway boundary. */
  readonly text?: string;
  /** A reference is a source/dataset URL; it is never fetched by this module. */
  readonly url?: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly taint: ProblemExternalTaint;
}

export interface ProblemProvider {
  readonly datasetId: string;
  /** Immutable tag, date, or commit. Mutable aliases such as `main` are banned. */
  readonly revision: string;
  readonly config: string;
  readonly split: string;
  readonly rowId?: string | number;
}

export interface ProblemProvenanceEvidence {
  readonly kind: 'source' | 'dataset' | 'license' | 'retrieval' | 'asset';
  readonly url: string;
  readonly note?: string;
}

export interface ProblemProvenance {
  readonly sourceUrl: string;
  readonly datasetUrl: string;
  readonly evidence: readonly ProblemProvenanceEvidence[];
}

export interface ProblemRightsComponent {
  readonly decision: ProblemRightsDecision;
  /** A license identifier is evidence, not a permission override. */
  readonly licenseId?: string;
  readonly evidenceUrls?: readonly string[];
}

export interface ProblemRightsSnapshot {
  readonly dataset: ProblemRightsComponent;
  readonly code: ProblemRightsComponent;
  readonly sourceMaterial: ProblemRightsComponent;
  readonly redistribution: ProblemRightsDecision;
  readonly commercial: ProblemRightsDecision;
  readonly training: ProblemRightsDecision;
  readonly redistributable: boolean;
  readonly commercialReady: boolean;
  readonly trainingReady: boolean;
}

export interface ProblemAsset {
  readonly assetId: string;
  readonly role: ProblemAssetRole;
  /** Relative provider path, or an HTTPS URL on the cited provider origin. */
  readonly providerPathOrUrl: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mediaType: ProblemImageMediaType;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly rightsDecision: ProblemRightsDecision;
  readonly rightsEvidenceUrl?: string;
}

export interface ProblemArtifactManifest {
  readonly schemaVersion: ProblemArtifactManifestSchema;
  readonly source: GeometryProblemSourceId;
  /** Stable source record ID, conventionally `${source}:<provider-id>`. */
  readonly sourceId: string;
  readonly provider: ProblemProvider;
  readonly provenance: ProblemProvenance;
  readonly rights: ProblemRightsSnapshot;
  readonly contentDigestAlgorithm: 'sha256';
  /** SHA-256 of canonicalProblemArtifactDigestMaterial(manifest). */
  readonly contentDigest: string;
  readonly retrievedAt: string;
  readonly taint: ProblemExternalTaint;
  readonly statement: ProblemTextArtifact;
  readonly solution?: ProblemTextArtifact | readonly ProblemTextArtifact[];
  readonly assets: readonly ProblemAsset[];
}

export interface ProblemTaskArtifactRef {
  readonly source: GeometryProblemSourceId;
  readonly sourceId: string;
  readonly contentDigest: string;
}

export interface ProblemTaskFact {
  readonly id: string;
  readonly text: string;
  readonly taint: ProblemExternalTaint;
}

export interface ProblemTaskGoal {
  readonly text: string;
  readonly taint: ProblemExternalTaint;
}

export interface ProblemExpectedRelation {
  readonly type: string;
  readonly subject: string;
  readonly object?: string;
  readonly value?: string;
}

export type ProblemRenderExpectationKind =
  | 'entity'
  | 'relation'
  | 'label'
  | 'style'
  | 'layout'
  | 'pixel';

export interface ProblemRenderExpectation {
  readonly kind: ProblemRenderExpectationKind;
  readonly target?: string;
  readonly description: string;
  readonly required: boolean;
}

export interface ProblemTolerances {
  readonly coordinate?: number;
  readonly length?: number;
  readonly angleDegrees?: number;
  readonly pixel?: number;
  readonly relative?: number;
}

export type ProblemTaskSplit = 'train' | 'validation' | 'test' | 'canary' | 'holdout';

export interface ProblemTask {
  readonly schemaVersion: ProblemTaskSchema;
  readonly taskId: string;
  readonly artifact: ProblemTaskArtifactRef;
  readonly contentDigestAlgorithm: 'sha256';
  /** SHA-256 of canonicalProblemTaskDigestMaterial(task). */
  readonly contentDigest: string;
  readonly facts: readonly ProblemTaskFact[];
  readonly goal: ProblemTaskGoal;
  readonly expectedRelations: readonly ProblemExpectedRelation[];
  readonly renderExpectations: readonly ProblemRenderExpectation[];
  readonly tolerances: ProblemTolerances;
  readonly split: ProblemTaskSplit;
  /** Prevent near-duplicate source rows leaking across train/eval splits. */
  readonly leakageGroup: string;
  readonly taint: ProblemExternalTaint;
}

export const PROBLEM_ARTIFACT_LIMITS = {
  maxManifestBytes: 512 * 1024,
  maxStringBytes: 8 * 1024,
  maxTextBytes: 128 * 1024,
  maxTextItems: 8,
  maxEvidenceItems: 32,
  maxEvidenceNoteBytes: 2 * 1024,
  maxAssets: 16,
  maxAssetBytes: 24 * 1024 * 1024,
  maxTotalAssetBytes: 64 * 1024 * 1024,
  maxFacts: 64,
  maxRelations: 128,
  maxRenderExpectations: 64,
  maxTaskBytes: 256 * 1024,
  maxLeakageGroupBytes: 256,
} as const;

const SHA256 = /^[a-f0-9]{64}$/u;
const IMMUTABLE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE_SOURCE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MUTABLE_REVISIONS = new Set([
  'latest',
  'main',
  'master',
  'head',
  'default',
  'trunk',
  'dev',
]);
const IMAGE_MEDIA_TYPES = new Set<ProblemImageMediaType>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);
const RIGHTS_DECISIONS = new Set<ProblemRightsDecision>([
  'allowed',
  'prohibited',
  'unknown',
  'review-required',
]);
const EVIDENCE_KINDS = new Set<ProblemProvenanceEvidence['kind']>([
  'source',
  'dataset',
  'license',
  'retrieval',
  'asset',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: ProblemManifestValidationError[],
): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) {
      errors.push({ path: `${path}.${key}`, code: 'unknown-field', message: 'Unknown field is not accepted' });
    }
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedString(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
  maxBytes = PROBLEM_ARTIFACT_LIMITS.maxStringBytes,
): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push({ path, code: 'invalid-string', message: 'Expected a non-empty string' });
    return false;
  }
  if (byteLength(value) > maxBytes) {
    errors.push({ path, code: 'byte-budget', message: `String exceeds ${maxBytes} byte budget` });
    return false;
  }
  return true;
}

function integer(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
  minimum = 0,
): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    errors.push({ path, code: 'invalid-integer', message: `Expected a safe integer >= ${minimum}` });
    return false;
  }
  return true;
}

function finiteNonNegative(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push({ path, code: 'invalid-tolerance', message: 'Expected a finite non-negative number' });
    return false;
  }
  return true;
}

function sha256(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
): value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    errors.push({ path, code: 'sha256', message: 'Expected a 64-hex SHA-256 digest' });
    return false;
  }
  return true;
}

function httpsUrl(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
): value is string {
  if (typeof value !== 'string' || byteLength(value) > 2048) {
    errors.push({ path, code: 'url', message: 'Expected a bounded HTTPS URL' });
    return false;
  }
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    const ipv4 = hostname.split('.').map((part) => Number(part));
    const privateIpv4 = ipv4.length === 4
      && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
      && (
        ipv4[0] === 10
        || ipv4[0] === 127
        || (ipv4[0] === 169 && ipv4[1] === 254)
        || (ipv4[0] === 172 && (ipv4[1] ?? 0) >= 16 && (ipv4[1] ?? 0) <= 31)
        || (ipv4[0] === 192 && ipv4[1] === 168)
      );
    const privateIpv6 = hostname === '::1'
      || hostname === '::'
      || /^f[cd][0-9a-f]*:/u.test(hostname)
      || /^fe[89ab][0-9a-f]*:/u.test(hostname);
    // URL normalisation removes literal `..` segments before exposing
    // `pathname`, so inspect the raw authority/path too.  Otherwise
    // `%2e%2e` (and encoded slash variants) could evade traversal checks.
    const rawPath = value.match(/^https?:\/\/[^/?#]*(\/[^?#]*)?/iu)?.[1] ?? '';
    const decodedRawPath = decodeURIComponent(rawPath);
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || privateIpv4
      || privateIpv6
      || decodedRawPath.split('/').some((segment) => segment === '.' || segment === '..')
      || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')
    ) throw new Error('unsafe URL');
  } catch {
    errors.push({ path, code: 'url', message: 'Only credential-free HTTPS URLs are accepted' });
    return false;
  }
  return true;
}

function isoTimestamp(value: unknown, path: string, errors: ProblemManifestValidationError[]): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    errors.push({ path, code: 'timestamp', message: 'Expected an ISO-8601 timestamp with timezone' });
    return false;
  }
  if (!Number.isFinite(Date.parse(value))) {
    errors.push({ path, code: 'timestamp', message: 'Timestamp is not parseable' });
    return false;
  }
  return true;
}

function decision(value: unknown, path: string, errors: ProblemManifestValidationError[]): value is ProblemRightsDecision {
  if (typeof value !== 'string' || !RIGHTS_DECISIONS.has(value as ProblemRightsDecision)) {
    errors.push({ path, code: 'rights-decision', message: 'Unknown rights decision' });
    return false;
  }
  return true;
}

function safeJsonBytes(value: unknown): number | null {
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' ? byteLength(json) : null;
  } catch {
    return null;
  }
}

function issue(
  errors: ProblemManifestValidationError[],
  path: string,
  code: ProblemManifestValidationErrorCode,
  message: string,
): void {
  errors.push({ path, code, message });
}

function validateProvider(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
): value is ProblemProvider {
  if (!isRecord(value)) {
    issue(errors, path, 'invalid-shape', 'Provider must be an object');
    return false;
  }
  exactKeys(value, ['datasetId', 'revision', 'config', 'split', 'rowId'], path, errors);
  boundedString(value.datasetId, `${path}.datasetId`, errors, 256);
  const revision = value.revision;
  const revisionValid = boundedString(revision, `${path}.revision`, errors, 256);
  if (revisionValid && (
    MUTABLE_REVISIONS.has(revision.trim().toLowerCase())
    || !IMMUTABLE_REVISION.test(revision)
  )) {
    issue(errors, `${path}.revision`, 'unpinned-revision', 'Revision must be an immutable 40- or 64-hex content identifier');
  }
  boundedString(value.config, `${path}.config`, errors, 256);
  boundedString(value.split, `${path}.split`, errors, 128);
  if (hasOwn(value, 'rowId')) {
    const validRow = (typeof value.rowId === 'string' && value.rowId.trim().length > 0 && byteLength(value.rowId) <= 256)
      || (typeof value.rowId === 'number' && Number.isSafeInteger(value.rowId) && value.rowId >= 0);
    if (!validRow) issue(errors, `${path}.rowId`, 'invalid-row-id', 'rowId must be a bounded string or non-negative safe integer');
  }
  return true;
}

function validateProvenance(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
): value is ProblemProvenance {
  if (!isRecord(value)) {
    issue(errors, path, 'invalid-shape', 'Provenance must be an object');
    return false;
  }
  exactKeys(value, ['sourceUrl', 'datasetUrl', 'evidence'], path, errors);
  httpsUrl(value.sourceUrl, `${path}.sourceUrl`, errors);
  httpsUrl(value.datasetUrl, `${path}.datasetUrl`, errors);
  if (!Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > PROBLEM_ARTIFACT_LIMITS.maxEvidenceItems) {
    issue(errors, `${path}.evidence`, 'item-budget', `Evidence must contain 1-${PROBLEM_ARTIFACT_LIMITS.maxEvidenceItems} items`);
  } else {
    value.evidence.forEach((entry, index) => validateEvidence(entry, `${path}.evidence[${index}]`, errors));
  }
  return true;
}

function validateEvidence(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
): value is ProblemProvenanceEvidence {
  if (!isRecord(value)) {
    issue(errors, path, 'invalid-shape', 'Evidence must be an object');
    return false;
  }
  exactKeys(value, ['kind', 'url', 'note'], path, errors);
  if (typeof value.kind !== 'string' || !EVIDENCE_KINDS.has(value.kind as ProblemProvenanceEvidence['kind'])) {
    issue(errors, `${path}.kind`, 'invalid-enum', 'Unknown evidence kind');
  }
  httpsUrl(value.url, `${path}.url`, errors);
  if (hasOwn(value, 'note')) boundedString(value.note, `${path}.note`, errors, PROBLEM_ARTIFACT_LIMITS.maxEvidenceNoteBytes);
  return true;
}

function validateRightsComponent(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
): value is ProblemRightsComponent {
  if (!isRecord(value)) {
    issue(errors, path, 'invalid-shape', 'Rights component must be an object');
    return false;
  }
  exactKeys(value, ['decision', 'licenseId', 'evidenceUrls'], path, errors);
  const knownDecision = decision(value.decision, `${path}.decision`, errors);
  if (hasOwn(value, 'licenseId')) boundedString(value.licenseId, `${path}.licenseId`, errors, 256);
  if (hasOwn(value, 'evidenceUrls')) {
    if (!Array.isArray(value.evidenceUrls) || value.evidenceUrls.length > PROBLEM_ARTIFACT_LIMITS.maxEvidenceItems) {
      issue(errors, `${path}.evidenceUrls`, 'item-budget', 'Too many rights evidence URLs');
    } else {
      value.evidenceUrls.forEach((url, index) => httpsUrl(url, `${path}.evidenceUrls[${index}]`, errors));
    }
  }
  if (knownDecision && value.decision === 'allowed' && typeof value.licenseId !== 'string') {
    issue(errors, `${path}.licenseId`, 'rights-evidence', 'Allowed rights require an explicit license identifier');
  }
  return true;
}

function validateRights(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
): value is ProblemRightsSnapshot {
  if (!isRecord(value)) {
    issue(errors, path, 'invalid-shape', 'Rights must be an object');
    return false;
  }
  exactKeys(value, [
    'dataset',
    'code',
    'sourceMaterial',
    'redistribution',
    'commercial',
    'training',
    'redistributable',
    'commercialReady',
    'trainingReady',
  ], path, errors);
  const components = [value.dataset, value.code, value.sourceMaterial];
  components.forEach((component, index) => validateRightsComponent(component, `${path}.${['dataset', 'code', 'sourceMaterial'][index]}`, errors));
  const topDecisions = ['redistribution', 'commercial', 'training'] as const;
  const topKnown = topDecisions.map((key) => decision(value[key], `${path}.${key}`, errors));
  for (const key of ['redistributable', 'commercialReady', 'trainingReady'] as const) {
    if (typeof value[key] !== 'boolean') issue(errors, `${path}.${key}`, 'invalid-boolean', 'Rights readiness must be boolean');
  }
  const componentDecisions = components
    .filter(isRecord)
    .map((component) => component.decision)
    .filter((entry): entry is ProblemRightsDecision => RIGHTS_DECISIONS.has(entry as ProblemRightsDecision));
  const taintedRights = componentDecisions.some((entry) => entry === 'unknown' || entry === 'review-required');
  const blockedRights = componentDecisions.some((entry) => entry !== 'allowed');
  if (taintedRights && (value.redistributable === true || value.commercialReady === true || value.trainingReady === true)) {
    issue(errors, path, 'rights-escalation', 'Unknown/review-required rights cannot be marked ready');
  }
  if (blockedRights && topDecisions.some((key) => value[key] === 'allowed')) {
    issue(errors, path, 'rights-escalation', 'A non-allowed component cannot be upgraded by a top-level decision');
  }
  for (const [index, key] of topDecisions.entries()) {
    if (topKnown[index] && (value[key] === 'unknown' || value[key] === 'review-required') && (
      (key === 'redistribution' && value.redistributable === true)
      || (key === 'commercial' && value.commercialReady === true)
      || (key === 'training' && value.trainingReady === true)
    )) {
      issue(errors, `${path}.${key}`, 'rights-escalation', 'Unresolved decision cannot be marked ready');
    }
  }
  if (value.redistributable === true && value.redistribution !== 'allowed') {
    issue(errors, `${path}.redistributable`, 'rights-escalation', 'redistributable requires allowed redistribution');
  }
  if (value.commercialReady === true && value.commercial !== 'allowed') {
    issue(errors, `${path}.commercialReady`, 'rights-escalation', 'commercialReady requires allowed commercial use');
  }
  if (value.trainingReady === true && value.training !== 'allowed') {
    issue(errors, `${path}.trainingReady`, 'rights-escalation', 'trainingReady requires allowed training use');
  }
  return true;
}

function validateText(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
  allowedOrigins: ReadonlySet<string>,
): value is ProblemTextArtifact {
  if (!isRecord(value)) {
    issue(errors, path, 'invalid-shape', 'Text artifact must be an object');
    return false;
  }
  exactKeys(value, ['kind', 'text', 'url', 'bytes', 'sha256', 'taint'], path, errors);
  if (value.kind !== 'inline' && value.kind !== 'reference') issue(errors, `${path}.kind`, 'invalid-enum', 'Text kind must be inline or reference');
  const textValue = value.text;
  if (value.kind === 'inline') {
    if (!boundedString(textValue, `${path}.text`, errors, PROBLEM_ARTIFACT_LIMITS.maxTextBytes)) {
      // boundedString records the useful diagnostic.
    } else if (integer(value.bytes, `${path}.bytes`, errors, 1) && value.bytes !== byteLength(textValue)) {
      issue(errors, `${path}.bytes`, 'digest-mismatch', 'Inline bytes must equal UTF-8 byte length');
    }
    if (hasOwn(value, 'url')) issue(errors, `${path}.url`, 'invalid-shape', 'Inline text cannot also carry a URL');
  } else if (value.kind === 'reference') {
    if (!httpsUrl(value.url, `${path}.url`, errors)) {
      // httpsUrl records the useful diagnostic.
    } else {
      try {
        const origin = new URL(value.url).origin;
        if (!allowedOrigins.has(origin)) issue(errors, `${path}.url`, 'provenance', 'Reference URL is outside cited source/dataset origins');
      } catch {
        // httpsUrl already reported this.
      }
    }
    if (hasOwn(value, 'text')) issue(errors, `${path}.text`, 'invalid-shape', 'Reference text cannot inline a body');
    integer(value.bytes, `${path}.bytes`, errors, 1);
    if (typeof value.bytes === 'number' && value.bytes > PROBLEM_ARTIFACT_LIMITS.maxTextBytes) issue(errors, `${path}.bytes`, 'byte-budget', 'Referenced text exceeds byte budget');
  }
  const digestValid = sha256(value.sha256, `${path}.sha256`, errors);
  if (
    value.kind === 'inline'
    && typeof textValue === 'string'
    && digestValid
    && createHash('sha256').update(textValue, 'utf8').digest('hex') !== value.sha256
  ) {
    issue(errors, `${path}.sha256`, 'digest-mismatch', 'Inline text SHA-256 does not match its UTF-8 bytes');
  }
  if (value.taint !== PROBLEM_EXTERNAL_TAINT) issue(errors, `${path}.taint`, 'taint', 'External text must remain untrusted-external-reference');
  return true;
}

function relativeProviderPath(value: string): boolean {
  if (value.includes('%')) return false;
  return !value.startsWith('/')
    && !value.startsWith('\\')
    && !value.includes('..')
    && !value.includes('\\')
    && !/[\u0000-\u001f]/u.test(value)
    && !value.startsWith('//');
}

function validateAsset(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
  allowedOrigins: ReadonlySet<string>,
): value is ProblemAsset {
  if (!isRecord(value)) {
    issue(errors, path, 'invalid-shape', 'Asset must be an object');
    return false;
  }
  exactKeys(value, [
    'assetId',
    'role',
    'providerPathOrUrl',
    'sha256',
    'bytes',
    'mediaType',
    'width',
    'height',
    'alt',
    'rightsDecision',
    'rightsEvidenceUrl',
  ], path, errors);
  boundedString(value.assetId, `${path}.assetId`, errors, 256);
  if (typeof value.role !== 'string' || !(['diagram', 'problem-diagram', 'solution-diagram', 'illustration', 'thumbnail', 'reference'] as const).includes(value.role as ProblemAssetRole)) {
    issue(errors, `${path}.role`, 'invalid-enum', 'Unknown asset role');
  }
  const providerPathOrUrl = value.providerPathOrUrl;
  const providerPathValid = boundedString(providerPathOrUrl, `${path}.providerPathOrUrl`, errors, 2048);
  if (providerPathValid) {
    if (/^https?:/iu.test(providerPathOrUrl)) {
      if (!httpsUrl(providerPathOrUrl, `${path}.providerPathOrUrl`, errors)) {
        // httpsUrl records the useful diagnostic.
      } else if (!allowedOrigins.has(new URL(providerPathOrUrl).origin)) {
        issue(errors, `${path}.providerPathOrUrl`, 'provenance', 'Asset URL is outside cited source/dataset origins');
      }
    } else if (/^[a-z][a-z0-9+.-]*:/iu.test(providerPathOrUrl) || !relativeProviderPath(providerPathOrUrl)) {
      issue(errors, `${path}.providerPathOrUrl`, 'provenance', 'Asset path must be a safe relative provider path or HTTPS URL');
    }
  }
  sha256(value.sha256, `${path}.sha256`, errors);
  const bytes = value.bytes;
  const bytesValid = integer(bytes, `${path}.bytes`, errors, 1);
  if (bytesValid && bytes > PROBLEM_ARTIFACT_LIMITS.maxAssetBytes) issue(errors, `${path}.bytes`, 'byte-budget', 'Asset exceeds per-item byte budget');
  if (typeof value.mediaType !== 'string' || !IMAGE_MEDIA_TYPES.has(value.mediaType as ProblemImageMediaType)) {
    issue(errors, `${path}.mediaType`, 'media-type', 'Media type is not in the safe image allowlist');
  }
  const width = value.width;
  const height = value.height;
  const widthValid = integer(width, `${path}.width`, errors, 1);
  const heightValid = integer(height, `${path}.height`, errors, 1);
  if (widthValid && width > 65_536) issue(errors, `${path}.width`, 'dimension', 'Image width exceeds limit');
  if (heightValid && height > 65_536) issue(errors, `${path}.height`, 'dimension', 'Image height exceeds limit');
  if (widthValid && heightValid && width * height > 100_000_000) issue(errors, path, 'dimension', 'Image pixel budget exceeded');
  boundedString(value.alt, `${path}.alt`, errors, 1024);
  decision(value.rightsDecision, `${path}.rightsDecision`, errors);
  if (hasOwn(value, 'rightsEvidenceUrl')) httpsUrl(value.rightsEvidenceUrl, `${path}.rightsEvidenceUrl`, errors);
  if (value.rightsDecision === 'allowed' && typeof value.rightsEvidenceUrl !== 'string') {
    issue(errors, `${path}.rightsEvidenceUrl`, 'rights-evidence', 'Allowed assets require HTTPS rights evidence');
  }
  return true;
}

export type ProblemManifestValidationErrorCode =
  | 'invalid-shape'
  | 'unknown-field'
  | 'invalid-string'
  | 'invalid-integer'
  | 'invalid-boolean'
  | 'invalid-enum'
  | 'invalid-row-id'
  | 'url'
  | 'timestamp'
  | 'sha256'
  | 'unpinned-revision'
  | 'byte-budget'
  | 'item-budget'
  | 'media-type'
  | 'dimension'
  | 'rights-decision'
  | 'rights-evidence'
  | 'rights-escalation'
  | 'provenance'
  | 'taint'
  | 'digest-mismatch'
  | 'invalid-tolerance'
  | 'task-reference';

export interface ProblemManifestValidationError {
  readonly path: string;
  readonly code: ProblemManifestValidationErrorCode;
  readonly message: string;
}

export interface ValidProblemArtifactManifest {
  readonly ok: true;
  readonly value: ProblemArtifactManifest;
}

export interface InvalidProblemArtifactManifest {
  readonly ok: false;
  readonly errors: readonly ProblemManifestValidationError[];
}

export type ProblemArtifactManifestValidationResult =
  | ValidProblemArtifactManifest
  | InvalidProblemArtifactManifest;

export interface ValidProblemTask {
  readonly ok: true;
  readonly value: ProblemTask;
}

export interface InvalidProblemTask {
  readonly ok: false;
  readonly errors: readonly ProblemManifestValidationError[];
}

export type ProblemTaskValidationResult = ValidProblemTask | InvalidProblemTask;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

/**
 * Return the exact, deterministic bytes to hash for a manifest.  The digest
 * field itself is removed to avoid a circular hash.  No I/O or async crypto is
 * performed here; callers may hash this string in their own trust boundary.
 */
export function canonicalProblemArtifactDigestMaterial(
  manifest: ProblemArtifactManifest,
): string {
  const { contentDigest: _contentDigest, ...withoutDigest } = manifest;
  return JSON.stringify(canonicalValue(withoutDigest));
}

/** Synchronous local helper for adapters that want the validator to attest the digest. */
export function canonicalProblemArtifactSha256(manifest: ProblemArtifactManifest): string {
  return createHash('sha256')
    .update(canonicalProblemArtifactDigestMaterial(manifest), 'utf8')
    .digest('hex');
}

export function canonicalProblemTaskDigestMaterial(task: ProblemTask): string {
  const { contentDigest: _contentDigest, ...withoutDigest } = task;
  return JSON.stringify(canonicalValue(withoutDigest));
}

export function canonicalProblemTaskSha256(task: ProblemTask): string {
  return createHash('sha256')
    .update(canonicalProblemTaskDigestMaterial(task), 'utf8')
    .digest('hex');
}

export const canonicalArtifactDigestMaterial = canonicalProblemArtifactDigestMaterial;

function originsFor(provenance: ProblemProvenance): Set<string> {
  const origins = new Set<string>();
  for (const url of [provenance.sourceUrl, provenance.datasetUrl]) {
    try {
      origins.add(new URL(url).origin);
    } catch {
      // The URL validator emits the user-visible issue.
    }
  }
  return origins;
}

function validateSolution(
  value: unknown,
  path: string,
  errors: ProblemManifestValidationError[],
  allowedOrigins: ReadonlySet<string>,
): void {
  if (Array.isArray(value)) {
    if (value.length > PROBLEM_ARTIFACT_LIMITS.maxTextItems) issue(errors, path, 'item-budget', 'Too many solution items');
    value.forEach((entry, index) => validateText(entry, `${path}[${index}]`, errors, allowedOrigins));
    return;
  }
  validateText(value, path, errors, allowedOrigins);
}

/**
 * Validate a manifest without network access.  The returned object is the same
 * immutable input value; adapters should retain the result as a trust gate and
 * never recover from errors by guessing or silently dropping fields.
 */
export function validateProblemArtifactManifest(
  input: unknown,
): ProblemArtifactManifestValidationResult {
  const errors: ProblemManifestValidationError[] = [];
  if (!isRecord(input)) return { ok: false, errors: [{ path: '$', code: 'invalid-shape', message: 'Manifest must be an object' }] };
  exactKeys(input, [
    'schemaVersion',
    'source',
    'sourceId',
    'provider',
    'provenance',
    'rights',
    'contentDigestAlgorithm',
    'contentDigest',
    'retrievedAt',
    'taint',
    'statement',
    'solution',
    'assets',
  ], '$', errors);
  if (input.schemaVersion !== PROBLEM_ARTIFACT_MANIFEST_SCHEMA) issue(errors, '$.schemaVersion', 'invalid-enum', 'Unsupported manifest schema');
  const source = input.source;
  const sourceValid = boundedString(source, '$.source', errors, 64);
  if (sourceValid && !SAFE_SOURCE.test(source)) issue(errors, '$.source', 'invalid-string', 'Source must be a stable lowercase identifier');
  if (sourceValid && !isGeometryProblemSourceId(source)) {
    issue(errors, '$.source', 'invalid-enum', 'Source is not present in the closed geometry source catalog');
  }
  const sourceId = input.sourceId;
  const sourceIdValid = boundedString(sourceId, '$.sourceId', errors, 256);
  if (sourceValid && sourceIdValid && !sourceId.startsWith(`${source}:`)) issue(errors, '$.sourceId', 'invalid-string', 'sourceId must be namespaced by source');
  validateProvider(input.provider, '$.provider', errors);
  const provenanceValid = validateProvenance(input.provenance, '$.provenance', errors);
  if (
    sourceValid
    && isGeometryProblemSourceId(source)
    && provenanceValid
    && isRecord(input.provenance)
    && typeof input.provenance.sourceUrl === 'string'
    && typeof input.provenance.datasetUrl === 'string'
  ) {
    const descriptor = getGeometryProblemSourceDescriptor(source);
    const approvedOrigins = new Set([
      new URL(descriptor.projectUrl).origin,
      new URL(descriptor.datasetUrl).origin,
    ]);
    const sourceOrigin = new URL(input.provenance.sourceUrl).origin;
    const datasetOrigin = new URL(input.provenance.datasetUrl).origin;
    if (!approvedOrigins.has(sourceOrigin)) {
      issue(errors, '$.provenance.sourceUrl', 'provenance', 'Source URL origin is not approved by the closed source catalog');
    }
    if (datasetOrigin !== new URL(descriptor.datasetUrl).origin) {
      issue(errors, '$.provenance.datasetUrl', 'provenance', 'Dataset URL origin does not match the closed source catalog');
    }
  }
  validateRights(input.rights, '$.rights', errors);
  if (input.contentDigestAlgorithm !== 'sha256') issue(errors, '$.contentDigestAlgorithm', 'sha256', 'Only SHA-256 content digests are accepted');
  sha256(input.contentDigest, '$.contentDigest', errors);
  isoTimestamp(input.retrievedAt, '$.retrievedAt', errors);
  if (input.taint !== PROBLEM_EXTERNAL_TAINT) issue(errors, '$.taint', 'taint', 'Manifest must remain tainted as external input');
  if (!provenanceValid) {
    // Keep validation deterministic even when origin extraction is impossible.
  }
  const allowedOrigins = provenanceValid && isRecord(input.provenance)
    ? originsFor(input.provenance as unknown as ProblemProvenance)
    : new Set<string>();
  validateText(input.statement, '$.statement', errors, allowedOrigins);
  if (hasOwn(input, 'solution')) validateSolution(input.solution, '$.solution', errors, allowedOrigins);
  if (!Array.isArray(input.assets) || input.assets.length > PROBLEM_ARTIFACT_LIMITS.maxAssets) {
    issue(errors, '$.assets', 'item-budget', `Assets must contain 0-${PROBLEM_ARTIFACT_LIMITS.maxAssets} items`);
  } else {
    const ids = new Set<string>();
    let totalAssetBytes = 0;
    input.assets.forEach((entry, index) => {
      validateAsset(entry, `$.assets[${index}]`, errors, allowedOrigins);
      if (isRecord(entry)) {
        if (typeof entry.assetId === 'string') {
          if (ids.has(entry.assetId)) issue(errors, `$.assets[${index}].assetId`, 'invalid-string', 'Asset IDs must be unique');
          ids.add(entry.assetId);
        }
        if (typeof entry.bytes === 'number' && Number.isSafeInteger(entry.bytes) && entry.bytes > 0) totalAssetBytes += entry.bytes;
      }
    });
    if (totalAssetBytes > PROBLEM_ARTIFACT_LIMITS.maxTotalAssetBytes) issue(errors, '$.assets', 'byte-budget', 'Total asset byte budget exceeded');
  }
  const manifestBytes = safeJsonBytes(input);
  if (manifestBytes === null || manifestBytes > PROBLEM_ARTIFACT_LIMITS.maxManifestBytes) issue(errors, '$', 'byte-budget', 'Manifest exceeds byte budget or is not JSON-serializable');
  // The digest check is deliberately last so malformed values produce useful
  // structural errors first. It is an integrity check, not a remote fetch.
  if (errors.length === 0) {
    const candidate = input as unknown as ProblemArtifactManifest;
    if (canonicalProblemArtifactSha256(candidate) !== candidate.contentDigest.toLowerCase()) {
      issue(errors, '$.contentDigest', 'digest-mismatch', 'Content digest does not match canonical manifest material');
    }
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as ProblemArtifactManifest };
}

function validateTaskText(value: unknown, path: string, errors: ProblemManifestValidationError[]): value is ProblemTaskFact | ProblemTaskGoal {
  if (!isRecord(value)) {
    issue(errors, path, 'invalid-shape', 'Task text must be an object');
    return false;
  }
  exactKeys(value, ['id', 'text', 'taint'], path, errors);
  if (hasOwn(value, 'id')) boundedString(value.id, `${path}.id`, errors, 256);
  boundedString(value.text, `${path}.text`, errors, PROBLEM_ARTIFACT_LIMITS.maxTextBytes);
  if (value.taint !== PROBLEM_EXTERNAL_TAINT) issue(errors, `${path}.taint`, 'taint', 'External task text must remain tainted');
  return true;
}

function validateTask(input: Record<string, unknown>, errors: ProblemManifestValidationError[]): void {
  exactKeys(input, [
    'schemaVersion',
    'taskId',
    'artifact',
    'contentDigestAlgorithm',
    'contentDigest',
    'facts',
    'goal',
    'expectedRelations',
    'renderExpectations',
    'tolerances',
    'split',
    'leakageGroup',
    'taint',
  ], '$', errors);
  if (input.schemaVersion !== PROBLEM_TASK_SCHEMA) issue(errors, '$.schemaVersion', 'invalid-enum', 'Unsupported task schema');
  boundedString(input.taskId, '$.taskId', errors, 256);
  if (input.contentDigestAlgorithm !== 'sha256') issue(errors, '$.contentDigestAlgorithm', 'sha256', 'Only SHA-256 task digests are accepted');
  sha256(input.contentDigest, '$.contentDigest', errors);
  if (!isRecord(input.artifact)) {
    issue(errors, '$.artifact', 'invalid-shape', 'Task artifact reference must be an object');
  } else {
    exactKeys(input.artifact, ['source', 'sourceId', 'contentDigest'], '$.artifact', errors);
    const taskSource = input.artifact.source;
    const taskSourceId = input.artifact.sourceId;
    const taskSourceValid = boundedString(taskSource, '$.artifact.source', errors, 64);
    if (taskSourceValid && !isGeometryProblemSourceId(taskSource)) {
      issue(errors, '$.artifact.source', 'invalid-enum', 'Task source is not present in the closed geometry source catalog');
    }
    const taskSourceIdValid = boundedString(taskSourceId, '$.artifact.sourceId', errors, 256);
    if (
      taskSourceValid
      && taskSourceIdValid
      && !taskSourceId.startsWith(`${taskSource}:`)
    ) {
      issue(errors, '$.artifact.sourceId', 'invalid-string', 'Task sourceId must be namespaced by source');
    }
    sha256(input.artifact.contentDigest, '$.artifact.contentDigest', errors);
  }
  if (!Array.isArray(input.facts) || input.facts.length > PROBLEM_ARTIFACT_LIMITS.maxFacts) {
    issue(errors, '$.facts', 'item-budget', `Facts must contain 0-${PROBLEM_ARTIFACT_LIMITS.maxFacts} items`);
  } else {
    const ids = new Set<string>();
    input.facts.forEach((fact, index) => {
      validateTaskText(fact, `$.facts[${index}]`, errors);
      if (isRecord(fact) && typeof fact.id === 'string') {
        if (ids.has(fact.id)) issue(errors, `$.facts[${index}].id`, 'invalid-string', 'Fact IDs must be unique');
        ids.add(fact.id);
      }
    });
  }
  validateTaskText(input.goal, '$.goal', errors);
  if (isRecord(input.goal) && hasOwn(input.goal, 'id')) issue(errors, '$.goal.id', 'unknown-field', 'Goal cannot have an id');
  if (!Array.isArray(input.expectedRelations) || input.expectedRelations.length > PROBLEM_ARTIFACT_LIMITS.maxRelations) {
    issue(errors, '$.expectedRelations', 'item-budget', `Expected relations must contain 0-${PROBLEM_ARTIFACT_LIMITS.maxRelations} items`);
  } else {
    input.expectedRelations.forEach((relation, index) => {
      if (!isRecord(relation)) {
        issue(errors, `$.expectedRelations[${index}]`, 'invalid-shape', 'Relation must be an object');
        return;
      }
      exactKeys(relation, ['type', 'subject', 'object', 'value'], `$.expectedRelations[${index}]`, errors);
      boundedString(relation.type, `$.expectedRelations[${index}].type`, errors, 128);
      boundedString(relation.subject, `$.expectedRelations[${index}].subject`, errors, 256);
      if (hasOwn(relation, 'object')) boundedString(relation.object, `$.expectedRelations[${index}].object`, errors, 256);
      if (hasOwn(relation, 'value')) boundedString(relation.value, `$.expectedRelations[${index}].value`, errors, 1024);
    });
  }
  if (!Array.isArray(input.renderExpectations) || input.renderExpectations.length > PROBLEM_ARTIFACT_LIMITS.maxRenderExpectations) {
    issue(errors, '$.renderExpectations', 'item-budget', `Render expectations must contain 0-${PROBLEM_ARTIFACT_LIMITS.maxRenderExpectations} items`);
  } else {
    input.renderExpectations.forEach((expectation, index) => {
      const path = `$.renderExpectations[${index}]`;
      if (!isRecord(expectation)) {
        issue(errors, path, 'invalid-shape', 'Render expectation must be an object');
        return;
      }
      exactKeys(expectation, ['kind', 'target', 'description', 'required'], path, errors);
      if (typeof expectation.kind !== 'string' || !(['entity', 'relation', 'label', 'style', 'layout', 'pixel'] as const).includes(expectation.kind as ProblemRenderExpectationKind)) issue(errors, `${path}.kind`, 'invalid-enum', 'Unknown render expectation kind');
      if (hasOwn(expectation, 'target')) boundedString(expectation.target, `${path}.target`, errors, 256);
      boundedString(expectation.description, `${path}.description`, errors, PROBLEM_ARTIFACT_LIMITS.maxStringBytes);
      if (typeof expectation.required !== 'boolean') issue(errors, `${path}.required`, 'invalid-boolean', 'required must be boolean');
    });
  }
  if (!isRecord(input.tolerances)) {
    issue(errors, '$.tolerances', 'invalid-shape', 'Tolerances must be an object');
  } else {
    exactKeys(input.tolerances, ['coordinate', 'length', 'angleDegrees', 'pixel', 'relative'], '$.tolerances', errors);
    for (const key of ['coordinate', 'length', 'angleDegrees', 'pixel', 'relative'] as const) {
      if (hasOwn(input.tolerances, key)) finiteNonNegative(input.tolerances[key], `$.tolerances.${key}`, errors);
    }
  }
  if (typeof input.split !== 'string' || !(['train', 'validation', 'test', 'canary', 'holdout'] as const).includes(input.split as ProblemTaskSplit)) issue(errors, '$.split', 'invalid-enum', 'Unknown task split');
  boundedString(input.leakageGroup, '$.leakageGroup', errors, PROBLEM_ARTIFACT_LIMITS.maxLeakageGroupBytes);
  if (input.taint !== PROBLEM_EXTERNAL_TAINT) issue(errors, '$.taint', 'taint', 'Task must remain tainted as external-derived input');
  const taskBytes = safeJsonBytes(input);
  if (taskBytes === null || taskBytes > PROBLEM_ARTIFACT_LIMITS.maxTaskBytes) issue(errors, '$', 'byte-budget', 'Task exceeds byte budget or is not JSON-serializable');
  if (errors.length === 0) {
    const candidate = input as unknown as ProblemTask;
    if (canonicalProblemTaskSha256(candidate) !== candidate.contentDigest) {
      issue(errors, '$.contentDigest', 'digest-mismatch', 'Task digest does not match canonical task material');
    }
  }
}

export function validateProblemTask(
  input: unknown,
  manifest?: ProblemArtifactManifest,
): ProblemTaskValidationResult {
  const errors: ProblemManifestValidationError[] = [];
  if (!isRecord(input)) return { ok: false, errors: [{ path: '$', code: 'invalid-shape', message: 'Task must be an object' }] };
  validateTask(input, errors);
  if (manifest && isRecord(input.artifact)) {
    if (input.artifact.source !== manifest.source || input.artifact.sourceId !== manifest.sourceId || input.artifact.contentDigest !== manifest.contentDigest) {
      issue(errors, '$.artifact', 'task-reference', 'Task artifact reference does not match manifest');
    }
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as ProblemTask };
}

export function isProblemArtifactManifest(value: unknown): value is ProblemArtifactManifest {
  return validateProblemArtifactManifest(value).ok;
}

export function isProblemTask(value: unknown, manifest?: ProblemArtifactManifest): value is ProblemTask {
  return validateProblemTask(value, manifest).ok;
}
