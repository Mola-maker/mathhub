import {
  compileConstructionPlan,
  compileConstructionWriterArtifact,
  validateConstructionPlan,
  type CircleConstructionReference,
  type ConstructionConstraint,
  type ConstructionEntity,
  type ConstructionInput,
  type ConstructionOutput,
  type ConstructionPlan,
  type ConstructionPlanKind,
  type ConstructionPoint,
  type ConstructionRelation,
  type PrimitiveDefinition,
  type PrimitiveKind,
} from './construction-ir';
import {
  MANAGED_CONSTRUCTION_SCHEMA_V2,
  MANAGED_CONSTRUCTION_SCHEMA_V3,
  parseManagedConstructionBlocks,
  type ManagedConstructionBlock,
} from '../semantics/managed-construction';
import {
  hydrateManagedPresentation,
  managedPresentationEnvelopeMatches,
  type ManagedPresentationIR,
} from './managed-presentation';
import { compileConstructionPlanV3 } from './construction-ir-v3';
import {
  managedConstructionV3OutsideSlotsMatches,
  readManagedConstructionV3Envelope,
  validateManagedConstructionV3Artifact,
} from '../semantics/managed-construction-v3';
import { validateConstructionPlanSemanticFootprint } from './construction-plan-footprint';

/**
 * Compatibility identity for the managed construction decoder/recovery ABI.
 * Include this in semantic projection digests so an old CDN client cannot
 * present a proposal created under different writer-slot rules as current.
 */
export const CONSTRUCTION_PLAN_CODEC_ABI_VERSION =
  'construction-plan-codec/v3' as const;

/**
 * Schema-v2 stores the source-relevant semantic graph, but intentionally does
 * not persist ephemeral authoring feedback (`status` and `selection`). A
 * recovered plan therefore normalizes those fields and proves either complete
 * canonical writer output or a lossless, writer-slot-owned presentation
 * projection for the currently supported primitive vertical slice.
 */
export type CompactCanonicalConstructionPlan = ConstructionPlan extends infer Plan
  ? Plan extends ConstructionPlan
    ? Omit<Plan, 'selection' | 'sourceWriterHint' | 'status'>
    : never
  : never;

export type ConstructionPlanCodecIssueCode =
  | 'stale-block'
  | 'unsupported-schema'
  | 'invalid-metadata'
  | 'invalid-integrity'
  | 'source-adopted'
  | 'unsupported-plan-kind'
  | 'header-shape'
  | 'missing-record'
  | 'ambiguous-record'
  | 'semantic-mismatch'
  | 'insufficient-plan-data'
  | 'invalid-recovered-plan'
  | 'unsafe-writer-surface'
  | 'invalid-writer-envelope'
  | 'non-canonical-source';

export type ConstructionPlanWriterSafetyIssueCode =
  | 'unsafe-name'
  | 'unsafe-reference'
  | 'unsafe-metadata-token'
  | 'unsafe-label-text'
  | 'unsafe-scalar'
  | 'unsafe-writer-hint'
  | 'primitive-semantic-mismatch';

export interface ConstructionPlanWriterSafetyIssue {
  readonly code: ConstructionPlanWriterSafetyIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface ConstructionPlanCodecIssue {
  readonly code: ConstructionPlanCodecIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface DecodedManagedConstructionPlan {
  readonly ok: true;
  readonly block: ManagedConstructionBlock;
  /** Full plan accepted by the trusted writer/recompile boundary. */
  readonly plan: ConstructionPlan;
  /** Source-relevant plan projection suitable for a compact AI context. */
  readonly compactPlan: CompactCanonicalConstructionPlan;
  /** Proven revision-local presentation for supported writer slots. */
  readonly presentation?: ManagedPresentationIR;
}

export interface RejectedManagedConstructionPlan {
  readonly ok: false;
  readonly block: ManagedConstructionBlock;
  readonly issues: readonly ConstructionPlanCodecIssue[];
}

export type ManagedConstructionPlanDecodeResult =
  | DecodedManagedConstructionPlan
  | RejectedManagedConstructionPlan;

/**
 * Selects the union members that can carry `kind`. Plain `Extract` collapses to
 * `never` for members declared with a grouped discriminant such as
 * `kind: 'segment' | 'vector' | 'line' | 'ray'`, because that member is not
 * assignable to `{ kind: 'line' }`.
 */
type RecordWithKind<T, K> = T extends { kind: infer Discriminant }
  ? K extends Discriminant ? T : never
  : never;

type ConstraintKind = ConstructionConstraint['kind'];
type ConstraintOf<K extends ConstraintKind> = RecordWithKind<ConstructionConstraint, K>;
type EntityKind = ConstructionEntity['kind'];
type EntityOf<K extends EntityKind> = RecordWithKind<ConstructionEntity, K>;

const PLAN_KINDS = new Set<ConstructionPlanKind>([
  'primitive',
  'rectangle-by-opposite-corners',
  'midpoint',
  'perpendicular-foot',
  'point-on-circle',
  'parallel-line',
  'perpendicular-line',
  'perpendicular-bisector',
  'angle-bisector',
  'circumcircle',
  'nine-point-circle',
  'simson-line',
  'fermat-point',
  'tangent-at-point',
  'reflect-point',
  'reflect-line',
  'rotate-90',
  'homothety-2',
  'inversion-point',
  'radical-axis',
  'cyclic-quadrilateral',
  'complete-quadrilateral',
]);

const PRIMITIVE_KINDS = new Set<PrimitiveKind>([
  'point',
  'segment',
  'vector',
  'line',
  'ray',
  'polyline',
  'polygon',
  'rectangle',
  'circle',
  'label',
  'angle',
  'right-angle',
]);

const WRITER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9:_-]*$/;
const WRITER_PERSISTENT_REFERENCE_PATTERN = /^managed:[A-Za-z0-9:_.%-]+$/;
const WRITER_METADATA_TOKEN_PATTERN = /^[A-Za-z][A-Za-z0-9:_-]*$/;
const WRITER_PLAIN_LABEL_PATTERN = /^[\p{L}\p{N}\p{M}\p{Zs}\t.,:!?+\-=()\/'"\u00b7\u00b0\u00d7\u00f7_]+$/u;
const WRITER_MATH_NAME_LABEL_PATTERN = /^\$[A-Za-z_][A-Za-z0-9:_-]*\$$/;
const MANAGED_DIRECTIVE_MARKER_PATTERN = /@mathgeo/iu;

/**
 * Concrete managed syntax identity. Non-primitive plans use their plan kind;
 * primitive plans additionally preserve point/segment/circle/etc. This value
 * is the replacement CAS discriminator, not merely display metadata.
 */
export function constructionPlanSyntaxKind(plan: ConstructionPlan): string {
  return plan.kind === 'primitive' ? plan.primitive.kind : plan.kind;
}

function writerSafetyIssue(
  issues: ConstructionPlanWriterSafetyIssue[],
  code: ConstructionPlanWriterSafetyIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function safeWriterName(
  value: string,
  path: string,
  issues: ConstructionPlanWriterSafetyIssue[],
): void {
  if (!WRITER_NAME_PATTERN.test(value) || MANAGED_DIRECTIVE_MARKER_PATTERN.test(value)) {
    writerSafetyIssue(
      issues,
      'unsafe-name',
      path,
      'value must match the canonical TikZ name grammar',
    );
  }
}

function safeWriterReference(
  value: string,
  path: string,
  issues: ConstructionPlanWriterSafetyIssue[],
): void {
  if (
    (!WRITER_NAME_PATTERN.test(value)
      && !WRITER_PERSISTENT_REFERENCE_PATTERN.test(value))
    || MANAGED_DIRECTIVE_MARKER_PATTERN.test(value)
  ) {
    writerSafetyIssue(
      issues,
      'unsafe-reference',
      path,
      'value must be a canonical TikZ name or persistent managed reference',
    );
  }
}

function safeWriterMetadataToken(
  value: string,
  path: string,
  issues: ConstructionPlanWriterSafetyIssue[],
): void {
  if (!WRITER_METADATA_TOKEN_PATTERN.test(value) || MANAGED_DIRECTIVE_MARKER_PATTERN.test(value)) {
    writerSafetyIssue(
      issues,
      'unsafe-metadata-token',
      path,
      'metadata value must match the canonical token grammar',
    );
  }
}

function safeWriterLabel(
  value: string,
  path: string,
  issues: ConstructionPlanWriterSafetyIssue[],
): void {
  const safePlainText = WRITER_PLAIN_LABEL_PATTERN.test(value);
  const safeSingleNameMath = WRITER_MATH_NAME_LABEL_PATTERN.test(value);
  if (
    value.length > 256
    || MANAGED_DIRECTIVE_MARKER_PATTERN.test(value)
    || (!safePlainText && !safeSingleNameMath)
  ) {
    writerSafetyIssue(
      issues,
      'unsafe-label-text',
      path,
      'label must be bounded plain text or one canonical $name$ token; TeX controls and structural delimiters are not accepted',
    );
  }
}

function safeWriterScalar(
  value: number | string,
  path: string,
  issues: ConstructionPlanWriterSafetyIssue[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    writerSafetyIssue(
      issues,
      'unsafe-scalar',
      path,
      'AI-replaceable writer scalars must be finite JSON numbers; raw TikZ expressions are not accepted',
    );
  }
}

function safeWriterPoint(
  point: ConstructionPoint,
  path: string,
  issues: ConstructionPlanWriterSafetyIssue[],
): void {
  const values = 'x' in point ? [point.x, point.y] : [point[0], point[1]];
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      writerSafetyIssue(issues, 'unsafe-scalar', `${path}[${index}]`, 'coordinate must be finite');
    }
  });
}

function safeWriterCircleReference(
  circle: CircleConstructionReference,
  path: string,
  issues: ConstructionPlanWriterSafetyIssue[],
): void {
  if (circle.id !== undefined) safeWriterReference(circle.id, `${path}.id`, issues);
  safeWriterName(circle.center, `${path}.center`, issues);
  if (circle.through !== undefined) safeWriterName(circle.through, `${path}.through`, issues);
  if (circle.radius !== undefined) safeWriterScalar(circle.radius, `${path}.radius`, issues);
  if (circle.angleDegrees !== undefined) {
    safeWriterScalar(circle.angleDegrees, `${path}.angleDegrees`, issues);
  }
  if (circle.evaluatedCenter !== undefined) {
    safeWriterPoint(circle.evaluatedCenter, `${path}.evaluatedCenter`, issues);
  }
  if (circle.evaluatedRadius !== undefined) {
    safeWriterScalar(circle.evaluatedRadius, `${path}.evaluatedRadius`, issues);
  }
}

function safeWriterEntity(
  entity: ConstructionEntity,
  path: string,
  issues: ConstructionPlanWriterSafetyIssue[],
): void {
  safeWriterName(entity.id, `${path}.id`, issues);
  safeWriterName(entity.name, `${path}.name`, issues);
  entity.tags?.forEach((tag, index) => (
    safeWriterMetadataToken(tag, `${path}.tags[${index}]`, issues)
  ));
  switch (entity.kind) {
    case 'point':
      if (entity.position !== undefined) safeWriterPoint(entity.position, `${path}.position`, issues);
      return;
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray':
      safeWriterReference(entity.from, `${path}.from`, issues);
      safeWriterReference(entity.to, `${path}.to`, issues);
      return;
    case 'polyline':
    case 'polygon':
      entity.vertices.forEach((ref, index) => safeWriterReference(ref, `${path}.vertices[${index}]`, issues));
      return;
    case 'rectangle':
      entity.corners.forEach((ref, index) => safeWriterReference(ref, `${path}.corners[${index}]`, issues));
      return;
    case 'circle':
      safeWriterReference(entity.center, `${path}.center`, issues);
      if ('through' in entity && entity.through !== undefined) {
        safeWriterReference(entity.through, `${path}.through`, issues);
      }
      if ('radius' in entity && entity.radius !== undefined) {
        safeWriterScalar(entity.radius, `${path}.radius`, issues);
      }
      return;
    case 'label':
      safeWriterReference(entity.at, `${path}.at`, issues);
      safeWriterLabel(entity.text, `${path}.text`, issues);
      return;
    case 'angle':
    case 'right-angle':
      entity.points.forEach((ref, index) => safeWriterReference(ref, `${path}.points[${index}]`, issues));
  }
}

function safeWriterConstraint(
  constraint: ConstructionConstraint,
  path: string,
  issues: ConstructionPlanWriterSafetyIssue[],
): void {
  safeWriterName(constraint.id, `${path}.id`, issues);
  const refs: readonly string[] = (() => {
    switch (constraint.kind) {
      case 'point-reflection':
        return [constraint.source, constraint.center, constraint.result];
      case 'line-reflection':
        return [constraint.source, constraint.axisStart, constraint.axisEnd, constraint.foot, constraint.result];
      case 'rotation':
        safeWriterScalar(constraint.angleDegrees, `${path}.angleDegrees`, issues);
        return [constraint.source, constraint.center, constraint.result];
      case 'homothety':
        safeWriterScalar(constraint.scale, `${path}.scale`, issues);
        return [constraint.source, constraint.center, constraint.result];
      case 'midpoint':
        return [constraint.point, constraint.a, constraint.b];
      case 'perpendicular-foot':
        return [constraint.point, constraint.lineStart, constraint.lineEnd, constraint.result];
      case 'on-circle':
        return [constraint.point, constraint.circle];
      case 'circle-through-three-points':
        return [constraint.circle, constraint.center, ...constraint.points];
      case 'tangent-at-point':
        return [constraint.line, constraint.touch, constraint.circle, constraint.center];
      case 'perpendicular-bisector':
        return [constraint.line, constraint.midpoint, constraint.a, constraint.b];
      case 'angle-bisector':
        return [constraint.line, constraint.armA, constraint.vertex, constraint.armB];
      case 'parallel':
      case 'perpendicular':
        return [constraint.line, constraint.reference];
      case 'inversion':
        return [constraint.point, constraint.center, constraint.radius, constraint.result];
      case 'radical-axis':
        return [constraint.line, constraint.point, constraint.circle1, constraint.circle2];
      case 'line-intersection':
        return [constraint.point, constraint.line1, constraint.line2];
      case 'line-circle-other-intersection':
        return [constraint.point, constraint.line, constraint.circle, constraint.excludePoint];
      case 'cyclic':
      case 'complete-quadrilateral':
      case 'collinear':
        return constraint.points;
    }
  })();
  refs.forEach((ref, index) => safeWriterReference(ref, `${path}.refs[${index}]`, issues));
}

function sameWriterPoint(
  left: ConstructionPoint,
  right: ConstructionPoint,
): boolean {
  const leftValues = 'x' in left ? [left.x, left.y] : [left[0], left[1]];
  const rightValues = 'x' in right ? [right.x, right.y] : [right[0], right[1]];
  return leftValues[0] === rightValues[0] && leftValues[1] === rightValues[1];
}

function primitiveMatchesEntity(
  primitive: PrimitiveDefinition,
  entity: ConstructionEntity,
): boolean {
  if (entity.kind !== primitive.kind) return false;
  switch (primitive.kind) {
    case 'point':
      return entity.kind === 'point'
        && entity.name === primitive.name
        && entity.position !== undefined
        && sameWriterPoint(entity.position, primitive.position);
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray':
      return entity.kind === primitive.kind
        && entity.from === primitive.from
        && entity.to === primitive.to;
    case 'polyline':
    case 'polygon':
      return entity.kind === primitive.kind && sameValues(entity.vertices, primitive.vertices);
    case 'rectangle':
      return entity.kind === 'rectangle' && sameValues(entity.corners, primitive.corners);
    case 'circle':
      return entity.kind === 'circle'
        && 'through' in entity
        && entity.center === primitive.center
        && entity.through === primitive.through;
    case 'label':
      return entity.kind === 'label'
        && entity.at === primitive.at
        && entity.text === primitive.text;
    case 'angle':
    case 'right-angle':
      return entity.kind === primitive.kind && sameValues(entity.points, primitive.points);
  }
}

function validatePrimitiveSemanticCoupling(
  plan: Extract<ConstructionPlan, { kind: 'primitive' }>,
  issues: ConstructionPlanWriterSafetyIssue[],
): void {
  const matchingEntities = plan.entities.filter((entity) => (
    primitiveMatchesEntity(plan.primitive, entity)
  ));
  if (matchingEntities.length !== 1) {
    writerSafetyIssue(
      issues,
      'primitive-semantic-mismatch',
      'entities',
      `primitive definition must have exactly one identical ${plan.primitive.kind} semantic entity`,
    );
    return;
  }
  const entity = matchingEntities[0]!;
  const expectedRef = plan.primitive.kind === 'point' ? plan.primitive.name : entity.id;
  const matchingOutputs = plan.outputs.filter((output) => (
    output.kind === plan.primitive.kind && output.ref === expectedRef
  ));
  if (matchingOutputs.length !== 1) {
    writerSafetyIssue(
      issues,
      'primitive-semantic-mismatch',
      'outputs',
      'primitive definition, semantic entity and output record must identify the same concrete primitive',
    );
  }
}

/**
 * Extra trust-boundary validation for plans that are allowed to reach the
 * canonical TikZ writer. The general ConstructionPlan validator accepts some
 * source-language expressions for trusted internal callers; AI and recovered
 * replaceable plans intentionally use this smaller, injection-safe grammar.
 */
export function validateConstructionPlanWriterSafety(
  plan: ConstructionPlan,
): readonly ConstructionPlanWriterSafetyIssue[] {
  const issues: ConstructionPlanWriterSafetyIssue[] = [];
  safeWriterName(plan.id, 'id', issues);
  if (plan.sourceWriterHint !== undefined) {
    writerSafetyIssue(
      issues,
      'unsafe-writer-hint',
      'sourceWriterHint',
      'sourceWriterHint is never accepted at the AI/canonical replacement boundary',
    );
  }
  plan.inputs.forEach((input, index) => {
    safeWriterName(input.id, `inputs[${index}].id`, issues);
    safeWriterMetadataToken(input.role, `inputs[${index}].role`, issues);
    safeWriterReference(input.ref, `inputs[${index}].ref`, issues);
  });
  plan.entities.forEach((entity, index) => safeWriterEntity(entity, `entities[${index}]`, issues));
  plan.constraints.forEach((constraint, index) => safeWriterConstraint(constraint, `constraints[${index}]`, issues));
  plan.relations.forEach((relation, index) => {
    safeWriterName(relation.id, `relations[${index}].id`, issues);
    safeWriterReference(relation.from, `relations[${index}].from`, issues);
    safeWriterReference(relation.to, `relations[${index}].to`, issues);
  });
  plan.outputs.forEach((output, index) => {
    safeWriterName(output.id, `outputs[${index}].id`, issues);
    safeWriterMetadataToken(output.role, `outputs[${index}].role`, issues);
    // Output refs are emitted in the managed header through safeName(), not
    // merely stored as semantic references.
    safeWriterName(output.ref, `outputs[${index}].ref`, issues);
  });
  plan.selection.forEach((ref, index) => safeWriterReference(ref, `selection[${index}]`, issues));

  const names = (fields: readonly [string, string][]): void => {
    fields.forEach(([path, value]) => safeWriterName(value, path, issues));
  };
  switch (plan.kind) {
    case 'primitive': {
      const primitive = plan.primitive;
      switch (primitive.kind) {
        case 'point':
          safeWriterName(primitive.name, 'primitive.name', issues);
          safeWriterPoint(primitive.position, 'primitive.position', issues);
          break;
        case 'segment':
        case 'vector':
        case 'line':
        case 'ray':
          names([['primitive.from', primitive.from], ['primitive.to', primitive.to]]);
          break;
        case 'polyline':
        case 'polygon':
          names(primitive.vertices.map((value, index) => [`primitive.vertices[${index}]`, value] as const));
          break;
        case 'rectangle':
          names(primitive.corners.map((value, index) => [`primitive.corners[${index}]`, value] as const));
          break;
        case 'circle':
          names([['primitive.center', primitive.center], ['primitive.through', primitive.through]]);
          break;
        case 'label':
          safeWriterName(primitive.at, 'primitive.at', issues);
          safeWriterLabel(primitive.text, 'primitive.text', issues);
          break;
        case 'angle':
        case 'right-angle':
          names(primitive.points.map((value, index) => [`primitive.points[${index}]`, value] as const));
          break;
      }
      validatePrimitiveSemanticCoupling(plan, issues);
      break;
    }
    case 'rectangle-by-opposite-corners':
      names([['first', plan.first], ['opposite', plan.opposite], ['second', plan.second], ['fourth', plan.fourth]]);
      break;
    case 'midpoint':
      names([['a', plan.a], ['b', plan.b], ['result', plan.result]]);
      break;
    case 'perpendicular-foot':
      names([['point', plan.point], ['lineStart', plan.lineStart], ['lineEnd', plan.lineEnd], ['result', plan.result]]);
      break;
    case 'point-on-circle':
      safeWriterCircleReference(plan.circle, 'circle', issues);
      safeWriterName(plan.result, 'result', issues);
      break;
    case 'parallel-line':
    case 'perpendicular-line':
      names([['through', plan.through], ['referenceStart', plan.referenceStart], ['referenceEnd', plan.referenceEnd], ['result', plan.result]]);
      break;
    case 'perpendicular-bisector':
      names([['a', plan.a], ['b', plan.b], ['midpoint', plan.midpoint], ['result', plan.result], ['line', plan.line]]);
      break;
    case 'angle-bisector':
      names([['armA', plan.armA], ['vertex', plan.vertex], ['armB', plan.armB], ['result', plan.result], ['line', plan.line]]);
      break;
    case 'circumcircle':
      names([['a', plan.a], ['b', plan.b], ['c', plan.c], ['center', plan.center], ['circle', plan.circle]]);
      break;
    case 'nine-point-circle':
      names([
        ['a', plan.a], ['b', plan.b], ['c', plan.c],
        ['midpointBC', plan.midpointBC], ['midpointCA', plan.midpointCA], ['midpointAB', plan.midpointAB],
        ['footA', plan.footA], ['footB', plan.footB], ['footC', plan.footC],
        ['orthocenter', plan.orthocenter],
        ['vertexMidpointA', plan.vertexMidpointA],
        ['vertexMidpointB', plan.vertexMidpointB],
        ['vertexMidpointC', plan.vertexMidpointC],
        ['center', plan.center], ['circle', plan.circle],
      ]);
      break;
    case 'simson-line':
      names([
        ['a', plan.a], ['b', plan.b], ['c', plan.c],
        ['center', plan.center], ['circle', plan.circle], ['point', plan.point],
        ['footAB', plan.footAB], ['footBC', plan.footBC], ['footCA', plan.footCA],
        ['line', plan.line],
      ]);
      safeWriterScalar(plan.angleDegrees, 'angleDegrees', issues);
      break;
    case 'fermat-point':
      names([
        ['a', plan.a], ['b', plan.b], ['c', plan.c],
        ['equilateralAB', plan.equilateralAB], ['equilateralAC', plan.equilateralAC],
        ['torricelli', plan.torricelli], ['result', plan.result],
        ['line1', plan.line1], ['line2', plan.line2],
        ['triangleAB', plan.triangleAB], ['triangleAC', plan.triangleAC],
        ['rayA', plan.rayA], ['rayB', plan.rayB], ['rayC', plan.rayC],
        ['resultSource', plan.resultSource],
      ]);
      safeWriterScalar(plan.rotationABDegrees, 'rotationABDegrees', issues);
      safeWriterScalar(plan.rotationACDegrees, 'rotationACDegrees', issues);
      break;
    case 'tangent-at-point':
      safeWriterCircleReference(plan.circle, 'circle', issues);
      names([['touch', plan.touch], ['result', plan.result], ['line', plan.line]]);
      break;
    case 'reflect-point':
    case 'rotate-90':
    case 'homothety-2':
      names([['point', plan.point], ['center', plan.center], ['result', plan.result]]);
      break;
    case 'reflect-line':
      names([['point', plan.point], ['lineStart', plan.lineStart], ['lineEnd', plan.lineEnd], ['foot', plan.foot], ['result', plan.result]]);
      break;
    case 'inversion-point':
      names([['point', plan.point], ['center', plan.center], ['radiusPoint', plan.radiusPoint], ['result', plan.result], ['guide', plan.guide]]);
      break;
    case 'radical-axis':
      safeWriterCircleReference(plan.circle1, 'circle1', issues);
      safeWriterCircleReference(plan.circle2, 'circle2', issues);
      names([['result', plan.result], ['direction', plan.direction], ['line', plan.line]]);
      break;
    case 'cyclic-quadrilateral':
      names([['a', plan.a], ['b', plan.b], ['c', plan.c], ['direction', plan.direction], ['center', plan.center], ['result', plan.result], ['circle', plan.circle], ['secant', plan.secant], ['polygon', plan.polygon]]);
      break;
    case 'complete-quadrilateral':
      names([
        ['a', plan.a], ['b', plan.b], ['c', plan.c], ['d', plan.d],
        ['firstIntersection', plan.firstIntersection], ['secondIntersection', plan.secondIntersection],
        ['lineAB', plan.lineAB], ['lineBC', plan.lineBC], ['lineCD', plan.lineCD],
        ['lineDA', plan.lineDA], ['diagonal', plan.diagonal],
      ]);
      break;
  }
  return issues;
}

interface DecodeContext {
  readonly block: ManagedConstructionBlock;
  readonly inputs: readonly ConstructionInput[];
  readonly entities: readonly ConstructionEntity[];
  readonly constraints: readonly ConstructionConstraint[];
  readonly relations: readonly ConstructionRelation[];
  readonly outputs: readonly ConstructionOutput[];
  readonly issues: ConstructionPlanCodecIssue[];
}

function issue(
  context: DecodeContext,
  code: ConstructionPlanCodecIssueCode,
  path: string,
  message: string,
): void {
  context.issues.push({ code, path, message });
}

function sameValues(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function headerValues(
  context: DecodeContext,
  field: 'inputs' | 'outputs',
  length: number,
): readonly string[] | undefined {
  const values = context.block[field];
  if (values.length !== length) {
    issue(
      context,
      'header-shape',
      `header.${field}`,
      `${context.block.planKind} requires ${length} ordered header ${field}; found ${values.length}.`,
    );
    return undefined;
  }
  return values;
}

function uniqueMatch<T>(
  context: DecodeContext,
  matches: readonly T[],
  path: string,
  description: string,
): T | undefined {
  if (matches.length === 1) return matches[0];
  issue(
    context,
    matches.length === 0 ? 'missing-record' : 'ambiguous-record',
    path,
    matches.length === 0
      ? `Missing ${description}.`
      : `Expected one ${description}; found ${matches.length}.`,
  );
  return undefined;
}

function constraint<K extends ConstraintKind>(
  context: DecodeContext,
  kind: K,
  path = `constraints.${kind}`,
): ConstraintOf<K> | undefined {
  const matches = context.constraints.filter(
    (candidate): candidate is ConstraintOf<K> => candidate.kind === kind,
  );
  return uniqueMatch(context, matches, path, `${kind} constraint`);
}

function entity<K extends EntityKind>(
  context: DecodeContext,
  kind: K,
  predicate: (candidate: EntityOf<K>) => boolean,
  path: string,
  description: string,
): EntityOf<K> | undefined {
  const matches = context.entities.filter(
    (candidate): candidate is EntityOf<K> => candidate.kind === kind,
  ).filter(predicate);
  return uniqueMatch(context, matches, path, description);
}

function semanticMismatch(
  context: DecodeContext,
  path: string,
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (sameValues(actual, expected)) return false;
  issue(
    context,
    'semantic-mismatch',
    path,
    `Semantic record values [${actual.join(', ')}] do not match header-derived values [${expected.join(', ')}].`,
  );
  return true;
}

function primitiveFromRecords(
  context: DecodeContext,
): PrimitiveDefinition | undefined {
  if (!PRIMITIVE_KINDS.has(context.block.kind as PrimitiveKind)) {
    issue(
      context,
      'semantic-mismatch',
      'header.kind',
      `Primitive plan has unsupported primitive kind ${context.block.kind}.`,
    );
    return undefined;
  }
  const kind = context.block.kind as PrimitiveKind;
  const matches = context.entities.filter((candidate) => {
    if (candidate.kind !== kind) return false;
    switch (kind) {
      case 'point':
        return context.block.inputs.length === 0
          && context.block.outputs.length === 1
          && candidate.kind === 'point'
          && candidate.name === context.block.outputs[0]
          && candidate.position !== undefined;
      case 'segment':
      case 'vector':
      case 'line':
      case 'ray':
        return candidate.kind === kind
          && context.block.inputs.length === 2
          && candidate.from === context.block.inputs[0]
          && candidate.to === context.block.inputs[1];
      case 'polyline':
      case 'polygon':
        return candidate.kind === kind
          && sameValues(candidate.vertices, context.block.inputs);
      case 'rectangle':
        return candidate.kind === 'rectangle'
          && sameValues(candidate.corners, context.block.inputs);
      case 'circle':
        return candidate.kind === 'circle'
          && 'through' in candidate
          && typeof candidate.through === 'string'
          && sameValues([candidate.center, candidate.through], context.block.inputs);
      case 'label':
        return candidate.kind === 'label'
          && context.block.inputs.length === 1
          && candidate.at === context.block.inputs[0];
      case 'angle':
      case 'right-angle':
        return candidate.kind === kind
          && sameValues(candidate.points, context.block.inputs);
    }
  });
  const primitiveEntity = uniqueMatch(
    context,
    matches,
    'entities',
    `${kind} entity matching the primitive header`,
  );
  if (!primitiveEntity) return undefined;

  switch (primitiveEntity.kind) {
    case 'point':
      if (primitiveEntity.position === undefined) return undefined;
      return { kind: 'point', name: primitiveEntity.name, position: primitiveEntity.position };
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray':
      return { kind: primitiveEntity.kind, from: primitiveEntity.from, to: primitiveEntity.to };
    case 'polyline':
    case 'polygon':
      return { kind: primitiveEntity.kind, vertices: primitiveEntity.vertices };
    case 'rectangle':
      return { kind: 'rectangle', corners: primitiveEntity.corners };
    case 'circle':
      if (!('through' in primitiveEntity) || typeof primitiveEntity.through !== 'string') {
        issue(
          context,
          'insufficient-plan-data',
          'entities.circle',
          'Primitive circle writer requires a through-point; a radius-only entity cannot recover that spelling.',
        );
        return undefined;
      }
      return { kind: 'circle', center: primitiveEntity.center, through: primitiveEntity.through };
    case 'label':
      return { kind: 'label', at: primitiveEntity.at, text: primitiveEntity.text };
    case 'angle':
    case 'right-angle':
      return { kind: primitiveEntity.kind, points: primitiveEntity.points };
  }
}

function directConstraintPlan(
  context: DecodeContext,
  kind: ConstructionPlanKind,
): Record<string, unknown> | undefined {
  switch (kind) {
    case 'midpoint': {
      const headerInputs = headerValues(context, 'inputs', 2);
      const headerOutputs = headerValues(context, 'outputs', 1);
      const record = constraint(context, 'midpoint');
      if (!headerInputs || !headerOutputs || !record) return undefined;
      semanticMismatch(context, 'constraints.midpoint', [record.a, record.b, record.point], [
        headerInputs[0], headerInputs[1], headerOutputs[0],
      ]);
      return { a: headerInputs[0], b: headerInputs[1], result: headerOutputs[0] };
    }
    case 'perpendicular-foot': {
      const headerInputs = headerValues(context, 'inputs', 3);
      const headerOutputs = headerValues(context, 'outputs', 1);
      const record = constraint(context, 'perpendicular-foot');
      if (!headerInputs || !headerOutputs || !record) return undefined;
      semanticMismatch(
        context,
        'constraints.perpendicular-foot',
        [record.point, record.lineStart, record.lineEnd, record.result],
        [...headerInputs, headerOutputs[0]],
      );
      return {
        point: headerInputs[0],
        lineStart: headerInputs[1],
        lineEnd: headerInputs[2],
        result: headerOutputs[0],
      };
    }
    case 'perpendicular-bisector': {
      const headerInputs = headerValues(context, 'inputs', 2);
      const headerOutputs = headerValues(context, 'outputs', 3);
      const record = constraint(context, 'perpendicular-bisector');
      if (!headerInputs || !headerOutputs || !record) return undefined;
      semanticMismatch(
        context,
        'constraints.perpendicular-bisector',
        [record.a, record.b, record.midpoint, record.line],
        [headerInputs[0], headerInputs[1], headerOutputs[0], headerOutputs[2]],
      );
      const line = entity(
        context,
        'line',
        (candidate) => candidate.name === headerOutputs[2],
        'entities.perpendicular-bisector-line',
        'perpendicular-bisector line entity',
      );
      if (!line) return undefined;
      semanticMismatch(
        context,
        'entities.perpendicular-bisector-line',
        [line.from, line.to],
        [headerOutputs[0], headerOutputs[1]],
      );
      return {
        a: headerInputs[0],
        b: headerInputs[1],
        midpoint: headerOutputs[0],
        result: headerOutputs[1],
        line: headerOutputs[2],
      };
    }
    case 'angle-bisector': {
      const headerInputs = headerValues(context, 'inputs', 3);
      const headerOutputs = headerValues(context, 'outputs', 2);
      const record = constraint(context, 'angle-bisector');
      if (!headerInputs || !headerOutputs || !record) return undefined;
      semanticMismatch(
        context,
        'constraints.angle-bisector',
        [record.armA, record.vertex, record.armB, record.line],
        [...headerInputs, headerOutputs[1]],
      );
      const line = entity(
        context,
        'line',
        (candidate) => candidate.name === headerOutputs[1],
        'entities.angle-bisector-line',
        'angle-bisector line entity',
      );
      if (!line) return undefined;
      semanticMismatch(
        context,
        'entities.angle-bisector-line',
        [line.from, line.to],
        [headerInputs[1], headerOutputs[0]],
      );
      return {
        armA: headerInputs[0],
        vertex: headerInputs[1],
        armB: headerInputs[2],
        result: headerOutputs[0],
        line: headerOutputs[1],
      };
    }
    case 'circumcircle': {
      const headerInputs = headerValues(context, 'inputs', 3);
      const headerOutputs = headerValues(context, 'outputs', 2);
      const record = constraint(context, 'circle-through-three-points');
      if (!headerInputs || !headerOutputs || !record) return undefined;
      semanticMismatch(
        context,
        'constraints.circle-through-three-points',
        [...record.points, record.center, record.circle],
        [...headerInputs, ...headerOutputs],
      );
      return {
        a: headerInputs[0],
        b: headerInputs[1],
        c: headerInputs[2],
        center: headerOutputs[0],
        circle: headerOutputs[1],
      };
    }
    case 'reflect-point':
    case 'rotate-90':
    case 'homothety-2': {
      const headerInputs = headerValues(context, 'inputs', 2);
      const headerOutputs = headerValues(context, 'outputs', 1);
      const constraintKind = kind === 'reflect-point'
        ? 'point-reflection'
        : kind === 'rotate-90'
          ? 'rotation'
          : 'homothety';
      if (!headerInputs || !headerOutputs) return undefined;
      if (constraintKind === 'point-reflection') {
        const record = constraint(context, constraintKind);
        if (!record) return undefined;
        semanticMismatch(context, 'constraints.point-reflection', [record.source, record.center, record.result], [
          ...headerInputs, headerOutputs[0],
        ]);
      } else if (constraintKind === 'rotation') {
        const record = constraint(context, constraintKind);
        if (!record) return undefined;
        semanticMismatch(context, 'constraints.rotation', [record.source, record.center, record.result], [
          ...headerInputs, headerOutputs[0],
        ]);
        if (record.angleDegrees !== 90) {
          issue(context, 'semantic-mismatch', 'constraints.rotation.angleDegrees', 'rotate-90 requires angleDegrees=90.');
        }
      } else {
        const record = constraint(context, constraintKind);
        if (!record) return undefined;
        semanticMismatch(context, 'constraints.homothety', [record.source, record.center, record.result], [
          ...headerInputs, headerOutputs[0],
        ]);
        if (record.scale !== 2) {
          issue(context, 'semantic-mismatch', 'constraints.homothety.scale', 'homothety-2 requires scale=2.');
        }
      }
      return { point: headerInputs[0], center: headerInputs[1], result: headerOutputs[0] };
    }
    case 'reflect-line': {
      const headerInputs = headerValues(context, 'inputs', 3);
      const headerOutputs = headerValues(context, 'outputs', 2);
      const record = constraint(context, 'line-reflection');
      if (!headerInputs || !headerOutputs || !record) return undefined;
      semanticMismatch(
        context,
        'constraints.line-reflection',
        [record.source, record.axisStart, record.axisEnd, record.foot, record.result],
        [...headerInputs, ...headerOutputs],
      );
      return {
        point: headerInputs[0],
        lineStart: headerInputs[1],
        lineEnd: headerInputs[2],
        foot: headerOutputs[0],
        result: headerOutputs[1],
      };
    }
    case 'inversion-point': {
      const headerInputs = headerValues(context, 'inputs', 3);
      const headerOutputs = headerValues(context, 'outputs', 2);
      const record = constraint(context, 'inversion');
      if (!headerInputs || !headerOutputs || !record) return undefined;
      semanticMismatch(
        context,
        'constraints.inversion',
        [record.point, record.center, record.radius, record.result],
        [...headerInputs, headerOutputs[0]],
      );
      const guide = entity(
        context,
        'segment',
        (candidate) => candidate.name === headerOutputs[1],
        'entities.inversion-guide',
        'inversion guide segment entity',
      );
      if (!guide) return undefined;
      semanticMismatch(
        context,
        'entities.inversion-guide',
        [guide.from, guide.to],
        [headerInputs[0], headerOutputs[0]],
      );
      return {
        point: headerInputs[0],
        center: headerInputs[1],
        radiusPoint: headerInputs[2],
        result: headerOutputs[0],
        guide: headerOutputs[1],
      };
    }
    default:
      return undefined;
  }
}

function parallelPlan(
  context: DecodeContext,
  kind: 'parallel-line' | 'perpendicular-line',
): Record<string, unknown> | undefined {
  const headerInputs = headerValues(context, 'inputs', 3);
  const headerOutputs = headerValues(context, 'outputs', 1);
  if (!headerInputs || !headerOutputs) return undefined;
  const constraintKind = kind === 'parallel-line' ? 'parallel' : 'perpendicular';
  const record = constraint(context, constraintKind);
  if (!record) return undefined;
  const authoredLine = entity(
    context,
    'line',
    (candidate) => candidate.name === record.line,
    'entities.authored-line',
    `${constraintKind} authored line entity`,
  );
  const referenceLine = entity(
    context,
    'line',
    (candidate) => candidate.name === record.reference,
    'entities.reference-line',
    `${constraintKind} reference line entity`,
  );
  if (!authoredLine || !referenceLine) return undefined;
  semanticMismatch(
    context,
    'entities.authored-line',
    [authoredLine.from, authoredLine.to],
    [headerInputs[0], headerOutputs[0]],
  );
  semanticMismatch(
    context,
    'entities.reference-line',
    [referenceLine.from, referenceLine.to],
    [headerInputs[1], headerInputs[2]],
  );
  return {
    through: headerInputs[0],
    referenceStart: headerInputs[1],
    referenceEnd: headerInputs[2],
    result: headerOutputs[0],
  };
}

function rectanglePlan(context: DecodeContext): Record<string, unknown> | undefined {
  const headerInputs = headerValues(context, 'inputs', 2);
  if (!headerInputs) return undefined;
  const boundary = entity(
    context,
    'polygon',
    (candidate) => candidate.vertices.length === 4
      && candidate.vertices[0] === headerInputs[0]
      && candidate.vertices[2] === headerInputs[1],
    'entities.rectangle-boundary',
    'rectangle boundary polygon with ordered opposite corners',
  );
  if (!boundary) return undefined;
  const rectangle = entity(
    context,
    'rectangle',
    (candidate) => sameValues(candidate.corners, headerInputs),
    'entities.rectangle',
    'rectangle entity matching the header corners',
  );
  if (!rectangle) return undefined;
  return {
    first: headerInputs[0],
    opposite: headerInputs[1],
    second: boundary.vertices[1],
    fourth: boundary.vertices[3],
  };
}

function ninePointCirclePlan(context: DecodeContext): Record<string, unknown> | undefined {
  const headerInputs = headerValues(context, 'inputs', 3);
  const headerOutputs = headerValues(context, 'outputs', 12);
  if (!headerInputs || !headerOutputs) return undefined;
  const [
    midpointBC, midpointCA, midpointAB,
    footA, footB, footC,
    orthocenter,
    vertexMidpointA, vertexMidpointB, vertexMidpointC,
    center, circle,
  ] = headerOutputs;
  const circleRecord = constraint(context, 'circle-through-three-points');
  if (!circleRecord) return undefined;
  semanticMismatch(
    context,
    'constraints.circle-through-three-points',
    [...circleRecord.points, circleRecord.center, circleRecord.circle],
    [midpointBC, midpointCA, midpointAB, center, circle],
  );
  return {
    a: headerInputs[0], b: headerInputs[1], c: headerInputs[2],
    midpointBC, midpointCA, midpointAB,
    footA, footB, footC, orthocenter,
    vertexMidpointA, vertexMidpointB, vertexMidpointC,
    center, circle,
  };
}

function fermatPointPlan(context: DecodeContext): Record<string, unknown> | undefined {
  const headerInputs = headerValues(context, 'inputs', 3);
  const headerOutputs = headerValues(context, 'outputs', 8);
  if (!headerInputs || !headerOutputs) return undefined;
  const [a, b, c] = headerInputs;
  const [equilateralAB, equilateralAC, result, triangleAB, triangleAC, rayA, rayB, rayC] = headerOutputs;
  const rotations = context.constraints.filter(
    (candidate): candidate is ConstraintOf<'rotation'> => candidate.kind === 'rotation',
  );
  const rotationAB = uniqueMatch(
    context,
    rotations.filter((candidate) => candidate.center === a && candidate.source === b && candidate.result === equilateralAB),
    'constraints.rotationAB',
    'AB equilateral rotation constraint',
  );
  const rotationAC = uniqueMatch(
    context,
    rotations.filter((candidate) => candidate.center === a && candidate.source === c && candidate.result === equilateralAC),
    'constraints.rotationAC',
    'AC equilateral rotation constraint',
  );
  const intersection = constraint(context, 'line-intersection');
  const branch = uniqueMatch(
    context,
    context.constraints.filter((candidate): candidate is ConstraintOf<'midpoint'> => (
      candidate.kind === 'midpoint' && candidate.point === result && candidate.a === candidate.b
    )),
    'constraints.branch',
    'Fermat branch alias constraint',
  );
  if (!rotationAB || !rotationAC || !intersection || !branch) return undefined;
  const line1 = entity(context, 'line', (candidate) => candidate.name === intersection.line1, 'entities.line1', 'first Fermat construction line');
  const line2 = entity(context, 'line', (candidate) => candidate.name === intersection.line2, 'entities.line2', 'second Fermat construction line');
  if (!line1 || !line2) return undefined;
  semanticMismatch(context, 'entities.line1', [line1.from, line1.to], [c, equilateralAB]);
  semanticMismatch(context, 'entities.line2', [line2.from, line2.to], [b, equilateralAC]);
  return {
    a, b, c,
    equilateralAB, equilateralAC,
    torricelli: intersection.point,
    result,
    line1: line1.name,
    line2: line2.name,
    triangleAB,
    triangleAC,
    rayA,
    rayB,
    rayC,
    rotationABDegrees: rotationAB.angleDegrees,
    rotationACDegrees: rotationAC.angleDegrees,
    resultSource: branch.a,
  };
}

function simsonLinePlan(context: DecodeContext): Record<string, unknown> | undefined {
  const headerInputs = headerValues(context, 'inputs', 3);
  const headerOutputs = headerValues(context, 'outputs', 7);
  if (!headerInputs || !headerOutputs) return undefined;
  const [a, b, c] = headerInputs;
  const [center, circle, point, footAB, footBC, footCA, line] = headerOutputs;
  const circleRecord = constraint(context, 'circle-through-three-points');
  const rotation = uniqueMatch(
    context,
    context.constraints.filter((candidate): candidate is ConstraintOf<'rotation'> => (
      candidate.kind === 'rotation'
      && candidate.source === a
      && candidate.center === center
      && candidate.result === point
    )),
    'constraints.rotation',
    'Simson circle-point rotation constraint',
  );
  const collinear = constraint(context, 'collinear');
  const onCircle = uniqueMatch(
    context,
    context.constraints.filter((candidate): candidate is ConstraintOf<'on-circle'> => (
      candidate.kind === 'on-circle'
      && candidate.point === point
      && candidate.circle === circle
    )),
    'constraints.on-circle',
    'Simson source point circle constraint',
  );
  const footConstraint = (
    result: string,
    lineStart: string,
    lineEnd: string,
    path: string,
  ): ConstraintOf<'perpendicular-foot'> | undefined => uniqueMatch(
    context,
    context.constraints.filter((candidate): candidate is ConstraintOf<'perpendicular-foot'> => (
      candidate.kind === 'perpendicular-foot'
      && candidate.point === point
      && candidate.result === result
      && candidate.lineStart === lineStart
      && candidate.lineEnd === lineEnd
    )),
    path,
    `Simson perpendicular foot ${result}`,
  );
  const perpendicularAB = footConstraint(footAB, a, b, 'constraints.footAB');
  const perpendicularBC = footConstraint(footBC, b, c, 'constraints.footBC');
  const perpendicularCA = footConstraint(footCA, c, a, 'constraints.footCA');
  const lineEntity = entity(
    context,
    'line',
    (candidate) => candidate.name === line,
    'entities.line',
    'Simson line entity',
  );
  if (
    !circleRecord || !rotation || !onCircle || !collinear
    || !perpendicularAB || !perpendicularBC || !perpendicularCA || !lineEntity
  ) return undefined;
  semanticMismatch(context, 'constraints.circle.points', circleRecord.points, [a, b, c]);
  semanticMismatch(context, 'constraints.circle.outputs', [circleRecord.center, circleRecord.circle], [center, circle]);
  semanticMismatch(context, 'constraints.collinear.points', collinear.points, [footAB, footBC, footCA]);
  semanticMismatch(context, 'entities.line.endpoints', [lineEntity.from, lineEntity.to], [footAB, footCA]);
  return {
    a, b, c, center, circle, point, footAB, footBC, footCA, line,
    angleDegrees: rotation.angleDegrees,
  };
}

function cyclicPlan(context: DecodeContext): Record<string, unknown> | undefined {
  const headerInputs = headerValues(context, 'inputs', 4);
  if (!headerInputs) return undefined;
  const [a, b, c, direction] = headerInputs;
  const circleRecord = constraint(context, 'circle-through-three-points');
  const intersection = constraint(context, 'line-circle-other-intersection');
  const cyclic = constraint(context, 'cyclic');
  if (!circleRecord || !intersection || !cyclic) return undefined;
  semanticMismatch(context, 'constraints.circle-through-three-points.points', circleRecord.points, [a, b, c]);
  semanticMismatch(
    context,
    'constraints.line-circle-other-intersection',
    [intersection.line, intersection.circle, intersection.excludePoint],
    [intersection.line, circleRecord.circle, a],
  );
  semanticMismatch(context, 'constraints.cyclic.points', cyclic.points, [a, b, c, intersection.point]);
  const secant = entity(
    context,
    'line',
    (candidate) => candidate.name === intersection.line,
    'entities.secant',
    'cyclic secant line entity',
  );
  if (!secant) return undefined;
  semanticMismatch(context, 'entities.secant', [secant.from, secant.to], [a, direction]);
  const polygon = entity(
    context,
    'polygon',
    (candidate) => sameValues(candidate.vertices, [a, b, intersection.point, c]),
    'entities.cyclic-polygon',
    'cyclic quadrilateral polygon entity',
  );
  if (!polygon) return undefined;
  return {
    a,
    b,
    c,
    direction,
    center: circleRecord.center,
    result: intersection.point,
    circle: circleRecord.circle,
    secant: intersection.line,
    polygon: polygon.name,
  };
}

function completeQuadrilateralPlan(context: DecodeContext): Record<string, unknown> | undefined {
  const headerInputs = headerValues(context, 'inputs', 4);
  if (!headerInputs) return undefined;
  const [a, b, c, d] = headerInputs;
  const complete = constraint(context, 'complete-quadrilateral');
  if (!complete) return undefined;
  semanticMismatch(context, 'constraints.complete-quadrilateral.points', complete.points, headerInputs);

  const lineFor = (from: string, to: string, path: string) => entity(
    context,
    'line',
    (candidate) => candidate.from === from && candidate.to === to,
    path,
    `line entity from ${from} to ${to}`,
  );
  const lineAB = lineFor(a, b, 'entities.lineAB');
  const lineBC = lineFor(b, c, 'entities.lineBC');
  const lineCD = lineFor(c, d, 'entities.lineCD');
  const lineDA = lineFor(d, a, 'entities.lineDA');
  if (!lineAB || !lineBC || !lineCD || !lineDA) return undefined;

  const first = uniqueMatch(
    context,
    context.constraints.filter((candidate): candidate is ConstraintOf<'line-intersection'> => (
      candidate.kind === 'line-intersection'
      && candidate.line1 === lineAB.name
      && candidate.line2 === lineCD.name
    )),
    'constraints.first-intersection',
    'AB/CD line-intersection constraint',
  );
  const second = uniqueMatch(
    context,
    context.constraints.filter((candidate): candidate is ConstraintOf<'line-intersection'> => (
      candidate.kind === 'line-intersection'
      && candidate.line1 === lineBC.name
      && candidate.line2 === lineDA.name
    )),
    'constraints.second-intersection',
    'BC/DA line-intersection constraint',
  );
  if (!first || !second) return undefined;
  const diagonal = entity(
    context,
    'segment',
    (candidate) => candidate.from === first.point && candidate.to === second.point,
    'entities.diagonal',
    'segment joining the two opposite intersections',
  );
  if (!diagonal) return undefined;
  return {
    a,
    b,
    c,
    d,
    firstIntersection: first.point,
    secondIntersection: second.point,
    lineAB: lineAB.name,
    lineBC: lineBC.name,
    lineCD: lineCD.name,
    lineDA: lineDA.name,
    diagonal: diagonal.name,
  };
}

function unsupportedCircleDefinition(
  context: DecodeContext,
  kind: 'point-on-circle' | 'radical-axis' | 'tangent-at-point',
): undefined {
  const detail = kind === 'radical-axis'
    ? 'circle center/radius parameterizations and evaluatedCenter/evaluatedRadius snapshots'
    : 'circle center/through-or-radius parameterization and angleDegrees';
  issue(
    context,
    'insufficient-plan-data',
    kind === 'radical-axis' ? 'circle1,circle2' : 'circle',
    `Schema-v2 does not persist ${detail}; recovering ${kind} would require guessing.`,
  );
  return undefined;
}

function unreachablePlanKind(value: never): never {
  throw new TypeError(`Unhandled ConstructionPlan kind ${String(value)}.`);
}

function recoverDefinition(
  context: DecodeContext,
  kind: ConstructionPlanKind,
): Record<string, unknown> | undefined {
  switch (kind) {
    case 'primitive': {
      const primitive = primitiveFromRecords(context);
      return primitive ? { primitive } : undefined;
    }
    case 'rectangle-by-opposite-corners':
      return rectanglePlan(context);
    case 'midpoint':
    case 'perpendicular-foot':
    case 'perpendicular-bisector':
    case 'angle-bisector':
    case 'circumcircle':
    case 'reflect-point':
    case 'reflect-line':
    case 'rotate-90':
    case 'homothety-2':
    case 'inversion-point':
      return directConstraintPlan(context, kind);
    case 'nine-point-circle':
      return ninePointCirclePlan(context);
    case 'simson-line':
      return simsonLinePlan(context);
    case 'fermat-point':
      return fermatPointPlan(context);
    case 'parallel-line':
    case 'perpendicular-line':
      return parallelPlan(context, kind);
    case 'cyclic-quadrilateral':
      return cyclicPlan(context);
    case 'complete-quadrilateral':
      return completeQuadrilateralPlan(context);
    case 'point-on-circle':
    case 'tangent-at-point':
    case 'radical-axis':
      return unsupportedCircleDefinition(context, kind);
    default:
      return unreachablePlanKind(kind);
  }
}

function recordsContext(block: ManagedConstructionBlock): DecodeContext {
  const inputs: ConstructionInput[] = [];
  const entities: ConstructionEntity[] = [];
  const constraints: ConstructionConstraint[] = [];
  const relations: ConstructionRelation[] = [];
  const outputs: ConstructionOutput[] = [];
  for (const record of block.records) {
    switch (record.recordType) {
      case 'input':
        inputs.push({ id: record.id, role: record.role, ref: record.ref });
        break;
      case 'entity':
        entities.push(record);
        break;
      case 'constraint':
        constraints.push(record);
        break;
      case 'relation':
        relations.push(record);
        break;
      case 'output':
        outputs.push(record);
        break;
    }
  }
  return { block, inputs, entities, constraints, relations, outputs, issues: [] };
}

function currentBlock(
  source: string,
  requested: ManagedConstructionBlock,
): ManagedConstructionBlock | undefined {
  const matches = parseManagedConstructionBlocks(source).filter((candidate) => (
    candidate.id === requested.id
    && candidate.range.start === requested.range.start
    && candidate.range.end === requested.range.end
    && candidate.actualContentFingerprint === requested.actualContentFingerprint
    && candidate.contentFingerprint === requested.contentFingerprint
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * The envelope's own line ending, read from the header and record lines.
 *
 * Inferring it from the whole block would let a CRLF inside the writer-slot
 * body — a legitimate presentation detail, e.g. a comment inside an option
 * list — rewrite the canonical header and record lines as CRLF. The envelope
 * comparison would then reject bytes that never changed.
 */
function envelopeLineEnding(envelopeText: string): '\n' | '\r\n' {
  return envelopeText.includes('\r\n') ? '\r\n' : '\n';
}

function compiledBlockText(
  plan: ConstructionPlan,
  currentText: string,
  envelopeText: string,
): string {
  const lineEnding = envelopeLineEnding(envelopeText);
  const hasTrailingLineEnding = currentText.endsWith('\r\n') || currentText.endsWith('\n');
  return compileConstructionPlan(plan).lines.join(lineEnding)
    + (hasTrailingLineEnding ? lineEnding : '');
}

function compiledV3BlockText(
  plan: ConstructionPlan,
  currentText: string,
  envelopeText: string,
): string {
  const lineEnding = envelopeLineEnding(envelopeText);
  const hasTrailingLineEnding = currentText.endsWith('\r\n') || currentText.endsWith('\n');
  const compiled = compileConstructionPlanV3(plan, lineEnding).source;
  return hasTrailingLineEnding
    ? compiled
    : compiled.slice(0, -lineEnding.length);
}

export function compactCanonicalConstructionPlan(
  plan: ConstructionPlan,
): CompactCanonicalConstructionPlan {
  const {
    selection: _selection,
    sourceWriterHint: _sourceWriterHint,
    status: _status,
    ...compact
  } = plan;
  return compact as CompactCanonicalConstructionPlan;
}

/**
 * Recover a canonical ConstructionPlan from one current schema-v2/v3 block.
 *
 * This is a proof-producing decoder rather than a best-effort parser:
 * metadata and integrity must be valid, plan-specific fields must have one
 * semantic derivation, the reconstructed plan must validate, and its complete
 * canonical block must be byte-identical to the current source slice, unless
 * a writer-slot presentation hydrator proves the difference is lossless. Any
 * source-adopted, styled, hand-diverged, ambiguous, or under-specified block
 * fails closed with typed issues.
 */
export function decodeManagedConstructionPlan(
  source: string,
  requestedBlock: ManagedConstructionBlock,
): ManagedConstructionPlanDecodeResult {
  const block = currentBlock(source, requestedBlock);
  if (!block) {
    return {
      ok: false,
      block: requestedBlock,
      issues: [{
        code: 'stale-block',
        path: 'range',
        message: 'Managed construction block is not the unique block at this revision-bound range.',
      }],
    };
  }
  const context = recordsContext(block);
  if (
    block.schemaVersion !== MANAGED_CONSTRUCTION_SCHEMA_V2
    && block.schemaVersion !== MANAGED_CONSTRUCTION_SCHEMA_V3
  ) {
    issue(
      context,
      'unsupported-schema',
      'schemaVersion',
      `Expected schema-v2 or schema-v3, found ${String(block.schemaVersion)}.`,
    );
  }
  if (block.metadataStatus !== 'valid') {
    issue(context, 'invalid-metadata', 'metadataStatus', `Metadata status is ${block.metadataStatus}.`);
  }
  if (block.integrityStatus !== 'valid') {
    issue(context, 'invalid-integrity', 'integrityStatus', `Integrity status is ${block.integrityStatus}.`);
  }
  if (block.records.some((record) => (
    record.recordType === 'entity'
    && record.tags?.includes('source-adopted')
  ))) {
    issue(
      context,
      'source-adopted',
      'entities.tags',
      'Source-adopted blocks preserve an external source spelling and cannot be reconstructed by the canonical plan writer.',
    );
  }
  if (!PLAN_KINDS.has(block.planKind as ConstructionPlanKind)) {
    issue(
      context,
      'unsupported-plan-kind',
      'planKind',
      `Unsupported ConstructionPlan kind ${block.planKind}.`,
    );
  }
  if (context.issues.length > 0) {
    return { ok: false, block, issues: context.issues };
  }

  const kind = block.planKind as ConstructionPlanKind;
  if (kind !== 'primitive' && block.kind !== kind) {
    issue(
      context,
      'semantic-mismatch',
      'header.kind',
      `Non-primitive block kind ${block.kind} does not match plan kind ${kind}.`,
    );
  }
  const definition = recoverDefinition(context, kind);
  if (!definition || context.issues.length > 0) {
    return { ok: false, block, issues: context.issues };
  }

  const candidate: Record<string, unknown> = {
    id: block.id,
    kind,
    inputs: context.inputs,
    entities: context.entities,
    constraints: context.constraints,
    relations: context.relations,
    outputs: context.outputs,
    ...definition,
    // These fields were never source truth and are not encoded by schema-v2.
    status: '',
    selection: context.outputs.map((output) => output.ref),
  };
  const validationIssues = validateConstructionPlan(candidate);
  if (validationIssues.length > 0) {
    return {
      ok: false,
      block,
      issues: validationIssues.map((validationIssue) => ({
        code: 'invalid-recovered-plan' as const,
        path: validationIssue.path,
        message: validationIssue.message,
      })),
    };
  }
  const plan = candidate as unknown as ConstructionPlan;
  const footprintIssues = validateConstructionPlanSemanticFootprint(plan);
  if (footprintIssues.length > 0) {
    return {
      ok: false,
      block,
      issues: footprintIssues.map((footprintIssue) => ({
        code: 'invalid-recovered-plan' as const,
        path: footprintIssue.path,
        message: footprintIssue.message,
      })),
    };
  }
  const writerSafetyIssues = validateConstructionPlanWriterSafety(plan);
  if (writerSafetyIssues.length > 0) {
    return {
      ok: false,
      block,
      issues: writerSafetyIssues.map((writerIssue) => ({
        code: 'unsafe-writer-surface' as const,
        path: writerIssue.path,
        message: `${writerIssue.code}: ${writerIssue.message}`,
      })),
    };
  }
  const currentText = source.slice(block.range.start, block.range.end);
  // Header, records and end marker — the block minus its TikZ body. The body is
  // writer-slot/presentation territory and must not dictate envelope layout.
  const envelopeText = source.slice(block.range.start, block.tikzBodyRange.start)
    + source.slice(block.tikzBodyRange.end, block.range.end);
  let compiled: string;
  try {
    compiled = block.schemaVersion === MANAGED_CONSTRUCTION_SCHEMA_V3
      ? compiledV3BlockText(plan, currentText, envelopeText)
      : compiledBlockText(plan, currentText, envelopeText);
  } catch (error) {
    return {
      ok: false,
      block,
      issues: [{
        code: 'invalid-recovered-plan',
        path: '',
        message: error instanceof Error ? error.message : 'Canonical plan compilation failed.',
      }],
    };
  }
  let presentationSource = source.slice(
    block.tikzBodyRange.start,
    block.tikzBodyRange.end,
  );
  let v3EnvelopeMatches = true;
  if (block.schemaVersion === MANAGED_CONSTRUCTION_SCHEMA_V3) {
    const currentLocalBlock = parseManagedConstructionBlocks(currentText)[0];
    const canonicalBlock = parseManagedConstructionBlocks(compiled)[0];
    if (!currentLocalBlock || !canonicalBlock) {
      return {
        ok: false,
        block,
        issues: [{
          code: 'invalid-writer-envelope',
          path: 'range',
          message: 'Schema-v3 block could not be reparsed as a standalone writer envelope.',
        }],
      };
    }
    const currentEnvelope = readManagedConstructionV3Envelope(
      currentText,
      currentLocalBlock,
    );
    const canonicalEnvelope = readManagedConstructionV3Envelope(
      compiled,
      canonicalBlock,
    );
    const artifact = compileConstructionWriterArtifact(plan);
    const currentArtifact = validateManagedConstructionV3Artifact(
      currentEnvelope,
      artifact,
    );
    const canonicalArtifact = validateManagedConstructionV3Artifact(
      canonicalEnvelope,
      artifact,
    );
    if (
      !currentEnvelope.syntacticallyValid
      || currentEnvelope.opaqueRanges.length !== 0
      || !currentArtifact.artifactMatched
      || !canonicalEnvelope.syntacticallyValid
      || canonicalEnvelope.opaqueRanges.length !== 0
      || !canonicalArtifact.artifactMatched
      || currentEnvelope.slots.length !== 1
    ) {
      const firstIssue = [
        ...currentEnvelope.issues,
        ...currentArtifact.issues,
        ...canonicalEnvelope.issues,
        ...canonicalArtifact.issues,
      ][0];
      return {
        ok: false,
        block,
        issues: [{
          code: 'invalid-writer-envelope',
          path: 'writerEnvelope',
          message: firstIssue?.message
            ?? 'Schema-v3 block is not owned by the trusted one-slot writer artifact.',
        }],
      };
    }
    presentationSource = currentText.slice(
      currentEnvelope.slots[0]!.sourceRange.start,
      currentEnvelope.slots[0]!.sourceRange.end,
    );
    v3EnvelopeMatches = managedConstructionV3OutsideSlotsMatches(
      currentText,
      currentEnvelope,
      compiled,
      canonicalEnvelope,
    );
  }
  const presentation = hydrateManagedPresentation(plan, presentationSource);
  const sourceDiverged = compiled !== currentText;
  if (
    sourceDiverged
    && (
      !(block.schemaVersion === MANAGED_CONSTRUCTION_SCHEMA_V3
        ? v3EnvelopeMatches
        : managedPresentationEnvelopeMatches(currentText, compiled))
      || !presentation.ok
    )
  ) {
    return {
      ok: false,
      block,
      issues: [{
        code: 'non-canonical-source',
        path: 'range',
        message: `Recovered plan does not reproduce the complete managed block byte-for-byte and presentation hydration rejected it: ${presentation.ok ? 'managed envelope differs outside the owned writer slot' : presentation.issues[0]?.message ?? 'unknown presentation conflict'}`,
      }],
    };
  }
  return {
    ok: true,
    block,
    plan,
    compactPlan: compactCanonicalConstructionPlan(plan),
    ...(sourceDiverged && presentation.ok
      ? { presentation: presentation.presentation }
      : {}),
  };
}

/** Discoverable alias for callers that phrase the operation as recovery. */
export const recoverConstructionPlanFromManagedBlock = decodeManagedConstructionPlan;
