import type {
  ConstructionConstraint,
  ConstructionEntity,
  ConstructionOutput,
  ConstructionRelation,
} from '../authoring/construction-ir';
import { hashSource } from '../document/source-hash';

/**
 * Managed-construction schema milestones.
 *
 * `MANAGED_CONSTRUCTION_SCHEMA_VERSION` intentionally remains the v2 write
 * alias.  Declaring v3 here gives later presentation work a stable capability
 * boundary without changing the parser or writer acceptance/defaults today.
 */
export const MANAGED_CONSTRUCTION_SCHEMA_V1 = 1 as const;
export const MANAGED_CONSTRUCTION_SCHEMA_V2 = 2 as const;
export const MANAGED_CONSTRUCTION_SCHEMA_V3 = 3 as const;
export const LATEST_MANAGED_CONSTRUCTION_SCHEMA_VERSION =
  MANAGED_CONSTRUCTION_SCHEMA_V3;

/** Historical v1 name retained for consumers that still inspect legacy blocks. */
export const LEGACY_MANAGED_CONSTRUCTION_SCHEMA_VERSION =
  MANAGED_CONSTRUCTION_SCHEMA_V1;

/**
 * Historical write/default name.  New managed blocks still serialize as
 * schema-v2 until the schema-v3 presentation contract is implemented.
 */
export const MANAGED_CONSTRUCTION_SCHEMA_VERSION =
  MANAGED_CONSTRUCTION_SCHEMA_V2;

/**
 * Typed semantic records currently have v2 semantics; v3 is reserved for the
 * future presentation-aware contract.  The parser's explicit v1/v2 gate keeps
 * v3 fail-closed until that contract is implemented.
 */
export function isTypedSemanticSchema(version: number | null): version is 2 | 3 {
  return version === MANAGED_CONSTRUCTION_SCHEMA_V2
    || version === MANAGED_CONSTRUCTION_SCHEMA_V3;
}
export const MANAGED_CONSTRUCTION_FINGERPRINT_ALGORITHM =
  'fnv1a64-utf8' as const;

const MAX_RECORDS_PER_BLOCK = 256;
const MAX_RECORD_LENGTH = 16 * 1024;
const MAX_METADATA_LENGTH = 256 * 1024;

export type ManagedConstructionSemanticRecord =
  | {
    readonly recordType: 'input';
    readonly id: string;
    readonly role: string;
    readonly ref: string;
  }
  | ConstructionEntity
  | ConstructionConstraint
  | ConstructionRelation
  | ConstructionOutput;

export type ManagedConstructionMetadataStatus =
  | 'absent'
  | 'valid'
  | 'invalid'
  | 'unsupported';

export type ManagedConstructionIntegrityStatus =
  | 'absent'
  | 'valid'
  | 'detached'
  | 'invalid';

export type ManagedConstructionMetadataIssueCode =
  | 'metadata-without-schema'
  | 'invalid-schema-version'
  | 'unsupported-schema-version'
  | 'missing-records'
  | 'record-too-large'
  | 'metadata-too-large'
  | 'too-many-records'
  | 'invalid-record-json'
  | 'invalid-record-shape'
  | 'invalid-semantic-reference'
  | 'dangling-semantic-reference'
  | 'incompatible-reference-kind'
  | 'duplicate-entity-alias'
  | 'duplicate-record-id'
  | 'unknown-record-type'
  | 'misplaced-record'
  | 'invalid-content-fingerprint'
  | 'content-fingerprint-mismatch';

export interface ManagedConstructionMetadataIssue {
  code: ManagedConstructionMetadataIssueCode;
  message: string;
  range: { start: number; end: number };
}

export interface ManagedConstructionBlock {
  id: string;
  kind: string;
  planKind: string;
  inputs: readonly string[];
  outputs: readonly string[];
  schemaVersion: number | null;
  metadataStatus: ManagedConstructionMetadataStatus;
  integrityStatus: ManagedConstructionIntegrityStatus;
  contentFingerprint: string | null;
  actualContentFingerprint: string;
  records: readonly ManagedConstructionSemanticRecord[];
  metadataIssues: readonly ManagedConstructionMetadataIssue[];
  range: { start: number; end: number };
  headerRange: { start: number; end: number };
  semanticRecordRanges: readonly { start: number; end: number }[];
  bodyRange: { start: number; end: number };
  tikzBodyRange: { start: number; end: number };
  endRange: { start: number; end: number };
}

const BEGIN_LINE =
  /^[ \t]*%[ \t]*@mathgeo[ \t]+begin(?<attributes>[^\r\n]*)(?:\r?\n|$)/gm;
const END_LINE =
  /^[ \t]*%[ \t]*@mathgeo[ \t]+end[^\r\n]*(?:\r?\n|$)/gm;
const RECORD_LINE =
  /^[ \t]*%[ \t]*@mathgeo[ \t]+record(?:[ \t]+(?<payload>[^\r\n]*))?(?:\r?\n|$)/gm;
const RECORD_LINE_AT =
  /[ \t]*%[ \t]*@mathgeo[ \t]+record(?:[ \t]+(?<payload>[^\r\n]*))?(?:\r?\n|$)/y;
const ATTRIBUTE = /(?:^|[ \t]+)(?<key>[a-z][a-z0-9-]*)=(?<value>[^ \t\r\n]*)/gi;
// The v3 declaration does not opt in any new record types; this vocabulary
// stays closed until the presentation contract adds an explicit decoder.
const RECORD_TYPES = new Set(['input', 'entity', 'constraint', 'relation', 'output']);
const CONTENT_FINGERPRINT = /^[0-9a-f]{16}$/;
// Keep schema-v2 identifier/reference validation aligned with Construction IR.
// Schema-v1 deliberately remains permissive for backwards compatibility.
const TIKZ_NAME = /^[A-Za-z_][A-Za-z0-9:_-]*$/;
const PERSISTENT_REFERENCE = /^managed:[A-Za-z0-9:_.%-]+$/;
const MANAGED_REFERENCE_PREFIX = 'managed:';

function isTikzSafeName(value: unknown): value is string {
  return typeof value === 'string' && TIKZ_NAME.test(value);
}

function isPersistentReference(value: unknown): value is string {
  return typeof value === 'string' && PERSISTENT_REFERENCE.test(value);
}

function isManagedProvenanceReference(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(MANAGED_REFERENCE_PREFIX);
}

function isEntityName(value: unknown): value is string {
  return isTikzSafeName(value) && !isManagedProvenanceReference(value);
}

function isTikzReference(value: unknown): value is string {
  return isManagedProvenanceReference(value)
    ? isPersistentReference(value)
    : isTikzSafeName(value);
}

function list(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function attributesOf(raw: string): Map<string, string> {
  const attributes = new Map<string, string>();
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(raw))) {
    const key = match.groups?.key?.toLowerCase();
    const value = match.groups?.value;
    if (key && value !== undefined && !attributes.has(key)) {
      attributes.set(key, value);
    }
  }
  return attributes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringTuple(value: unknown, length: number): value is readonly string[] {
  return isStringArray(value) && value.length === length;
}

function isScalarRecordValue(value: unknown): value is number | string {
  return (
    (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.trim().length > 0)
  );
}

function validSemanticRecordShape(
  value: Record<string, unknown>,
  schemaVersion: number | null,
): value is ManagedConstructionSemanticRecord {
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (value.recordType === 'input') {
    return typeof value.role === 'string' && typeof value.ref === 'string';
  }
  if (value.recordType === 'entity') {
    if (typeof value.name !== 'string' || typeof value.kind !== 'string') return false;
    switch (value.kind) {
      case 'point':
        return value.position === undefined || (
          (
            isRecord(value.position)
            && typeof value.position.x === 'number'
            && typeof value.position.y === 'number'
          )
          || (
            Array.isArray(value.position)
            && value.position.length === 2
            && value.position.every((item) => typeof item === 'number')
          )
        );
      case 'segment':
      case 'vector':
      case 'line':
      case 'ray':
        return typeof value.from === 'string' && typeof value.to === 'string';
      case 'polyline':
      case 'polygon':
        return isStringArray(value.vertices);
      case 'rectangle':
        return isStringTuple(value.corners, 2);
      case 'circle': {
        const hasThrough = typeof value.through === 'string' && value.through.length > 0;
        const hasRadius = (
          typeof value.radius === 'number'
          && Number.isFinite(value.radius)
          && value.radius > 0
        );
        return (
          typeof value.center === 'string'
          && value.center.length > 0
          && hasThrough !== hasRadius
        );
      }
      case 'label':
        return typeof value.at === 'string' && typeof value.text === 'string';
      case 'angle':
      case 'right-angle':
        return isStringTuple(value.points, 3);
      default:
        return false;
    }
  }
  if (value.recordType === 'constraint') {
    if (typeof value.kind !== 'string') return false;
    switch (value.kind) {
      case 'point-reflection':
        return isTypedSemanticSchema(schemaVersion) && (
          typeof value.source === 'string'
          && typeof value.center === 'string'
          && typeof value.result === 'string'
        );
      case 'line-reflection':
        return isTypedSemanticSchema(schemaVersion) && (
          typeof value.source === 'string'
          && typeof value.axisStart === 'string'
          && typeof value.axisEnd === 'string'
          && typeof value.foot === 'string'
          && typeof value.result === 'string'
          && value.axisStart !== value.axisEnd
        );
      case 'rotation':
        return isTypedSemanticSchema(schemaVersion) && (
          typeof value.source === 'string'
          && typeof value.center === 'string'
          && typeof value.result === 'string'
          && isScalarRecordValue(value.angleDegrees)
        );
      case 'homothety':
        return isTypedSemanticSchema(schemaVersion) && (
          typeof value.source === 'string'
          && typeof value.center === 'string'
          && typeof value.result === 'string'
          && isScalarRecordValue(value.scale)
        );
      case 'midpoint':
        return (
          typeof value.point === 'string'
          && typeof value.a === 'string'
          && typeof value.b === 'string'
        );
      case 'perpendicular-foot':
        return (
          typeof value.point === 'string'
          && typeof value.lineStart === 'string'
          && typeof value.lineEnd === 'string'
          && typeof value.result === 'string'
        );
      case 'on-circle':
        return typeof value.point === 'string' && typeof value.circle === 'string';
      case 'circle-through-three-points':
        return isTypedSemanticSchema(schemaVersion) && (
          typeof value.circle === 'string'
          && typeof value.center === 'string'
          && isStringTuple(value.points, 3)
        );
      case 'tangent-at-point':
        return isTypedSemanticSchema(schemaVersion) && (
          typeof value.line === 'string'
          && typeof value.touch === 'string'
          && typeof value.circle === 'string'
          && typeof value.center === 'string'
        );
      case 'perpendicular-bisector':
        return isTypedSemanticSchema(schemaVersion) && (
          typeof value.line === 'string'
          && typeof value.midpoint === 'string'
          && typeof value.a === 'string'
          && typeof value.b === 'string'
        );
      case 'angle-bisector':
        return isTypedSemanticSchema(schemaVersion) && (
          typeof value.line === 'string'
          && typeof value.armA === 'string'
          && typeof value.vertex === 'string'
          && typeof value.armB === 'string'
        );
      case 'parallel':
      case 'perpendicular':
        return typeof value.line === 'string' && typeof value.reference === 'string';
      case 'inversion':
        return (
          typeof value.point === 'string'
          && typeof value.center === 'string'
          && typeof value.radius === 'string'
          && typeof value.result === 'string'
        );
      case 'radical-axis':
        return isTypedSemanticSchema(schemaVersion) && (
          typeof value.line === 'string'
          && typeof value.point === 'string'
          && typeof value.circle1 === 'string'
          && typeof value.circle2 === 'string'
          && value.circle1 !== value.circle2
        );
      case 'line-intersection':
        return isTypedSemanticSchema(schemaVersion) && (
          typeof value.point === 'string'
          && typeof value.line1 === 'string'
          && typeof value.line2 === 'string'
          && value.line1 !== value.line2
          && value.domain === 'line'
        );
      case 'line-circle-other-intersection':
        return isTypedSemanticSchema(schemaVersion) && (
          typeof value.point === 'string'
          && typeof value.line === 'string'
          && typeof value.circle === 'string'
          && typeof value.excludePoint === 'string'
          && value.line !== value.circle
          && value.point !== value.excludePoint
          && value.domain === 'line'
          && value.selector === 'exclude-known-point'
        );
      case 'cyclic':
      case 'complete-quadrilateral':
        return isStringTuple(value.points, 4);
      default:
        return false;
    }
  }
  if (value.recordType === 'relation') {
    return (
      typeof value.kind === 'string'
      && typeof value.from === 'string'
      && typeof value.to === 'string'
      && (value.directed === undefined || typeof value.directed === 'boolean')
    );
  }
  if (value.recordType === 'output') {
    return (
      typeof value.role === 'string'
      && typeof value.ref === 'string'
      && typeof value.kind === 'string'
    );
  }
  return false;
}

interface SchemaV2SemanticIssue {
  path: string;
  message: string;
}

/**
 * Schema-v2 is the typed semantic contract.  Keep this check separate from
 * the legacy shape check so schema-v1 records retain their historical,
 * intentionally permissive vocabulary.
 */
function schemaV2SemanticRecordIssue(
  value: ManagedConstructionSemanticRecord,
): SchemaV2SemanticIssue | null {
  const name = (path: string, candidate: unknown): SchemaV2SemanticIssue | null => (
    isTikzSafeName(candidate)
      ? null
      : {
        path,
        message: `${path} must be a non-empty TikZ-safe name.`,
      }
  );
  const entityName = (path: string, candidate: unknown): SchemaV2SemanticIssue | null => (
    isEntityName(candidate)
      ? null
      : {
        path,
        message: `${path} must be a non-empty TikZ-safe entity name and cannot use the reserved managed: provenance prefix.`,
      }
  );
  const reference = (
    path: string,
    candidate: unknown,
  ): SchemaV2SemanticIssue | null => (
    isTikzReference(candidate)
      ? null
      : {
        path,
        message: `${path} must be a non-empty TikZ-safe name or persistent managed reference.`,
      }
  );
  const references = (
    path: string,
    candidates: readonly unknown[],
  ): SchemaV2SemanticIssue | null => {
    for (const [index, candidate] of candidates.entries()) {
      const failure = reference(`${path}[${index}]`, candidate);
      if (failure) return failure;
    }
    return null;
  };

  const idIssue = value.recordType === 'entity'
    ? entityName('id', value.id)
    : name('id', value.id);
  if (idIssue) return idIssue;

  if (value.recordType === 'input') {
    return name('role', value.role) ?? reference('ref', value.ref);
  }

  if (value.recordType === 'entity') {
    const nameIssue = entityName('name', value.name);
    if (nameIssue) return nameIssue;
    switch (value.kind) {
      case 'point':
        return null;
      case 'segment':
      case 'vector':
      case 'line':
      case 'ray':
        return reference('from', value.from) ?? reference('to', value.to);
      case 'polyline':
      case 'polygon':
        return references('vertices', value.vertices);
      case 'rectangle':
        return references('corners', value.corners);
      case 'circle':
        return reference('center', value.center)
          ?? (value.through === undefined ? null : reference('through', value.through));
      case 'label':
        return reference('at', value.at);
      case 'angle':
      case 'right-angle':
        return references('points', value.points);
      default:
        return null;
    }
  }

  if (value.recordType === 'constraint') {
    switch (value.kind) {
      case 'point-reflection':
        return reference('source', value.source)
          ?? reference('center', value.center)
          ?? reference('result', value.result);
      case 'line-reflection':
        return reference('source', value.source)
          ?? reference('axisStart', value.axisStart)
          ?? reference('axisEnd', value.axisEnd)
          ?? reference('foot', value.foot)
          ?? reference('result', value.result);
      case 'rotation':
        return reference('source', value.source)
          ?? reference('center', value.center)
          ?? reference('result', value.result);
      case 'homothety':
        return reference('source', value.source)
          ?? reference('center', value.center)
          ?? reference('result', value.result);
      case 'midpoint':
        return reference('point', value.point)
          ?? reference('a', value.a)
          ?? reference('b', value.b);
      case 'perpendicular-foot':
        return reference('point', value.point)
          ?? reference('lineStart', value.lineStart)
          ?? reference('lineEnd', value.lineEnd)
          ?? reference('result', value.result);
      case 'on-circle':
        return reference('point', value.point) ?? reference('circle', value.circle);
      case 'circle-through-three-points':
        return reference('circle', value.circle)
          ?? reference('center', value.center)
          ?? references('points', value.points);
      case 'tangent-at-point':
        return reference('line', value.line)
          ?? reference('touch', value.touch)
          ?? reference('circle', value.circle)
          ?? reference('center', value.center);
      case 'perpendicular-bisector':
        return reference('line', value.line)
          ?? reference('midpoint', value.midpoint)
          ?? reference('a', value.a)
          ?? reference('b', value.b);
      case 'angle-bisector':
        return reference('line', value.line)
          ?? reference('armA', value.armA)
          ?? reference('vertex', value.vertex)
          ?? reference('armB', value.armB);
      case 'parallel':
      case 'perpendicular':
        return reference('line', value.line) ?? reference('reference', value.reference);
      case 'inversion':
        return reference('point', value.point)
          ?? reference('center', value.center)
          ?? reference('radius', value.radius)
          ?? reference('result', value.result);
      case 'radical-axis':
        return reference('line', value.line)
          ?? reference('point', value.point)
          ?? reference('circle1', value.circle1)
          ?? reference('circle2', value.circle2);
      case 'line-intersection':
        return reference('point', value.point)
          ?? reference('line1', value.line1)
          ?? reference('line2', value.line2);
      case 'line-circle-other-intersection':
        return reference('point', value.point)
          ?? reference('line', value.line)
          ?? reference('circle', value.circle)
          ?? reference('excludePoint', value.excludePoint);
      case 'cyclic':
      case 'complete-quadrilateral':
        return references('points', value.points);
      default:
        return null;
    }
  }

  if (value.recordType === 'relation') {
    return reference('from', value.from) ?? reference('to', value.to);
  }
  return name('role', value.role) ?? reference('ref', value.ref);
}

function issue(
  code: ManagedConstructionMetadataIssueCode,
  message: string,
  range: { start: number; end: number },
): ManagedConstructionMetadataIssue {
  return { code, message, range };
}

interface SemanticReferenceUse {
  path: string;
  value: string;
  expectedKind?: ConstructionEntity['kind'];
}

interface DecodedSemanticRecord {
  record: ManagedConstructionSemanticRecord;
  range: { start: number; end: number };
}

function semanticReferencesOf(
  record: ManagedConstructionSemanticRecord,
): SemanticReferenceUse[] {
  const refs = (
    entries: readonly [string, unknown, ConstructionEntity['kind'] | undefined][],
  ): SemanticReferenceUse[] => entries.flatMap(([path, value, expectedKind]) => (
    typeof value === 'string' ? [{ path, value, expectedKind }] : []
  ));
  const tuple = (
    path: string,
    values: readonly unknown[],
    expectedKind?: ConstructionEntity['kind'],
  ): SemanticReferenceUse[] => values.flatMap((value, index) => (
    typeof value === 'string'
      ? [{ path: `${path}[${index}]`, value, expectedKind }]
      : []
  ));

  if (record.recordType === 'input') return [];
  if (record.recordType === 'entity') {
    switch (record.kind) {
      case 'point':
        return [];
      case 'segment':
      case 'vector':
      case 'line':
      case 'ray':
        return refs([
          ['from', record.from, 'point'],
          ['to', record.to, 'point'],
        ]);
      case 'polyline':
      case 'polygon':
        return tuple('vertices', record.vertices, 'point');
      case 'rectangle':
        return tuple('corners', record.corners, 'point');
      case 'circle': {
        const circleRefs: [string, unknown, ConstructionEntity['kind'] | undefined][] = [
          ['center', record.center, 'point'],
        ];
        if (record.through !== undefined) {
          circleRefs.push(['through', record.through, 'point']);
        }
        return refs(circleRefs);
      }
      case 'label':
        return refs([['at', record.at, 'point']]);
      case 'angle':
      case 'right-angle':
        return tuple('points', record.points, 'point');
    }
    return [];
  }
  if (record.recordType === 'constraint') {
    switch (record.kind) {
      case 'point-reflection':
        return refs([
          ['source', record.source, 'point'],
          ['center', record.center, 'point'],
          ['result', record.result, 'point'],
        ]);
      case 'line-reflection':
        return refs([
          ['source', record.source, 'point'],
          ['axisStart', record.axisStart, 'point'],
          ['axisEnd', record.axisEnd, 'point'],
          ['foot', record.foot, 'point'],
          ['result', record.result, 'point'],
        ]);
      case 'rotation':
        return refs([
          ['source', record.source, 'point'],
          ['center', record.center, 'point'],
          ['result', record.result, 'point'],
        ]);
      case 'homothety':
        return refs([
          ['source', record.source, 'point'],
          ['center', record.center, 'point'],
          ['result', record.result, 'point'],
        ]);
      case 'midpoint':
        return refs([
          ['point', record.point, 'point'],
          ['a', record.a, 'point'],
          ['b', record.b, 'point'],
        ]);
      case 'perpendicular-foot':
        return refs([
          ['point', record.point, 'point'],
          ['lineStart', record.lineStart, 'point'],
          ['lineEnd', record.lineEnd, 'point'],
          ['result', record.result, 'point'],
        ]);
      case 'on-circle':
        return refs([
          ['point', record.point, 'point'],
          ['circle', record.circle, 'circle'],
        ]);
      case 'circle-through-three-points':
        return refs([
          ['circle', record.circle, 'circle'],
          ['center', record.center, 'point'],
        ]).concat(tuple('points', record.points, 'point'));
      case 'tangent-at-point':
        return refs([
          ['line', record.line, 'line'],
          ['touch', record.touch, 'point'],
          ['circle', record.circle, 'circle'],
          ['center', record.center, 'point'],
        ]);
      case 'perpendicular-bisector':
        return refs([
          ['line', record.line, 'line'],
          ['midpoint', record.midpoint, 'point'],
          ['a', record.a, 'point'],
          ['b', record.b, 'point'],
        ]);
      case 'angle-bisector':
        return refs([
          ['line', record.line, 'line'],
          ['armA', record.armA, 'point'],
          ['vertex', record.vertex, 'point'],
          ['armB', record.armB, 'point'],
        ]);
      case 'parallel':
      case 'perpendicular':
        return refs([
          ['line', record.line, 'line'],
          ['reference', record.reference, 'line'],
        ]);
      case 'inversion':
        return refs([
          ['point', record.point, 'point'],
          ['center', record.center, 'point'],
          ['radius', record.radius, 'point'],
          ['result', record.result, 'point'],
        ]);
      case 'radical-axis':
        return refs([
          ['line', record.line, 'line'],
          ['point', record.point, 'point'],
          ['circle1', record.circle1, 'circle'],
          ['circle2', record.circle2, 'circle'],
        ]);
      case 'line-intersection':
        return refs([
          ['point', record.point, 'point'],
          ['line1', record.line1, 'line'],
          ['line2', record.line2, 'line'],
        ]);
      case 'line-circle-other-intersection':
        return refs([
          ['point', record.point, 'point'],
          ['line', record.line, 'line'],
          ['circle', record.circle, 'circle'],
          ['excludePoint', record.excludePoint, 'point'],
        ]);
      case 'cyclic':
      case 'complete-quadrilateral':
        return tuple('points', record.points, 'point');
    }
    return [];
  }
  if (record.recordType === 'relation') {
    return refs([
      ['from', record.from, undefined],
      ['to', record.to, undefined],
    ]);
  }
  const outputKind = record.kind === 'derived-point'
    ? 'point'
    : record.kind === 'derived-line'
      ? 'line'
      : record.kind;
  return refs([['ref', record.ref, outputKind]]);
}

function semanticClosureIssues(
  decoded: readonly DecodedSemanticRecord[],
): ManagedConstructionMetadataIssue[] {
  const allowedReferences = new Set<string>();
  const inputReferences = new Set<string>();
  const entityAliasOwners = new Map<string, Array<{
    entityId: string;
    kind: ConstructionEntity['kind'];
    range: { start: number; end: number };
  }>>();
  for (const { record, range } of decoded) {
    if (record.recordType === 'input') {
      inputReferences.add(record.ref);
      allowedReferences.add(record.ref);
      continue;
    }
    if (record.recordType !== 'entity') continue;
    for (const alias of new Set([record.id, record.name])) {
      if (!isManagedProvenanceReference(alias)) {
        allowedReferences.add(alias);
      }
      const owners = entityAliasOwners.get(alias) ?? [];
      if (!owners.some((owner) => owner.entityId === record.id)) {
        owners.push({ entityId: record.id, kind: record.kind, range });
      }
      entityAliasOwners.set(alias, owners);
    }
  }

  const issues: ManagedConstructionMetadataIssue[] = [];
  const ambiguousAliases = new Set<string>();
  // Entity id/name aliases are ownership-sensitive: merging kinds would
  // reproduce the adapter's last-write-wins ambiguity instead of rejecting it.
  for (const [alias, owners] of entityAliasOwners) {
    if (owners.length < 2) continue;
    ambiguousAliases.add(alias);
    issues.push(issue(
      'duplicate-entity-alias',
      `Entity alias "${alias}" is owned by multiple entity records (${owners.map((owner) => owner.entityId).join(', ')}).`,
      owners[1].range,
    ));
  }

  // Existing tangent blocks omitted an explicit center input. Keep only their
  // historical tuple readable: a persistent circle input, one declared tangent
  // line, that line's direction point, and the center dependency relation.
  const tangentCenterWitnesses: Array<{
    constraintId: string;
    directionPoint: string;
    center: string;
  }> = [];
  for (const { record } of decoded) {
    if (
      record.recordType === 'constraint'
      && record.kind === 'tangent-at-point'
      && inputReferences.has(record.circle)
      && isPersistentReference(record.circle)
      && isEntityName(record.center)
    ) {
      const tangentLineEntities = decoded.filter((candidate) => (
        candidate.record.recordType === 'entity'
        && candidate.record.kind === 'line'
        && (
          candidate.record.id === record.line
          || candidate.record.name === record.line
        )
      ));
      if (tangentLineEntities.length !== 1) continue;
      const tangentLine = tangentLineEntities[0].record;
      if (tangentLine.recordType !== 'entity' || tangentLine.kind !== 'line') continue;
      const hasHistoricalCenterRelation = decoded.some((candidate) => (
        candidate.record.recordType === 'relation'
        && candidate.record.kind === 'depends-on'
        && candidate.record.directed === true
        && candidate.record.from === tangentLine.to
        && candidate.record.to === record.center
      ));
      if (!hasHistoricalCenterRelation) continue;
      tangentCenterWitnesses.push({
        constraintId: record.id,
        directionPoint: tangentLine.to,
        center: record.center,
      });
    }
  }
  const isTangentCenterWitness = (
    record: ManagedConstructionSemanticRecord,
    reference: SemanticReferenceUse,
  ): boolean => tangentCenterWitnesses.some((witness) => (
    (
      record.recordType === 'constraint'
      && record.kind === 'tangent-at-point'
      && record.id === witness.constraintId
      && reference.path === 'center'
      && reference.value === witness.center
    )
    || (
      record.recordType === 'relation'
      && record.kind === 'depends-on'
      && record.directed === true
      && record.from === witness.directionPoint
      && record.to === witness.center
      && reference.path === 'to'
      && reference.value === witness.center
    )
  ));

  for (const { record, range } of decoded) {
    for (const reference of semanticReferencesOf(record)) {
      const isExplicitInput = inputReferences.has(reference.value);
      const isManagedReference = isManagedProvenanceReference(reference.value);
      if (
        (!allowedReferences.has(reference.value) && !isTangentCenterWitness(record, reference))
        || (isManagedReference && !isExplicitInput)
      ) {
        issues.push(issue(
          'dangling-semantic-reference',
          `Managed semantic ${record.recordType} ${record.id} field ${reference.path} references "${reference.value}", which is not an input ref or an entity id/name in this block.`,
          range,
        ));
        continue;
      }
      if (reference.expectedKind === undefined) continue;
      // External inputs are intentionally opaque: only aliases declared by
      // this block receive a local kind check.
      const owners = entityAliasOwners.get(reference.value);
      if (!owners || ambiguousAliases.has(reference.value)) continue;
      if (owners[0].kind !== reference.expectedKind) {
        issues.push(issue(
          'incompatible-reference-kind',
          `Managed semantic ${record.recordType} ${record.id} field ${reference.path} expects an internal ${reference.expectedKind} entity, but "${reference.value}" is declared as ${owners[0].kind}.`,
          range,
        ));
      }
    }
  }
  return issues;
}

function schemaVersionOf(
  raw: string | undefined,
  range: { start: number; end: number },
): {
  value: number | null;
  status: ManagedConstructionMetadataStatus;
  issues: ManagedConstructionMetadataIssue[];
} {
  if (raw === undefined) return { value: null, status: 'absent', issues: [] };
  if (!/^[0-9]+$/.test(raw)) {
    return {
      value: null,
      status: 'invalid',
      issues: [issue(
        'invalid-schema-version',
        `Invalid @mathgeo schema version "${raw}".`,
        range,
      )],
    };
  }
  const value = Number(raw);
  // Keep the read/write gate explicit while schema-v3 remains undefined:
  // declaring the version and typed predicate must not make v3 metadata valid.
  if (
    value !== MANAGED_CONSTRUCTION_SCHEMA_V1
    && value !== MANAGED_CONSTRUCTION_SCHEMA_V2
  ) {
    return {
      value,
      status: 'unsupported',
      issues: [issue(
        'unsupported-schema-version',
        `Unsupported @mathgeo schema version ${value}; using header-only semantics.`,
        range,
      )],
    };
  }
  return { value, status: 'valid', issues: [] };
}

function recordsOf(
  source: string,
  bodyRange: { start: number; end: number },
  schema: ReturnType<typeof schemaVersionOf>,
): {
  status: ManagedConstructionMetadataStatus;
  records: ManagedConstructionSemanticRecord[];
  decoded: DecodedSemanticRecord[];
  issues: ManagedConstructionMetadataIssue[];
  recordRanges: Array<{ start: number; end: number }>;
  metadataEnd: number;
} {
  const matches: RegExpExecArray[] = [];
  let cursor = bodyRange.start;
  while (cursor < bodyRange.end) {
    RECORD_LINE_AT.lastIndex = cursor;
    const match = RECORD_LINE_AT.exec(source);
    if (!match || match.index !== cursor || match.index >= bodyRange.end) break;
    matches.push(match);
    cursor = match.index + match[0].length;
  }
  const recordRanges = matches.map((candidate) => ({
    start: candidate.index,
    end: candidate.index + candidate[0].length,
  }));
  RECORD_LINE.lastIndex = cursor;
  const misplaced = RECORD_LINE.exec(source);
  if (misplaced && misplaced.index < bodyRange.end) {
    return {
      status: 'invalid',
      records: [],
      decoded: [],
      recordRanges: [
        ...recordRanges,
        {
          start: misplaced.index,
          end: misplaced.index + misplaced[0].length,
        },
      ],
      metadataEnd: cursor,
      issues: [issue(
        'misplaced-record',
        'Managed semantic records must be a continuous prefix after the header.',
        {
          start: misplaced.index,
          end: misplaced.index + misplaced[0].length,
        },
      )],
    };
  }

  if (schema.status === 'absent') {
    if (matches.length === 0) {
      return {
        status: 'absent',
        records: [],
        decoded: [],
        issues: [],
        recordRanges: [],
        metadataEnd: bodyRange.start,
      };
    }
    return {
      status: 'invalid',
      records: [],
      decoded: [],
      recordRanges,
      metadataEnd: cursor,
      issues: [issue(
        'metadata-without-schema',
        'Managed semantic records require an explicit schema version.',
        { start: matches[0].index, end: matches[0].index + matches[0][0].length },
      )],
    };
  }
  if (schema.status !== 'valid') {
    return {
      status: schema.status,
      records: [],
      decoded: [],
      issues: [],
      recordRanges,
      metadataEnd: cursor,
    };
  }
  if (matches.length === 0) {
    return {
      status: 'invalid',
      records: [],
      decoded: [],
      recordRanges: [],
      metadataEnd: bodyRange.start,
      issues: [issue(
        'missing-records',
        'Schema-versioned @mathgeo block has no semantic records.',
        bodyRange,
      )],
    };
  }
  if (matches.length > MAX_RECORDS_PER_BLOCK) {
    return {
      status: 'invalid',
      records: [],
      decoded: [],
      recordRanges,
      metadataEnd: cursor,
      issues: [issue(
        'too-many-records',
        `Managed construction metadata exceeds ${MAX_RECORDS_PER_BLOCK} records.`,
        bodyRange,
      )],
    };
  }

  const issues: ManagedConstructionMetadataIssue[] = [];
  const records: ManagedConstructionSemanticRecord[] = [];
  const decoded: DecodedSemanticRecord[] = [];
  const ids = new Set<string>();
  let totalLength = 0;

  for (const candidate of matches) {
    const range = {
      start: candidate.index,
      end: candidate.index + candidate[0].length,
    };
    const payload = candidate.groups?.payload?.trim() ?? '';
    totalLength += payload.length;
    if (payload.length > MAX_RECORD_LENGTH) {
      issues.push(issue(
        'record-too-large',
        `Managed semantic record exceeds ${MAX_RECORD_LENGTH} UTF-16 code units.`,
        range,
      ));
      continue;
    }
    if (totalLength > MAX_METADATA_LENGTH) {
      issues.push(issue(
        'metadata-too-large',
        `Managed construction metadata exceeds ${MAX_METADATA_LENGTH} UTF-16 code units.`,
        bodyRange,
      ));
      break;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      issues.push(issue(
        'invalid-record-json',
        'Managed semantic record is not valid single-line JSON.',
        range,
      ));
      continue;
    }
    if (
      !isRecord(parsed)
      || typeof parsed.recordType !== 'string'
      || typeof parsed.id !== 'string'
      || parsed.id.length === 0
    ) {
      issues.push(issue(
        'invalid-record-shape',
        'Managed semantic record requires string recordType and id fields.',
        range,
      ));
      continue;
    }
    if (!RECORD_TYPES.has(parsed.recordType)) {
      issues.push(issue(
        'unknown-record-type',
        `Unknown managed semantic record type "${parsed.recordType}".`,
        range,
      ));
      continue;
    }
    const identity = `${parsed.recordType}:${parsed.id}`;
    if (ids.has(identity)) {
      issues.push(issue(
        'duplicate-record-id',
        `Duplicate managed semantic record "${identity}".`,
        range,
      ));
      continue;
    }
    ids.add(identity);
    if (!validSemanticRecordShape(parsed, schema.value)) {
      issues.push(issue(
        'invalid-record-shape',
        `Managed semantic ${parsed.recordType} record has invalid fields.`,
        range,
      ));
      continue;
    }
    if (isTypedSemanticSchema(schema.value)) {
      const schemaIssue = schemaV2SemanticRecordIssue(parsed);
      if (schemaIssue) {
        issues.push(issue(
          'invalid-semantic-reference',
          `Managed schema-v2 ${parsed.recordType} record ${parsed.id}: ${schemaIssue.message}`,
          range,
        ));
        continue;
      }
    }
    records.push(parsed);
    decoded.push({ record: parsed, range });
  }

  // Typed-schema records form one closed semantic transaction.  Unknown record
  // types remain forward-compatible, but known records cannot silently carry
  // references that later resolve to unresolved:* aliases in the adapter.
  if (
    isTypedSemanticSchema(schema.value)
    && issues.every((item) => item.code === 'unknown-record-type')
  ) {
    issues.push(...semanticClosureIssues(decoded));
  }

  // Metadata is one transaction: never expose a partially decoded plan.
  if (issues.some((item) => item.code !== 'unknown-record-type')) {
    return {
      status: 'invalid',
      records: [],
      decoded: [],
      issues,
      recordRanges,
      metadataEnd: cursor,
    };
  }
  return {
    status: 'valid',
    records,
    decoded,
    issues,
    recordRanges,
    metadataEnd: cursor,
  };
}

/**
 * Serialize validated construction records as TeX-safe single-line comments.
 * TeX ignores the comments; Code, Canvas and AI recover the same record set.
 */
export function serializeManagedConstructionRecords(
  records: readonly ManagedConstructionSemanticRecord[],
): readonly string[] {
  if (records.length > MAX_RECORDS_PER_BLOCK) {
    throw new RangeError(`Managed construction exceeds ${MAX_RECORDS_PER_BLOCK} records.`);
  }
  let totalLength = 0;
  return records.map((record) => {
    const payload = JSON.stringify(record);
    if (payload.length > MAX_RECORD_LENGTH) {
      throw new RangeError(`Managed semantic record ${record.id} is too large.`);
    }
    totalLength += payload.length;
    if (totalLength > MAX_METADATA_LENGTH) {
      throw new RangeError('Managed construction metadata is too large.');
    }
    return `% @mathgeo record ${payload}`;
  });
}

export interface ManagedConstructionFingerprintInput {
  id: string;
  kind: string;
  planKind: string;
  inputs: readonly string[];
  outputs: readonly string[];
  metadataText: string;
  tikzBodyText: string;
}

function normalizeLf(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export function managedConstructionContentFingerprint(
  input: ManagedConstructionFingerprintInput,
): string {
  const headerIdentity = JSON.stringify({
    id: input.id,
    kind: input.kind,
    planKind: input.planKind,
    inputs: input.inputs,
    outputs: input.outputs,
  });
  return hashSource([
    'mathgeo-managed-content/v1',
    headerIdentity,
    normalizeLf(input.metadataText),
    '--tikz-body--',
    normalizeLf(input.tikzBodyText),
  ].join('\n'));
}

/**
 * Read Math GeoHub construction provenance without interpreting the TikZ body.
 *
 * Blocks are line-comment delimited, deliberately non-nesting, and lossless:
 * ranges address the original UTF-16 source so the body can remain untouched.
 * Malformed or detached versioned metadata degrades atomically to read-only
 * construction truth. Only legacy blocks without a schema use header fallback;
 * exact TeX source remains byte-preserved in every state.
 */
export function parseManagedConstructionBlocks(
  source: string,
): ManagedConstructionBlock[] {
  const blocks: ManagedConstructionBlock[] = [];
  BEGIN_LINE.lastIndex = 0;
  let begin: RegExpExecArray | null;
  while ((begin = BEGIN_LINE.exec(source))) {
    const attributes = attributesOf(begin.groups?.attributes ?? '');
    const id = attributes.get('id');
    const kind = attributes.get('kind');
    if (!id || !kind) continue;

    END_LINE.lastIndex = BEGIN_LINE.lastIndex;
    const end = END_LINE.exec(source);
    if (!end) break;

    const nextBeginSearch = new RegExp(BEGIN_LINE.source, BEGIN_LINE.flags);
    nextBeginSearch.lastIndex = BEGIN_LINE.lastIndex;
    const nestedBegin = nextBeginSearch.exec(source);
    if (nestedBegin && nestedBegin.index < end.index) {
      BEGIN_LINE.lastIndex = nestedBegin.index;
      continue;
    }

    const headerRange = {
      start: begin.index,
      end: begin.index + begin[0].length,
    };
    const bodyRange = {
      start: headerRange.end,
      end: end.index,
    };
    const schema = schemaVersionOf(attributes.get('schema'), headerRange);
    const metadata = recordsOf(source, bodyRange, schema);
    const endRange = {
      start: end.index,
      end: end.index + end[0].length,
    };
    const tikzBodyRange = {
      start: Math.min(metadata.metadataEnd, bodyRange.end),
      end: bodyRange.end,
    };
    const planKind = attributes.get('plan-kind') ?? kind;
    const inputs = list(attributes.get('inputs'));
    const outputs = list(attributes.get('outputs'));
    const fingerprintAlgorithm = attributes.get('fingerprint-alg') ?? null;
    const contentFingerprint = attributes.get('content-fingerprint') ?? null;
    const actualContentFingerprint = managedConstructionContentFingerprint({
      id,
      kind,
      planKind,
      inputs,
      outputs,
      metadataText: source.slice(headerRange.end, tikzBodyRange.start),
      tikzBodyText: source.slice(tikzBodyRange.start, tikzBodyRange.end),
    });
    const integrityStatus: ManagedConstructionIntegrityStatus = (() => {
      if (fingerprintAlgorithm === null && contentFingerprint === null) {
        return 'absent';
      }
      if (
        fingerprintAlgorithm !== MANAGED_CONSTRUCTION_FINGERPRINT_ALGORITHM
        || contentFingerprint === null
        || !CONTENT_FINGERPRINT.test(contentFingerprint)
      ) return 'invalid';
      return contentFingerprint === actualContentFingerprint
        ? 'valid'
        : 'detached';
    })();
    const integrityIssues: ManagedConstructionMetadataIssue[] = (() => {
      if (integrityStatus === 'invalid') {
        return [issue(
          'invalid-content-fingerprint',
          'Managed construction content fingerprint is malformed or unsupported.',
          headerRange,
        )];
      }
      if (integrityStatus === 'detached') {
        return [issue(
          'content-fingerprint-mismatch',
          'Managed semantic metadata is detached from its TikZ body.',
          headerRange,
        )];
      }
      return [];
    })();
    blocks.push({
      id,
      kind,
      planKind,
      inputs,
      outputs,
      schemaVersion: schema.value,
      metadataStatus: metadata.status,
      integrityStatus,
      contentFingerprint,
      actualContentFingerprint,
      records: metadata.records,
      metadataIssues: [
        ...schema.issues,
        ...metadata.issues,
        ...integrityIssues,
      ],
      range: { start: begin.index, end: END_LINE.lastIndex },
      headerRange,
      semanticRecordRanges: metadata.recordRanges,
      bodyRange,
      tikzBodyRange,
      endRange,
    });
    BEGIN_LINE.lastIndex = END_LINE.lastIndex;
  }
  return blocks;
}

export interface ManagedConstructionDocumentReferenceIssue {
  readonly code:
    | 'dangling-managed-reference'
    | 'ambiguous-managed-reference'
    | 'incompatible-managed-reference-kind';
  readonly constructionId: string;
  readonly recordId: string;
  readonly path: string;
  readonly reference: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly expectedKind?: ConstructionEntity['kind'];
  readonly actualKind?: ConstructionEntity['kind'];
  readonly message: string;
}

/**
 * Validate persistent references across managed-block boundaries.
 *
 * Per-block metadata validation deliberately treats `managed:*` inputs as
 * opaque external identities. This document-level pass resolves those
 * identities against the current revision so a valid block cannot silently
 * become dangling after another block is recompiled.
 */
export function managedConstructionDocumentReferenceIssues(
  source: string,
): readonly ManagedConstructionDocumentReferenceIssue[] {
  const blocks = parseManagedConstructionBlocks(source).filter((block) => (
    block.metadataStatus === 'valid'
    && block.integrityStatus === 'valid'
  ));
  const targets = new Map<string, Array<{
    constructionId: string;
    recordId: string;
    kind: ConstructionEntity['kind'];
  }>>();
  for (const block of blocks) {
    for (const record of block.records) {
      if (record.recordType !== 'entity') continue;
      const reference = `managed:${block.id}:${record.id}`;
      const owners = targets.get(reference) ?? [];
      owners.push({
        constructionId: block.id,
        recordId: record.id,
        kind: record.kind,
      });
      targets.set(reference, owners);
    }
  }

  const issues: ManagedConstructionDocumentReferenceIssue[] = [];
  for (const block of blocks) {
    block.records.forEach((record, index) => {
      const uses: SemanticReferenceUse[] = record.recordType === 'input'
        ? [{ path: 'ref', value: record.ref }]
        : semanticReferencesOf(record);
      const range = block.semanticRecordRanges[index] ?? block.range;
      for (const use of uses) {
        if (!isManagedProvenanceReference(use.value)) continue;
        const owners = targets.get(use.value) ?? [];
        if (owners.length === 0) {
          issues.push({
            code: 'dangling-managed-reference',
            constructionId: block.id,
            recordId: record.id,
            path: use.path,
            reference: use.value,
            range,
            ...(use.expectedKind ? { expectedKind: use.expectedKind } : {}),
            message: `Managed construction ${block.id} record ${record.id} field ${use.path} references missing entity ${use.value}.`,
          });
          continue;
        }
        if (owners.length !== 1) {
          issues.push({
            code: 'ambiguous-managed-reference',
            constructionId: block.id,
            recordId: record.id,
            path: use.path,
            reference: use.value,
            range,
            ...(use.expectedKind ? { expectedKind: use.expectedKind } : {}),
            message: `Managed construction ${block.id} record ${record.id} field ${use.path} resolves ${use.value} to ${owners.length} entities.`,
          });
          continue;
        }
        const owner = owners[0]!;
        if (use.expectedKind && owner.kind !== use.expectedKind) {
          issues.push({
            code: 'incompatible-managed-reference-kind',
            constructionId: block.id,
            recordId: record.id,
            path: use.path,
            reference: use.value,
            range,
            expectedKind: use.expectedKind,
            actualKind: owner.kind,
            message: `Managed construction ${block.id} record ${record.id} field ${use.path} expects ${use.expectedKind}, but ${use.value} is ${owner.kind}.`,
          });
        }
      }
    });
  }
  return issues;
}

export function managedConstructionDocumentReferenceIssueKey(
  value: ManagedConstructionDocumentReferenceIssue,
): string {
  return [
    value.code,
    value.constructionId,
    value.recordId,
    value.path,
    value.reference,
    value.expectedKind ?? '',
    value.actualKind ?? '',
  ].join('|');
}
