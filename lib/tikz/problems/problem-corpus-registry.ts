import { createHash } from 'node:crypto';
import {
  PROBLEM_EXTERNAL_TAINT,
  validateProblemArtifactManifest,
  validateProblemTask,
  type ProblemArtifactManifest,
  type ProblemManifestValidationError,
  type ProblemTask,
} from './problem-artifact-manifest';
import {
  isGeometryProblemSourceId,
  type GeometryProblemSourceId,
} from './source-catalog';
import {
  isHostAdmittedProblemArtifact,
  type AdmittedProblemArtifact,
} from './problem-admission-policy';

/**
 * The corpus registry is the final, read-only boundary between the host
 * admission policy and an evaluation runner.  It accepts no live gateway
 * records and performs no network or canvas work.
 */
export const PROBLEM_CORPUS_ENTRY_SCHEMA = 'ProblemCorpusEntry/v1' as const;
export const PROBLEM_ADMITTED_REFERENCE_SCHEMA = 'AdmittedProblemReference/v1' as const;
export const PROBLEM_CORPUS_REGISTRY_SCHEMA = 'ProblemCorpusRegistry/v1' as const;

export type ProblemCorpusEntrySchema = typeof PROBLEM_CORPUS_ENTRY_SCHEMA;
export type ProblemAdmittedReferenceSchema = typeof PROBLEM_ADMITTED_REFERENCE_SCHEMA;
export type ProblemCorpusRegistrySchema = typeof PROBLEM_CORPUS_REGISTRY_SCHEMA;

export interface ProblemAdmittedReference {
  readonly schemaVersion: ProblemAdmittedReferenceSchema;
  readonly identity: string;
  readonly source: GeometryProblemSourceId;
  readonly sourceId: string;
  readonly contentDigest: string;
  readonly taskId: string;
  readonly taskContentDigest: string;
  readonly split: ProblemTask['split'];
  readonly leakageGroup: string;
  readonly lane: 'evaluation';
  readonly taint: typeof PROBLEM_EXTERNAL_TAINT;
  readonly tainted: true;
  readonly readOnly: true;
  readonly writable: false;
  readonly writeAuthority: 'none';
}

export interface ProblemCorpusEntry {
  readonly schemaVersion: ProblemCorpusEntrySchema;
  /** SHA-256 identity of the stable entry fields and task projection. */
  readonly identity: string;
  readonly source: GeometryProblemSourceId;
  readonly sourceId: string;
  readonly contentDigest: string;
  readonly taskId: string;
  readonly taskContentDigest: string;
  readonly split: ProblemTask['split'];
  readonly leakageGroup: string;
  readonly lane: 'evaluation';
  readonly taint: typeof PROBLEM_EXTERNAL_TAINT;
  readonly manifest: ProblemArtifactManifest;
  readonly task: ProblemTask;
  readonly reference: ProblemAdmittedReference;
}

export interface ProblemCorpusRegistry {
  readonly schemaVersion: ProblemCorpusRegistrySchema;
  readonly entries: readonly ProblemCorpusEntry[];
  readonly references: readonly ProblemAdmittedReference[];
}

export type ProblemCorpusRegistryErrorCode =
  | 'invalid-input'
  | 'not-admitted'
  | 'wrong-lane'
  | 'mutability-invariant'
  | 'taint-invariant'
  | 'reference-only'
  | 'unknown-source'
  | 'manifest-invalid'
  | 'task-invalid'
  | 'identity-mismatch'
  | 'duplicate-source-id'
  | 'duplicate-content-digest'
  | 'duplicate-task-id'
  | 'split-leakage-conflict'
  | 'item-budget';

export interface ProblemCorpusRegistryError {
  readonly code: ProblemCorpusRegistryErrorCode;
  readonly path: string;
  readonly message: string;
  readonly details?: readonly ProblemManifestValidationError[];
}

export interface ProblemCorpusEntrySuccess {
  readonly ok: true;
  readonly entry: ProblemCorpusEntry;
  readonly reference: ProblemAdmittedReference;
}

export interface ProblemCorpusEntryFailure {
  readonly ok: false;
  readonly errors: readonly ProblemCorpusRegistryError[];
}

export type ProblemCorpusEntryResult = ProblemCorpusEntrySuccess | ProblemCorpusEntryFailure;

export interface ProblemCorpusRegistrySuccess {
  readonly ok: true;
  readonly registry: ProblemCorpusRegistry;
}

export interface ProblemCorpusRegistryFailure {
  readonly ok: false;
  readonly errors: readonly ProblemCorpusRegistryError[];
}

export type ProblemCorpusRegistryResult = ProblemCorpusRegistrySuccess | ProblemCorpusRegistryFailure;

export const PROBLEM_CORPUS_REGISTRY_LIMITS = {
  maxEntries: 512,
} as const;

const SHA256 = /^[a-f0-9]{64}$/u;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(
  errors: ProblemCorpusRegistryError[],
  code: ProblemCorpusRegistryErrorCode,
  path: string,
  message: string,
  details?: readonly ProblemManifestValidationError[],
): void {
  errors.push({
    code,
    path,
    message,
    ...(details ? { details } : {}),
  });
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (record(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export interface ProblemCorpusIdentityMaterial {
  readonly source: string;
  readonly sourceId: string;
  readonly contentDigest: string;
  readonly taskId: string;
  /** Optional for compatibility with pre-task-digest identity callers. */
  readonly taskContentDigest?: string;
  readonly split: ProblemTask['split'];
  readonly leakageGroup: string;
  readonly task: ProblemTask;
}

/**
 * Stable identity bytes for a corpus entry.  The identity does not include
 * itself and does not include the full manifest body: the manifest's own
 * canonical SHA-256 digest binds that body, while the task projection binds
 * the evaluation instructions.
 */
export function canonicalProblemCorpusIdentityMaterial(
  material: ProblemCorpusIdentityMaterial,
): string {
  return canonicalJson({
    schemaVersion: PROBLEM_CORPUS_ENTRY_SCHEMA,
    source: material.source,
    sourceId: material.sourceId,
    contentDigest: material.contentDigest,
    taskId: material.taskId,
    taskContentDigest: material.taskContentDigest ?? material.task.contentDigest,
    split: material.split,
    leakageGroup: material.leakageGroup,
    task: material.task,
  });
}

export function problemCorpusIdentitySha256(material: ProblemCorpusIdentityMaterial): string {
  return createHash('sha256')
    .update(canonicalProblemCorpusIdentityMaterial(material), 'utf8')
    .digest('hex');
}

export const canonicalCorpusIdentityMaterial = canonicalProblemCorpusIdentityMaterial;

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    const clone = value.map((entry) => cloneAndFreeze(entry)) as T;
    return Object.freeze(clone);
  }
  if (record(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) clone[key] = cloneAndFreeze(entry);
    return Object.freeze(clone) as T;
  }
  return value;
}

function exactAdmissionKeys(value: Record<string, unknown>, errors: ProblemCorpusRegistryError[]): void {
  const allowed = new Set([
    'ok',
    'lane',
    'source',
    'sourceId',
    'contentDigest',
    'taskContentDigest',
    'manifest',
    'task',
    'tainted',
    'readOnly',
    'writable',
    'writeAuthority',
    'ledgerEntry',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issue(errors, 'invalid-input', `$.${key}`, 'Unknown admission result field');
  }
}

function hasLiveReferenceMarker(value: Record<string, unknown>): boolean {
  if (value.admission === 'search-reference-only' || value.revisionStatus === 'unpinned-live-viewer') return true;
  const provider = record(value.provider) ? value.provider : undefined;
  return provider?.revision === null || provider?.revisionStatus === 'unpinned-live-viewer';
}

function validateAdmissionInvariants(
  input: unknown,
  errors: ProblemCorpusRegistryError[],
): input is AdmittedProblemArtifact {
  if (!record(input)) {
    issue(errors, 'invalid-input', '$', 'Admission result must be an object');
    return false;
  }
  if (!isHostAdmittedProblemArtifact(input)) {
    issue(errors, 'not-admitted', '$', 'Corpus registration requires the exact host-issued admission receipt');
    return false;
  }
  exactAdmissionKeys(input, errors);
  if (input.ok !== true) {
    issue(errors, 'not-admitted', '$.ok', 'Only ok=true admission results can enter the corpus');
    return false;
  }
  if (input.lane !== 'evaluation') issue(errors, 'wrong-lane', '$.lane', 'Corpus registry accepts only evaluation admissions');
  if (input.tainted !== true) issue(errors, 'taint-invariant', '$.tainted', 'Admission must retain tainted=true');
  if (input.readOnly !== true || input.writable !== false || input.writeAuthority !== 'none') {
    issue(errors, 'mutability-invariant', '$', 'Corpus entries must be read-only and have no write authority');
  }
  if (record(input.manifest) && hasLiveReferenceMarker(input.manifest)) {
    issue(errors, 'reference-only', '$.manifest', 'Live search-reference-only records cannot enter the corpus');
  }
  if (record(input.task) && hasLiveReferenceMarker(input.task)) {
    issue(errors, 'reference-only', '$.task', 'Live search-reference-only tasks cannot enter the corpus');
  }
  return true;
}

interface CheckedAdmission {
  readonly source: GeometryProblemSourceId;
  readonly sourceId: string;
  readonly contentDigest: string;
  readonly manifest: ProblemArtifactManifest;
  readonly task: ProblemTask;
}

function checkAdmission(
  input: unknown,
  path: string,
  errors: ProblemCorpusRegistryError[],
): CheckedAdmission | null {
  if (!validateAdmissionInvariants(input, errors)) return null;
  const admission = input as AdmittedProblemArtifact;
  if (!isGeometryProblemSourceId(admission.source)) {
    issue(errors, 'unknown-source', `${path}.source`, 'Source is not in the closed geometry source catalog');
  }
  if (typeof admission.contentDigest !== 'string' || !SHA256.test(admission.contentDigest)) {
    issue(errors, 'identity-mismatch', `${path}.contentDigest`, 'Admission contentDigest must be a lowercase 64-hex SHA-256');
  }
  if (typeof admission.taskContentDigest !== 'string' || !SHA256.test(admission.taskContentDigest)) {
    issue(errors, 'identity-mismatch', `${path}.taskContentDigest`, 'Admission taskContentDigest must be a lowercase 64-hex SHA-256');
  }
  const manifestResult = validateProblemArtifactManifest(admission.manifest);
  if (!manifestResult.ok) issue(errors, 'manifest-invalid', `${path}.manifest`, 'Manifest failed a second validation', manifestResult.errors);
  const manifest = manifestResult.ok ? manifestResult.value : null;
  const taskResult = manifest
    ? validateProblemTask(admission.task, manifest)
    : validateProblemTask(admission.task);
  if (!taskResult.ok) issue(errors, 'task-invalid', `${path}.task`, 'Task failed a second validation', taskResult.errors);
  const task = taskResult.ok ? taskResult.value : null;
  if (manifest) {
    if (admission.source !== manifest.source) issue(errors, 'identity-mismatch', `${path}.source`, 'Admission source does not match manifest');
    if (admission.sourceId !== manifest.sourceId) issue(errors, 'identity-mismatch', `${path}.sourceId`, 'Admission sourceId does not match manifest');
    if (admission.contentDigest !== manifest.contentDigest) issue(errors, 'identity-mismatch', `${path}.contentDigest`, 'Admission digest does not match manifest');
    if (manifest.taint !== PROBLEM_EXTERNAL_TAINT) issue(errors, 'taint-invariant', `${path}.manifest.taint`, 'Manifest taint invariant was not retained');
  }
  if (task && admission.taskContentDigest !== task.contentDigest) issue(errors, 'identity-mismatch', `${path}.taskContentDigest`, 'Admission task digest does not match task');
  if (task && task.taint !== PROBLEM_EXTERNAL_TAINT) issue(errors, 'taint-invariant', `${path}.task.taint`, 'Task taint invariant was not retained');
  if (!manifest || !task || !isGeometryProblemSourceId(admission.source)) return null;
  if (errors.length > 0) return null;
  return {
    source: admission.source,
    sourceId: admission.sourceId,
    contentDigest: admission.contentDigest,
    manifest,
    task,
  };
}

function duplicateErrors(
  entries: readonly ProblemCorpusEntry[],
  candidate: CheckedAdmission,
  path: string,
): ProblemCorpusRegistryError[] {
  const errors: ProblemCorpusRegistryError[] = [];
  for (const entry of entries) {
    if (entry.sourceId === candidate.sourceId) issue(errors, 'duplicate-source-id', `${path}.sourceId`, 'sourceId is already registered');
    if (entry.contentDigest === candidate.contentDigest) issue(errors, 'duplicate-content-digest', `${path}.contentDigest`, 'contentDigest is already registered');
    if (entry.taskId === candidate.task.taskId) issue(errors, 'duplicate-task-id', `${path}.taskId`, 'taskId is already registered');
    if (entry.leakageGroup === candidate.task.leakageGroup && entry.split !== candidate.task.split) {
      issue(errors, 'split-leakage-conflict', `${path}.leakageGroup`, 'One leakageGroup cannot cross evaluation splits');
    }
  }
  return errors;
}

function makeEntry(candidate: CheckedAdmission): ProblemCorpusEntry {
  const material: ProblemCorpusIdentityMaterial = {
    source: candidate.source,
    sourceId: candidate.sourceId,
    contentDigest: candidate.contentDigest,
    taskId: candidate.task.taskId,
    taskContentDigest: candidate.task.contentDigest,
    split: candidate.task.split,
    leakageGroup: candidate.task.leakageGroup,
    task: candidate.task,
  };
  const identity = problemCorpusIdentitySha256(material);
  const reference: ProblemAdmittedReference = {
    schemaVersion: PROBLEM_ADMITTED_REFERENCE_SCHEMA,
    identity,
    source: candidate.source,
    sourceId: candidate.sourceId,
    contentDigest: candidate.contentDigest,
    taskId: candidate.task.taskId,
    taskContentDigest: candidate.task.contentDigest,
    split: candidate.task.split,
    leakageGroup: candidate.task.leakageGroup,
    lane: 'evaluation',
    taint: PROBLEM_EXTERNAL_TAINT,
    tainted: true,
    readOnly: true,
    writable: false,
    writeAuthority: 'none',
  };
  return {
    schemaVersion: PROBLEM_CORPUS_ENTRY_SCHEMA,
    identity,
    source: candidate.source,
    sourceId: candidate.sourceId,
    contentDigest: candidate.contentDigest,
    taskId: candidate.task.taskId,
    taskContentDigest: candidate.task.contentDigest,
    split: candidate.task.split,
    leakageGroup: candidate.task.leakageGroup,
    lane: 'evaluation',
    taint: PROBLEM_EXTERNAL_TAINT,
    manifest: candidate.manifest,
    task: candidate.task,
    reference,
  };
}

/** Validate one already-admitted result and produce an immutable entry. */
export function createProblemCorpusEntry(input: unknown): ProblemCorpusEntryResult {
  const errors: ProblemCorpusRegistryError[] = [];
  const checked = checkAdmission(input, '$', errors);
  if (!checked) return { ok: false, errors };
  const entry = cloneAndFreeze(makeEntry({
    ...checked,
    manifest: cloneAndFreeze(checked.manifest),
    task: cloneAndFreeze(checked.task),
  }));
  return {
    ok: true,
    entry,
    reference: entry.reference,
  };
}

/**
 * Validate a bounded batch and atomically return a frozen registry.  No entry
 * is returned when any row is invalid, duplicated, or leaks a leakageGroup
 * across splits.
 */
export function createProblemCorpusRegistry(
  inputs: readonly unknown[],
): ProblemCorpusRegistryResult {
  if (!Array.isArray(inputs) || inputs.length > PROBLEM_CORPUS_REGISTRY_LIMITS.maxEntries) {
    return {
      ok: false,
      errors: [{
        code: 'item-budget',
        path: '$',
        message: `Registry must contain 0-${PROBLEM_CORPUS_REGISTRY_LIMITS.maxEntries} admissions`,
      }],
    };
  }
  const errors: ProblemCorpusRegistryError[] = [];
  const checked: CheckedAdmission[] = [];
  for (const [index, input] of inputs.entries()) {
    const rowErrors: ProblemCorpusRegistryError[] = [];
    const candidate = checkAdmission(input, `$[${index}]`, rowErrors);
    if (candidate) {
      const priorEntries = checked.map((item) => makeEntry(item));
      rowErrors.push(...duplicateErrors(priorEntries, candidate, `$[${index}]`));
      if (rowErrors.length === 0) checked.push(candidate);
    }
    errors.push(...rowErrors);
  }
  if (errors.length > 0) return { ok: false, errors };
  const entries = checked.map((candidate) => {
    const entry = makeEntry({
      ...candidate,
      manifest: cloneAndFreeze(candidate.manifest),
      task: cloneAndFreeze(candidate.task),
    });
    return cloneAndFreeze(entry);
  });
  const references = entries.map((entry) => entry.reference);
  return {
    ok: true,
    registry: cloneAndFreeze({
      schemaVersion: PROBLEM_CORPUS_REGISTRY_SCHEMA,
      entries,
      references,
    }),
  };
}

/** Explicit aliases for callers that speak in admission/registration terms. */
export const admitProblemCorpusCanary = createProblemCorpusEntry;
export const registerProblemCorpus = createProblemCorpusRegistry;
