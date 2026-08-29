import { projectGeogebraCommandsToGeometryDoc } from '@/lib/geometry/adapters/geogebra-geometry-doc';
import type { GeometrySemanticSignature } from '@/lib/geometry/semantic-signature';
import { hashSource } from '@/lib/tikz/document/source-hash';
import type { GeometryDoc } from '@/lib/tikz/ir/geometry-doc';

export const GEOGEBRA_COMMAND_TRANSACTION_SCHEMA_VERSION =
  'geogebra-command-transaction/v1' as const;
export const GEOGEBRA_APPLIED_SCRIPT_RECEIPT_SCHEMA_VERSION =
  'geogebra-applied-script-receipt/v1' as const;
export const GEOGEBRA_COMMAND_SNAPSHOT_SCHEMA_VERSION =
  'geogebra-command-snapshot/v1' as const;

const MAX_COMMANDS = 512;
const MAX_COMMAND_CHARS = 4_096;
const MAX_SOURCE_CHARS = 256 * 1024;
const MAX_PATCHES = 64;
const MAX_RECORDS = 128;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,256}$/u;

export interface GeogebraCommandPatch {
  readonly from: number;
  readonly to: number;
  readonly expected: readonly string[];
  readonly insert: readonly string[];
}

export interface GeogebraCommandTransaction {
  readonly schemaVersion: typeof GEOGEBRA_COMMAND_TRANSACTION_SCHEMA_VERSION;
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly origin: 'ai' | 'canvas' | 'source' | 'repair';
  readonly documentId: string;
  readonly epoch: string;
  readonly sourceId: string;
  readonly expectedRevision: number;
  readonly beforeSourceHash: string;
  readonly patches: readonly GeogebraCommandPatch[];
}

export interface GeogebraAppliedScriptReceipt {
  readonly schemaVersion: typeof GEOGEBRA_APPLIED_SCRIPT_RECEIPT_SCHEMA_VERSION;
  readonly transactionId: string;
  readonly candidateSourceHash: string;
  readonly commandCount: number;
  readonly successfulCommandCount: number;
  readonly failureCount: 0;
  readonly appliedAt: number;
}

export interface GeogebraCommandSnapshot {
  readonly schemaVersion: typeof GEOGEBRA_COMMAND_SNAPSHOT_SCHEMA_VERSION;
  readonly commands: readonly string[];
  readonly geometryDoc: GeometryDoc;
  readonly semanticSignature: GeometrySemanticSignature;
}

export interface GeogebraCommandTransactionRecord {
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly origin: GeogebraCommandTransaction['origin'];
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly beforeSourceHash: string;
  readonly afterSourceHash: string;
  readonly semanticHash: string;
  readonly committedAt: number;
}

export type GeogebraCommandBrokerResult =
  | {
    readonly ok: true;
    readonly status: 'committed' | 'idempotent';
    readonly snapshot: GeogebraCommandSnapshot;
    readonly record: GeogebraCommandTransactionRecord;
  }
  | {
    readonly ok: false;
    readonly status: 'conflict' | 'rejected';
    readonly code:
      | 'invalid-request'
      | 'document-mismatch'
      | 'epoch-mismatch'
      | 'source-id-mismatch'
      | 'revision-mismatch'
      | 'source-hash-mismatch'
      | 'patch-precondition-failed'
      | 'idempotency-conflict'
      | 'applied-receipt-mismatch'
      | 'projection-failed';
    readonly message: string;
    readonly currentRevision: number;
    readonly currentSourceHash: string;
  };

export interface GeogebraCommandBrokerIdentity {
  readonly documentId: string;
  readonly epoch: string;
  readonly revision?: number;
  readonly commands?: readonly string[];
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean': return JSON.stringify(value);
    case 'object': {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => (
        `${JSON.stringify(key)}:${canonicalJson(record[key])}`
      )).join(',')}}`;
    }
    case 'undefined': return 'null';
    default: return JSON.stringify(String(value));
  }
}

function validCommand(command: unknown): command is string {
  return typeof command === 'string'
    && command.length > 0
    && command.length <= MAX_COMMAND_CHARS
    && command.trim().length > 0
    && !/[\r\n\u0000]/u.test(command);
}

function validCommands(commands: unknown): commands is readonly string[] {
  return Array.isArray(commands)
    && commands.length <= MAX_COMMANDS
    && commands.every(validCommand)
    && commands.reduce((sum, command) => sum + command.length, 0)
      + Math.max(0, commands.length - 1) <= MAX_SOURCE_CHARS;
}

function sourceFor(commands: readonly string[]): string {
  return commands.join('\n');
}

export function geogebraCommandSourceHash(commands: readonly string[]): string {
  return hashSource(sourceFor(commands));
}

function sameCommands(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((command, index) => command === right[index]);
}

function applyPatches(
  commands: readonly string[],
  patches: readonly GeogebraCommandPatch[],
): readonly string[] | null {
  let cursor = 0;
  const output: string[] = [];
  for (const patch of patches) {
    if (
      !Number.isSafeInteger(patch.from)
      || !Number.isSafeInteger(patch.to)
      || patch.from < cursor
      || patch.to < patch.from
      || patch.to > commands.length
      || !validCommands(patch.expected)
      || !validCommands(patch.insert)
      || !sameCommands(commands.slice(patch.from, patch.to), patch.expected)
    ) return null;
    output.push(...commands.slice(cursor, patch.from), ...patch.insert);
    cursor = patch.to;
  }
  output.push(...commands.slice(cursor));
  return validCommands(output) ? output : null;
}

function validPatch(patch: unknown): patch is GeogebraCommandPatch {
  if (!patch || typeof patch !== 'object') return false;
  const candidate = patch as Partial<GeogebraCommandPatch>;
  return Number.isSafeInteger(candidate.from)
    && Number.isSafeInteger(candidate.to)
    && (candidate.from ?? -1) >= 0
    && (candidate.to ?? -1) >= (candidate.from ?? 0)
    && validCommands(candidate.expected)
    && validCommands(candidate.insert);
}

function validTransaction(request: GeogebraCommandTransaction): boolean {
  return request.schemaVersion === GEOGEBRA_COMMAND_TRANSACTION_SCHEMA_VERSION
    && IDENTIFIER.test(request.transactionId)
    && IDENTIFIER.test(request.idempotencyKey)
    && (request.origin === 'ai'
      || request.origin === 'canvas'
      || request.origin === 'source'
      || request.origin === 'repair')
    && IDENTIFIER.test(request.documentId)
    && IDENTIFIER.test(request.epoch)
    && IDENTIFIER.test(request.sourceId)
    && Number.isSafeInteger(request.expectedRevision)
    && request.expectedRevision >= 0
    && typeof request.beforeSourceHash === 'string'
    && request.beforeSourceHash.length > 0
    && request.beforeSourceHash.length <= 256
    && Array.isArray(request.patches)
    && request.patches.length > 0
    && request.patches.length <= MAX_PATCHES
    && request.patches.every(validPatch);
}

function validReceipt(receipt: GeogebraAppliedScriptReceipt): boolean {
  return receipt.schemaVersion === GEOGEBRA_APPLIED_SCRIPT_RECEIPT_SCHEMA_VERSION
    && IDENTIFIER.test(receipt.transactionId)
    && typeof receipt.candidateSourceHash === 'string'
    && receipt.candidateSourceHash.length > 0
    && receipt.candidateSourceHash.length <= 256
    && Number.isSafeInteger(receipt.commandCount)
    && receipt.commandCount >= 0
    && receipt.commandCount <= MAX_COMMANDS
    && Number.isSafeInteger(receipt.successfulCommandCount)
    && receipt.successfulCommandCount === receipt.commandCount
    && receipt.failureCount === 0
    && Number.isSafeInteger(receipt.appliedAt)
    && receipt.appliedAt > 0;
}

function cloneSnapshot(snapshot: GeogebraCommandSnapshot): GeogebraCommandSnapshot {
  return structuredClone(snapshot);
}

export function createGeogebraReplaceScriptTransaction(input: {
  readonly snapshot: GeogebraCommandSnapshot;
  readonly commands: readonly string[];
  readonly transactionId: string;
  readonly idempotencyKey?: string;
  readonly origin: GeogebraCommandTransaction['origin'];
}): GeogebraCommandTransaction {
  if (!validCommands(input.commands)) {
    throw new TypeError('GeoGebra replacement script is invalid or exceeds its safety bound.');
  }
  return {
    schemaVersion: GEOGEBRA_COMMAND_TRANSACTION_SCHEMA_VERSION,
    transactionId: input.transactionId,
    idempotencyKey: input.idempotencyKey ?? input.transactionId,
    origin: input.origin,
    documentId: input.snapshot.geometryDoc.basis.documentId,
    epoch: input.snapshot.geometryDoc.basis.epoch,
    sourceId: input.snapshot.geometryDoc.basis.sourceId!,
    expectedRevision: input.snapshot.geometryDoc.basis.revision,
    beforeSourceHash: input.snapshot.geometryDoc.basis.sourceHash,
    patches: [{
      from: 0,
      to: input.snapshot.commands.length,
      expected: [...input.snapshot.commands],
      insert: [...input.commands],
    }],
  };
}

export function createGeogebraAppliedScriptReceipt(input: {
  readonly transactionId: string;
  readonly commands: readonly string[];
  readonly successfulCommandCount: number;
  readonly failureCount: number;
  readonly appliedAt?: number;
}): GeogebraAppliedScriptReceipt | null {
  const appliedAt = input.appliedAt ?? Date.now();
  if (
    !IDENTIFIER.test(input.transactionId)
    || !validCommands(input.commands)
    || !Number.isSafeInteger(input.successfulCommandCount)
    || input.successfulCommandCount !== input.commands.length
    || input.failureCount !== 0
    || !Number.isSafeInteger(appliedAt)
    || appliedAt <= 0
  ) return null;
  return {
    schemaVersion: GEOGEBRA_APPLIED_SCRIPT_RECEIPT_SCHEMA_VERSION,
    transactionId: input.transactionId,
    candidateSourceHash: geogebraCommandSourceHash(input.commands),
    commandCount: input.commands.length,
    successfulCommandCount: input.successfulCommandCount,
    failureCount: 0,
    appliedAt,
  };
}

export class GeogebraCommandTransactionBroker {
  readonly #records = new Map<string, GeogebraCommandTransactionRecord>();
  #snapshot: GeogebraCommandSnapshot;

  constructor(identity: GeogebraCommandBrokerIdentity) {
    if (
      !IDENTIFIER.test(identity.documentId)
      || !IDENTIFIER.test(identity.epoch)
      || !Number.isSafeInteger(identity.revision ?? 0)
      || (identity.revision ?? 0) < 0
      || !validCommands(identity.commands ?? [])
    ) throw new TypeError('GeoGebra broker requires a valid initial snapshot identity.');
    const projection = projectGeogebraCommandsToGeometryDoc({
      commands: [...(identity.commands ?? [])],
      identity: {
        documentId: identity.documentId,
        epoch: identity.epoch,
        revision: identity.revision ?? 0,
      },
    });
    this.#snapshot = {
      schemaVersion: GEOGEBRA_COMMAND_SNAPSHOT_SCHEMA_VERSION,
      commands: [...(identity.commands ?? [])],
      geometryDoc: projection.geometryDoc,
      semanticSignature: projection.semanticSignature,
    };
  }

  snapshot(): GeogebraCommandSnapshot {
    return cloneSnapshot(this.#snapshot);
  }

  commitApplied(
    request: GeogebraCommandTransaction,
    receipt: GeogebraAppliedScriptReceipt,
    coordOf?: (name: string) => { x: number; y: number } | null,
  ): GeogebraCommandBrokerResult {
    const current = this.#snapshot;
    const reject = (
      status: 'conflict' | 'rejected',
      code: Extract<GeogebraCommandBrokerResult, { ok: false }>['code'],
      message: string,
    ): GeogebraCommandBrokerResult => ({
      ok: false,
      status,
      code,
      message,
      currentRevision: current.geometryDoc.basis.revision,
      currentSourceHash: current.geometryDoc.basis.sourceHash,
    });
    if (!validTransaction(request)) {
      return reject('rejected', 'invalid-request', 'GeoGebra transaction shape is invalid.');
    }
    const fingerprint = hashSource(canonicalJson(request));
    const previous = this.#records.get(request.idempotencyKey);
    if (previous) {
      if (previous.requestFingerprint !== fingerprint) {
        return reject('conflict', 'idempotency-conflict', 'Idempotency key was reused for a different request.');
      }
      return {
        ok: true,
        status: 'idempotent',
        snapshot: this.snapshot(),
        record: structuredClone(previous),
      };
    }
    const basis = current.geometryDoc.basis;
    if (request.documentId !== basis.documentId) {
      return reject('conflict', 'document-mismatch', 'GeoGebra document identity is stale.');
    }
    if (request.epoch !== basis.epoch) {
      return reject('conflict', 'epoch-mismatch', 'GeoGebra document epoch is stale.');
    }
    if (request.sourceId !== basis.sourceId) {
      return reject('conflict', 'source-id-mismatch', 'GeoGebra source identity is stale.');
    }
    if (request.expectedRevision !== basis.revision) {
      return reject('conflict', 'revision-mismatch', 'GeoGebra command revision is stale.');
    }
    if (request.beforeSourceHash !== basis.sourceHash) {
      return reject('conflict', 'source-hash-mismatch', 'GeoGebra command source hash is stale.');
    }
    const candidate = applyPatches(current.commands, request.patches);
    if (!candidate) {
      return reject('conflict', 'patch-precondition-failed', 'GeoGebra command patch precondition failed.');
    }
    const candidateSourceHash = geogebraCommandSourceHash(candidate);
    if (
      !validReceipt(receipt)
      || receipt.transactionId !== request.transactionId
      || receipt.candidateSourceHash !== candidateSourceHash
      || receipt.commandCount !== candidate.length
    ) {
      return reject('rejected', 'applied-receipt-mismatch', 'Host-applied GeoGebra receipt does not match the candidate script.');
    }
    let projection: ReturnType<typeof projectGeogebraCommandsToGeometryDoc>;
    try {
      projection = projectGeogebraCommandsToGeometryDoc({
        commands: candidate,
        identity: {
          documentId: basis.documentId,
          epoch: basis.epoch,
          revision: basis.revision + 1,
        },
        coordOf,
      });
    } catch (error) {
      return reject(
        'rejected',
        'projection-failed',
        error instanceof Error ? error.message : 'GeoGebra semantic projection failed.',
      );
    }
    if (projection.geometryDoc.basis.sourceHash !== candidateSourceHash) {
      return reject('rejected', 'projection-failed', 'GeoGebra projection detached from the applied command source.');
    }
    const record: GeogebraCommandTransactionRecord = {
      transactionId: request.transactionId,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: fingerprint,
      origin: request.origin,
      fromRevision: basis.revision,
      toRevision: projection.geometryDoc.basis.revision,
      beforeSourceHash: basis.sourceHash,
      afterSourceHash: projection.geometryDoc.basis.sourceHash,
      semanticHash: projection.semanticSignature.semanticHash,
      committedAt: receipt.appliedAt,
    };
    this.#snapshot = {
      schemaVersion: GEOGEBRA_COMMAND_SNAPSHOT_SCHEMA_VERSION,
      commands: [...candidate],
      geometryDoc: projection.geometryDoc,
      semanticSignature: projection.semanticSignature,
    };
    this.#records.set(request.idempotencyKey, record);
    if (this.#records.size > MAX_RECORDS) {
      this.#records.delete(this.#records.keys().next().value as string);
    }
    return {
      ok: true,
      status: 'committed',
      snapshot: this.snapshot(),
      record: structuredClone(record),
    };
  }
}
