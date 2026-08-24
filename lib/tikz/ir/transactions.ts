import type {
  ConstructionBinding,
  GeometryConstraint,
  GeometryDiagnostic,
  GeometryEntity,
  GeometryRecordReference,
  GeometryRelation,
  GeometryRevisionBasis,
  GeometryStyle,
  JsonObject,
  JsonValue,
  SourceRange,
  SourceTextPatch,
} from './model';
import type { GeometryProjection } from './projection';

export const GEOMETRY_TRANSACTION_SCHEMA_VERSION = 'geometry-transaction/v1' as const;
export const GEOMETRY_WORKSPACE_EDIT_SCHEMA_VERSION =
  'geometry-workspace-edit/v1' as const;

export type GeometryTransactionLifecycleState =
  | 'proposed'
  | 'previewed'
  | 'validated'
  | 'committed'
  | 'conflicted'
  | 'rejected';

export type GeometryOperationKind =
  | 'add'
  | 'update'
  | 'remove'
  | 'relate'
  | 'constrain'
  | 'source-patch';

export type GeometryTransactionOrigin =
  | 'source'
  | 'ai'
  | 'canvas'
  | 'compiler'
  | 'system'
  | 'external'
  | `plugin:${string}`
  | `integration:${string}`;

export interface GeometryChangeAnnotation {
  /** Short, user-facing summary suitable for a review card. */
  label: string;
  description?: string;
  needsConfirmation?: boolean;
  /** Canonical semantic IDs affected by this change; never aliases. */
  semanticTargetIds?: readonly string[];
}

export interface GeometryOperationChangeAnnotation {
  operationId: string;
  annotationId: string;
  /** One annotation per source patch, in patch order. */
  patchAnnotationIds?: readonly string[];
}

/**
 * Review metadata for an atomic Geometry transaction.
 *
 * Source edits remain in `operations`; this descriptor deliberately references
 * them by ID/index so the review UI cannot become a second patch truth.
 */
export interface GeometryWorkspaceEdit {
  schemaVersion: typeof GEOMETRY_WORKSPACE_EDIT_SCHEMA_VERSION;
  failureHandling: 'atomic';
  changeAnnotations: Readonly<Record<string, GeometryChangeAnnotation>>;
  operationAnnotations: readonly GeometryOperationChangeAnnotation[];
}

export type GeometryPrecondition =
  | {
    kind: 'record-exists';
    target: GeometryRecordReference;
  }
  | {
    kind: 'record-absent';
    target: GeometryRecordReference;
  }
  | {
    kind: 'field-equals';
    target: GeometryRecordReference;
    /** JSON Pointer into the record. */
    path: string;
    value: JsonValue;
  }
  | {
    kind: 'source-slice-equals';
    sourceId: string;
    range: SourceRange;
    text?: string;
    sliceHash?: string;
  }
  | {
    kind: 'capability-available';
    capability: string;
    pluginId?: string;
  }
  | {
    kind: 'extension';
    namespace: string;
    name: string;
    parameters?: JsonObject;
  };

export type GeometryResourceReference =
  | {
    kind: 'record';
    target: GeometryRecordReference;
  }
  | {
    kind: 'source-range';
    sourceId: string;
    range: SourceRange;
    sliceHash?: string;
  }
  | {
    kind: 'plugin';
    pluginId: string;
    version?: string;
  }
  | {
    kind: 'document';
    documentId: string;
  }
  | {
    kind: 'extension';
    namespace: string;
    id: string;
  };

export interface GeometryOperationBase {
  operationId: string;
  preconditions?: readonly GeometryPrecondition[];
  metadata?: JsonObject;
}

export type AddableGeometryRecord =
  | GeometryEntity
  | GeometryStyle
  | ConstructionBinding;

export interface AddGeometryOperation extends GeometryOperationBase {
  op: 'add';
  record: AddableGeometryRecord;
}

export type GeometryFieldMutation =
  | {
    op: 'set';
    /** JSON Pointer into the target record. */
    path: string;
    value: JsonValue;
  }
  | {
    op: 'remove';
    path: string;
  }
  | {
    op: 'merge';
    path: string;
    value: JsonObject;
  };

export interface UpdateGeometryOperation extends GeometryOperationBase {
  op: 'update';
  target: GeometryRecordReference;
  mutations: readonly GeometryFieldMutation[];
}

export interface RemoveGeometryOperation extends GeometryOperationBase {
  op: 'remove';
  target: GeometryRecordReference;
  cascade?: 'reject' | 'dependents' | 'detach';
}

export interface RelateGeometryOperation extends GeometryOperationBase {
  op: 'relate';
  relation: GeometryRelation;
}

export interface ConstrainGeometryOperation extends GeometryOperationBase {
  op: 'constrain';
  constraint: GeometryConstraint;
}

export interface SourcePatchGeometryOperation extends GeometryOperationBase {
  op: 'source-patch';
  patches: readonly SourceTextPatch[];
}

export type GeometryOperation =
  | AddGeometryOperation
  | UpdateGeometryOperation
  | RemoveGeometryOperation
  | RelateGeometryOperation
  | ConstrainGeometryOperation
  | SourcePatchGeometryOperation;

/**
 * Optimistic transaction request.
 *
 * `sourceHash` is the expected hash of `expectedRevision`; both guards must
 * match before any operation is applied. Operations are atomic as one request.
 */
export interface GeometryTransactionRequest {
  schemaVersion: typeof GEOMETRY_TRANSACTION_SCHEMA_VERSION;
  transactionId: string;
  idempotencyKey: string;
  documentId: string;
  documentEpoch: string;
  origin: GeometryTransactionOrigin;
  stage?: Extract<GeometryTransactionLifecycleState, 'proposed' | 'previewed' | 'validated'>;
  expectedRevision: number;
  sourceHash: string;
  expectedKernelHash?: string;
  /** Exact renderer/source-map projection identity used by typed authoring intents. */
  expectedProjectionHash?: string;
  pluginSetDigest?: string;
  readSet: readonly GeometryResourceReference[];
  writeSet: readonly GeometryResourceReference[];
  preconditions?: readonly GeometryPrecondition[];
  operations: readonly GeometryOperation[];
  workspaceEdit?: GeometryWorkspaceEdit;
  actorId?: string;
  correlationId?: string;
  metadata?: JsonObject;
}

export type GeometryConflictCode =
  | 'document-epoch-mismatch'
  | 'revision-mismatch'
  | 'source-hash-mismatch'
  | 'kernel-hash-mismatch'
  | 'projection-hash-mismatch'
  | 'read-set-changed'
  | 'write-set-conflict'
  | 'plugin-set-mismatch'
  | 'precondition-failed'
  | 'record-conflict'
  | 'source-range-conflict'
  | 'operation-conflict';

export interface GeometryTransactionConflict {
  code: GeometryConflictCode;
  message: string;
  operationId?: string;
  precondition?: GeometryPrecondition;
  target?: GeometryRecordReference;
  sourceId?: string;
  range?: SourceRange;
  expected?: JsonValue;
  actual?: JsonValue;
  data?: JsonObject;
}

export interface GeometryTransactionCommittedResult {
  ok: true;
  status: 'committed';
  transactionId: string;
  previous: GeometryRevisionBasis;
  current: GeometryRevisionBasis;
  appliedOperationIds: readonly string[];
  sourcePatches: readonly SourceTextPatch[];
  diagnostics: readonly GeometryDiagnostic[];
  projection?: GeometryProjection;
}

export interface GeometryTransactionConflictResult {
  ok: false;
  status: 'conflict';
  transactionId: string;
  expected: GeometryRevisionBasis;
  current: GeometryRevisionBasis;
  conflicts: readonly GeometryTransactionConflict[];
  retryable: boolean;
  projection?: GeometryProjection;
}

export interface GeometryTransactionRejectedResult {
  ok: false;
  status: 'rejected';
  transactionId: string;
  basis: GeometryRevisionBasis;
  code: string;
  message: string;
  diagnostics: readonly GeometryDiagnostic[];
}

export type GeometryTransactionResult =
  | GeometryTransactionCommittedResult
  | GeometryTransactionConflictResult
  | GeometryTransactionRejectedResult;
