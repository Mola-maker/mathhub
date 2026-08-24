import {
  calcDifferenceCoordinate,
  calcInterpolateCoordinate,
  calcOffsetCoordinate,
  calcProjectionCoordinate,
  calcTranslateByVectorCoordinate,
  type TikzCalcScalar,
} from './tikz-coordinate-serializer';
import { formatCoordNumber } from '../patch/source-patch';
import { hashSource } from '../document/source-hash';
import {
  MANAGED_CONSTRUCTION_FINGERPRINT_ALGORITHM,
  MANAGED_CONSTRUCTION_SCHEMA_VERSION,
  managedConstructionContentFingerprint,
  serializeManagedConstructionRecords,
  type ManagedConstructionSemanticRecord,
} from '../semantics/managed-construction';

/**
 * Construction IR is deliberately independent of a renderer or a source
 * language.  TikZ is only one writer for a validated plan.  `ref` values are
 * document-local semantic identities (normally the corresponding TikZ name).
 */
export type ConstructionScalar = TikzCalcScalar;
export type ConstructionPlanKind =
  | 'primitive'
  | 'rectangle-by-opposite-corners'
  | 'midpoint'
  | 'perpendicular-foot'
  | 'point-on-circle'
  | 'parallel-line'
  | 'perpendicular-line'
  | 'perpendicular-bisector'
  | 'angle-bisector'
  | 'circumcircle'
  | 'nine-point-circle'
  | 'simson-line'
  | 'fermat-point'
  | 'tangent-at-point'
  | 'reflect-point'
  | 'reflect-line'
  | 'rotate-90'
  | 'homothety-2'
  | 'inversion-point'
  | 'radical-axis'
  | 'cyclic-quadrilateral'
  | 'complete-quadrilateral';

export type PrimitiveKind =
  | 'point'
  | 'segment'
  | 'vector'
  | 'line'
  | 'ray'
  | 'polyline'
  | 'polygon'
  | 'rectangle'
  | 'circle'
  | 'label'
  | 'angle'
  | 'right-angle';

export interface ConstructionInput {
  readonly id: string;
  readonly role: string;
  readonly ref: string;
}

export type ConstructionPoint =
  | readonly [number, number]
  | { readonly x: number; readonly y: number };

export interface ConstructionEntityBase {
  readonly recordType: 'entity';
  readonly id: string;
  readonly name: string;
  readonly tags?: readonly string[];
}

export type ConstructionEntity =
  | (ConstructionEntityBase & {
    readonly kind: 'point';
    /** Omitted for a derived point whose position is supplied by a constraint. */
    readonly position?: ConstructionPoint;
  })
  | (ConstructionEntityBase & {
    readonly kind: 'segment' | 'vector' | 'line' | 'ray';
    readonly from: string;
    readonly to: string;
  })
  | (ConstructionEntityBase & {
    readonly kind: 'polyline' | 'polygon';
    readonly vertices: readonly string[];
  })
  | (ConstructionEntityBase & {
    readonly kind: 'rectangle';
    /** Opposite corners, not four pre-expanded vertices. */
    readonly corners: readonly [string, string];
  })
  | (ConstructionEntityBase & {
    readonly kind: 'circle';
    readonly center: string;
    readonly through: string;
    readonly radius?: never;
  })
  | (ConstructionEntityBase & {
    readonly kind: 'circle';
    readonly center: string;
    readonly radius: number;
    readonly through?: never;
  })
  | (ConstructionEntityBase & {
    readonly kind: 'label';
    readonly at: string;
    readonly text: string;
  })
  | (ConstructionEntityBase & {
    readonly kind: 'angle' | 'right-angle';
    readonly points: readonly [string, string, string];
  });

export type ConstructionConstraint =
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'point-reflection';
    readonly source: string;
    readonly center: string;
    readonly result: string;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'line-reflection';
    readonly source: string;
    readonly axisStart: string;
    readonly axisEnd: string;
    readonly foot: string;
    readonly result: string;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'rotation';
    readonly source: string;
    readonly center: string;
    readonly result: string;
    readonly angleDegrees: ConstructionScalar;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'homothety';
    readonly source: string;
    readonly center: string;
    readonly result: string;
    readonly scale: ConstructionScalar;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'midpoint';
    readonly point: string;
    readonly a: string;
    readonly b: string;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'perpendicular-foot';
    readonly point: string;
    readonly lineStart: string;
    readonly lineEnd: string;
    readonly result: string;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'on-circle';
    readonly point: string;
    readonly circle: string;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'circle-through-three-points';
    readonly circle: string;
    readonly center: string;
    readonly points: readonly [string, string, string];
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'tangent-at-point';
    readonly line: string;
    readonly touch: string;
    readonly circle: string;
    readonly center: string;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'perpendicular-bisector';
    readonly line: string;
    readonly midpoint: string;
    readonly a: string;
    readonly b: string;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'angle-bisector';
    readonly line: string;
    readonly armA: string;
    readonly vertex: string;
    readonly armB: string;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'parallel' | 'perpendicular';
    readonly line: string;
    readonly reference: string;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'inversion';
    readonly point: string;
    readonly center: string;
    readonly radius: string;
    readonly result: string;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'radical-axis';
    readonly line: string;
    readonly point: string;
    readonly circle1: string;
    readonly circle2: string;
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    /** Intersection of two infinite supporting lines. */
    readonly kind: 'line-intersection';
    readonly point: string;
    readonly line1: string;
    readonly line2: string;
    readonly domain: 'line';
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    /** The line/circle branch other than a stable, known point. */
    readonly kind: 'line-circle-other-intersection';
    readonly point: string;
    readonly line: string;
    readonly circle: string;
    readonly excludePoint: string;
    readonly domain: 'line';
    readonly selector: 'exclude-known-point';
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'cyclic';
    readonly points: readonly [string, string, string, string];
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'collinear';
    readonly points: readonly [string, string, string];
  }
  | {
    readonly recordType: 'constraint';
    readonly id: string;
    readonly kind: 'complete-quadrilateral';
    readonly points: readonly [string, string, string, string];
  };

export type ConstructionRelation =
  | {
    readonly recordType: 'relation';
    readonly id: string;
    readonly kind: 'depends-on' | 'incidence' | 'constructed-by' | 'selection';
    readonly from: string;
    readonly to: string;
    readonly directed?: boolean;
  };

export interface ConstructionOutput {
  readonly recordType: 'output';
  readonly id: string;
  readonly role: string;
  readonly ref: string;
  readonly kind: PrimitiveKind | 'derived-point' | 'derived-line';
}

/**
 * The only escape hatch for a source writer.  It is intentionally named
 * `opaque`, explicitly marked unsafe, and never accepted by the default
 * compiler path.
 */
export interface OpaqueSourceWriterHint {
  readonly kind: 'opaque';
  readonly unsafe: true;
  readonly reason: string;
  readonly lines: readonly string[];
  readonly mode?: 'append' | 'replace';
}

export type SourceWriterHint = OpaqueSourceWriterHint;

export type PrimitiveDefinition =
  | { readonly kind: 'point'; readonly name: string; readonly position: ConstructionPoint }
  | { readonly kind: 'segment' | 'vector' | 'line' | 'ray'; readonly from: string; readonly to: string }
  | { readonly kind: 'polyline' | 'polygon'; readonly vertices: readonly string[] }
  | { readonly kind: 'rectangle'; readonly corners: readonly [string, string] }
  | { readonly kind: 'circle'; readonly center: string; readonly through: string }
  | { readonly kind: 'label'; readonly at: string; readonly text: string }
  | { readonly kind: 'angle' | 'right-angle'; readonly points: readonly [string, string, string] };

export interface CircleConstructionReference {
  readonly id?: string;
  readonly center: string;
  readonly through?: string;
  readonly radius?: ConstructionScalar;
  readonly angleDegrees?: ConstructionScalar;
  /** Evaluated snapshot used only for write-time degeneracy preconditions. */
  readonly evaluatedCenter?: ConstructionPoint;
  /** Evaluated positive radius paired with evaluatedCenter. */
  readonly evaluatedRadius?: number;
}

/**
 * Promotes one already-parsed raw TikZ circle statement into a durable managed
 * entity without rewriting its source spelling or style options.
 */
export interface SourceCircleAdoptionRequest {
  readonly id: string;
  readonly entityId: string;
  readonly source: string;
  readonly circle:
    | { readonly center: string; readonly through: string }
    | { readonly center: string; readonly radius: number };
}

export type SourceCircleDefinition =
  | {
    readonly kind: 'center-through';
    readonly centerName: string;
    readonly throughName: string;
  }
  | {
    readonly kind: 'center-radius';
    readonly centerName: string;
    readonly radius: number;
  };

/**
 * Revision-bound request to promote one directly writable raw TikZ circle
 * into a managed semantic entity. Callers may select the source binding, but
 * the Broker must rederive every field from the current GeometryDoc before
 * commit; raw geometric signatures are never durable identities.
 */
export interface SourceCircleAdoptionIntent {
  readonly constructionId: string;
  readonly sourceEntityId: string;
  readonly sourceBindingId: string;
  readonly managedEntityId: 'circle';
  readonly sourceStableId: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly definition: SourceCircleDefinition;
}

export interface ConstructionPlanBase<K extends ConstructionPlanKind> {
  readonly id: string;
  readonly kind: K;
  readonly inputs: readonly ConstructionInput[];
  readonly entities: readonly ConstructionEntity[];
  readonly constraints: readonly ConstructionConstraint[];
  readonly relations: readonly ConstructionRelation[];
  readonly outputs: readonly ConstructionOutput[];
  readonly status: string;
  readonly selection: readonly string[];
  readonly sourceWriterHint?: SourceWriterHint;
}

export type PrimitiveConstructionPlan = ConstructionPlanBase<'primitive'> & {
  readonly primitive: PrimitiveDefinition;
};

export type RectangleByOppositeCornersConstructionPlan =
  ConstructionPlanBase<'rectangle-by-opposite-corners'> & {
    readonly first: string;
    readonly opposite: string;
    readonly second: string;
    readonly fourth: string;
  };

export type PointOnCircleConstructionPlan = ConstructionPlanBase<'point-on-circle'> & {
  readonly circle: CircleConstructionReference;
  readonly result: string;
};

export type MidpointConstructionPlan = ConstructionPlanBase<'midpoint'> & {
  readonly a: string;
  readonly b: string;
  readonly result: string;
};

export type PerpendicularFootConstructionPlan =
  ConstructionPlanBase<'perpendicular-foot'> & {
    readonly point: string;
    readonly lineStart: string;
    readonly lineEnd: string;
    readonly result: string;
  };

export type ParallelLineConstructionPlan = ConstructionPlanBase<'parallel-line'> & {
  readonly through: string;
  readonly referenceStart: string;
  readonly referenceEnd: string;
  readonly result: string;
};

export type PerpendicularLineConstructionPlan = ConstructionPlanBase<'perpendicular-line'> & {
  readonly through: string;
  readonly referenceStart: string;
  readonly referenceEnd: string;
  readonly result: string;
};

export type PerpendicularBisectorConstructionPlan = ConstructionPlanBase<'perpendicular-bisector'> & {
  readonly a: string;
  readonly b: string;
  readonly midpoint: string;
  readonly result: string;
  readonly line: string;
};

export type AngleBisectorConstructionPlan = ConstructionPlanBase<'angle-bisector'> & {
  readonly armA: string;
  readonly vertex: string;
  readonly armB: string;
  readonly result: string;
  readonly line: string;
};

export type CircumcircleConstructionPlan = ConstructionPlanBase<'circumcircle'> & {
  readonly a: string;
  readonly b: string;
  readonly c: string;
  readonly center: string;
  readonly circle: string;
};

export type NinePointCircleConstructionPlan = ConstructionPlanBase<'nine-point-circle'> & {
  readonly a: string;
  readonly b: string;
  readonly c: string;
  readonly midpointBC: string;
  readonly midpointCA: string;
  readonly midpointAB: string;
  readonly footA: string;
  readonly footB: string;
  readonly footC: string;
  readonly orthocenter: string;
  readonly vertexMidpointA: string;
  readonly vertexMidpointB: string;
  readonly vertexMidpointC: string;
  readonly center: string;
  readonly circle: string;
};

export type SimsonLineConstructionPlan = ConstructionPlanBase<'simson-line'> & {
  readonly a: string;
  readonly b: string;
  readonly c: string;
  readonly center: string;
  readonly circle: string;
  readonly point: string;
  readonly footAB: string;
  readonly footBC: string;
  readonly footCA: string;
  readonly line: string;
  readonly angleDegrees: number;
};

export type FermatPointConstructionPlan = ConstructionPlanBase<'fermat-point'> & {
  readonly a: string;
  readonly b: string;
  readonly c: string;
  readonly equilateralAB: string;
  readonly equilateralAC: string;
  readonly torricelli: string;
  readonly result: string;
  readonly line1: string;
  readonly line2: string;
  readonly triangleAB: string;
  readonly triangleAC: string;
  readonly rayA: string;
  readonly rayB: string;
  readonly rayC: string;
  readonly rotationABDegrees: number;
  readonly rotationACDegrees: number;
  /** Torricelli for the interior branch, otherwise the >=120-degree vertex. */
  readonly resultSource: string;
};

export type TangentAtPointConstructionPlan = ConstructionPlanBase<'tangent-at-point'> & {
  readonly touch: string;
  readonly circle: CircleConstructionReference;
  readonly result: string;
  readonly line: string;
};

export type ReflectPointConstructionPlan = ConstructionPlanBase<'reflect-point'> & {
  readonly point: string;
  readonly center: string;
  readonly result: string;
};

export type ReflectLineConstructionPlan = ConstructionPlanBase<'reflect-line'> & {
  readonly point: string;
  readonly lineStart: string;
  readonly lineEnd: string;
  readonly foot: string;
  readonly result: string;
};

export type Rotate90ConstructionPlan = ConstructionPlanBase<'rotate-90'> & {
  readonly point: string;
  readonly center: string;
  readonly result: string;
};

export type Homothety2ConstructionPlan = ConstructionPlanBase<'homothety-2'> & {
  readonly point: string;
  readonly center: string;
  readonly result: string;
};

export type InversionPointConstructionPlan = ConstructionPlanBase<'inversion-point'> & {
  readonly point: string;
  readonly center: string;
  readonly radiusPoint: string;
  readonly result: string;
  /** Visible construction guide joining the source point to its inverse. */
  readonly guide: string;
};

export type RadicalAxisConstructionPlan = ConstructionPlanBase<'radical-axis'> & {
  readonly circle1: CircleConstructionReference;
  readonly circle2: CircleConstructionReference;
  readonly result: string;
  readonly direction: string;
  readonly line: string;
};

export type CyclicQuadrilateralConstructionPlan = ConstructionPlanBase<'cyclic-quadrilateral'> & {
  readonly a: string;
  readonly b: string;
  readonly c: string;
  readonly direction: string;
  readonly center: string;
  readonly result: string;
  readonly circle: string;
  readonly secant: string;
  readonly polygon: string;
};

export type CompleteQuadrilateralConstructionPlan = ConstructionPlanBase<'complete-quadrilateral'> & {
  readonly a: string;
  readonly b: string;
  readonly c: string;
  readonly d: string;
  readonly firstIntersection: string;
  readonly secondIntersection: string;
  readonly lineAB: string;
  readonly lineBC: string;
  readonly lineCD: string;
  readonly lineDA: string;
  readonly diagonal: string;
};

export type ConstructionPlan =
  | PrimitiveConstructionPlan
  | RectangleByOppositeCornersConstructionPlan
  | MidpointConstructionPlan
  | PerpendicularFootConstructionPlan
  | PointOnCircleConstructionPlan
  | ParallelLineConstructionPlan
  | PerpendicularLineConstructionPlan
  | PerpendicularBisectorConstructionPlan
  | AngleBisectorConstructionPlan
  | CircumcircleConstructionPlan
  | NinePointCircleConstructionPlan
  | SimsonLineConstructionPlan
  | FermatPointConstructionPlan
  | TangentAtPointConstructionPlan
  | ReflectPointConstructionPlan
  | ReflectLineConstructionPlan
  | Rotate90ConstructionPlan
  | Homothety2ConstructionPlan
  | InversionPointConstructionPlan
  | RadicalAxisConstructionPlan
  | CyclicQuadrilateralConstructionPlan
  | CompleteQuadrilateralConstructionPlan;

export interface ConstructionValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface ConstructionCompilation {
  readonly lines: readonly string[];
  readonly selection: readonly string[];
  readonly status: string;
  readonly kind: ConstructionPlanKind;
}

export const CONSTRUCTION_WRITER_ID =
  'mathgeo/tikz-construction-writer' as const;
export const CONSTRUCTION_WRITER_REVISION = 1 as const;

export interface ConstructionWriterSlot {
  /** Stable per-construction semantic role; never derived from source layout. */
  readonly id: string;
  readonly role: string;
  readonly kind: 'tikz-statement' | 'tikz-fragment';
  /** Stable semantic record identities responsible for this source slot. */
  readonly owners: readonly string[];
  /** Source-neutral hash of the canonical plan core and this slot identity. */
  readonly semanticFingerprint: string;
  readonly canonicalSource: string;
  readonly optionSites: readonly {
    readonly id: string;
    readonly insertionPolicy: 'command-options';
  }[];
}

export interface ConstructionWriterArtifact {
  readonly writerId: typeof CONSTRUCTION_WRITER_ID;
  readonly writerRevision: typeof CONSTRUCTION_WRITER_REVISION;
  readonly planKind: ConstructionPlanKind;
  /** Source-neutral fingerprint of this writer ABI and ordered slot contract. */
  readonly semanticFingerprint: string;
  readonly referenceSurface: readonly string[];
  readonly slots: readonly ConstructionWriterSlot[];
}

export interface ConstructionWriterOptions {
  /** Required to intentionally emit an `opaque` writer hint. */
  readonly allowUnsafeOpaque?: boolean;
}

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9:_-]*$/;
const PERSISTENT_REFERENCE_PATTERN = /^managed:[A-Za-z0-9:_.%-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasPersistentReferencePrefix(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('managed:');
}

function isPersistentReference(value: unknown): value is string {
  return nonEmpty(value) && PERSISTENT_REFERENCE_PATTERN.test(value);
}

function validName(value: unknown): value is string {
  return nonEmpty(value)
    && !hasPersistentReferencePrefix(value)
    && NAME_PATTERN.test(value);
}

function validReference(value: unknown): value is string {
  return validName(value) || isPersistentReference(value);
}

function finiteScalar(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validScalar(value: unknown): value is ConstructionScalar {
  return finiteScalar(value)
    || (typeof value === 'string' && value.trim().length > 0);
}

function refIssue(path: string, value: unknown, issues: ConstructionValidationIssue[]): void {
  if (!validReference(value)) {
    issues.push({ path, message: 'reference must be a TikZ-safe name or a persistent semantic reference' });
  }
}

function uniqueIssue(values: readonly string[], path: string, issues: ConstructionValidationIssue[]): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) issues.push({ path: `${path}[${index}]`, message: `duplicate value ${value}` });
    seen.add(value);
  });
}

interface ReferenceEntry {
  readonly path: string;
  readonly value: unknown;
}

function referenceEntry(path: string, value: unknown): ReferenceEntry {
  return { path, value };
}

/**
 * Validate the discriminated entity records at the IR boundary.  This is
 * intentionally a switch rather than a generic object walker: geometry
 * dependencies are part of the semantic contract and must not be inferred
 * from arbitrary string-valued properties.
 */
function validateEntity(value: unknown, path: string, issues: ConstructionValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: 'entity must be an object' });
    return;
  }
  if (value.recordType !== 'entity') {
    issues.push({ path: `${path}.recordType`, message: 'entity recordType must be entity' });
  }
  if (!validName(value.id)) issues.push({ path: `${path}.id`, message: 'entity id is invalid' });
  if (!validName(value.name)) issues.push({ path: `${path}.name`, message: 'entity name is invalid' });
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string'))) {
    issues.push({ path: `${path}.tags`, message: 'entity tags must be an array of strings' });
  }
  if (typeof value.kind !== 'string') {
    issues.push({ path: `${path}.kind`, message: 'entity kind is required' });
    return;
  }
  const ref = (field: string): void => refIssue(`${path}.${field}`, value[field], issues);
  switch (value.kind) {
    case 'point':
      if (value.position !== undefined) validatePoint(value.position, `${path}.position`, issues);
      return;
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray':
      ref('from');
      ref('to');
      if (value.from === value.to) issues.push({ path: `${path}.endpoints`, message: 'edge endpoints must be distinct' });
      return;
    case 'polyline':
    case 'polygon':
      if (!Array.isArray(value.vertices) || value.vertices.length < (value.kind === 'polygon' ? 3 : 2)) {
        issues.push({ path: `${path}.vertices`, message: `${value.kind} requires at least ${value.kind === 'polygon' ? 3 : 2} vertices` });
      } else {
        value.vertices.forEach((vertex, index) => refIssue(`${path}.vertices[${index}]`, vertex, issues));
      }
      return;
    case 'rectangle':
      if (!Array.isArray(value.corners) || value.corners.length !== 2) {
        issues.push({ path: `${path}.corners`, message: 'rectangle requires two opposite corners' });
      } else {
        value.corners.forEach((corner, index) => refIssue(`${path}.corners[${index}]`, corner, issues));
        if (value.corners[0] === value.corners[1]) issues.push({ path: `${path}.corners`, message: 'rectangle corners must be distinct' });
      }
      return;
    case 'circle': {
      ref('center');
      const hasThrough = value.through !== undefined;
      const hasRadius = value.radius !== undefined;
      if (hasThrough === hasRadius) {
        issues.push({ path, message: 'circle requires exactly one of through or positive finite radius' });
      }
      if (hasThrough) {
        ref('through');
        if (value.through === value.center) issues.push({ path: `${path}.through`, message: 'circle through point must differ from its center' });
      }
      if (hasRadius && (!finiteScalar(value.radius) || value.radius <= 0)) {
        issues.push({ path: `${path}.radius`, message: 'circle radius must be a positive finite number' });
      }
      return;
    }
    case 'label':
      ref('at');
      if (typeof value.text !== 'string' || value.text.length === 0) issues.push({ path: `${path}.text`, message: 'label text is required' });
      return;
    case 'angle':
    case 'right-angle':
      if (!Array.isArray(value.points) || value.points.length !== 3) {
        issues.push({ path: `${path}.points`, message: `${value.kind} requires exactly three points` });
      } else {
        value.points.forEach((point, index) => refIssue(`${path}.points[${index}]`, point, issues));
      }
      return;
    default:
      issues.push({ path: `${path}.kind`, message: `unsupported entity kind ${String(value.kind)}` });
  }
}

function outputKindMatchesEntity(outputKind: unknown, entityKind: unknown): boolean {
  if (outputKind === 'derived-point') return entityKind === 'point';
  if (outputKind === 'derived-line') return entityKind === 'line';
  return outputKind === entityKind;
}

function entityReferenceEntries(entity: Record<string, unknown>, path: string): readonly ReferenceEntry[] {
  switch (entity.kind) {
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray':
      return [referenceEntry(`${path}.from`, entity.from), referenceEntry(`${path}.to`, entity.to)];
    case 'polyline':
    case 'polygon':
      return Array.isArray(entity.vertices)
        ? entity.vertices.map((value, index) => referenceEntry(`${path}.vertices[${index}]`, value))
        : [];
    case 'rectangle':
      return Array.isArray(entity.corners)
        ? entity.corners.map((value, index) => referenceEntry(`${path}.corners[${index}]`, value))
        : [];
    case 'circle':
      return [
        referenceEntry(`${path}.center`, entity.center),
        ...(entity.through !== undefined ? [referenceEntry(`${path}.through`, entity.through)] : []),
      ];
    case 'label':
      return [referenceEntry(`${path}.at`, entity.at)];
    case 'angle':
    case 'right-angle':
      return Array.isArray(entity.points)
        ? entity.points.map((value, index) => referenceEntry(`${path}.points[${index}]`, value))
        : [];
    case 'point':
    default:
      return [];
  }
}

function constraintReferenceEntries(constraint: Record<string, unknown>, path: string): readonly ReferenceEntry[] {
  switch (constraint.kind) {
    case 'point-reflection':
      return ['source', 'center', 'result'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'line-reflection':
      return ['source', 'axisStart', 'axisEnd', 'foot', 'result'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'rotation':
    case 'homothety':
      return ['source', 'center', 'result'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'midpoint':
      return ['point', 'a', 'b'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'perpendicular-foot':
      return ['point', 'lineStart', 'lineEnd', 'result'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'on-circle':
      return ['point', 'circle'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'circle-through-three-points':
      return [
        referenceEntry(`${path}.circle`, constraint.circle),
        referenceEntry(`${path}.center`, constraint.center),
        ...(Array.isArray(constraint.points)
          ? constraint.points.map((value, index) => referenceEntry(`${path}.points[${index}]`, value))
          : []),
      ];
    case 'tangent-at-point':
      return ['line', 'touch', 'circle', 'center'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'perpendicular-bisector':
      return ['line', 'midpoint', 'a', 'b'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'angle-bisector':
      return ['line', 'armA', 'vertex', 'armB'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'parallel':
    case 'perpendicular':
      return ['line', 'reference'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'inversion':
      return ['point', 'center', 'radius', 'result'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'radical-axis':
      return ['line', 'point', 'circle1', 'circle2'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'line-intersection':
      return ['point', 'line1', 'line2'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'line-circle-other-intersection':
      return ['point', 'line', 'circle', 'excludePoint'].map((field) => referenceEntry(`${path}.${field}`, constraint[field]));
    case 'cyclic':
    case 'complete-quadrilateral':
      return Array.isArray(constraint.points)
        ? constraint.points.map((value, index) => referenceEntry(`${path}.points[${index}]`, value))
        : [];
    case 'collinear':
      return Array.isArray(constraint.points)
        ? constraint.points.map((value, index) => referenceEntry(`${path}.points[${index}]`, value))
        : [];
    default:
      return [];
  }
}

function planReferenceEntries(plan: Record<string, unknown>): readonly ReferenceEntry[] {
  const ref = (field: string): ReferenceEntry => referenceEntry(field, plan[field]);
  switch (plan.kind) {
    case 'primitive': {
      const primitive = isRecord(plan.primitive) ? plan.primitive : null;
      if (!primitive) return [];
      switch (primitive.kind) {
        case 'segment':
        case 'vector':
        case 'line':
        case 'ray':
          return [referenceEntry('primitive.from', primitive.from), referenceEntry('primitive.to', primitive.to)];
        case 'polyline':
        case 'polygon':
          return Array.isArray(primitive.vertices)
            ? primitive.vertices.map((value, index) => referenceEntry(`primitive.vertices[${index}]`, value))
            : [];
        case 'rectangle':
          return Array.isArray(primitive.corners)
            ? primitive.corners.map((value, index) => referenceEntry(`primitive.corners[${index}]`, value))
            : [];
        case 'circle':
          return [referenceEntry('primitive.center', primitive.center), referenceEntry('primitive.through', primitive.through)];
        case 'label':
          return [referenceEntry('primitive.at', primitive.at)];
        case 'angle':
        case 'right-angle':
          return Array.isArray(primitive.points)
            ? primitive.points.map((value, index) => referenceEntry(`primitive.points[${index}]`, value))
            : [];
        case 'point':
        default:
          return [];
      }
    }
    case 'rectangle-by-opposite-corners':
      return ['first', 'opposite', 'second', 'fourth'].map(ref);
    case 'midpoint':
      return ['a', 'b', 'result'].map(ref);
    case 'perpendicular-foot':
      return ['point', 'lineStart', 'lineEnd', 'result'].map(ref);
    case 'parallel-line':
    case 'perpendicular-line':
      return ['through', 'referenceStart', 'referenceEnd', 'result'].map(ref);
    case 'perpendicular-bisector':
      return ['a', 'b', 'midpoint', 'result', 'line'].map(ref);
    case 'angle-bisector':
      return ['armA', 'vertex', 'armB', 'result', 'line'].map(ref);
    case 'circumcircle':
      return ['a', 'b', 'c', 'center', 'circle'].map(ref);
    case 'nine-point-circle':
      return [
        'a', 'b', 'c', 'midpointBC', 'midpointCA', 'midpointAB',
        'footA', 'footB', 'footC', 'orthocenter',
        'vertexMidpointA', 'vertexMidpointB', 'vertexMidpointC',
        'center', 'circle',
      ].map(ref);
    case 'simson-line':
      return [
        'a', 'b', 'c', 'center', 'circle', 'point',
        'footAB', 'footBC', 'footCA', 'line',
      ].map(ref);
    case 'fermat-point':
      return [
        'a', 'b', 'c', 'equilateralAB', 'equilateralAC', 'torricelli',
        'result', 'line1', 'line2', 'triangleAB', 'triangleAC',
        'rayA', 'rayB', 'rayC', 'resultSource',
      ].map(ref);
    case 'reflect-point':
    case 'rotate-90':
    case 'homothety-2':
      return ['point', 'center', 'result'].map(ref);
    case 'reflect-line':
      return ['point', 'lineStart', 'lineEnd', 'foot', 'result'].map(ref);
    case 'inversion-point':
      return ['point', 'center', 'radiusPoint', 'result', 'guide'].map(ref);
    case 'cyclic-quadrilateral':
      return ['a', 'b', 'c', 'direction', 'center', 'result', 'circle', 'secant', 'polygon'].map(ref);
    case 'complete-quadrilateral':
      return [
        'a', 'b', 'c', 'd', 'firstIntersection', 'secondIntersection',
        'lineAB', 'lineBC', 'lineCD', 'lineDA', 'diagonal',
      ].map(ref);
    case 'point-on-circle':
    case 'tangent-at-point':
    case 'radical-axis': {
      const entries: ReferenceEntry[] = [];
      if (plan.kind === 'point-on-circle') entries.push(ref('result'));
      if (plan.kind === 'tangent-at-point') entries.push(...['touch', 'result', 'line'].map(ref));
      if (plan.kind === 'radical-axis') entries.push(...['result', 'direction', 'line'].map(ref));
      const circleValues = plan.kind === 'radical-axis'
        ? [
          ['circle1', plan.circle1],
          ['circle2', plan.circle2],
        ] as const
        : [['circle', plan.circle]] as const;
      circleValues.forEach(([name, raw]) => {
        if (!isRecord(raw)) return;
        if (raw.id !== undefined) entries.push(referenceEntry(`${name}.id`, raw.id));
        // Ordinary center/through values are source-coordinate witnesses
        // mirrored by the circle input. A managed witness is different: it
        // must still prove provenance through the explicit input list.
        if (isPersistentReference(raw.center)) entries.push(referenceEntry(`${name}.center`, raw.center));
        if (isPersistentReference(raw.through)) entries.push(referenceEntry(`${name}.through`, raw.through));
      });
      return entries;
    }
  }
  return [];
}

function validateReferenceClosure(plan: Record<string, unknown>, issues: ConstructionValidationIssue[]): void {
  const inputReferences = new Set<string>();
  const allowed = new Set<string>();
  if (Array.isArray(plan.inputs)) {
    plan.inputs.forEach((input) => {
      if (isRecord(input) && validReference(input.ref)) {
        inputReferences.add(input.ref);
        allowed.add(input.ref);
      }
    });
  }
  if (Array.isArray(plan.entities)) {
    plan.entities.forEach((entity) => {
      if (isRecord(entity)) {
        if (validName(entity.id)) allowed.add(entity.id);
        if (validName(entity.name)) allowed.add(entity.name);
      }
    });
  }
  const check = (entry: ReferenceEntry): void => {
    if (isPersistentReference(entry.value)) {
      if (!inputReferences.has(entry.value)) {
        issues.push({ path: entry.path, message: `persistent reference ${entry.value} must be declared by an input` });
      }
      return;
    }
    if (validReference(entry.value) && !allowed.has(entry.value)) {
      issues.push({ path: entry.path, message: `reference ${entry.value} is not declared by an input or entity` });
    }
  };
  if (Array.isArray(plan.selection)) {
    plan.selection.forEach((value, index) => check(referenceEntry(`selection[${index}]`, value)));
  }
  if (Array.isArray(plan.entities)) {
    plan.entities.forEach((entity, index) => {
      if (isRecord(entity)) entityReferenceEntries(entity, `entities[${index}]`).forEach(check);
    });
  }
  if (Array.isArray(plan.constraints)) {
    plan.constraints.forEach((constraint, index) => {
      if (isRecord(constraint)) constraintReferenceEntries(constraint, `constraints[${index}]`).forEach(check);
    });
  }
  if (Array.isArray(plan.relations)) {
    plan.relations.forEach((relation, index) => {
      if (isRecord(relation)) {
        check(referenceEntry(`relations[${index}].from`, relation.from));
        check(referenceEntry(`relations[${index}].to`, relation.to));
      }
    });
  }
  if (Array.isArray(plan.outputs)) {
    plan.outputs.forEach((output, index) => {
      if (isRecord(output)) check(referenceEntry(`outputs[${index}].ref`, output.ref));
    });
  }
  planReferenceEntries(plan).forEach(check);
}

function validateBase(plan: Record<string, unknown>, issues: ConstructionValidationIssue[]): void {
  if (!validName(plan.id)) issues.push({ path: 'id', message: 'id must be a TikZ-safe name' });
  if (typeof plan.status !== 'string') issues.push({ path: 'status', message: 'status must be a string' });
  if (!Array.isArray(plan.selection) || plan.selection.some((value) => !validReference(value))) {
    issues.push({ path: 'selection', message: 'selection must contain only semantic references' });
  }
  for (const field of ['inputs', 'entities', 'constraints', 'relations', 'outputs'] as const) {
    if (!Array.isArray(plan[field])) issues.push({ path: field, message: `${field} must be an array` });
  }
  if (Array.isArray(plan.inputs)) {
    const ids: string[] = [];
    plan.inputs.forEach((input, index) => {
      if (!isRecord(input)) {
        issues.push({ path: `inputs[${index}]`, message: 'input must be an object' });
        return;
      }
      if (!validName(input.id)) issues.push({ path: `inputs[${index}].id`, message: 'input id is invalid' });
      if (!nonEmpty(input.role)) issues.push({ path: `inputs[${index}].role`, message: 'input role is required' });
      refIssue(`inputs[${index}].ref`, input.ref, issues);
      if (typeof input.id === 'string') ids.push(input.id);
    });
    uniqueIssue(ids, 'inputs', issues);
  }
  if (Array.isArray(plan.entities)) {
    const ids: string[] = [];
    const names: string[] = [];
    const aliases = new Map<string, number>();
    const inputReferences = new Set<string>();
    if (Array.isArray(plan.inputs)) {
      for (const input of plan.inputs) {
        if (isRecord(input) && validReference(input.ref)) {
          inputReferences.add(input.ref);
        }
      }
    }
    plan.entities.forEach((entity, index) => {
      const path = `entities[${index}]`;
      validateEntity(entity, path, issues);
      if (!isRecord(entity)) return;
      if (typeof entity.id === 'string' && validName(entity.id)) ids.push(entity.id);
      if (typeof entity.name === 'string' && validName(entity.name)) names.push(entity.name);
      for (const field of ['id', 'name'] as const) {
        const alias = entity[field];
        if (!validName(alias)) continue;
        if (inputReferences.has(alias)) {
          issues.push({
            path: `${path}.${field}`,
            message: `semantic alias ${alias} collides with an input reference; entity aliases and external inputs must resolve unambiguously`,
          });
        }
        const owner = aliases.get(alias);
        if (owner !== undefined && owner !== index) {
          issues.push({
            path: `${path}.${field}`,
            message: `semantic alias ${alias} collides with entity ${owner}; entity ids/names must resolve unambiguously`,
          });
        } else {
          aliases.set(alias, index);
        }
      }
    });
    uniqueIssue(ids, 'entities', issues);
    uniqueIssue(names, 'entities.name', issues);
  }
  if (Array.isArray(plan.relations)) {
    const ids: string[] = [];
    const supportedKinds = new Set(['depends-on', 'incidence', 'constructed-by', 'selection']);
    plan.relations.forEach((relation, index) => {
      const path = `relations[${index}]`;
      if (!isRecord(relation)) {
        issues.push({ path, message: 'relation must be an object' });
        return;
      }
      if (relation.recordType !== 'relation') {
        issues.push({ path: `${path}.recordType`, message: 'relation recordType must be relation' });
      }
      if (!validName(relation.id)) {
        issues.push({ path: `${path}.id`, message: 'relation id is invalid' });
      } else {
        ids.push(relation.id);
      }
      if (typeof relation.kind !== 'string' || !supportedKinds.has(relation.kind)) {
        issues.push({ path: `${path}.kind`, message: `unsupported relation kind ${String(relation.kind)}` });
      }
      refIssue(`${path}.from`, relation.from, issues);
      refIssue(`${path}.to`, relation.to, issues);
      if (relation.from === relation.to) {
        issues.push({ path: `${path}.endpoints`, message: 'relation endpoints must be distinct' });
      }
      if (relation.directed !== undefined && typeof relation.directed !== 'boolean') {
        issues.push({ path: `${path}.directed`, message: 'relation directed must be a boolean when provided' });
      }
    });
    uniqueIssue(ids, 'relations', issues);
  }
  if (Array.isArray(plan.outputs)) {
    const ids: string[] = [];
    const refs: string[] = [];
    // An output may address its entity by name (points, which are referenced by
    // their TikZ name) or by record id (composite primitives, whose name is the
    // construction id and whose canonical reference is `entity-<name>`). Index
    // both so a declared entity resolves under either alias.
    const entitiesByAlias = new Map<string, Record<string, unknown>>();
    if (Array.isArray(plan.entities)) {
      for (const entity of plan.entities) {
        if (!isRecord(entity)) continue;
        if (validReference(entity.name)) entitiesByAlias.set(entity.name, entity);
        if (validReference(entity.id) && !entitiesByAlias.has(entity.id)) {
          entitiesByAlias.set(entity.id, entity);
        }
      }
    }
    const supportedKinds = new Set([
      'point', 'segment', 'vector', 'line', 'ray', 'polyline', 'polygon',
      'rectangle', 'circle', 'label', 'angle', 'right-angle',
      'derived-point', 'derived-line',
    ]);
    plan.outputs.forEach((output, index) => {
      if (!isRecord(output)) {
        issues.push({ path: `outputs[${index}]`, message: 'output must be an object' });
        return;
      }
      if (output.recordType !== 'output') {
        issues.push({ path: `outputs[${index}].recordType`, message: 'output recordType must be output' });
      }
      if (!validName(output.id)) issues.push({ path: `outputs[${index}].id`, message: 'output id is invalid' });
      if (!nonEmpty(output.role)) issues.push({ path: `outputs[${index}].role`, message: 'output role is required' });
      refIssue(`outputs[${index}].ref`, output.ref, issues);
      if (typeof output.kind !== 'string' || !supportedKinds.has(output.kind)) {
        issues.push({ path: `outputs[${index}].kind`, message: `unsupported output kind ${String(output.kind)}` });
      }
      if (validReference(output.ref)) {
        const entity = entitiesByAlias.get(output.ref);
        if (!entity) {
          issues.push({
            path: `outputs[${index}].ref`,
            message: `output reference ${output.ref} must resolve to a declared entity`,
          });
        } else if (!outputKindMatchesEntity(output.kind, entity.kind)) {
          issues.push({
            path: `outputs[${index}].kind`,
            message: `output kind ${String(output.kind)} does not match entity kind ${String(entity.kind)}`,
          });
        }
      }
      if (typeof output.id === 'string') ids.push(output.id);
      if (typeof output.ref === 'string') refs.push(output.ref);
    });
    uniqueIssue(ids, 'outputs', issues);
    uniqueIssue(refs, 'outputs.ref', issues);
  }
  if (Array.isArray(plan.constraints)) {
    const ids: string[] = [];
    plan.constraints.forEach((constraint, index) => {
      const path = `constraints[${index}]`;
      if (!isRecord(constraint)) {
        issues.push({ path, message: 'constraint must be an object' });
        return;
      }
      if (constraint.recordType !== 'constraint') {
        issues.push({ path: `${path}.recordType`, message: 'constraint recordType must be constraint' });
      }
      if (!validName(constraint.id)) {
        issues.push({ path: `${path}.id`, message: 'constraint id is invalid' });
      } else {
        ids.push(constraint.id);
      }
      if (!nonEmpty(constraint.kind)) {
        issues.push({ path: `${path}.kind`, message: 'constraint kind is required' });
        return;
      }
      const ref = (field: string): void => {
        refIssue(`${path}.${field}`, constraint[field], issues);
      };
      const scalar = (field: string): void => {
        if (!validScalar(constraint[field])) {
          issues.push({
            path: `${path}.${field}`,
            message: 'scalar must be a finite number or a non-empty scalar expression',
          });
        }
      };
      switch (constraint.kind) {
        case 'point-reflection':
          ['source', 'center', 'result'].forEach(ref);
          break;
        case 'line-reflection':
          ['source', 'axisStart', 'axisEnd', 'foot', 'result'].forEach(ref);
          if (constraint.axisStart === constraint.axisEnd) {
            issues.push({ path: `${path}.axis`, message: 'reflection axis endpoints must be distinct' });
          }
          break;
        case 'rotation':
          ['source', 'center', 'result'].forEach(ref);
          scalar('angleDegrees');
          break;
        case 'homothety':
          ['source', 'center', 'result'].forEach(ref);
          scalar('scale');
          break;
        case 'midpoint':
          ['point', 'a', 'b'].forEach(ref);
          break;
        case 'perpendicular-foot':
          ['point', 'lineStart', 'lineEnd', 'result'].forEach(ref);
          break;
        case 'on-circle':
          ['point', 'circle'].forEach(ref);
          break;
        case 'circle-through-three-points':
          ['circle', 'center'].forEach(ref);
          if (!Array.isArray(constraint.points) || constraint.points.length !== 3) {
            issues.push({ path: `${path}.points`, message: 'three-point circle requires exactly three points' });
          } else {
            constraint.points.forEach((value, pointIndex) => (
              refIssue(`${path}.points[${pointIndex}]`, value, issues)
            ));
            uniqueIssue(
              constraint.points.filter((value): value is string => typeof value === 'string'),
              `${path}.points`,
              issues,
            );
          }
          break;
        case 'tangent-at-point':
          ['line', 'touch', 'circle', 'center'].forEach(ref);
          break;
        case 'perpendicular-bisector':
          ['line', 'midpoint', 'a', 'b'].forEach(ref);
          break;
        case 'angle-bisector':
          ['line', 'armA', 'vertex', 'armB'].forEach(ref);
          break;
        case 'parallel':
        case 'perpendicular':
          ['line', 'reference'].forEach(ref);
          break;
        case 'inversion':
          ['point', 'center', 'radius', 'result'].forEach(ref);
          break;
        case 'radical-axis':
          ['line', 'point', 'circle1', 'circle2'].forEach(ref);
          if (constraint.circle1 === constraint.circle2) {
            issues.push({ path: `${path}.circles`, message: 'radical axis requires two distinct circles' });
          }
          break;
        case 'line-intersection':
          ['point', 'line1', 'line2'].forEach(ref);
          if (constraint.line1 === constraint.line2) {
            issues.push({ path: `${path}.lines`, message: 'line intersection requires two distinct lines' });
          }
          if (constraint.domain !== 'line') {
            issues.push({ path: `${path}.domain`, message: 'line intersection domain must be line' });
          }
          break;
        case 'line-circle-other-intersection':
          ['point', 'line', 'circle', 'excludePoint'].forEach(ref);
          if (constraint.line === constraint.circle) {
            issues.push({ path: `${path}.parents`, message: 'line-circle intersection requires distinct line and circle references' });
          }
          if (constraint.point === constraint.excludePoint) {
            issues.push({ path: `${path}.excludePoint`, message: 'other intersection output must differ from the excluded point' });
          }
          if (constraint.domain !== 'line') {
            issues.push({ path: `${path}.domain`, message: 'line-circle intersection domain must be line' });
          }
          if (constraint.selector !== 'exclude-known-point') {
            issues.push({ path: `${path}.selector`, message: 'line-circle intersection selector must be exclude-known-point' });
          }
          break;
        case 'cyclic':
        case 'complete-quadrilateral':
          if (!Array.isArray(constraint.points) || constraint.points.length !== 4) {
            issues.push({ path: `${path}.points`, message: `${constraint.kind} requires exactly four points` });
          } else {
            constraint.points.forEach((value, pointIndex) => (
              refIssue(`${path}.points[${pointIndex}]`, value, issues)
            ));
          }
          break;
        case 'collinear':
          if (!Array.isArray(constraint.points) || constraint.points.length !== 3) {
            issues.push({ path: `${path}.points`, message: 'collinear requires exactly three points' });
          } else {
            constraint.points.forEach((value, pointIndex) => (
              refIssue(`${path}.points[${pointIndex}]`, value, issues)
            ));
            uniqueIssue(
              constraint.points.filter((value): value is string => typeof value === 'string'),
              `${path}.points`,
              issues,
            );
          }
          break;
        default:
          issues.push({ path: `${path}.kind`, message: `unsupported constraint kind ${String(constraint.kind)}` });
      }
    });
    uniqueIssue(ids, 'constraints', issues);
  }
  if (plan.sourceWriterHint !== undefined) {
    const hint = plan.sourceWriterHint;
    if (!isRecord(hint) || hint.kind !== 'opaque' || hint.unsafe !== true) {
      issues.push({ path: 'sourceWriterHint', message: 'only an explicitly unsafe opaque hint is supported' });
    } else {
      if (!nonEmpty(hint.reason)) issues.push({ path: 'sourceWriterHint.reason', message: 'opaque reason is required' });
      if (!Array.isArray(hint.lines) || hint.lines.some((line) => typeof line !== 'string')) {
        issues.push({ path: 'sourceWriterHint.lines', message: 'opaque lines must be strings' });
      }
    }
  }
}

function validatePoint(value: unknown, path: string, issues: ConstructionValidationIssue[]): void {
  if (Array.isArray(value)) {
    if (value.length !== 2 || !finiteScalar(value[0]) || !finiteScalar(value[1])) {
      issues.push({ path, message: 'point literal must contain two finite numbers' });
    }
    return;
  }
  if (!isRecord(value) || !finiteScalar(value.x) || !finiteScalar(value.y)) {
    issues.push({ path, message: 'point literal must contain finite x and y' });
  }
}

function validatePrimitive(primitive: unknown, issues: ConstructionValidationIssue[]): void {
  if (!isRecord(primitive) || typeof primitive.kind !== 'string') {
    issues.push({ path: 'primitive', message: 'primitive definition is required' });
    return;
  }
  const kind = primitive.kind;
  if (kind === 'point') {
    if (!validName(primitive.name)) issues.push({ path: 'primitive.name', message: 'point name is invalid' });
    validatePoint(primitive.position, 'primitive.position', issues);
    return;
  }
  if (kind === 'segment' || kind === 'vector' || kind === 'line' || kind === 'ray') {
    refIssue('primitive.from', primitive.from, issues);
    refIssue('primitive.to', primitive.to, issues);
    if (primitive.from === primitive.to) issues.push({ path: 'primitive', message: 'endpoints must be distinct' });
    return;
  }
  if (kind === 'polyline' || kind === 'polygon') {
    if (!Array.isArray(primitive.vertices) || primitive.vertices.length < (kind === 'polygon' ? 3 : 2)) {
      issues.push({ path: 'primitive.vertices', message: `${kind} requires at least ${kind === 'polygon' ? 3 : 2} vertices` });
    } else primitive.vertices.forEach((value, index) => refIssue(`primitive.vertices[${index}]`, value, issues));
    return;
  }
  if (kind === 'rectangle') {
    if (!Array.isArray(primitive.corners) || primitive.corners.length !== 2) {
      issues.push({ path: 'primitive.corners', message: 'rectangle requires two opposite corners' });
    } else {
      primitive.corners.forEach((value, index) => refIssue(`primitive.corners[${index}]`, value, issues));
      if (primitive.corners[0] === primitive.corners[1]) issues.push({ path: 'primitive.corners', message: 'corners must be distinct' });
    }
    return;
  }
  if (kind === 'circle') {
    refIssue('primitive.center', primitive.center, issues);
    refIssue('primitive.through', primitive.through, issues);
    if (primitive.center === primitive.through) issues.push({ path: 'primitive', message: 'circle points must be distinct' });
    return;
  }
  if (kind === 'label') {
    refIssue('primitive.at', primitive.at, issues);
    if (typeof primitive.text !== 'string' || primitive.text.length === 0) issues.push({ path: 'primitive.text', message: 'label text is required' });
    return;
  }
  if (kind === 'angle' || kind === 'right-angle') {
    if (!Array.isArray(primitive.points) || primitive.points.length !== 3) {
      issues.push({ path: 'primitive.points', message: 'angle requires three points' });
    } else primitive.points.forEach((value, index) => refIssue(`primitive.points[${index}]`, value, issues));
    return;
  }
  issues.push({ path: 'primitive.kind', message: `unsupported primitive kind ${kind}` });
}

function boundEntity(
  plan: Record<string, unknown>,
  reference: unknown,
  expectedKind: string,
  path: string,
  issues: ConstructionValidationIssue[],
): Record<string, unknown> | null {
  if (!validReference(reference) || !Array.isArray(plan.entities)) return null;
  const entity = plan.entities.find((candidate) => (
    isRecord(candidate) && candidate.name === reference
  ));
  if (!isRecord(entity)) {
    issues.push({ path, message: `${path} must resolve to a declared ${expectedKind} entity` });
    return null;
  }
  if (entity.kind !== expectedKind) {
    issues.push({ path, message: `${path} must resolve to ${expectedKind}, got ${String(entity.kind)}` });
    return null;
  }
  return entity;
}

function sameReferences(value: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function validatePlanDefinition(plan: Record<string, unknown>, issues: ConstructionValidationIssue[]): void {
  if (plan.kind === 'primitive') {
    validatePrimitive(plan.primitive, issues);
    return;
  }
  if (plan.kind === 'rectangle-by-opposite-corners') {
    for (const field of ['first', 'opposite', 'second', 'fourth'] as const) {
      refIssue(field, plan[field], issues);
    }
    uniqueIssue(
      [plan.first, plan.opposite, plan.second, plan.fourth]
        .filter((value): value is string => typeof value === 'string'),
      'corners',
      issues,
    );
    return;
  }
  if (plan.kind === 'midpoint') {
    for (const field of ['a', 'b', 'result'] as const) {
      refIssue(field, plan[field], issues);
    }
    uniqueIssue(
      [plan.a, plan.b].filter(
        (value): value is string => typeof value === 'string',
      ),
      'endpoints',
      issues,
    );
    return;
  }
  if (plan.kind === 'perpendicular-foot') {
    for (
      const field of ['point', 'lineStart', 'lineEnd', 'result'] as const
    ) {
      refIssue(field, plan[field], issues);
    }
    uniqueIssue(
      [plan.lineStart, plan.lineEnd].filter(
        (value): value is string => typeof value === 'string',
      ),
      'reference-line',
      issues,
    );
    return;
  }
  if (plan.kind === 'point-on-circle') {
    const circle = plan.circle;
    if (!isRecord(circle)) {
      issues.push({ path: 'circle', message: 'circle reference is required' });
    } else {
      refIssue('circle.center', circle.center, issues);
      if (circle.through === undefined && circle.radius === undefined) issues.push({ path: 'circle', message: 'circle requires through or radius' });
      if (circle.through !== undefined) refIssue('circle.through', circle.through, issues);
      if (typeof circle.radius === 'number' && !Number.isFinite(circle.radius)) issues.push({ path: 'circle.radius', message: 'radius must be finite' });
      if (typeof circle.angleDegrees === 'number' && !Number.isFinite(circle.angleDegrees)) issues.push({ path: 'circle.angleDegrees', message: 'angle must be finite' });
    }
    refIssue('result', plan.result, issues);
    return;
  }
  if (plan.kind === 'parallel-line' || plan.kind === 'perpendicular-line') {
    for (const field of ['through', 'referenceStart', 'referenceEnd', 'result'] as const) refIssue(field, plan[field], issues);
    if (plan.referenceStart === plan.referenceEnd) issues.push({ path: 'reference', message: 'reference endpoints must be distinct' });
    return;
  }
  if (plan.kind === 'perpendicular-bisector') {
    for (const field of ['a', 'b', 'midpoint', 'result', 'line'] as const) refIssue(field, plan[field], issues);
    if (plan.a === plan.b) issues.push({ path: 'reference', message: 'segment endpoints must be distinct' });
    return;
  }
  if (plan.kind === 'angle-bisector') {
    for (const field of ['armA', 'vertex', 'armB', 'result', 'line'] as const) refIssue(field, plan[field], issues);
    if (plan.armA === plan.vertex || plan.armB === plan.vertex || plan.armA === plan.armB) {
      issues.push({ path: 'angle', message: 'angle points must be distinct' });
    }
    return;
  }
  if (plan.kind === 'circumcircle') {
    for (const field of ['a', 'b', 'c', 'center', 'circle'] as const) refIssue(field, plan[field], issues);
    uniqueIssue([plan.a, plan.b, plan.c].filter((value): value is string => typeof value === 'string'), 'vertices', issues);
    return;
  }
  if (plan.kind === 'nine-point-circle') {
    const fields = [
      'a', 'b', 'c', 'midpointBC', 'midpointCA', 'midpointAB',
      'footA', 'footB', 'footC', 'orthocenter',
      'vertexMidpointA', 'vertexMidpointB', 'vertexMidpointC',
      'center', 'circle',
    ] as const;
    for (const field of fields) refIssue(field, plan[field], issues);
    uniqueIssue(
      [plan.a, plan.b, plan.c].filter((value): value is string => typeof value === 'string'),
      'vertices',
      issues,
    );
    return;
  }
  if (plan.kind === 'simson-line') {
    const fields = [
      'a', 'b', 'c', 'center', 'circle', 'point',
      'footAB', 'footBC', 'footCA', 'line',
    ] as const;
    for (const field of fields) refIssue(field, plan[field], issues);
    uniqueIssue(
      [plan.a, plan.b, plan.c].filter((value): value is string => typeof value === 'string'),
      'vertices',
      issues,
    );
    if (!Number.isFinite(plan.angleDegrees)) {
      issues.push({ path: 'angleDegrees', message: 'circle parameter angle must be finite' });
    }
    return;
  }
  if (plan.kind === 'fermat-point') {
    const fields = [
      'a', 'b', 'c', 'equilateralAB', 'equilateralAC', 'torricelli',
      'result', 'line1', 'line2', 'triangleAB', 'triangleAC',
      'rayA', 'rayB', 'rayC', 'resultSource',
    ] as const;
    for (const field of fields) refIssue(field, plan[field], issues);
    uniqueIssue(
      [plan.a, plan.b, plan.c].filter((value): value is string => typeof value === 'string'),
      'vertices',
      issues,
    );
    for (const field of ['rotationABDegrees', 'rotationACDegrees'] as const) {
      if (!Number.isFinite(plan[field])) {
        issues.push({ path: field, message: 'rotation angle must be finite' });
      }
    }
    if (![plan.torricelli, plan.a, plan.b, plan.c].includes(plan.resultSource)) {
      issues.push({ path: 'resultSource', message: 'result source must be the Torricelli point or a triangle vertex' });
    }
    return;
  }
  if (plan.kind === 'tangent-at-point') {
    for (const field of ['touch', 'result', 'line'] as const) refIssue(field, plan[field], issues);
    const circle = plan.circle;
    if (!isRecord(circle)) {
      issues.push({ path: 'circle', message: 'circle reference is required' });
    } else {
      if (circle.id !== undefined) refIssue('circle.id', circle.id, issues);
      refIssue('circle.center', circle.center, issues);
      if (circle.through === undefined && circle.radius === undefined) {
        issues.push({ path: 'circle', message: 'circle requires through or radius' });
      }
      if (circle.through !== undefined) refIssue('circle.through', circle.through, issues);
      if (typeof circle.radius === 'number' && (!Number.isFinite(circle.radius) || circle.radius <= 0)) {
        issues.push({ path: 'circle.radius', message: 'radius must be a positive finite number' });
      }
      if (typeof circle.angleDegrees === 'number' && !Number.isFinite(circle.angleDegrees)) {
        issues.push({ path: 'circle.angleDegrees', message: 'angle must be finite' });
      }
    }
    return;
  }
  if (plan.kind === 'reflect-point' || plan.kind === 'rotate-90' || plan.kind === 'homothety-2') {
    for (const field of ['point', 'center', 'result'] as const) refIssue(field, plan[field], issues);
    return;
  }
  if (plan.kind === 'reflect-line') {
    for (const field of ['point', 'lineStart', 'lineEnd', 'foot', 'result'] as const) refIssue(field, plan[field], issues);
    if (plan.lineStart === plan.lineEnd) issues.push({ path: 'axis', message: 'axis endpoints must be distinct' });
    return;
  }
  if (plan.kind === 'inversion-point') {
    for (const field of ['point', 'center', 'radiusPoint', 'result', 'guide'] as const) refIssue(field, plan[field], issues);
    if (plan.point === plan.center) issues.push({ path: 'point', message: 'point cannot equal inversion center' });
    if (plan.radiusPoint === plan.center) issues.push({ path: 'radiusPoint', message: 'radius point cannot equal inversion center' });
    const resultEntity = boundEntity(plan, plan.result, 'point', 'result', issues);
    const guideEntity = boundEntity(plan, plan.guide, 'segment', 'guide', issues);
    if (resultEntity && resultEntity.name !== plan.result) {
      issues.push({ path: 'result', message: 'inversion result must bind the named point entity' });
    }
    if (guideEntity && (guideEntity.from !== plan.point || guideEntity.to !== plan.result)) {
      issues.push({ path: 'guide', message: 'inversion guide must join source point to inverse result' });
    }
    return;
  }
  if (plan.kind === 'radical-axis') {
    for (const field of ['result', 'direction', 'line'] as const) refIssue(field, plan[field], issues);
    const validateCircle = (
      value: unknown,
      path: 'circle1' | 'circle2',
    ): void => {
      if (!isRecord(value)) {
        issues.push({ path, message: 'circle reference is required' });
        return;
      }
      refIssue(`${path}.id`, value.id, issues);
      refIssue(`${path}.center`, value.center, issues);
      validatePoint(value.evaluatedCenter, `${path}.evaluatedCenter`, issues);
      if (!finiteScalar(value.evaluatedRadius) || value.evaluatedRadius <= 0) {
        issues.push({
          path: `${path}.evaluatedRadius`,
          message: 'evaluated radius must be a positive finite number',
        });
      }
      if (value.through === undefined && value.radius === undefined) {
        issues.push({ path, message: 'circle requires through or radius' });
      }
      if (value.through !== undefined) {
        refIssue(`${path}.through`, value.through, issues);
        if (value.through === value.center) {
          issues.push({ path: `${path}.through`, message: 'circle through point must differ from its center' });
        }
      }
      if (
        value.radius !== undefined
        && (
          (typeof value.radius === 'number' && (!Number.isFinite(value.radius) || value.radius <= 0))
          || (typeof value.radius === 'string' && value.radius.trim().length === 0)
          || (typeof value.radius !== 'number' && typeof value.radius !== 'string')
        )
      ) {
        issues.push({ path: `${path}.radius`, message: 'radius must be a positive finite literal or non-empty scalar expression' });
      }
    };
    validateCircle(plan.circle1, 'circle1');
    validateCircle(plan.circle2, 'circle2');
    boundEntity(plan, plan.result, 'point', 'result', issues);
    boundEntity(plan, plan.direction, 'point', 'direction', issues);
    const lineEntity = boundEntity(plan, plan.line, 'line', 'line', issues);
    if (lineEntity && (lineEntity.from !== plan.result || lineEntity.to !== plan.direction)) {
      issues.push({ path: 'line', message: 'radical-axis line must bind result and direction points' });
    }
    if (isRecord(plan.circle1) && isRecord(plan.circle2)) {
      if (plan.circle1.id === plan.circle2.id) {
        issues.push({ path: 'circles', message: 'radical axis requires two distinct circles' });
      }
      if (plan.circle1.center === plan.circle2.center) {
        issues.push({ path: 'centers', message: 'concentric circles have no unique finite radical axis' });
      }
      const center1 = plan.circle1.evaluatedCenter;
      const center2 = plan.circle2.evaluatedCenter;
      const radius1 = plan.circle1.evaluatedRadius;
      const radius2 = plan.circle2.evaluatedRadius;
      const center1Values = Array.isArray(center1)
        ? center1
        : isRecord(center1) && finiteScalar(center1.x) && finiteScalar(center1.y)
          ? [center1.x, center1.y]
          : null;
      const center2Values = Array.isArray(center2)
        ? center2
        : isRecord(center2) && finiteScalar(center2.x) && finiteScalar(center2.y)
          ? [center2.x, center2.y]
          : null;
      if (
        center1Values
        && center2Values
        && finiteScalar(radius1)
        && finiteScalar(radius2)
      ) {
        const centerDistance = Math.hypot(
          center2Values[0] - center1Values[0],
          center2Values[1] - center1Values[1],
        );
        if (centerDistance <= 1e-7 * Math.max(radius1, radius2, 1)) {
          issues.push({
            path: 'centers',
            message: 'concentric or near-concentric circles have no unique finite radical axis',
          });
        }
      }
    }
    return;
  }
  if (plan.kind === 'cyclic-quadrilateral') {
    for (const field of [
      'a', 'b', 'c', 'direction', 'center', 'result', 'circle', 'secant', 'polygon',
    ] as const) refIssue(field, plan[field], issues);
    uniqueIssue([plan.a, plan.b, plan.c].filter((value): value is string => typeof value === 'string'), 'vertices', issues);
    if (plan.direction === plan.a) issues.push({ path: 'direction', message: 'direction point must differ from first vertex' });
    boundEntity(plan, plan.center, 'point', 'center', issues);
    boundEntity(plan, plan.result, 'point', 'result', issues);
    const circleEntity = boundEntity(plan, plan.circle, 'circle', 'circle', issues);
    if (circleEntity && (circleEntity.center !== plan.center || circleEntity.through !== plan.a)) {
      issues.push({ path: 'circle', message: 'cyclic circle must bind circumcenter and first vertex' });
    }
    const secantEntity = boundEntity(plan, plan.secant, 'line', 'secant', issues);
    if (secantEntity && (secantEntity.from !== plan.a || secantEntity.to !== plan.direction)) {
      issues.push({ path: 'secant', message: 'cyclic secant must bind first vertex and direction point' });
    }
    const polygonEntity = boundEntity(plan, plan.polygon, 'polygon', 'polygon', issues);
    if (polygonEntity && !sameReferences(polygonEntity.vertices, [plan.a, plan.b, plan.result, plan.c])) {
      issues.push({ path: 'polygon', message: 'cyclic polygon vertices must be [a, b, result, c]' });
    }
    return;
  }
  if (plan.kind === 'complete-quadrilateral') {
    for (const field of [
      'a', 'b', 'c', 'd', 'firstIntersection', 'secondIntersection',
      'lineAB', 'lineBC', 'lineCD', 'lineDA', 'diagonal',
    ] as const) refIssue(field, plan[field], issues);
    uniqueIssue([plan.a, plan.b, plan.c, plan.d].filter((value): value is string => typeof value === 'string'), 'vertices', issues);
    if (plan.firstIntersection === plan.secondIntersection) issues.push({ path: 'intersections', message: 'intersection outputs must be distinct' });
    boundEntity(plan, plan.firstIntersection, 'point', 'firstIntersection', issues);
    boundEntity(plan, plan.secondIntersection, 'point', 'secondIntersection', issues);
    const lineBindings = [
      ['lineAB', plan.lineAB, plan.a, plan.b],
      ['lineBC', plan.lineBC, plan.b, plan.c],
      ['lineCD', plan.lineCD, plan.c, plan.d],
      ['lineDA', plan.lineDA, plan.d, plan.a],
    ] as const;
    for (const [path, reference, from, to] of lineBindings) {
      const entity = boundEntity(plan, reference, 'line', path, issues);
      if (entity && (entity.from !== from || entity.to !== to)) {
        issues.push({ path, message: `${path} must bind its declared endpoint pair` });
      }
    }
    const diagonalEntity = boundEntity(plan, plan.diagonal, 'segment', 'diagonal', issues);
    if (
      diagonalEntity
      && (diagonalEntity.from !== plan.firstIntersection || diagonalEntity.to !== plan.secondIntersection)
    ) {
      issues.push({ path: 'diagonal', message: 'diagonal must join the two opposite intersections' });
    }
    return;
  }
  issues.push({ path: 'kind', message: `unsupported construction kind ${String(plan.kind)}` });
}

export function validateConstructionPlan(value: unknown): readonly ConstructionValidationIssue[] {
  if (!isRecord(value)) return [{ path: '', message: 'construction plan must be an object' }];
  const issues: ConstructionValidationIssue[] = [];
  validateBase(value, issues);
  validatePlanDefinition(value, issues);
  validateReferenceClosure(value, issues);
  return issues;
}

export class ConstructionPlanValidationError extends Error {
  readonly issues: readonly ConstructionValidationIssue[];

  constructor(issues: readonly ConstructionValidationIssue[]) {
    super(`Invalid construction plan: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    this.name = 'ConstructionPlanValidationError';
    this.issues = issues;
  }
}

export function assertConstructionPlan(value: unknown): asserts value is ConstructionPlan {
  const issues = validateConstructionPlan(value);
  if (issues.length > 0) throw new ConstructionPlanValidationError(issues);
}

function safeName(value: string, path: string): string {
  if (!validName(value)) throw new ConstructionPlanValidationError([{ path, message: 'invalid TikZ name' }]);
  return value;
}

function safeReference(value: string, path: string): string {
  if (!validReference(value)) {
    throw new ConstructionPlanValidationError([{ path, message: 'invalid semantic reference' }]);
  }
  return value;
}

function isConstructionPointObject(
  point: ConstructionPoint,
): point is { readonly x: number; readonly y: number } {
  return 'x' in point && 'y' in point;
}

function pointValues(point: ConstructionPoint): readonly [number, number] {
  return isConstructionPointObject(point)
    ? [point.x, point.y]
    : [point[0], point[1]];
}

function sourceCanonicalPoint(point: ConstructionPoint): ConstructionPoint {
  const [x, y] = pointValues(point);
  return {
    x: Number(formatCoordNumber(x)),
    y: Number(formatCoordNumber(y)),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function canonicalWriterPlanCore(plan: ConstructionPlan): unknown {
  const {
    selection: _selection,
    sourceWriterHint: _sourceWriterHint,
    status: _status,
    ...core
  } = plan;
  return core;
}

function semanticEntityOwner(
  plan: ConstructionPlan,
  reference: string,
): string {
  const entity = plan.entities.find((candidate) => (
    candidate.id === reference || candidate.name === reference
  ));
  return entity
    ? `entity:${entity.id}`
    : `entity-name:${reference}`;
}

function semanticEntityOwners(
  plan: ConstructionPlan,
  predicate: (entity: ConstructionEntity) => boolean,
  fallbackReference: string,
): readonly string[] {
  const owners = plan.entities
    .filter(predicate)
    .map((entity) => `entity:${entity.id}`);
  return owners.length > 0
    ? owners
    : [semanticEntityOwner(plan, fallbackReference)];
}

const COMMAND_OPTION_SITE = [{
  id: 'command-options',
  insertionPolicy: 'command-options' as const,
}] as const;

function constructionWriterSlot(
  plan: ConstructionPlan,
  role: string,
  owners: readonly string[],
  canonicalSource: string,
  optionSites: ConstructionWriterSlot['optionSites'] = [],
): ConstructionWriterSlot {
  const id = `construction:${plan.id}:${plan.kind}:${role}`;
  const stableOwners = [...new Set(owners)].sort();
  const kind = 'tikz-statement' as const;
  const slotIdentity = {
    id,
    role,
    kind,
    owners: stableOwners,
    optionSites,
  };
  const semanticFingerprint = hashSource(canonicalJson({
    domain: 'mathgeo/tikz-construction-writer-slot/v1',
    writerId: CONSTRUCTION_WRITER_ID,
    writerRevision: CONSTRUCTION_WRITER_REVISION,
    planCore: canonicalWriterPlanCore(plan),
    slot: slotIdentity,
  }));
  return {
    ...slotIdentity,
    semanticFingerprint,
    canonicalSource,
  };
}

function constructionWriterReferenceSurface(
  plan: ConstructionPlan,
): readonly string[] {
  const references = plan.entities.flatMap((entity) => [entity.id, entity.name]);
  if (
    plan.kind === 'circumcircle'
    || plan.kind === 'nine-point-circle'
    || plan.kind === 'simson-line'
    || plan.kind === 'cyclic-quadrilateral'
  ) {
    const seed = safeName(plan.id, 'id');
    references.push(
      `mg-${seed}-m1`,
      `mg-${seed}-m2`,
      `mg-${seed}-q1`,
      `mg-${seed}-q2`,
    );
    if (plan.kind === 'nine-point-circle') {
      const orthocenterSeed = `${seed}-orthocenter`;
      references.push(
        `mg-${orthocenterSeed}-o`,
        `mg-${orthocenterSeed}-m1`,
        `mg-${orthocenterSeed}-m2`,
        `mg-${orthocenterSeed}-q1`,
        `mg-${orthocenterSeed}-q2`,
      );
    }
  }
  return [...new Set(references)].sort();
}

function constructionWriterArtifact(
  plan: ConstructionPlan,
  slots: readonly ConstructionWriterSlot[],
): ConstructionWriterArtifact {
  const slotIds = new Set(slots.map((slot) => slot.id));
  if (slotIds.size !== slots.length) {
    throw new TypeError(`Construction writer emitted duplicate slots for ${plan.kind}.`);
  }
  const referenceSurface = constructionWriterReferenceSurface(plan);
  const semanticFingerprint = hashSource(canonicalJson({
    domain: 'mathgeo/tikz-construction-writer-artifact/v1',
    writerId: CONSTRUCTION_WRITER_ID,
    writerRevision: CONSTRUCTION_WRITER_REVISION,
    planKind: plan.kind,
    referenceSurface,
    slots: slots.map((slot) => ({
      id: slot.id,
      role: slot.role,
      kind: slot.kind,
      owners: slot.owners,
      semanticFingerprint: slot.semanticFingerprint,
      optionSites: slot.optionSites,
    })),
  }));
  return {
    writerId: CONSTRUCTION_WRITER_ID,
    writerRevision: CONSTRUCTION_WRITER_REVISION,
    planKind: plan.kind,
    semanticFingerprint,
    referenceSurface,
    slots,
  };
}

function extendedLine(a: string, b: string): string {
  return `${calcInterpolateCoordinate(a, -3, b)} -- ${calcInterpolateCoordinate(a, 4, b)}`;
}

function perpendicularDirection(result: string, through: string, lineStart: string, lineEnd: string): string {
  return `\\path let \\p1=${calcDifferenceCoordinate(lineEnd, lineStart)} in coordinate (${result}) at ${calcOffsetCoordinate(through, '{0-\\y1}', '{\\x1}')};`;
}

function lineLineIntersection(
  result: string,
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string,
): string {
  const firstDirection = calcDifferenceCoordinate(firstEnd, firstStart);
  const secondDirection = calcDifferenceCoordinate(secondEnd, secondStart);
  const betweenStarts = calcDifferenceCoordinate(secondStart, firstStart);
  return [
    `\\path let \\p1=${firstDirection}, \\p2=${secondDirection}, \\p3=${betweenStarts},`,
    '\\n1={\\x1*\\y2-\\y1*\\x2}, \\n2={\\x3*\\y2-\\y3*\\x2}',
    `in coordinate (${result}) at ${calcInterpolateCoordinate(firstStart, '{\\n2/\\n1}', firstEnd)};`,
  ].join(' ');
}

function secondCircleIntersection(
  result: string,
  knownPoint: string,
  directionPoint: string,
  center: string,
): string {
  const direction = calcDifferenceCoordinate(directionPoint, knownPoint);
  const radiusAtKnownPoint = calcDifferenceCoordinate(knownPoint, center);
  return [
    `\\path let \\p1=${direction}, \\p2=${radiusAtKnownPoint},`,
    '\\n1={(0-2*(\\x1*\\x2+\\y1*\\y2))/(\\x1*\\x1+\\y1*\\y1)}',
    `in coordinate (${result}) at ${calcInterpolateCoordinate(knownPoint, '{\\n1}', directionPoint)};`,
  ].join(' ');
}

interface CircumcenterBody {
  readonly midpointAB: string;
  readonly perpendicularAB: string;
  readonly midpointAC: string;
  readonly perpendicularAC: string;
  readonly centerIntersection: string;
}

function circumcenterBody(
  center: string,
  a: string,
  b: string,
  c: string,
  seed: string,
): CircumcenterBody {
  const m1 = `mg-${seed}-m1`;
  const m2 = `mg-${seed}-m2`;
  const q1 = `mg-${seed}-q1`;
  const q2 = `mg-${seed}-q2`;
  return {
    midpointAB: `\\coordinate (${m1}) at ${calcInterpolateCoordinate(a, 0.5, b)};`,
    perpendicularAB: perpendicularDirection(q1, m1, a, b),
    midpointAC: `\\coordinate (${m2}) at ${calcInterpolateCoordinate(a, 0.5, c)};`,
    perpendicularAC: perpendicularDirection(q2, m2, a, c),
    centerIntersection: lineLineIntersection(center, m1, q1, m2, q2),
  };
}

function primitiveSource(primitive: PrimitiveDefinition): string {
  switch (primitive.kind) {
    case 'point': {
      const [x, y] = pointValues(primitive.position);
      return `\\coordinate (${safeName(primitive.name, 'primitive.name')}) at (${formatCoordNumber(x)},${formatCoordNumber(y)});`;
    }
    case 'segment':
      return `\\draw (${safeName(primitive.from, 'primitive.from')}) -- (${safeName(primitive.to, 'primitive.to')});`;
    case 'vector':
      return `\\draw[->] (${safeName(primitive.from, 'primitive.from')}) -- (${safeName(primitive.to, 'primitive.to')});`;
    case 'line':
      return `\\draw ${extendedLine(safeName(primitive.from, 'primitive.from'), safeName(primitive.to, 'primitive.to'))};`;
    case 'ray':
      return `\\draw[->] (${safeName(primitive.from, 'primitive.from')}) -- ${calcInterpolateCoordinate(safeName(primitive.from, 'primitive.from'), 4, safeName(primitive.to, 'primitive.to'))};`;
    case 'polyline':
      return `\\draw ${primitive.vertices.map((value) => `(${safeName(value, 'primitive.vertices')})`).join(' -- ')};`;
    case 'polygon':
      return `\\draw ${primitive.vertices.map((value) => `(${safeName(value, 'primitive.vertices')})`).join(' -- ')} -- cycle;`;
    case 'rectangle':
      return `\\draw (${safeName(primitive.corners[0], 'primitive.corners[0]')}) rectangle (${safeName(primitive.corners[1], 'primitive.corners[1]')});`;
    case 'circle':
      return `\\node[draw,circle through=(${safeName(primitive.through, 'primitive.through')})] at (${safeName(primitive.center, 'primitive.center')}) {};`;
    case 'label':
      return `\\node[above] at (${safeName(primitive.at, 'primitive.at')}) {${primitive.text}};`;
    case 'angle':
      return `\\pic[draw] {angle = ${primitive.points.map((value) => safeName(value, 'primitive.points')).join('--')}};`;
    case 'right-angle':
      return `\\pic[draw] {right angle = ${primitive.points.map((value) => safeName(value, 'primitive.points')).join('--')}};`;
  }
}

function directive(
  id: string,
  kind: string,
  planKind: ConstructionPlanKind,
  inputs: readonly string[],
  outputs: readonly string[],
  records: readonly ManagedConstructionSemanticRecord[],
  body: readonly string[],
): readonly string[] {
  const safeId = safeName(id, 'id');
  const safeKind = safeName(kind, 'kind');
  const safePlanKind = safeName(planKind, 'planKind');
  const safeInputs = inputs.map((value) => safeReference(value, 'input'));
  const safeOutputs = outputs.map((value) => safeName(value, 'output'));
  const recordLines = serializeManagedConstructionRecords(records);
  const metadataText = recordLines.length > 0
    ? `${recordLines.join('\n')}\n`
    : '';
  const tikzBody = body.length > 0 ? `${body.join('\n')}\n` : '';
  const contentFingerprint = managedConstructionContentFingerprint({
    id: safeId,
    kind: safeKind,
    planKind: safePlanKind,
    inputs: safeInputs,
    outputs: safeOutputs,
    metadataText,
    tikzBodyText: tikzBody,
  });
  return [
    `% @mathgeo begin schema=${MANAGED_CONSTRUCTION_SCHEMA_VERSION} fingerprint-alg=${MANAGED_CONSTRUCTION_FINGERPRINT_ALGORITHM} content-fingerprint=${contentFingerprint} id=${safeId} kind=${safeKind} plan-kind=${safePlanKind} inputs=${safeInputs.join(',')} outputs=${safeOutputs.join(',')}`,
    ...recordLines,
    ...body,
    '% @mathgeo end',
  ];
}

/**
 * Compile the trusted, source-neutral plan writer into stable semantic slots.
 * Opaque sourceWriterHint lines are deliberately absent: they remain a legacy
 * double-opt-in merge owned by compileConstructionPlan and never become slots.
 */
export function compileConstructionWriterArtifact(
  plan: ConstructionPlan,
): ConstructionWriterArtifact {
  assertConstructionPlan(plan);
  switch (plan.kind) {
    case 'primitive': {
      const outputReferences = plan.outputs
        .filter((output) => output.kind === plan.primitive.kind)
        .map((output) => output.ref);
      const owners = outputReferences.length > 0
        ? outputReferences.map((reference) => semanticEntityOwner(plan, reference))
        : semanticEntityOwners(
          plan,
          (entity) => entity.kind === plan.primitive.kind,
          plan.primitive.kind === 'point' ? plan.primitive.name : plan.id,
        );
      const role = plan.primitive.kind === 'point'
        ? 'primitive-point-definition'
        : `primitive-${plan.primitive.kind}-render`;
      return constructionWriterArtifact(plan, [constructionWriterSlot(
        plan,
        role,
        owners,
        primitiveSource(plan.primitive),
        plan.primitive.kind === 'point' ? [] : COMMAND_OPTION_SITE,
      )]);
    }
    case 'rectangle-by-opposite-corners': {
      const first = safeName(plan.first, 'first');
      const opposite = safeName(plan.opposite, 'opposite');
      const second = safeName(plan.second, 'second');
      const fourth = safeName(plan.fourth, 'fourth');
      const diagonal = calcDifferenceCoordinate(opposite, first);
      const boundaryOwners = semanticEntityOwners(
        plan,
        (entity) => entity.kind === 'polygon'
          && sameReferences(entity.vertices, [first, second, opposite, fourth]),
        plan.id,
      );
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(
          plan,
          'second-corner-definition',
          [semanticEntityOwner(plan, second)],
          `\\path let \\p1=${diagonal} in coordinate (${second}) at ${calcOffsetCoordinate(first, '{\\x1}', 0)};`,
        ),
        constructionWriterSlot(
          plan,
          'fourth-corner-definition',
          [semanticEntityOwner(plan, fourth)],
          `\\path let \\p1=${diagonal} in coordinate (${fourth}) at ${calcOffsetCoordinate(first, 0, '{\\y1}')};`,
        ),
        constructionWriterSlot(
          plan,
          'boundary-render',
          boundaryOwners,
          `\\draw (${first}) -- (${second}) -- (${opposite}) -- (${fourth}) -- cycle;`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'midpoint': {
      const result = safeName(plan.result, 'result');
      return constructionWriterArtifact(plan, [constructionWriterSlot(
        plan,
        'midpoint-definition',
        [semanticEntityOwner(plan, result)],
        `\\coordinate (${result}) at ${calcInterpolateCoordinate(
          safeName(plan.a, 'a'),
          0.5,
          safeName(plan.b, 'b'),
        )};`,
      )]);
    }
    case 'perpendicular-foot': {
      const result = safeName(plan.result, 'result');
      return constructionWriterArtifact(plan, [constructionWriterSlot(
        plan,
        'foot-definition',
        [semanticEntityOwner(plan, result)],
        `\\coordinate (${result}) at ${calcProjectionCoordinate(
          safeName(plan.lineStart, 'lineStart'),
          safeName(plan.point, 'point'),
          safeName(plan.lineEnd, 'lineEnd'),
        )};`,
      )]);
    }
    case 'point-on-circle': {
      const center = safeName(plan.circle.center, 'circle.center');
      const result = safeName(plan.result, 'result');
      const point = plan.circle.through
        ? calcInterpolateCoordinate(center, 1, safeName(plan.circle.through, 'circle.through'), plan.circle.angleDegrees)
        : calcOffsetCoordinate(
          center,
          `{${String(plan.circle.radius)}*cos(${String(plan.circle.angleDegrees ?? 0)})}`,
          `{${String(plan.circle.radius)}*sin(${String(plan.circle.angleDegrees ?? 0)})}`,
        );
      return constructionWriterArtifact(plan, [constructionWriterSlot(
        plan,
        'point-definition',
        [semanticEntityOwner(plan, result)],
        `\\coordinate (${result}) at ${point};`,
      )]);
    }
    case 'parallel-line': {
      const through = safeName(plan.through, 'through');
      const start = safeName(plan.referenceStart, 'referenceStart');
      const end = safeName(plan.referenceEnd, 'referenceEnd');
      const result = safeName(plan.result, 'result');
      const lineOwners = semanticEntityOwners(
        plan,
        (entity) => entity.kind === 'line'
          && entity.from === through
          && entity.to === result,
        result,
      );
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(
          plan,
          'direction-point-definition',
          [semanticEntityOwner(plan, result)],
          `\\coordinate (${result}) at ${calcTranslateByVectorCoordinate(through, start, end)};`,
        ),
        constructionWriterSlot(
          plan,
          'line-render',
          lineOwners,
          `\\draw ${extendedLine(through, result)};`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'perpendicular-line': {
      const through = safeName(plan.through, 'through');
      const start = safeName(plan.referenceStart, 'referenceStart');
      const end = safeName(plan.referenceEnd, 'referenceEnd');
      const result = safeName(plan.result, 'result');
      const lineOwners = semanticEntityOwners(
        plan,
        (entity) => entity.kind === 'line'
          && entity.from === through
          && entity.to === result,
        result,
      );
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(
          plan,
          'direction-point-definition',
          [semanticEntityOwner(plan, result)],
          perpendicularDirection(result, through, start, end),
        ),
        constructionWriterSlot(
          plan,
          'line-render',
          lineOwners,
          `\\draw ${extendedLine(through, result)};`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'perpendicular-bisector': {
      const a = safeName(plan.a, 'a');
      const b = safeName(plan.b, 'b');
      const midpoint = safeName(plan.midpoint, 'midpoint');
      const result = safeName(plan.result, 'result');
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(
          plan,
          'midpoint-definition',
          [semanticEntityOwner(plan, midpoint)],
          `\\coordinate (${midpoint}) at ${calcInterpolateCoordinate(a, 0.5, b)};`,
        ),
        constructionWriterSlot(
          plan,
          'direction-point-definition',
          [semanticEntityOwner(plan, result)],
          perpendicularDirection(result, midpoint, a, b),
        ),
        constructionWriterSlot(
          plan,
          'line-render',
          [semanticEntityOwner(plan, plan.line)],
          `\\draw ${extendedLine(midpoint, result)};`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'angle-bisector': {
      const armA = safeName(plan.armA, 'armA');
      const vertex = safeName(plan.vertex, 'vertex');
      const armB = safeName(plan.armB, 'armB');
      const result = safeName(plan.result, 'result');
      const firstVector = calcDifferenceCoordinate(armA, vertex);
      const secondVector = calcDifferenceCoordinate(armB, vertex);
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(
          plan,
          'direction-point-definition',
          [semanticEntityOwner(plan, result)],
          `\\path let \\p1=${firstVector}, \\n1={veclen(\\x1,\\y1)}, \\p2=${secondVector}, \\n2={veclen(\\x2,\\y2)} in coordinate (${result}) at ${calcOffsetCoordinate(vertex, '{\\x1/\\n1+\\x2/\\n2}', '{\\y1/\\n1+\\y2/\\n2}')};`,
        ),
        constructionWriterSlot(
          plan,
          'line-render',
          [semanticEntityOwner(plan, plan.line)],
          `\\draw (${vertex}) -- ${calcInterpolateCoordinate(vertex, 4, result)};`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'circumcircle': {
      const a = safeName(plan.a, 'a');
      const b = safeName(plan.b, 'b');
      const c = safeName(plan.c, 'c');
      const center = safeName(plan.center, 'center');
      const seed = safeName(plan.id, 'id');
      const centerOwners = [semanticEntityOwner(plan, center)];
      const body = circumcenterBody(center, a, b, c, seed);
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(plan, 'circumcenter-midpoint-ab-definition', centerOwners, body.midpointAB),
        constructionWriterSlot(plan, 'circumcenter-normal-ab-definition', centerOwners, body.perpendicularAB),
        constructionWriterSlot(plan, 'circumcenter-midpoint-ac-definition', centerOwners, body.midpointAC),
        constructionWriterSlot(plan, 'circumcenter-normal-ac-definition', centerOwners, body.perpendicularAC),
        constructionWriterSlot(plan, 'circumcenter-definition', centerOwners, body.centerIntersection),
        constructionWriterSlot(
          plan,
          'circle-render',
          [semanticEntityOwner(plan, plan.circle)],
          `\\node[draw,circle through=(${a})] at (${center}) {};`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'nine-point-circle': {
      const a = safeName(plan.a, 'a');
      const b = safeName(plan.b, 'b');
      const c = safeName(plan.c, 'c');
      const midpointBC = safeName(plan.midpointBC, 'midpointBC');
      const midpointCA = safeName(plan.midpointCA, 'midpointCA');
      const midpointAB = safeName(plan.midpointAB, 'midpointAB');
      const footA = safeName(plan.footA, 'footA');
      const footB = safeName(plan.footB, 'footB');
      const footC = safeName(plan.footC, 'footC');
      const orthocenter = safeName(plan.orthocenter, 'orthocenter');
      const vertexMidpointA = safeName(plan.vertexMidpointA, 'vertexMidpointA');
      const vertexMidpointB = safeName(plan.vertexMidpointB, 'vertexMidpointB');
      const vertexMidpointC = safeName(plan.vertexMidpointC, 'vertexMidpointC');
      const center = safeName(plan.center, 'center');
      const seed = safeName(plan.id, 'id');
      const orthocenterSeed = `${seed}-orthocenter`;
      const orthocenterSourceCenter = `mg-${orthocenterSeed}-o`;
      const orthocenterBody = circumcenterBody(
        orthocenterSourceCenter,
        a,
        b,
        c,
        orthocenterSeed,
      );
      const orthocenterOwners = [semanticEntityOwner(plan, orthocenter)];
      const centerOwners = [semanticEntityOwner(plan, center)];
      const centerBody = circumcenterBody(
        center,
        midpointBC,
        midpointCA,
        midpointAB,
        seed,
      );
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(plan, 'side-midpoint-bc-definition', [semanticEntityOwner(plan, midpointBC)], `\\coordinate (${midpointBC}) at ${calcInterpolateCoordinate(b, 0.5, c)};`),
        constructionWriterSlot(plan, 'side-midpoint-ca-definition', [semanticEntityOwner(plan, midpointCA)], `\\coordinate (${midpointCA}) at ${calcInterpolateCoordinate(c, 0.5, a)};`),
        constructionWriterSlot(plan, 'side-midpoint-ab-definition', [semanticEntityOwner(plan, midpointAB)], `\\coordinate (${midpointAB}) at ${calcInterpolateCoordinate(a, 0.5, b)};`),
        constructionWriterSlot(plan, 'altitude-foot-a-definition', [semanticEntityOwner(plan, footA)], `\\coordinate (${footA}) at ${calcProjectionCoordinate(b, a, c)};`),
        constructionWriterSlot(plan, 'altitude-foot-b-definition', [semanticEntityOwner(plan, footB)], `\\coordinate (${footB}) at ${calcProjectionCoordinate(c, b, a)};`),
        constructionWriterSlot(plan, 'altitude-foot-c-definition', [semanticEntityOwner(plan, footC)], `\\coordinate (${footC}) at ${calcProjectionCoordinate(a, c, b)};`),
        constructionWriterSlot(plan, 'orthocenter-circumcenter-midpoint-ab-definition', orthocenterOwners, orthocenterBody.midpointAB),
        constructionWriterSlot(plan, 'orthocenter-circumcenter-normal-ab-definition', orthocenterOwners, orthocenterBody.perpendicularAB),
        constructionWriterSlot(plan, 'orthocenter-circumcenter-midpoint-ac-definition', orthocenterOwners, orthocenterBody.midpointAC),
        constructionWriterSlot(plan, 'orthocenter-circumcenter-normal-ac-definition', orthocenterOwners, orthocenterBody.perpendicularAC),
        constructionWriterSlot(plan, 'orthocenter-circumcenter-definition', orthocenterOwners, orthocenterBody.centerIntersection),
        constructionWriterSlot(
          plan,
          'orthocenter-definition',
          orthocenterOwners,
          `\\path let \\p1=(${a}), \\p2=(${b}), \\p3=(${c}), \\p4=(${orthocenterSourceCenter}) in coordinate (${orthocenter}) at ({\\x1+\\x2+\\x3-2*\\x4},{\\y1+\\y2+\\y3-2*\\y4});`,
        ),
        constructionWriterSlot(plan, 'vertex-orthocenter-midpoint-a-definition', [semanticEntityOwner(plan, vertexMidpointA)], `\\coordinate (${vertexMidpointA}) at ${calcInterpolateCoordinate(a, 0.5, orthocenter)};`),
        constructionWriterSlot(plan, 'vertex-orthocenter-midpoint-b-definition', [semanticEntityOwner(plan, vertexMidpointB)], `\\coordinate (${vertexMidpointB}) at ${calcInterpolateCoordinate(b, 0.5, orthocenter)};`),
        constructionWriterSlot(plan, 'vertex-orthocenter-midpoint-c-definition', [semanticEntityOwner(plan, vertexMidpointC)], `\\coordinate (${vertexMidpointC}) at ${calcInterpolateCoordinate(c, 0.5, orthocenter)};`),
        constructionWriterSlot(plan, 'nine-point-center-midpoint-1-definition', centerOwners, centerBody.midpointAB),
        constructionWriterSlot(plan, 'nine-point-center-normal-1-definition', centerOwners, centerBody.perpendicularAB),
        constructionWriterSlot(plan, 'nine-point-center-midpoint-2-definition', centerOwners, centerBody.midpointAC),
        constructionWriterSlot(plan, 'nine-point-center-normal-2-definition', centerOwners, centerBody.perpendicularAC),
        constructionWriterSlot(plan, 'nine-point-center-definition', centerOwners, centerBody.centerIntersection),
        constructionWriterSlot(
          plan,
          'nine-point-circle-render',
          [semanticEntityOwner(plan, plan.circle)],
          `\\node[draw,circle through=(${midpointBC})] at (${center}) {};`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'simson-line': {
      const a = safeName(plan.a, 'a');
      const b = safeName(plan.b, 'b');
      const c = safeName(plan.c, 'c');
      const center = safeName(plan.center, 'center');
      const point = safeName(plan.point, 'point');
      const footAB = safeName(plan.footAB, 'footAB');
      const footBC = safeName(plan.footBC, 'footBC');
      const footCA = safeName(plan.footCA, 'footCA');
      const seed = safeName(plan.id, 'id');
      const centerOwners = [semanticEntityOwner(plan, center)];
      const body = circumcenterBody(center, a, b, c, seed);
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(plan, 'circumcenter-midpoint-ab-definition', centerOwners, body.midpointAB),
        constructionWriterSlot(plan, 'circumcenter-normal-ab-definition', centerOwners, body.perpendicularAB),
        constructionWriterSlot(plan, 'circumcenter-midpoint-ac-definition', centerOwners, body.midpointAC),
        constructionWriterSlot(plan, 'circumcenter-normal-ac-definition', centerOwners, body.perpendicularAC),
        constructionWriterSlot(plan, 'circumcenter-definition', centerOwners, body.centerIntersection),
        constructionWriterSlot(
          plan,
          'circumcircle-render',
          [semanticEntityOwner(plan, plan.circle)],
          `\\node[draw,dashed,circle through=(${a})] at (${center}) {};`,
          COMMAND_OPTION_SITE,
        ),
        constructionWriterSlot(
          plan,
          'simson-point-definition',
          [semanticEntityOwner(plan, point)],
          `\\coordinate (${point}) at ${calcInterpolateCoordinate(center, 1, a, plan.angleDegrees)};`,
        ),
        constructionWriterSlot(plan, 'pedal-foot-ab-definition', [semanticEntityOwner(plan, footAB)], `\\coordinate (${footAB}) at ${calcProjectionCoordinate(a, point, b)};`),
        constructionWriterSlot(plan, 'pedal-foot-bc-definition', [semanticEntityOwner(plan, footBC)], `\\coordinate (${footBC}) at ${calcProjectionCoordinate(b, point, c)};`),
        constructionWriterSlot(plan, 'pedal-foot-ca-definition', [semanticEntityOwner(plan, footCA)], `\\coordinate (${footCA}) at ${calcProjectionCoordinate(c, point, a)};`),
        constructionWriterSlot(
          plan,
          'simson-line-render',
          [semanticEntityOwner(plan, plan.line)],
          `\\draw[blue] ${extendedLine(footAB, footCA)};`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'fermat-point': {
      const a = safeName(plan.a, 'a');
      const b = safeName(plan.b, 'b');
      const c = safeName(plan.c, 'c');
      const equilateralAB = safeName(plan.equilateralAB, 'equilateralAB');
      const equilateralAC = safeName(plan.equilateralAC, 'equilateralAC');
      const torricelli = safeName(plan.torricelli, 'torricelli');
      const result = safeName(plan.result, 'result');
      const resultSource = safeName(plan.resultSource, 'resultSource');
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(
          plan,
          'equilateral-vertex-ab-definition',
          [semanticEntityOwner(plan, equilateralAB)],
          `\\coordinate (${equilateralAB}) at ${calcInterpolateCoordinate(a, 1, b, plan.rotationABDegrees)};`,
        ),
        constructionWriterSlot(
          plan,
          'equilateral-vertex-ac-definition',
          [semanticEntityOwner(plan, equilateralAC)],
          `\\coordinate (${equilateralAC}) at ${calcInterpolateCoordinate(a, 1, c, plan.rotationACDegrees)};`,
        ),
        constructionWriterSlot(
          plan,
          'torricelli-candidate-definition',
          [semanticEntityOwner(plan, torricelli)],
          lineLineIntersection(torricelli, c, equilateralAB, b, equilateralAC),
        ),
        constructionWriterSlot(
          plan,
          'fermat-point-definition',
          [semanticEntityOwner(plan, result)],
          `\\coordinate (${result}) at (${resultSource});`,
        ),
        constructionWriterSlot(
          plan,
          'equilateral-triangle-ab-render',
          [semanticEntityOwner(plan, plan.triangleAB)],
          `\\draw[gray,dashed] (${a}) -- (${b}) -- (${equilateralAB}) -- cycle;`,
          COMMAND_OPTION_SITE,
        ),
        constructionWriterSlot(
          plan,
          'equilateral-triangle-ac-render',
          [semanticEntityOwner(plan, plan.triangleAC)],
          `\\draw[gray,dashed] (${a}) -- (${c}) -- (${equilateralAC}) -- cycle;`,
          COMMAND_OPTION_SITE,
        ),
        constructionWriterSlot(
          plan,
          'fermat-ray-a-render',
          [semanticEntityOwner(plan, plan.rayA)],
          `\\draw[blue] (${result}) -- (${a});`,
          COMMAND_OPTION_SITE,
        ),
        constructionWriterSlot(
          plan,
          'fermat-ray-b-render',
          [semanticEntityOwner(plan, plan.rayB)],
          `\\draw[blue] (${result}) -- (${b});`,
          COMMAND_OPTION_SITE,
        ),
        constructionWriterSlot(
          plan,
          'fermat-ray-c-render',
          [semanticEntityOwner(plan, plan.rayC)],
          `\\draw[blue] (${result}) -- (${c});`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'tangent-at-point': {
      const touch = safeName(plan.touch, 'touch');
      const center = safeName(plan.circle.center, 'circle.center');
      const result = safeName(plan.result, 'result');
      const point = plan.circle.through
        ? calcInterpolateCoordinate(
          center,
          1,
          safeName(plan.circle.through, 'circle.through'),
          plan.circle.angleDegrees,
        )
        : calcOffsetCoordinate(
          center,
          `{${String(plan.circle.radius)}*cos(${String(plan.circle.angleDegrees ?? 0)})}`,
          `{${String(plan.circle.radius)}*sin(${String(plan.circle.angleDegrees ?? 0)})}`,
        );
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(
          plan,
          'touch-point-definition',
          [semanticEntityOwner(plan, touch)],
          `\\coordinate (${touch}) at ${point};`,
        ),
        constructionWriterSlot(
          plan,
          'tangent-direction-definition',
          [semanticEntityOwner(plan, result)],
          perpendicularDirection(result, touch, center, touch),
        ),
        constructionWriterSlot(
          plan,
          'tangent-line-render',
          [semanticEntityOwner(plan, plan.line)],
          `\\draw ${extendedLine(touch, result)};`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'reflect-point': {
      const point = safeName(plan.point, 'point');
      const center = safeName(plan.center, 'center');
      const result = safeName(plan.result, 'result');
      return constructionWriterArtifact(plan, [constructionWriterSlot(
        plan,
        'reflected-point-definition',
        [semanticEntityOwner(plan, result)],
        `\\coordinate (${result}) at ${calcInterpolateCoordinate(point, 2, center)};`,
      )]);
    }
    case 'reflect-line': {
      const point = safeName(plan.point, 'point');
      const lineStart = safeName(plan.lineStart, 'lineStart');
      const lineEnd = safeName(plan.lineEnd, 'lineEnd');
      const foot = safeName(plan.foot, 'foot');
      const result = safeName(plan.result, 'result');
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(
          plan,
          'projection-foot-definition',
          [semanticEntityOwner(plan, foot)],
          `\\coordinate (${foot}) at ${calcProjectionCoordinate(lineStart, point, lineEnd)};`,
        ),
        constructionWriterSlot(
          plan,
          'reflected-point-definition',
          [semanticEntityOwner(plan, result)],
          `\\coordinate (${result}) at ${calcInterpolateCoordinate(point, 2, foot)};`,
        ),
      ]);
    }
    case 'rotate-90': {
      const point = safeName(plan.point, 'point');
      const center = safeName(plan.center, 'center');
      const result = safeName(plan.result, 'result');
      return constructionWriterArtifact(plan, [constructionWriterSlot(
        plan,
        'rotated-point-definition',
        [semanticEntityOwner(plan, result)],
        `\\coordinate (${result}) at ${calcInterpolateCoordinate(center, 1, point, 90)};`,
      )]);
    }
    case 'homothety-2': {
      const point = safeName(plan.point, 'point');
      const center = safeName(plan.center, 'center');
      const result = safeName(plan.result, 'result');
      return constructionWriterArtifact(plan, [constructionWriterSlot(
        plan,
        'homothetic-point-definition',
        [semanticEntityOwner(plan, result)],
        `\\coordinate (${result}) at ${calcInterpolateCoordinate(center, 2, point)};`,
      )]);
    }
    case 'inversion-point': {
      const point = safeName(plan.point, 'point');
      const center = safeName(plan.center, 'center');
      const radiusPoint = safeName(plan.radiusPoint, 'radiusPoint');
      const result = safeName(plan.result, 'result');
      const pointVector = calcDifferenceCoordinate(point, center);
      const radiusVector = calcDifferenceCoordinate(radiusPoint, center);
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(
          plan,
          'inverse-point-definition',
          [semanticEntityOwner(plan, result)],
          `\\path let \\p1=${pointVector}, \\n1={veclen(\\x1,\\y1)}, \\p2=${radiusVector}, \\n2={veclen(\\x2,\\y2)} in coordinate (${result}) at ${calcOffsetCoordinate(center, '{\\x1*\\n2*\\n2/\\n1/\\n1}', '{\\y1*\\n2*\\n2/\\n1/\\n1}')};`,
        ),
        constructionWriterSlot(
          plan,
          'guide-render',
          [semanticEntityOwner(plan, plan.guide)],
          `\\draw[dashed] (${point}) -- (${result});`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'radical-axis': {
      const center1 = safeName(plan.circle1.center, 'circle1.center');
      const center2 = safeName(plan.circle2.center, 'circle2.center');
      const result = safeName(plan.result, 'result');
      const direction = safeName(plan.direction, 'direction');
      const radius1Bindings = plan.circle1.through
        ? [
          `\\p2=${calcDifferenceCoordinate(safeName(plan.circle1.through, 'circle1.through'), center1)}`,
          '\\n2={veclen(\\x2,\\y2)}',
        ]
        : [
          `\\p2=${calcOffsetCoordinate(center1, plan.circle1.radius ?? 0, 0)}`,
          `\\p4=(${center1})`,
          '\\n2={veclen(\\x2-\\x4,\\y2-\\y4)}',
        ];
      const radius2Bindings = plan.circle2.through
        ? [
          `\\p3=${calcDifferenceCoordinate(safeName(plan.circle2.through, 'circle2.through'), center2)}`,
          '\\n3={veclen(\\x3,\\y3)}',
        ]
        : [
          `\\p3=${calcOffsetCoordinate(center2, plan.circle2.radius ?? 0, 0)}`,
          `\\p5=(${center2})`,
          '\\n3={veclen(\\x3-\\x5,\\y3-\\y5)}',
        ];
      const bindings = [
        `\\p1=${calcDifferenceCoordinate(center2, center1)}`,
        '\\n1={veclen(\\x1,\\y1)}',
        ...radius1Bindings,
        ...radius2Bindings,
      ].join(', ');
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(
          plan,
          'equal-power-point-definition',
          [semanticEntityOwner(plan, result)],
          `\\path let ${bindings} in coordinate (${result}) at ${calcInterpolateCoordinate(center1, '{(\\n1*\\n1+\\n2*\\n2-\\n3*\\n3)/(2*\\n1*\\n1)}', center2)};`,
        ),
        constructionWriterSlot(
          plan,
          'axis-direction-definition',
          [semanticEntityOwner(plan, direction)],
          perpendicularDirection(direction, result, center1, center2),
        ),
        constructionWriterSlot(
          plan,
          'axis-render',
          [semanticEntityOwner(plan, plan.line)],
          `\\draw ${extendedLine(result, direction)};`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'cyclic-quadrilateral': {
      const a = safeName(plan.a, 'a');
      const b = safeName(plan.b, 'b');
      const c = safeName(plan.c, 'c');
      const direction = safeName(plan.direction, 'direction');
      const center = safeName(plan.center, 'center');
      const result = safeName(plan.result, 'result');
      const seed = safeName(plan.id, 'id');
      const centerOwners = [semanticEntityOwner(plan, center)];
      const body = circumcenterBody(center, a, b, c, seed);
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(plan, 'circumcenter-midpoint-ab-definition', centerOwners, body.midpointAB),
        constructionWriterSlot(plan, 'circumcenter-normal-ab-definition', centerOwners, body.perpendicularAB),
        constructionWriterSlot(plan, 'circumcenter-midpoint-ac-definition', centerOwners, body.midpointAC),
        constructionWriterSlot(plan, 'circumcenter-normal-ac-definition', centerOwners, body.perpendicularAC),
        constructionWriterSlot(plan, 'circumcenter-definition', centerOwners, body.centerIntersection),
        constructionWriterSlot(
          plan,
          'fourth-vertex-definition',
          [semanticEntityOwner(plan, result)],
          secondCircleIntersection(result, a, direction, center),
        ),
        constructionWriterSlot(
          plan,
          'secant-render',
          [semanticEntityOwner(plan, plan.secant)],
          `\\draw[dashed] ${extendedLine(a, direction)};`,
          COMMAND_OPTION_SITE,
        ),
        constructionWriterSlot(
          plan,
          'quadrilateral-render',
          [semanticEntityOwner(plan, plan.polygon)],
          `\\draw (${a}) -- (${b}) -- (${result}) -- (${c}) -- cycle;`,
          COMMAND_OPTION_SITE,
        ),
        constructionWriterSlot(
          plan,
          'circumcircle-render',
          [semanticEntityOwner(plan, plan.circle)],
          `\\node[draw,dashed,circle through=(${a})] at (${center}) {};`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
    case 'complete-quadrilateral': {
      const a = safeName(plan.a, 'a');
      const b = safeName(plan.b, 'b');
      const c = safeName(plan.c, 'c');
      const d = safeName(plan.d, 'd');
      const first = safeName(plan.firstIntersection, 'firstIntersection');
      const second = safeName(plan.secondIntersection, 'secondIntersection');
      return constructionWriterArtifact(plan, [
        constructionWriterSlot(
          plan,
          'first-opposite-intersection-definition',
          [semanticEntityOwner(plan, first)],
          lineLineIntersection(first, a, b, c, d),
        ),
        constructionWriterSlot(
          plan,
          'second-opposite-intersection-definition',
          [semanticEntityOwner(plan, second)],
          lineLineIntersection(second, b, c, d, a),
        ),
        constructionWriterSlot(
          plan,
          'side-ab-render',
          [semanticEntityOwner(plan, plan.lineAB)],
          `\\draw ${extendedLine(a, b)};`,
          COMMAND_OPTION_SITE,
        ),
        constructionWriterSlot(
          plan,
          'side-bc-render',
          [semanticEntityOwner(plan, plan.lineBC)],
          `\\draw ${extendedLine(b, c)};`,
          COMMAND_OPTION_SITE,
        ),
        constructionWriterSlot(
          plan,
          'side-cd-render',
          [semanticEntityOwner(plan, plan.lineCD)],
          `\\draw ${extendedLine(c, d)};`,
          COMMAND_OPTION_SITE,
        ),
        constructionWriterSlot(
          plan,
          'side-da-render',
          [semanticEntityOwner(plan, plan.lineDA)],
          `\\draw ${extendedLine(d, a)};`,
          COMMAND_OPTION_SITE,
        ),
        constructionWriterSlot(
          plan,
          'diagonal-render',
          [semanticEntityOwner(plan, plan.diagonal)],
          `\\draw[dashed] (${first}) -- (${second});`,
          COMMAND_OPTION_SITE,
        ),
      ]);
    }
  }
}

function planDirectiveInputs(plan: ConstructionPlan): readonly string[] {
  switch (plan.kind) {
    case 'primitive': {
      const primitive = plan.primitive;
      if (primitive.kind === 'point') return [];
      if (primitive.kind === 'segment' || primitive.kind === 'vector' || primitive.kind === 'line' || primitive.kind === 'ray') return [primitive.from, primitive.to];
      if (primitive.kind === 'polyline' || primitive.kind === 'polygon') return primitive.vertices;
      if (primitive.kind === 'rectangle') return primitive.corners;
      if (primitive.kind === 'circle') return [primitive.center, primitive.through];
      if (primitive.kind === 'label') return [primitive.at];
      if (primitive.kind === 'angle' || primitive.kind === 'right-angle') {
        return primitive.points;
      }
      return [];
    }
    case 'rectangle-by-opposite-corners': return [plan.first, plan.opposite];
    case 'midpoint': return [plan.a, plan.b];
    case 'perpendicular-foot': return [plan.point, plan.lineStart, plan.lineEnd];
    case 'point-on-circle': return [plan.circle.id ?? plan.circle.center];
    case 'parallel-line':
    case 'perpendicular-line': return [plan.through, plan.referenceStart, plan.referenceEnd];
    case 'perpendicular-bisector': return [plan.a, plan.b];
    case 'angle-bisector': return [plan.armA, plan.vertex, plan.armB];
    case 'circumcircle': return [plan.a, plan.b, plan.c];
    case 'nine-point-circle': return [plan.a, plan.b, plan.c];
    case 'simson-line': return [plan.a, plan.b, plan.c];
    case 'fermat-point': return [plan.a, plan.b, plan.c];
    case 'tangent-at-point': {
      const circleInput = plan.circle.id ?? plan.circle.center;
      return circleInput === plan.circle.center
        ? [circleInput]
        : [circleInput, plan.circle.center];
    }
    case 'reflect-point':
    case 'rotate-90':
    case 'homothety-2': return [plan.point, plan.center];
    case 'reflect-line': return [plan.point, plan.lineStart, plan.lineEnd];
    case 'inversion-point': return [plan.point, plan.center, plan.radiusPoint];
    case 'radical-axis': return [
      plan.circle1.id ?? plan.circle1.center,
      plan.circle2.id ?? plan.circle2.center,
    ];
    case 'cyclic-quadrilateral': return [plan.a, plan.b, plan.c, plan.direction];
    case 'complete-quadrilateral': return [plan.a, plan.b, plan.c, plan.d];
  }
}

function planDirectiveOutputs(plan: ConstructionPlan): readonly string[] {
  switch (plan.kind) {
    case 'primitive': return plan.primitive.kind === 'point' ? [plan.primitive.name] : plan.outputs.map((output) => output.ref);
    case 'rectangle-by-opposite-corners':
      return plan.outputs.map((output) => output.ref);
    case 'midpoint':
    case 'perpendicular-foot': return [plan.result];
    case 'point-on-circle': return [plan.result];
    case 'parallel-line':
    case 'perpendicular-line': return [plan.result];
    case 'inversion-point': return [plan.result, plan.guide];
    case 'perpendicular-bisector': return [plan.midpoint, plan.result, plan.line];
    case 'angle-bisector': return [plan.result, plan.line];
    case 'reflect-point':
    case 'rotate-90':
    case 'homothety-2': return [plan.result];
    case 'circumcircle': return [plan.center, plan.circle];
    case 'nine-point-circle': return plan.outputs.map((output) => output.ref);
    case 'simson-line': return plan.outputs.map((output) => output.ref);
    case 'fermat-point': return plan.outputs.map((output) => output.ref);
    case 'tangent-at-point': return [plan.touch, plan.result, plan.line];
    case 'reflect-line': return [plan.foot, plan.result];
    case 'radical-axis': return [plan.result, plan.direction, plan.line];
    case 'cyclic-quadrilateral': return plan.outputs.map((output) => output.ref);
    case 'complete-quadrilateral': return plan.outputs.map((output) => output.ref);
  }
}

/**
 * Compile one immutable plan into a single managed source transaction.  No
 * caller-provided source lines are accepted unless the plan explicitly opts
 * into the unsafe `opaque` writer hint and the caller opts in again.
 */
export function compileConstructionPlan(
  value: ConstructionPlan,
  options: ConstructionWriterOptions = {},
): ConstructionCompilation {
  assertConstructionPlan(value);
  const hint = value.sourceWriterHint;
  if (hint && !options.allowUnsafeOpaque) {
    throw new ConstructionPlanValidationError([{
      path: 'sourceWriterHint',
      message: 'opaque writer hint requires allowUnsafeOpaque=true',
    }]);
  }
  const kind = value.kind === 'primitive' ? value.primitive.kind : value.kind;
  const artifact = compileConstructionWriterArtifact(value);
  const generatedBody = artifact.slots.map((slot) => slot.canonicalSource);
  const body = hint?.mode === 'replace'
    ? hint.lines
    : [...generatedBody, ...(hint?.lines ?? [])];
  const records: ManagedConstructionSemanticRecord[] = [
    ...value.inputs.map((input) => ({
      recordType: 'input' as const,
      id: input.id,
      role: input.role,
      ref: input.ref,
    })),
    ...value.entities.map((entity) => (
      entity.kind === 'point' && entity.position !== undefined
        ? { ...entity, position: sourceCanonicalPoint(entity.position) }
        : entity
    )),
    ...value.constraints,
    ...value.relations,
    ...value.outputs,
  ];
  const lines = directive(
    value.id,
    kind,
    value.kind,
    planDirectiveInputs(value),
    planDirectiveOutputs(value),
    records,
    body,
  );
  return {
    lines,
    selection: [...value.selection],
    status: value.status,
    kind: value.kind,
  };
}

/**
 * Wrap a raw circle statement in-place with schema-v2 identity metadata. The
 * body is accepted only from the current parsed statement range and is emitted
 * byte-for-byte inside the managed block; nested MathGeo directives are
 * rejected so source cannot escape the adoption boundary.
 */
export function compileSourceCircleAdoption(
  request: SourceCircleAdoptionRequest,
): ConstructionCompilation {
  const id = safeName(request.id, 'id');
  const entityId = safeName(request.entityId, 'entityId');
  const center = safeName(request.circle.center, 'circle.center');
  if (!nonEmpty(request.source)) {
    throw new ConstructionPlanValidationError([{
      path: 'source',
      message: 'source circle statement is required',
    }]);
  }
  if (/(^|\r?\n)[ \t]*%[ \t]*@mathgeo\b/iu.test(request.source)) {
    throw new ConstructionPlanValidationError([{
      path: 'source',
      message: 'source circle statement cannot contain nested MathGeo directives',
    }]);
  }

  const circleEntity: ConstructionEntity = 'through' in request.circle
    ? {
      recordType: 'entity',
      id: entityId,
      name: entityId,
      kind: 'circle',
      center,
      through: safeName(request.circle.through, 'circle.through'),
      tags: ['source-adopted', 'circle'],
    }
    : (() => {
      if (!Number.isFinite(request.circle.radius) || request.circle.radius <= 0) {
        throw new ConstructionPlanValidationError([{
          path: 'circle.radius',
          message: 'source circle radius must be a positive finite number',
        }]);
      }
      return {
        recordType: 'entity',
        id: entityId,
        name: entityId,
        kind: 'circle',
        center,
        radius: request.circle.radius,
        tags: ['source-adopted', 'circle'],
      };
    })();
  const inputs: ManagedConstructionSemanticRecord[] = [
    {
      recordType: 'input',
      id: 'center',
      role: 'center',
      ref: center,
    },
    ...('through' in request.circle
      ? [{
        recordType: 'input' as const,
        id: 'through',
        role: 'through',
        ref: safeName(request.circle.through, 'circle.through'),
      }]
      : []),
  ];
  const output: ConstructionOutput = {
    recordType: 'output',
    id: `output-${entityId}`,
    role: 'adopted-circle',
    ref: entityId,
    kind: 'circle',
  };
  return {
    lines: directive(
      id,
      'circle',
      'primitive',
      inputs.flatMap((record) => (
        record.recordType === 'input' ? [record.ref] : []
      )),
      [entityId],
      [...inputs, circleEntity, output],
      [request.source],
    ),
    selection: [entityId],
    status: '已将原始 TikZ 圆提升为可逆 managed 实体',
    kind: 'primitive',
  };
}
