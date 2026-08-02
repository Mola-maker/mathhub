import type {
  JsonObject,
  JsonValue,
  RenderPrimitive,
  SourceRange,
} from '../ir/model';
import type { Pt } from '../semantics/calc-eval';
import type { PersistentSourceCircleDefinition } from '../ir/persistent-entity-reference';

export type RenderArrow = 'none' | '->' | '<-' | '<->';

export interface DecodedRenderStyle {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly dash?: string;
  readonly arrow: RenderArrow;
  readonly fill?: string;
  readonly fillOpacity: number;
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
    readonly kind: 'circle';
    readonly center: Pt;
    readonly radius: number;
    readonly circleDefinition?: PersistentSourceCircleDefinition;
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
  const opacity = finiteNumber(style.opacity);
  return {
    stroke: stringValue(style.stroke) ?? '#1d1d1f',
    strokeWidth: strokeWidth !== null && strokeWidth > 0 ? strokeWidth : 1.25,
    dash: stringValue(style.dash) ?? undefined,
    arrow: arrowValue(style.arrow) ?? semanticArrow,
    fill: stringValue(style.fill) ?? undefined,
    fillOpacity: fillOpacity === null
      ? 1
      : Math.min(1, Math.max(0, fillOpacity)),
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
      case 'label':
        points.push(primitive.at);
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
