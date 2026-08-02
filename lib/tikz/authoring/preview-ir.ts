import type {
  ConstructionEntity,
  ConstructionPlan,
  ConstructionPlanKind,
  ConstructionPoint,
} from './construction-ir';
import type { Pt } from '../semantics/calc-eval';
import {
  evaluateConstructionPlan,
  type ConstructionEvaluationDiagnosticCode,
} from './construction-eval';

/**
 * A renderer-neutral, source-neutral description of a construction preview.
 *
 * Preview IR is deliberately a small projection of ConstructionPlan.  It is
 * produced from the same immutable plan that the commit path serializes, but
 * it never parses TikZ, mutates the document, or allocates persistent ids.
 */
export type PreviewGeometry =
  | {
    readonly kind: 'point';
    readonly id: string;
    readonly point: Pt;
  }
  | {
    readonly kind: 'segment' | 'vector' | 'line' | 'ray';
    readonly id: string;
    readonly from: Pt;
    readonly to: Pt;
    /** Infinite/ray extents are intentionally rendered as a finite segment in phase 1. */
    readonly extent: 'finite' | 'line' | 'ray';
  }
  | {
    readonly kind: 'polyline' | 'polygon';
    readonly id: string;
    readonly points: readonly Pt[];
  }
  | {
    readonly kind: 'rectangle';
    readonly id: string;
    readonly corners: readonly [Pt, Pt, Pt, Pt];
  }
  | {
    readonly kind: 'circle';
    readonly id: string;
    readonly center: Pt;
    readonly radius: number;
  }
  | {
    readonly kind: 'label';
    readonly id: string;
    readonly at: Pt;
    readonly text: string;
  }
  | {
    readonly kind: 'angle' | 'right-angle';
    readonly id: string;
    readonly points: readonly [Pt, Pt, Pt];
  };

export type PreviewDiagnosticCode =
  | 'unsupported-plan-kind'
  | 'unsupported-entity-kind'
  | 'missing-reference'
  | 'non-finite-coordinate'
  | 'zero-direction'
  | 'coincident-points'
  | 'collinear-points'
  | 'invalid-radius'
  | 'point-not-on-circle'
  | 'parallel-lines'
  | 'no-second-intersection'
  | 'invalid-geometry'
  | 'finite-extent-fallback';

const previewDiagnosticCode = (
  code: ConstructionEvaluationDiagnosticCode,
): PreviewDiagnosticCode => code;

const EVALUATED_DERIVED_PLAN_KINDS: ReadonlySet<ConstructionPlanKind> = new Set([
  'midpoint',
  'perpendicular-foot',
  'parallel-line',
  'perpendicular-line',
  'perpendicular-bisector',
  'angle-bisector',
  'circumcircle',
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

export interface PreviewDiagnostic {
  readonly code: PreviewDiagnosticCode;
  readonly severity: 'warning' | 'error';
  readonly path: string;
  readonly message: string;
}

export interface ConstructionPreviewIR {
  readonly planId: string;
  readonly planKind: ConstructionPlanKind;
  readonly geometries: readonly PreviewGeometry[];
  readonly diagnostics: readonly PreviewDiagnostic[];
  readonly status: 'valid' | 'invalid' | 'unsupported';
}

function toPoint(value: ConstructionPoint): Pt {
  return Array.isArray(value)
    ? { x: value[0], y: value[1] }
    : { x: value.x, y: value.y };
}

function finitePoint(value: Pt): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function samePoint(first: Pt, second: Pt): boolean {
  return first.x === second.x && first.y === second.y;
}

function distance(first: Pt, second: Pt): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function entityForPlan(plan: ConstructionPlan): ConstructionEntity | null {
  return plan.entities[0] ?? null;
}

function freezePoint(point: Pt): Pt {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezeGeometry(geometry: PreviewGeometry): PreviewGeometry {
  switch (geometry.kind) {
    case 'point':
      return Object.freeze({ ...geometry, point: freezePoint(geometry.point) });
    case 'segment':
    case 'vector':
    case 'line':
    case 'ray':
      return Object.freeze({
        ...geometry,
        from: freezePoint(geometry.from),
        to: freezePoint(geometry.to),
      });
    case 'polyline':
    case 'polygon':
      return Object.freeze({
        ...geometry,
        points: Object.freeze(geometry.points.map(freezePoint)),
      });
    case 'rectangle':
      return Object.freeze({
        ...geometry,
        corners: Object.freeze(geometry.corners.map(freezePoint) as [Pt, Pt, Pt, Pt]),
      });
    case 'circle':
      return Object.freeze({ ...geometry, center: freezePoint(geometry.center) });
    case 'label':
      return Object.freeze({ ...geometry, at: freezePoint(geometry.at) });
    case 'angle':
    case 'right-angle':
      return Object.freeze({
        ...geometry,
        points: Object.freeze(geometry.points.map(freezePoint) as [Pt, Pt, Pt]),
      });
  }
}

/**
 * Build an immutable Preview IR from a construction plan and evaluated point
 * references.  Derived plans intentionally fail closed: a preview must never
 * invent geometry that the constraint solver has not produced yet.
 */
export function createConstructionPreviewIR(
  plan: ConstructionPlan,
  points: ReadonlyMap<string, Pt>,
): ConstructionPreviewIR {
  const geometries: PreviewGeometry[] = [];
  const diagnostics: PreviewDiagnostic[] = [];
  const pathOf = (path: string): void => {
    diagnostics.push({
      code: 'missing-reference',
      severity: 'error',
      path,
      message: `预览缺少几何引用：${path}`,
    });
  };
  const pointOf = (ref: string, path: string): Pt | null => {
    const value = points.get(ref);
    if (!value) {
      pathOf(path);
      return null;
    }
    const point = { x: value.x, y: value.y };
    if (!finitePoint(point)) {
      diagnostics.push({
        code: 'invalid-geometry',
        severity: 'error',
        path,
        message: `预览点坐标不是有限数值：${ref}`,
      });
      return null;
    }
    return point;
  };
  const addSegment = (
    entityId: string,
    kind: 'segment' | 'vector' | 'line' | 'ray',
    from: Pt | null,
    to: Pt | null,
  ): void => {
    if (!from || !to) return;
    if (samePoint(from, to)) {
      diagnostics.push({
        code: 'invalid-geometry',
        severity: 'error',
        path: `entities.${entityId}`,
        message: '预览线段的两个端点必须不同',
      });
      return;
    }
    const extent = kind === 'line' || kind === 'ray' ? kind : 'finite';
    if (extent !== 'finite') {
      diagnostics.push({
        code: 'finite-extent-fallback',
        severity: 'warning',
        path: `entities.${entityId}`,
        message: `${kind} 预览暂以定义点之间的有限线段显示`,
      });
    }
    geometries.push({ kind, id: entityId, from, to, extent });
  };

  if (plan.kind === 'primitive') {
    const primitive = plan.primitive;
    const entity = entityForPlan(plan);
    const entityId = entity?.id ?? `preview-${plan.id}`;
    switch (primitive.kind) {
      case 'point': {
        const point = points.get(primitive.name) ?? toPoint(primitive.position);
        if (!finitePoint(point)) {
          diagnostics.push({
            code: 'invalid-geometry',
            severity: 'error',
            path: 'primitive.position',
            message: '预览点坐标不是有限数值',
          });
          break;
        }
        geometries.push({ kind: 'point', id: entityId, point: { ...point } });
        break;
      }
      case 'segment':
      case 'vector':
      case 'line':
      case 'ray':
        addSegment(
          entityId,
          primitive.kind,
          pointOf(primitive.from, 'primitive.from'),
          pointOf(primitive.to, 'primitive.to'),
        );
        break;
      case 'polyline':
      case 'polygon': {
        const values = primitive.vertices.map((ref, index) => (
          pointOf(ref, `primitive.vertices[${index}]`)
        ));
        if (values.some((value): value is null => value === null)) break;
        geometries.push({
          kind: primitive.kind,
          id: entityId,
          points: values as Pt[],
        });
        break;
      }
      case 'rectangle': {
        const first = pointOf(primitive.corners[0], 'primitive.corners[0]');
        const opposite = pointOf(primitive.corners[1], 'primitive.corners[1]');
        if (!first || !opposite) break;
        if (samePoint(first, opposite)) {
          diagnostics.push({
            code: 'invalid-geometry',
            severity: 'error',
            path: 'primitive.corners',
            message: '预览矩形的对角点必须不同',
          });
          break;
        }
        geometries.push({
          kind: 'rectangle',
          id: entityId,
          corners: [
            first,
            { x: first.x, y: opposite.y },
            opposite,
            { x: opposite.x, y: first.y },
          ],
        });
        break;
      }
      case 'circle': {
        const center = pointOf(primitive.center, 'primitive.center');
        const through = pointOf(primitive.through, 'primitive.through');
        if (!center || !through) break;
        const radius = distance(center, through);
        if (!Number.isFinite(radius) || radius <= 1e-8) {
          diagnostics.push({
            code: 'invalid-geometry',
            severity: 'error',
            path: 'primitive.through',
            message: '预览圆的半径必须为正数',
          });
          break;
        }
        geometries.push({ kind: 'circle', id: entityId, center, radius });
        break;
      }
      case 'label': {
        const at = pointOf(primitive.at, 'primitive.at');
        if (!at) break;
        geometries.push({ kind: 'label', id: entityId, at, text: primitive.text });
        break;
      }
      case 'angle':
      case 'right-angle': {
        const values = primitive.points.map((ref, index) => (
          pointOf(ref, `primitive.points[${index}]`)
        ));
        if (values.some((value): value is null => value === null)) break;
        const [first, vertex, second] = values as [Pt, Pt, Pt];
        if (samePoint(first, vertex) || samePoint(vertex, second)) {
          diagnostics.push({
            code: 'invalid-geometry',
            severity: 'error',
            path: 'primitive.points',
            message: '角度的顶点必须与两侧点不同',
          });
          break;
        }
        geometries.push({
          kind: primitive.kind,
          id: entityId,
          points: [first, vertex, second],
        });
        break;
      }
    }
  } else if (plan.kind === 'rectangle-by-opposite-corners') {
    const first = pointOf(plan.first, 'first');
    const opposite = pointOf(plan.opposite, 'opposite');
    if (first && opposite && !samePoint(first, opposite)) {
      geometries.push({
        kind: 'rectangle',
        id: `preview-${plan.id}`,
        corners: [
          first,
          { x: first.x, y: opposite.y },
          opposite,
          { x: opposite.x, y: first.y },
        ],
      });
    } else if (first && opposite) {
      diagnostics.push({
        code: 'invalid-geometry',
        severity: 'error',
        path: 'plan.corners',
        message: '预览矩形的对角点必须不同',
      });
    }
  } else if (EVALUATED_DERIVED_PLAN_KINDS.has(plan.kind)) {
    const evaluation = evaluateConstructionPlan(plan, points);
    for (const geometry of evaluation.geometries) {
      switch (geometry.kind) {
        case 'point':
          geometries.push({
            kind: 'point',
            id: geometry.id,
            point: { ...geometry.point },
          });
          break;
        case 'segment':
          geometries.push({
            kind: 'segment',
            id: geometry.id,
            from: { ...geometry.from },
            to: { ...geometry.to },
            extent: geometry.extent,
          });
          break;
        case 'line':
          geometries.push({
            kind: 'line',
            id: geometry.id,
            from: { ...geometry.from },
            to: { ...geometry.to },
            extent: geometry.extent,
          });
          break;
        case 'circle':
          geometries.push({
            kind: 'circle',
            id: geometry.id,
            center: { ...geometry.center },
            radius: geometry.radius,
          });
          break;
        case 'polygon':
          geometries.push({
            kind: 'polygon',
            id: geometry.id,
            points: geometry.points.map((point) => ({ ...point })),
          });
          break;
      }
    }
    diagnostics.push(...evaluation.diagnostics.map((diagnostic) => ({
      code: previewDiagnosticCode(diagnostic.code),
      severity: diagnostic.severity,
      path: diagnostic.path,
      message: diagnostic.message,
    })));
  } else {
    diagnostics.push({
      code: 'unsupported-plan-kind',
      severity: 'error',
      path: 'plan.kind',
      message: `预览暂不展开派生构造：${plan.kind}`,
    });
  }

  const hasError = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const unsupported = diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-plan-kind');
  return Object.freeze({
    planId: plan.id,
    planKind: plan.kind,
    geometries: Object.freeze(geometries.map(freezeGeometry)),
    diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic }))),
    status: unsupported ? 'unsupported' : hasError ? 'invalid' : 'valid',
  });
}
