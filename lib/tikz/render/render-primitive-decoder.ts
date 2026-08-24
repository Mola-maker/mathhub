import type {
  JsonObject,
  JsonValue,
  RenderPrimitive,
  SourceRange,
} from '../ir/model';
import type { Pt } from '../semantics/calc-eval';
import type { PersistentSourceCircleDefinition } from '../ir/persistent-entity-reference';
import { flattenCircularArc } from '../geometry/circular-arc';
import { flattenEllipticalArc } from '../geometry/elliptical-arc';
import { flattenEllipse } from '../geometry/ellipse';
import { DEFAULT_STYLE } from './style-resolver';
import { labelSceneFitPoints } from './label-layout';

export type RenderArrow = 'none' | '->' | '<-' | '<->';
export type RenderArrowTip = 'to' | 'stealth' | 'latex';

export interface DecodedRenderStyle {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly dash?: string;
  readonly dashOffset: number;
  readonly lineCap: 'butt' | 'round' | 'square';
  readonly lineJoin: 'miter' | 'round' | 'bevel';
  readonly miterLimit: number;
  readonly arrow: RenderArrow;
  readonly arrowTip: RenderArrowTip;
  readonly fill?: string;
  readonly strokeOpacity: number;
  readonly fillOpacity: number;
  readonly textOpacity: number;
  readonly opacity: number;
}

interface DecodedRenderPrimitiveBase {
  readonly primitiveId: string;
  readonly entityIds: readonly string[];
  readonly sourceStableId?: string;
  readonly sourceBindingIds: readonly string[];
  readonly sourceRange?: SourceRange;
  readonly statementIndex: number | null;
  readonly references: readonly string[];
  readonly style: DecodedRenderStyle;
  readonly zIndex: number;
  readonly interactive: boolean;
}

export type DecodedRenderPrimitive =
  | (DecodedRenderPrimitiveBase & {
    readonly kind: 'point';
    readonly position: Pt;
    readonly pointName?: string;
    readonly free: boolean;
  })
  | (DecodedRenderPrimitiveBase & {
    readonly kind: 'segment' | 'vector' | 'line' | 'ray';
    readonly points: readonly [Pt, Pt];
  })
  | (DecodedRenderPrimitiveBase & {
    readonly kind: 'polyline' | 'polygon';
    readonly points: readonly Pt[];
  })
  | (DecodedRenderPrimitiveBase & {
    readonly kind: 'cubic-bezier';
    readonly start: Pt;
    readonly control1: Pt;
    readonly control2: Pt;
    readonly end: Pt;
  })
  | (DecodedRenderPrimitiveBase & {
    readonly kind: 'circular-arc';
    readonly center: Pt;
    readonly radius: number;
    readonly startAngleDeg: number;
    readonly endAngleDeg: number;
    readonly start: Pt;
    readonly end: Pt;
  })
  | (DecodedRenderPrimitiveBase & {
    readonly kind: 'elliptical-arc';
    readonly center: Pt;
    readonly axisX: Pt;
    readonly axisY: Pt;
    readonly xRadius: number;
    readonly yRadius: number;
    readonly rotationDegrees: number;
    readonly startAngleDeg: number;
    readonly endAngleDeg: number;
    readonly start: Pt;
    readonly end: Pt;
  })
  | (DecodedRenderPrimitiveBase & {
    readonly kind: 'circle';
    readonly center: Pt;
    readonly radius: number;
    readonly circleDefinition?: PersistentSourceCircleDefinition;
  })
  | (DecodedRenderPrimitiveBase & {
    readonly kind: 'graph-node';
    readonly center: Pt;
    readonly radius: number;
    readonly text: string;
    readonly outlined: boolean;
  })
  | (DecodedRenderPrimitiveBase & {
    readonly kind: 'ellipse';
    readonly center: Pt;
    readonly xRadius: number;
    readonly yRadius: number;
    readonly rotationDegrees: number;
  })
  | (DecodedRenderPrimitiveBase & {
    readonly kind: 'label';
    readonly at: Pt;
    readonly text: string;
    readonly anchor?: string;
  })
  | (DecodedRenderPrimitiveBase & {
    readonly kind: 'angle' | 'right-angle';
    readonly vertex: Pt;
    readonly from: Pt;
    readonly to: Pt;
  });

/**
 * Selects the decoded primitives that can carry `K`. Plain `Extract` collapses
 * to `never` for the members declared with a grouped discriminant such as
 * `kind: 'segment' | 'vector' | 'line' | 'ray'`.
 */
export type DecodedRenderPrimitiveOf<K extends DecodedRenderPrimitive['kind']> =
  DecodedRenderPrimitive extends infer Member
    ? Member extends { kind: infer Discriminant }
      ? K extends Discriminant ? Member : never
      : never
    : never;

export interface RenderPrimitiveDecodeIssue {
  readonly primitiveId: string;
  readonly code: 'unsupported-kind' | 'invalid-geometry';
  readonly message: string;
}

export interface DecodedRenderPrimitiveSet {
  readonly primitives: readonly DecodedRenderPrimitive[];
  readonly issues: readonly RenderPrimitiveDecodeIssue[];
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
  );
}

function objectValue(value: JsonValue | undefined): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function finiteNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function circleDefinitionValue(
  value: JsonValue | undefined,
): PersistentSourceCircleDefinition | null {
  const definition = objectValue(value);
  const kind = stringValue(definition?.kind);
  const centerName = stringValue(definition?.centerName)?.trim();
  if (!definition || !centerName) return null;
  if (kind === 'center-through') {
    const throughName = stringValue(definition.throughName)?.trim();
    return throughName
      ? { kind, centerName, throughName }
      : null;
  }
  if (kind === 'center-radius') {
    const radius = finiteNumber(definition.radius);
    return radius !== null && radius > 0
      ? { kind, centerName, radius }
      : null;
  }
  return null;
}

function booleanValue(value: JsonValue | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function pointValue(value: JsonValue | undefined): Pt | null {
  const object = objectValue(value);
  if (!object) return null;
  const x = finiteNumber(object.x);
  const y = finiteNumber(object.y);
  return x === null || y === null ? null : { x, y };
}

function pointList(value: JsonValue | undefined): readonly Pt[] | null {
  if (!Array.isArray(value)) return null;
  const points: Pt[] = [];
  for (const item of value) {
    const point = pointValue(item);
    if (!point) return null;
    points.push(point);
  }
  return points;
}

function stringList(value: JsonValue | undefined): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === 'string')
    ? value
    : null;
}

function arrowValue(value: JsonValue | undefined): RenderArrow | null {
  return value === 'none' || value === '->' || value === '<-' || value === '<->'
    ? value
    : null;
}

function arrowTipValue(value: JsonValue | undefined): RenderArrowTip | null {
  return value === 'to' || value === 'stealth' || value === 'latex' ? value : null;
}

function lineCapValue(value: JsonValue | undefined): DecodedRenderStyle['lineCap'] | null {
  return value === 'butt' || value === 'round' || value === 'square' ? value : null;
}

function lineJoinValue(value: JsonValue | undefined): DecodedRenderStyle['lineJoin'] | null {
  return value === 'miter' || value === 'round' || value === 'bevel' ? value : null;
}

function styleOf(
  primitive: RenderPrimitive,
  semanticKind: string,
): DecodedRenderStyle {
  const style = primitive.style ?? {};
  const semanticArrow = semanticKind === 'vector' || semanticKind === 'ray'
    ? '->'
    : 'none';
  const strokeWidth = finiteNumber(style.strokeWidth);
  const fillOpacity = finiteNumber(style.fillOpacity);
  const strokeOpacity = finiteNumber(style.strokeOpacity);
  const textOpacity = finiteNumber(style.textOpacity);
  const opacity = finiteNumber(style.opacity);
  const dashOffset = finiteNumber(style.dashOffset);
  const miterLimit = finiteNumber(style.miterLimit);
  return {
    stroke: stringValue(style.stroke) ?? DEFAULT_STYLE.stroke,
    strokeWidth: strokeWidth !== null && strokeWidth > 0
      ? strokeWidth
      : DEFAULT_STYLE.strokeWidth,
    dash: stringValue(style.dash) ?? undefined,
    dashOffset: dashOffset ?? DEFAULT_STYLE.dashOffset,
    lineCap: lineCapValue(style.lineCap) ?? DEFAULT_STYLE.lineCap,
    lineJoin: lineJoinValue(style.lineJoin) ?? DEFAULT_STYLE.lineJoin,
    miterLimit: miterLimit !== null && miterLimit > 0
      ? miterLimit
      : DEFAULT_STYLE.miterLimit,
    arrow: arrowValue(style.arrow) ?? semanticArrow,
    arrowTip: arrowTipValue(style.arrowTip) ?? DEFAULT_STYLE.arrowTip,
    fill: stringValue(style.fill) ?? undefined,
    strokeOpacity: strokeOpacity === null
      ? DEFAULT_STYLE.strokeOpacity
      : Math.min(1, Math.max(0, strokeOpacity)),
    fillOpacity: fillOpacity === null
      ? 1
      : Math.min(1, Math.max(0, fillOpacity)),
    textOpacity: textOpacity === null
      ? DEFAULT_STYLE.textOpacity
      : Math.min(1, Math.max(0, textOpacity)),
    opacity: opacity === null
      ? 1
      : Math.min(1, Math.max(0, opacity)),
  };
}

function referencesOf(geometry: JsonObject): readonly string[] {
  return (
    stringList(geometry.references)
    ?? stringList(geometry.through)
    ?? stringList(geometry.endpoints)
    ?? []
  );
}

function statementIndexOf(metadata: JsonObject | undefined): number | null {
  const value = finiteNumber(metadata?.statementIndex);
  return value !== null && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function baseOf(
  primitive: RenderPrimitive,
  semanticKind: string,
): DecodedRenderPrimitiveBase {
  return {
    primitiveId: primitive.id,
    entityIds: primitive.entityIds,
    sourceStableId: stringValue(primitive.metadata?.sourceStableId) ?? undefined,
    sourceBindingIds: primitive.sourceBindingIds ?? [],
    sourceRange: primitive.sourceRange,
    statementIndex: statementIndexOf(primitive.metadata),
    references: referencesOf(primitive.geometry),
    style: styleOf(primitive, semanticKind),
    zIndex: typeof primitive.zIndex === 'number'
      && Number.isFinite(primitive.zIndex)
      ? primitive.zIndex
      : 0,
    interactive: primitive.interactive ?? false,
  };
}

function decodePrimitive(
  primitive: RenderPrimitive,
): DecodedRenderPrimitive | RenderPrimitiveDecodeIssue {
  const geometry = primitive.geometry;
  const kind = primitive.kind;
  const invalid = (message: string): RenderPrimitiveDecodeIssue => ({
    primitiveId: primitive.id,
    code: 'invalid-geometry',
    message,
  });

  if (kind === 'point') {
    const x = finiteNumber(geometry.x);
    const y = finiteNumber(geometry.y);
    if (x === null || y === null) return invalid('point requires finite x and y');
    return {
      ...baseOf(primitive, 'point'),
      kind: 'point',
      position: { x, y },
      pointName: stringValue(primitive.metadata?.pointName) ?? undefined,
      free: booleanValue(geometry.free)
        ?? booleanValue(primitive.metadata?.free)
        ?? false,
    };
  }

  if (kind === 'segment' || kind === 'vector' || kind === 'line' || kind === 'ray') {
    const points = pointList(geometry.points);
    if (!points || points.length < 2) {
      return invalid(`${kind} requires at least two finite points`);
    }
    return {
      ...baseOf(primitive, kind),
      kind,
      points: [points[0]!, points[points.length - 1]!],
    };
  }

  if (kind === 'polyline' || kind === 'polygon') {
    const points = pointList(geometry.points);
    const minimum = kind === 'polygon' ? 3 : 2;
    if (!points || points.length < minimum) {
      return invalid(`${kind} requires at least ${minimum} finite points`);
    }
    return {
      ...baseOf(primitive, kind),
      kind,
      points,
    };
  }

  if (kind === 'cubic-bezier') {
    const start = pointValue(geometry.start);
    const control1 = pointValue(geometry.control1);
    const control2 = pointValue(geometry.control2);
    const end = pointValue(geometry.end);
    if (!start || !control1 || !control2 || !end) {
      return invalid('cubic-bezier requires finite start, control1, control2 and end points');
    }
    return {
      ...baseOf(primitive, 'cubic-bezier'),
      kind: 'cubic-bezier',
      start,
      control1,
      control2,
      end,
    };
  }

  if (kind === 'circular-arc') {
    const center = pointValue(geometry.center);
    const radius = finiteNumber(geometry.radius);
    const startAngleDeg = finiteNumber(geometry.startAngleDeg);
    const endAngleDeg = finiteNumber(geometry.endAngleDeg);
    const start = pointValue(geometry.start);
    const end = pointValue(geometry.end);
    if (!center || radius === null || radius <= 0 || startAngleDeg === null || endAngleDeg === null || !start || !end) {
      return invalid('circular-arc requires finite center, angles, endpoints and positive radius');
    }
    return {
      ...baseOf(primitive, 'circular-arc'), kind: 'circular-arc',
      center, radius, startAngleDeg, endAngleDeg, start, end,
    };
  }

  if (kind === 'elliptical-arc') {
    const center = pointValue(geometry.center);
    const axisX = pointValue(geometry.axisX);
    const axisY = pointValue(geometry.axisY);
    const xRadius = finiteNumber(geometry.xRadius);
    const yRadius = finiteNumber(geometry.yRadius);
    const rotationDegrees = finiteNumber(geometry.rotationDegrees);
    const startAngleDeg = finiteNumber(geometry.startAngleDeg);
    const endAngleDeg = finiteNumber(geometry.endAngleDeg);
    const start = pointValue(geometry.start);
    const end = pointValue(geometry.end);
    const determinant = axisX && axisY
      ? axisX.x * axisY.y - axisX.y * axisY.x
      : 0;
    if (
      !center || !axisX || !axisY || !start || !end
      || xRadius === null || xRadius <= 0
      || yRadius === null || yRadius <= 0
      || rotationDegrees === null
      || startAngleDeg === null || endAngleDeg === null
      || !Number.isFinite(determinant) || Math.abs(determinant) < 1e-12
    ) {
      return invalid('elliptical-arc requires finite invertible axes, angles, endpoints and positive radii');
    }
    return {
      ...baseOf(primitive, 'elliptical-arc'),
      kind: 'elliptical-arc',
      center,
      axisX,
      axisY,
      xRadius,
      yRadius,
      rotationDegrees,
      startAngleDeg,
      endAngleDeg,
      start,
      end,
    };
  }

  if (kind === 'circle') {
    const center = pointValue(geometry.center);
    const radius = finiteNumber(geometry.radius);
    if (!center || radius === null || radius <= 0) {
      return invalid('circle requires a finite center and positive radius');
    }
    return {
      ...baseOf(primitive, 'circle'),
      kind: 'circle',
      center,
      radius,
      circleDefinition: circleDefinitionValue(geometry.circleDefinition)
        ?? undefined,
    };
  }

  if (kind === 'graph-node') {
    const center = pointValue(geometry.center);
    const radius = finiteNumber(geometry.radius);
    const text = stringValue(geometry.text);
    const outlined = booleanValue(geometry.outlined);
    if (!center || radius === null || radius <= 0 || text === null || outlined === null) {
      return invalid('graph-node requires a finite center, positive radius, text and outlined flag');
    }
    return {
      ...baseOf(primitive, 'graph-node'),
      kind: 'graph-node',
      center,
      radius,
      text,
      outlined,
    };
  }

  if (kind === 'ellipse') {
    const center = pointValue(geometry.center);
    const xRadius = finiteNumber(geometry.xRadius);
    const yRadius = finiteNumber(geometry.yRadius);
    const rotationDegrees = geometry.rotationDegrees === undefined
      ? 0
      : finiteNumber(geometry.rotationDegrees);
    if (
      !center
      || xRadius === null || xRadius <= 0
      || yRadius === null || yRadius <= 0
      || rotationDegrees === null
    ) {
      return invalid('ellipse requires a finite center, rotation, and positive x/y radii');
    }
    return {
      ...baseOf(primitive, 'ellipse'),
      kind: 'ellipse',
      center,
      xRadius,
      yRadius,
      rotationDegrees,
    };
  }

  if (kind === 'label') {
    const at = pointValue(geometry.at);
    const text = stringValue(geometry.text);
    if (!at || text === null) {
      return invalid('label requires a finite position and text');
    }
    return {
      ...baseOf(primitive, 'label'),
      kind: 'label',
      at,
      text,
      anchor: stringValue(geometry.anchor) ?? undefined,
    };
  }

  if (
    kind === 'angle'
    || kind === 'right-angle'
    || kind === 'angle-mark'
    || kind === 'right-angle-mark'
  ) {
    const vertex = pointValue(geometry.vertex);
    const from = pointValue(geometry.from);
    const to = pointValue(geometry.to);
    if (!vertex || !from || !to) {
      return invalid(`${kind} requires finite vertex, from and to points`);
    }
    const semanticKind = kind === 'right-angle' || kind === 'right-angle-mark'
      ? 'right-angle'
      : 'angle';
    return {
      ...baseOf(primitive, semanticKind),
      kind: semanticKind,
      vertex,
      from,
      to,
    };
  }

  return {
    primitiveId: primitive.id,
    code: 'unsupported-kind',
    message: `interactive renderer does not support ${kind}`,
  };
}

export function decodeRenderPrimitives(
  primitives: readonly RenderPrimitive[],
): DecodedRenderPrimitiveSet {
  const decoded: DecodedRenderPrimitive[] = [];
  const issues: RenderPrimitiveDecodeIssue[] = [];
  for (const primitive of primitives) {
    const result = decodePrimitive(primitive);
    if ('code' in result) {
      issues.push(result);
    } else {
      decoded.push(result);
    }
  }
  return {
    primitives: decoded.sort((left, right) => left.zIndex - right.zIndex),
    issues,
  };
}

/**
 * Returns semantic definition points for auto-fit. Infinite line/ray primitives
 * prefer their named defining point handles, so neither expanded TikZ helper
 * endpoints nor viewport-clipped endpoints can feed back into the viewport.
 */
export function decodedRenderPrimitiveFitPoints(
  decoded: readonly DecodedRenderPrimitive[],
): readonly Pt[] {
  const namedPoints = new Map<string, Pt>();
  for (const primitive of decoded) {
    if (primitive.kind === 'point' && primitive.pointName) {
      namedPoints.set(primitive.pointName, primitive.position);
    }
  }

  const points: Pt[] = [];
  for (const primitive of decoded) {
    switch (primitive.kind) {
      case 'point':
        points.push(primitive.position);
        break;
      case 'line':
      case 'ray': {
        const definitions = primitive.references.flatMap((reference) => {
          const point = namedPoints.get(reference);
          return point ? [point] : [];
        });
        points.push(...(definitions.length >= 2 ? definitions : primitive.points));
        break;
      }
      case 'segment':
      case 'vector':
      case 'polyline':
      case 'polygon':
        points.push(...primitive.points);
        break;
      case 'cubic-bezier':
        // Control points safely over-approximate the analytical curve bounds.
        points.push(primitive.start, primitive.control1, primitive.control2, primitive.end);
        break;
      case 'circular-arc':
        points.push(...flattenCircularArc(primitive, 10));
        break;
      case 'elliptical-arc':
        points.push(...flattenEllipticalArc(primitive, 10));
        break;
      case 'circle':
        points.push(
          {
            x: primitive.center.x - primitive.radius,
            y: primitive.center.y,
          },
          {
            x: primitive.center.x + primitive.radius,
            y: primitive.center.y,
          },
          {
            x: primitive.center.x,
            y: primitive.center.y - primitive.radius,
          },
          {
            x: primitive.center.x,
            y: primitive.center.y + primitive.radius,
          },
        );
        break;
      case 'graph-node':
        points.push(
          { x: primitive.center.x - primitive.radius, y: primitive.center.y },
          { x: primitive.center.x + primitive.radius, y: primitive.center.y },
          { x: primitive.center.x, y: primitive.center.y - primitive.radius },
          { x: primitive.center.x, y: primitive.center.y + primitive.radius },
        );
        break;
      case 'ellipse':
        points.push(...flattenEllipse(primitive, 48));
        break;
      case 'label':
        points.push(...labelSceneFitPoints(
          primitive.at,
          primitive.text,
          primitive.anchor ?? '',
        ));
        break;
      case 'angle':
      case 'right-angle':
        points.push(primitive.vertex, primitive.from, primitive.to);
        break;
    }
  }
  return points;
}

export function renderPrimitiveFitPoints(
  primitives: readonly RenderPrimitive[],
): readonly Pt[] {
  return decodedRenderPrimitiveFitPoints(
    decodeRenderPrimitives(primitives).primitives,
  );
}
