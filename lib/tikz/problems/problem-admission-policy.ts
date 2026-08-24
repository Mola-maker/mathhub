import {
  getGeometryProblemSourceDescriptor,
  isGeometryProblemSourceId,
  type GeometryProblemSourceId,
  type GeometryProblemSourceMaterialRights,
} from './source-catalog';
import {
  PROBLEM_EXTERNAL_TAINT,
  validateProblemArtifactManifest,
  validateProblemTask,
  type ProblemArtifactManifest,
  type ProblemRightsDecision,
  type ProblemTask,
  type ProblemManifestValidationError,
} from './problem-artifact-manifest';

/**
 * Admission is intentionally a host-side operation.  A problem row is useful
 * as a reference, but it is never a second source of truth and it never gets
 * write authority over the TikZ document.
 */
export const PROBLEM_ADMISSION_LEDGER_SCHEMA =
  'ProblemAdmissionLedger/v1' as const;

export type ProblemAdmissionLedgerSchema =
  typeof PROBLEM_ADMISSION_LEDGER_SCHEMA;

export const PROBLEM_ADMISSION_LANES = [
  'reference',
  'evaluation',
  'redistribution',
  'commercial',
  'training',
] as const;

export type ProblemAdmissionLane = typeof PROBLEM_ADMISSION_LANES[number];

export type ProblemAdmissionLaneDecision = 'allowed' | 'blocked';

export interface ProblemAdmissionLedgerEvidence {
  readonly url: string;
  /** SHA-256 of the bytes at `url`, recorded by the trusted review process. */
  readonly sha256: string;
}

/**
 * A ledger entry is an exact, time-bounded exception to the catalog policy.
 * There are no wildcard source IDs, digests, or lanes.  `expiresAt` is
 * required so a review cannot silently become a permanent permission.
 */
export interface ProblemAdmissionLedgerEntry {
  readonly schemaVersion: ProblemAdmissionLedgerSchema;
  readonly source: GeometryProblemSourceId;
  readonly sourceId: string;
  readonly contentDigest: string;
  /** Exact digest of the task projection authorized by this decision. */
  readonly taskContentDigest: string;
  readonly reviewer: string;
  readonly decidedAt: string;
  readonly expiresAt: string;
  readonly evidence: readonly ProblemAdmissionLedgerEvidence[];
  readonly lanes: Readonly<Record<ProblemAdmissionLane, ProblemAdmissionLaneDecision>>;
}

export interface ProblemAdmissionHostContextOptions {
  /** Entries are supplied by a server-side review ledger, never by a browser. */
  readonly ledger?: readonly unknown[];
  /** Explicit trusted opt-in required for restricted sources such as FormalGeo. */
  readonly restrictedOptIn?: boolean;
  /** A deterministic clock is useful for host tests and review expiry checks. */
  readonly now?: string | Date;
}

export interface ProblemAdmissionHostContext {
  readonly ledger: readonly unknown[];
  readonly restrictedOptIn: boolean;
  readonly now: string;
}

export type ProblemAdmissionErrorCode =
  | 'host-context-required'
  | 'invalid-lane'
  | 'manifest-invalid'
  | 'task-invalid'
  | 'source-unknown'
  | 'source-mismatch'
  | 'catalog-blocked'
  | 'manifest-blocked'
  | 'catalog-review-required'
  | 'manifest-review-required'
  | 'ledger-required'
  | 'ledger-no-match'
  | 'ledger-invalid'
  | 'ledger-blocked'
  | 'ledger-expired'
  | 'restricted-opt-in-required';

export interface ProblemAdmissionError {
  readonly code: ProblemAdmissionErrorCode;
  readonly path: string;
  readonly message: string;
  readonly details?: readonly ProblemManifestValidationError[];
}

export interface AdmittedProblemArtifact {
  readonly ok: true;
  readonly lane: ProblemAdmissionLane;
  readonly source: GeometryProblemSourceId;
  readonly sourceId: string;
  readonly contentDigest: string;
  readonly taskContentDigest: string;
  readonly manifest: ProblemArtifactManifest;
  readonly task: ProblemTask;
  /** External data remains tainted after admission. */
  readonly tainted: true;
  /** Admission never grants a problem artifact document-write authority. */
  readonly readOnly: true;
  readonly writable: false;
  readonly writeAuthority: 'none';
  readonly ledgerEntry?: ProblemAdmissionLedgerEntry;
}

export interface RejectedProblemArtifact {
  readonly ok: false;
  readonly lane?: ProblemAdmissionLane;
  readonly errors: readonly ProblemAdmissionError[];
  readonly tainted: true;
  readonly readOnly: true;
  readonly writable: false;
}

export type ProblemAdmissionResult =
  | AdmittedProblemArtifact
  | RejectedProblemArtifact;

const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const HOST_CONTEXTS = new WeakSet<object>();
const ADMITTED_RECEIPTS = new WeakSet<object>();
const LANE_SET = new Set<string>(PROBLEM_ADMISSION_LANES);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keep a receipt independent from mutable caller-owned manifest/task objects. */
function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreeze(entry))) as T;
  }
  if (record(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) clone[key] = cloneAndFreeze(entry);
    return Object.freeze(clone) as T;
  }
  return value;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  errors: ProblemAdmissionError[],
): void {
  const accepted = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) {
      errors.push({
        code: 'ledger-invalid',
        path: `${path}.${key}`,
        message: 'Ledger contains an unknown field',
      });
    }
  }
}

function nonEmpty(value: unknown, path: string, errors: ProblemAdmissionError[], maxBytes = 256): value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || byteLength(value) > maxBytes || /[\u0000-\u001f\u007f]/u.test(value)) {
    errors.push({ code: 'ledger-invalid', path, message: 'Expected a bounded non-empty text value' });
    return false;
  }
  return true;
}

function digest(value: unknown, path: string, errors: ProblemAdmissionError[]): value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    errors.push({ code: 'ledger-invalid', path, message: 'Expected a lowercase 64-hex SHA-256 digest' });
    return false;
  }
  return true;
}

function httpsUrl(value: unknown, path: string, errors: ProblemAdmissionError[]): value is string {
  if (typeof value !== 'string' || byteLength(value) > 2048) {
    errors.push({ code: 'ledger-invalid', path, message: 'Evidence URL must be a bounded HTTPS URL' });
    return false;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('unsafe URL');
  } catch {
    errors.push({ code: 'ledger-invalid', path, message: 'Evidence URL must be credential-free HTTPS' });
    return false;
  }
  return true;
}

function timestamp(value: unknown, path: string, errors: ProblemAdmissionError[]): value is string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) {
    errors.push({ code: 'ledger-invalid', path, message: 'Expected a parseable ISO-8601 timestamp' });
    return false;
  }
  return true;
}

function isLane(value: unknown): value is ProblemAdmissionLane {
  return typeof value === 'string' && LANE_SET.has(value);
}

function invalid(
  lane: ProblemAdmissionLane | undefined,
  errors: readonly ProblemAdmissionError[],
): RejectedProblemArtifact {
  return {
    ok: false,
    ...(lane ? { lane } : {}),
    errors,
    tainted: true,
    readOnly: true,
    writable: false,
  };
}

/**
 * Make a host context with an unforgeable in-process brand.  JSON received
 * from a browser cannot satisfy the WeakSet check in `admitProblemArtifact`.
 */
export function createProblemAdmissionHostContext(
  options: ProblemAdmissionHostContextOptions = {},
): ProblemAdmissionHostContext {
  const now = options.now instanceof Date
    ? options.now.toISOString()
    : options.now ?? new Date().toISOString();
  const context = Object.freeze({
    ledger: Object.freeze((options.ledger ?? []).map((entry) => cloneAndFreeze(entry))),
    restrictedOptIn: options.restrictedOptIn === true,
    now,
  });
  HOST_CONTEXTS.add(context);
  return context;
}

function validateEvidence(
  value: unknown,
  path: string,
  errors: ProblemAdmissionError[],
): value is ProblemAdmissionLedgerEvidence {
  if (!record(value)) {
    errors.push({ code: 'ledger-invalid', path, message: 'Ledger evidence must be an object' });
    return false;
  }
  exactKeys(value, ['url', 'sha256'], path, errors);
  httpsUrl(value.url, `${path}.url`, errors);
  digest(value.sha256, `${path}.sha256`, errors);
  return true;
}

/** Validate a ledger row before it can participate in an admission decision. */
export function validateProblemAdmissionLedgerEntry(
  input: unknown,
): { readonly ok: true; readonly value: ProblemAdmissionLedgerEntry } | { readonly ok: false; readonly errors: readonly ProblemAdmissionError[] } {
  const errors: ProblemAdmissionError[] = [];
  if (!record(input)) {
    return { ok: false, errors: [{ code: 'ledger-invalid', path: '$', message: 'Ledger entry must be an object' }] };
  }
  exactKeys(input, [
    'schemaVersion',
    'source',
    'sourceId',
    'contentDigest',
    'taskContentDigest',
    'reviewer',
    'decidedAt',
    'expiresAt',
    'evidence',
    'lanes',
  ], '$', errors);
  if (input.schemaVersion !== PROBLEM_ADMISSION_LEDGER_SCHEMA) {
    errors.push({ code: 'ledger-invalid', path: '$.schemaVersion', message: 'Unsupported admission ledger schema' });
  }
  const sourceValid = typeof input.source === 'string' && isGeometryProblemSourceId(input.source);
  if (!sourceValid) {
    errors.push({ code: 'source-unknown', path: '$.source', message: 'Ledger source is not in the closed source catalog' });
  }
  const sourceId = input.sourceId;
  const sourceIdValid = nonEmpty(sourceId, '$.sourceId', errors);
  if (sourceValid && sourceIdValid && !sourceId.startsWith(`${input.source}:`)) {
    errors.push({ code: 'source-mismatch', path: '$.sourceId', message: 'Ledger sourceId must be namespaced by source' });
  }
  digest(input.contentDigest, '$.contentDigest', errors);
  digest(input.taskContentDigest, '$.taskContentDigest', errors);
  nonEmpty(input.reviewer, '$.reviewer', errors, 512);
  const decidedAt = input.decidedAt;
  const expiresAt = input.expiresAt;
  const decidedAtValid = timestamp(decidedAt, '$.decidedAt', errors);
  const expiresAtValid = timestamp(expiresAt, '$.expiresAt', errors);
  if (decidedAtValid && expiresAtValid && Date.parse(expiresAt) <= Date.parse(decidedAt)) {
    errors.push({ code: 'ledger-invalid', path: '$.expiresAt', message: 'Ledger expiry must be after its decision time' });
  }
  if (!Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > 16) {
    errors.push({ code: 'ledger-invalid', path: '$.evidence', message: 'Ledger requires 1-16 evidence records' });
  } else {
    input.evidence.forEach((entry, index) => validateEvidence(entry, `$.evidence[${index}]`, errors));
  }
  if (!record(input.lanes)) {
    errors.push({ code: 'ledger-invalid', path: '$.lanes', message: 'Ledger lanes must be an object' });
  } else {
    exactKeys(input.lanes, PROBLEM_ADMISSION_LANES, '$.lanes', errors);
    for (const lane of PROBLEM_ADMISSION_LANES) {
      if (input.lanes[lane] !== 'allowed' && input.lanes[lane] !== 'blocked') {
        errors.push({ code: 'ledger-invalid', path: `$.lanes.${lane}`, message: 'Each lane must be allowed or blocked' });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: input.schemaVersion as ProblemAdmissionLedgerSchema,
      source: input.source as GeometryProblemSourceId,
      sourceId: input.sourceId as string,
      contentDigest: input.contentDigest as string,
      taskContentDigest: input.taskContentDigest as string,
      reviewer: input.reviewer as string,
      decidedAt: input.decidedAt as string,
      expiresAt: input.expiresAt as string,
      evidence: Object.freeze((input.evidence as readonly Record<string, unknown>[]).map((entry) => Object.freeze({
        url: entry.url as string,
        sha256: entry.sha256 as string,
      }))),
      lanes: Object.freeze({ ...(input.lanes as Record<ProblemAdmissionLane, ProblemAdmissionLaneDecision>) }),
    }),
  };
}

type PolicyStatus = 'allowed' | 'review-required' | 'blocked';

function catalogStatus(
  source: GeometryProblemSourceId,
  lane: ProblemAdmissionLane,
): PolicyStatus {
  const descriptor = getGeometryProblemSourceDescriptor(source);
  if (lane === 'reference') {
    // A reference receipt may stay read-only, but it still contains external
    // source material.  Conditional/review-required catalog entries therefore
    // need an exact host ledger allowance before admission.  The live
    // search-reference-only gateway records do not call this gate.
    return sourceMaterialStatus(descriptor.sourceMaterialRights);
  }
  if (lane === 'evaluation') {
    return sourceMaterialStatus(descriptor.sourceMaterialRights);
  }
  const decision = descriptor[lane];
  return decision === 'blocked' ? 'blocked' : decision === 'allowed' ? 'allowed' : 'review-required';
}

function sourceMaterialStatus(value: GeometryProblemSourceMaterialRights): PolicyStatus {
  if (value === 'blocked') return 'blocked';
  if (value === 'allowed') return 'allowed';
  return 'review-required';
}

function manifestStatus(
  manifest: ProblemArtifactManifest,
  lane: ProblemAdmissionLane,
): PolicyStatus {
  const rights = manifest.rights;
  const componentDecisions: ProblemRightsDecision[] = [
    rights.dataset.decision,
    rights.code.decision,
    rights.sourceMaterial.decision,
  ];
  const laneDecision: ProblemRightsDecision | undefined = lane === 'redistribution'
    ? rights.redistribution
    : lane === 'commercial'
      ? rights.commercial
      : lane === 'training'
        ? rights.training
        : lane === 'evaluation'
          ? undefined
          : rights.sourceMaterial.decision;
  const relevant = lane === 'reference'
    ? [rights.sourceMaterial.decision]
    : [...componentDecisions, ...(laneDecision ? [laneDecision] : [])];
  relevant.push(...manifest.assets.map((asset) => asset.rightsDecision));
  if (relevant.some((decision) => decision === 'prohibited')) return 'blocked';
  if (relevant.some((decision) => decision !== 'allowed')) return 'review-required';
  return 'allowed';
}

function matchingLedger(
  entries: readonly ProblemAdmissionLedgerEntry[],
  manifest: ProblemArtifactManifest,
  task: ProblemTask,
  lane: ProblemAdmissionLane,
  now: number,
): {
  readonly entry?: ProblemAdmissionLedgerEntry;
  readonly expired: boolean;
  readonly future: boolean;
  readonly ambiguous: boolean;
  readonly blocked: boolean;
} {
  const exact = entries.filter((entry) => (
    entry.source === manifest.source
    && entry.sourceId === manifest.sourceId
    && entry.contentDigest === manifest.contentDigest
    && entry.taskContentDigest === task.contentDigest
  ));
  const expired = exact.some((entry) => Date.parse(entry.expiresAt) <= now);
  const future = exact.some((entry) => Date.parse(entry.decidedAt) > now);
  const current = exact
    .filter((entry) => Date.parse(entry.decidedAt) <= now && Date.parse(entry.expiresAt) > now)
    .sort((left, right) => Date.parse(right.decidedAt) - Date.parse(left.decidedAt));
  if (current.length === 0) return { expired, future, ambiguous: false, blocked: false };
  const newestTimestamp = current[0]!.decidedAt;
  const newest = current.filter((entry) => entry.decidedAt === newestTimestamp);
  const decisions = new Set(newest.map((entry) => entry.lanes[lane]));
  if (decisions.size !== 1) {
    return { expired, future, ambiguous: true, blocked: true };
  }
  const selected = newest
    .slice()
    .sort((left, right) => left.reviewer.localeCompare(right.reviewer))[0]!;
  return {
    entry: selected,
    expired,
    future,
    ambiguous: false,
    blocked: selected.lanes[lane] === 'blocked',
  };
}

export interface ProblemAdmissionRequest {
  readonly lane: ProblemAdmissionLane | string;
  readonly manifest: unknown;
  readonly task: unknown;
  readonly hostContext: ProblemAdmissionHostContext;
}

/**
 * Admit one manifest/task pair into a closed usage lane.  The function is
 * synchronous and side-effect free: it validates, returns a read-only
 * receipt, and never fetches, writes, or changes a document.
 */
export function admitProblemArtifact(
  request: ProblemAdmissionRequest,
): ProblemAdmissionResult {
  const lane = isLane(request?.lane) ? request.lane : undefined;
  if (!lane) {
    return invalid(undefined, [{ code: 'invalid-lane', path: '$.lane', message: 'Admission lane is not in the closed lane set' }]);
  }
  if (!request || !HOST_CONTEXTS.has(request.hostContext as object)) {
    return invalid(lane, [{ code: 'host-context-required', path: '$.hostContext', message: 'Admission requires a trusted host context' }]);
  }

  const manifestResult = validateProblemArtifactManifest(request.manifest);
  if (!manifestResult.ok) {
    const source = request.manifest !== null && typeof request.manifest === 'object'
      ? (request.manifest as { readonly source?: unknown }).source
      : undefined;
    const sourceError: ProblemAdmissionError | undefined = typeof source === 'string' && !isGeometryProblemSourceId(source)
      ? { code: 'source-unknown', path: '$.source', message: 'Manifest source is not in the closed source catalog' }
      : undefined;
    return invalid(lane, [
      ...(sourceError ? [sourceError] : []),
      { code: 'manifest-invalid', path: '$', message: 'Problem manifest failed validation', details: manifestResult.errors },
    ]);
  }
  const manifest = manifestResult.value;
  const taskResult = validateProblemTask(request.task, manifest);
  if (!taskResult.ok) {
    return invalid(lane, [{ code: 'task-invalid', path: '$', message: 'Problem task failed validation', details: taskResult.errors }]);
  }
  if (manifest.taint !== PROBLEM_EXTERNAL_TAINT || taskResult.value.taint !== PROBLEM_EXTERNAL_TAINT) {
    return invalid(lane, [{ code: 'manifest-invalid', path: '$.taint', message: 'Admitted material must remain externally tainted' }]);
  }

  const descriptor = getGeometryProblemSourceDescriptor(manifest.source);
  if (descriptor.accessMode === 'restricted-opt-in' && !request.hostContext.restrictedOptIn) {
    return invalid(lane, [{ code: 'restricted-opt-in-required', path: '$.hostContext.restrictedOptIn', message: 'This source requires an explicit trusted restricted-source opt-in' }]);
  }

  const catalog = catalogStatus(manifest.source, lane);
  const fromManifest = manifestStatus(manifest, lane);
  if (catalog === 'blocked') {
    return invalid(lane, [{ code: 'catalog-blocked', path: `catalog.${lane}`, message: `The source catalog blocks the ${lane} lane` }]);
  }
  if (fromManifest === 'blocked') {
    return invalid(lane, [{ code: 'manifest-blocked', path: `manifest.rights.${lane}`, message: `The manifest rights block the ${lane} lane` }]);
  }

  const requiresLedger = catalog === 'review-required' || fromManifest === 'review-required';
  let ledgerEntry: ProblemAdmissionLedgerEntry | undefined;
  if (requiresLedger) {
    const ledgerErrors: ProblemAdmissionError[] = [];
    const entries: ProblemAdmissionLedgerEntry[] = [];
    for (const [index, candidate] of request.hostContext.ledger.entries()) {
      const checked = validateProblemAdmissionLedgerEntry(candidate);
      if (!checked.ok) {
        ledgerErrors.push(...checked.errors.map((error) => ({
          ...error,
          path: `$.hostContext.ledger[${index}]${error.path === '$' ? '' : error.path.slice(1)}`,
        })));
      } else {
        entries.push(checked.value);
      }
    }
    if (ledgerErrors.length > 0) return invalid(lane, ledgerErrors);
    if (entries.length === 0) {
      return invalid(lane, [{ code: 'ledger-required', path: '$.hostContext.ledger', message: `The ${lane} lane requires an exact trusted ledger allowance` }]);
    }
    const now = Date.parse(request.hostContext.now);
    if (!Number.isFinite(now)) {
      return invalid(lane, [{ code: 'ledger-invalid', path: '$.hostContext.now', message: 'Host context clock is not a valid timestamp' }]);
    }
    const match = matchingLedger(entries, manifest, taskResult.value, lane, now);
    if (match.ambiguous) {
      return invalid(lane, [{ code: 'ledger-invalid', path: '$.hostContext.ledger', message: 'Newest exact ledger entries disagree for this lane' }]);
    }
    if (match.expired && !match.entry) {
      return invalid(lane, [{ code: 'ledger-expired', path: '$.hostContext.ledger', message: 'The exact ledger allowance has expired' }]);
    }
    if (match.blocked) {
      return invalid(lane, [{ code: 'ledger-blocked', path: `$.hostContext.ledger.lanes.${lane}`, message: 'The exact ledger entry blocks this lane' }]);
    }
    if (!match.entry) {
      return invalid(lane, [{
        code: match.future ? 'ledger-invalid' : 'ledger-no-match',
        path: '$.hostContext.ledger',
        message: match.future
          ? 'The exact ledger decision is dated in the future'
          : 'No current ledger entry exactly matches source, sourceId, manifest contentDigest, and taskContentDigest',
      }]);
    }
    ledgerEntry = match.entry;
  }

  const receipt: AdmittedProblemArtifact = Object.freeze({
    ok: true,
    lane,
    source: manifest.source,
    sourceId: manifest.sourceId,
    contentDigest: manifest.contentDigest,
    taskContentDigest: taskResult.value.contentDigest,
    manifest: cloneAndFreeze(manifest),
    task: cloneAndFreeze(taskResult.value),
    tainted: true,
    readOnly: true,
    writable: false,
    writeAuthority: 'none',
    ...(ledgerEntry ? { ledgerEntry: cloneAndFreeze(ledgerEntry) } : {}),
  });
  ADMITTED_RECEIPTS.add(receipt);
  return receipt;
}

/** Only the exact in-process receipt returned by `admitProblemArtifact` qualifies. */
export function isHostAdmittedProblemArtifact(value: unknown): value is AdmittedProblemArtifact {
  return typeof value === 'object'
    && value !== null
    && ADMITTED_RECEIPTS.has(value);
}

/** Compatibility aliases for callers that prefer an explicit policy verb. */
export const evaluateProblemAdmission = admitProblemArtifact;
export const admitGeometryProblem = admitProblemArtifact;
