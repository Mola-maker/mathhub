/**
 * Geometry Semantic Kernel v1 data model.
 *
 * This module lives under the TikZ integration package for now, but the IR is
 * intentionally language- and renderer-neutral. TikZ is represented by one
 * construction binding variant rather than being the semantic kernel itself.
 */

export const GEOMETRY_IR_SCHEMA_VERSION = 'geometry-ir/v1' as const;
export const GEOMETRY_KERNEL_SCHEMA_VERSION = 'geometry-semantic-kernel/v1' as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type GeometryTruthKind = 'semantic' | 'construction' | 'rendering';
export type GeometryRecordType =
  | 'entity'
  | 'constraint'
  | 'relation'
  | 'style'
  | 'source-binding';

export interface GeometryRecordReference {
  recordType: GeometryRecordType;
  id: string;
}

export interface GeometryBindableRecordReference {
  recordType: Exclude<GeometryRecordType, 'source-binding'>;
  id: string;
}

/**
 * Half-open source range: `start` is inclusive and `end` is exclusive.
 * Offset units live on the source reference so existing `{ start, end }` TikZ
 * CST ranges can be used without conversion.
 */
export interface SourceRange {
  start: number;
  end: number;
}

export type SourceOffsetUnit =
  | 'utf16-code-unit'
  | 'utf8-byte'
  | 'unicode-code-point';

export interface SourceDocumentReference {
  sourceId: string;
  languageId: string;
  revision: number;
  hash: string;
  hashAlgorithm: string;
  offsetUnit: SourceOffsetUnit;
  encoding?: string;
  length?: number;
}

/** An immutable source snapshot. `text` is never normalized. */
export interface SourceDocument extends SourceDocumentReference {
  text: string;
}

/**
 * Exact source slice bound to an immutable source snapshot.
 *
 * `verbatim` makes opaque or unsupported syntax round-trippable even when the
 * referenced source snapshot is no longer resident in memory.
 */
export interface LosslessSourceReference {
  document: SourceDocumentReference;
  range: SourceRange;
  verbatim: string;
  sliceHash?: string;
}

export interface SourceTextPatch {
  sourceId: string;
  range: SourceRange;
  insert: string;
  /** Optional compare-and-swap guard for the replaced source slice. */
  expectedText?: string;
  expectedSliceHash?: string;
}

export type ConstructionBindingRole =
  | 'definition'
  | 'reference'
  | 'constraint'
  | 'relation'
  | 'style'
  | 'label'
  | 'opaque'
  | 'custom';

export interface ConstructionBindingBase {
  recordType: 'source-binding';
  id: string;
  role: ConstructionBindingRole;
  targets: readonly GeometryBindableRecordReference[];
  source: LosslessSourceReference;
  writable: boolean;
  metadata?: JsonObject;
}

/** Language-neutral source/AST binding. */
export interface SourceRangeConstructionBinding extends ConstructionBindingBase {
  kind: 'source-range';
  syntaxNodeType?: string;
  syntaxPath?: readonly (string | number)[];
}

/**
 * Absolute TikZ/Lezer CST ranges. Lezer uses UTF-16 code-unit offsets, so a
 * TikZ source reference should declare `offsetUnit: 'utf16-code-unit'`.
 */
export interface TikzCstRangeSet {
  node: SourceRange;
  command?: SourceRange;
  options?: SourceRange;
  arguments?: readonly SourceRange[];
  coordinates?: readonly SourceRange[];
  named?: Readonly<Record<string, readonly SourceRange[]>>;
}

export interface TikzCstConstructionBinding extends ConstructionBindingBase {
  kind: 'tikz-cst';
  languageId: 'tikz';
  cstNodeType: string;
  cstRanges: TikzCstRangeSet;
}

/** Namespaced escape hatch for other construction languages and CSTs. */
export interface ExtensionConstructionBinding extends ConstructionBindingBase {
  kind: 'extension';
  namespace: string;
  bindingType: string;
  payload: JsonObject;
}

export type ConstructionBinding =
  | SourceRangeConstructionBinding
  | TikzCstConstructionBinding
  | ExtensionConstructionBinding;

export type OpaqueNodeReason =
  | 'unsupported-syntax'
  | 'parse-error'
  | 'plugin-owned'
  | 'unsafe-writeback'
  | 'unknown';

/**
 * Unsupported construction syntax is retained as an exact source slice. It is
 * intentionally not promoted to a fabricated semantic entity.
 */
export interface OpaqueConstructionNode {
  id: string;
  kind: 'opaque';
  languageId: string;
  syntaxNodeType?: string;
  reason: OpaqueNodeReason;
  impact: 'local' | 'statement' | 'scope' | 'document' | 'unknown';
  source: LosslessSourceReference;
  ownerPluginId?: string;
  metadata?: JsonObject;
}

export type GeometryExpression =
  | {
    kind: 'literal';
    value: JsonValue;
  }
  | {
    kind: 'entity-reference';
    entityId: string;
    component?: string;
  }
  | {
    kind: 'symbol';
    name: string;
    domain?: string;
  }
  | {
    kind: 'operation';
    operator: string;
    arguments: readonly GeometryExpression[];
    parameters?: JsonObject;
  }
  | {
    kind: 'extension';
    namespace: string;
    expressionType: string;
    payload: JsonObject;
  };

export interface GeometryArgument {
  role: string;
  entityId?: string;
  value?: JsonValue;
  expression?: GeometryExpression;
}

export interface GeometryEntity {
  recordType: 'entity';
  id: string;
  /** Open vocabulary: point, line, circle, conic, locus, custom, ... */
  kind: string;
  name?: string;
  dimension?: 0 | 1 | 2 | 3;
  definition?: GeometryExpression;
  parameters?: JsonObject;
  tags?: readonly string[];
  sourceBindingIds?: readonly string[];
  metadata?: JsonObject;
}

export interface GeometryConstraint {
  recordType: 'constraint';
  id: string;
  /** Open vocabulary: coincident, parallel, perpendicular, tangent, ... */
  kind: string;
  arguments: readonly GeometryArgument[];
  strength?: 'required' | 'strong' | 'medium' | 'weak';
  enabled?: boolean;
  parameters?: JsonObject;
  sourceBindingIds?: readonly string[];
  metadata?: JsonObject;
}

export interface GeometryRelation {
  recordType: 'relation';
  id: string;
  /** Open vocabulary: incidence, dependency, ownership, congruence, ... */
  kind: string;
  participants: readonly GeometryArgument[];
  directed?: boolean;
  properties?: JsonObject;
  sourceBindingIds?: readonly string[];
  metadata?: JsonObject;
}

export interface GeometryStyleSelector {
  entityIds?: readonly string[];
  entityKinds?: readonly string[];
  tags?: readonly string[];
  relationIds?: readonly string[];
}

export interface GeometryStyle {
  recordType: 'style';
  id: string;
  selector: GeometryStyleSelector;
  properties: JsonObject;
  precedence?: number;
  sourceBindingIds?: readonly string[];
  metadata?: JsonObject;
}

export type GeometryIrRecord =
  | GeometryEntity
  | GeometryConstraint
  | GeometryRelation
  | GeometryStyle
  | ConstructionBinding;

export interface GeometryIR {
  schemaVersion: typeof GEOMETRY_IR_SCHEMA_VERSION;
  entities: readonly GeometryEntity[];
  constraints: readonly GeometryConstraint[];
  relations: readonly GeometryRelation[];
  styles: readonly GeometryStyle[];
  sourceBindings: readonly ConstructionBinding[];
  metadata?: JsonObject;
  extensions?: Readonly<Record<string, JsonValue>>;
}

export type GeometryIr = GeometryIR;
export type GeometryIRRecord = GeometryIrRecord;

export interface GeometryRevisionBasis {
  documentId: string;
  /**
   * Changes whenever a document history is replaced or forked. Revisions are
   * only comparable inside the same epoch.
   */
  epoch: string;
  revision: number;
  sourceHash: string;
  /** Hash of the semantic snapshot produced from source + plugin set. */
  kernelHash?: string;
  /** Hash of source + grammar/plugin/schema versions. */
  projectionHash?: string;
  pluginSetDigest?: string;
  sourceId?: string;
}

export type GeometryDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface GeometryDiagnostic {
  code: string;
  severity: GeometryDiagnosticSeverity;
  message: string;
  truth?: GeometryTruthKind;
  source?: LosslessSourceReference;
  relatedRecords?: readonly GeometryRecordReference[];
  pluginId?: string;
  data?: JsonObject;
}

export type GeometryProjectionStatus = 'complete' | 'partial' | 'invalid';

/**
 * Mathematical meaning. This truth is a revision-bound projection and is not a
 * separately persisted document.
 */
export interface SemanticTruth {
  kind: 'semantic';
  basis: GeometryRevisionBasis;
  status: GeometryProjectionStatus;
  ir: GeometryIR;
  diagnostics: readonly GeometryDiagnostic[];
}

/**
 * Exact construction/source structure, including unsupported opaque regions.
 */
export interface ConstructionTruth {
  kind: 'construction';
  basis: GeometryRevisionBasis;
  status: GeometryProjectionStatus;
  sources: readonly SourceDocument[];
  bindings: readonly ConstructionBinding[];
  opaqueNodes: readonly OpaqueConstructionNode[];
  diagnostics: readonly GeometryDiagnostic[];
}

export interface RenderPrimitive {
  id: string;
  kind: string;
  entityIds: readonly string[];
  sourceBindingIds?: readonly string[];
  sourceRange?: SourceRange;
  geometry: JsonObject;
  style?: JsonObject;
  zIndex?: number;
  interactive?: boolean;
  metadata?: JsonObject;
}

export interface RenderArtifactReference {
  id: string;
  mediaType: string;
  contentHash?: string;
  uri?: string;
  width?: number;
  height?: number;
  metadata?: JsonObject;
}

/**
 * Renderer output derived from a semantic/construction basis. Multiple
 * rendering truths may coexist (interactive SVG, exact TeX, print, etc.).
 */
export interface RenderingTruth {
  kind: 'rendering';
  basis: GeometryRevisionBasis;
  renderRevision: number;
  rendererId: string;
  target: string;
  status: GeometryProjectionStatus;
  primitives: readonly RenderPrimitive[];
  artifacts: readonly RenderArtifactReference[];
  diagnostics: readonly GeometryDiagnostic[];
  metadata?: JsonObject;
}

/** A fully materialized three-truth state. */
export interface GeometryTruthSet {
  semantic: SemanticTruth;
  construction: ConstructionTruth;
  rendering: readonly RenderingTruth[];
}

/** Plugins may project only the truth lanes they advertise. */
export interface GeometryTruthProjection {
  semantic?: SemanticTruth;
  construction?: ConstructionTruth;
  rendering?: readonly RenderingTruth[];
}
