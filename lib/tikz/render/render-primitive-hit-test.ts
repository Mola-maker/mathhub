import type { SourceRange } from '../ir/model';
import type { Pt } from '../semantics/calc-eval';
import { clipParametricLineToFrame, type ScreenFrame } from './line-clip';
import { labelScreenBounds } from './label-layout';
import type {
  DecodedRenderPrimitive,
  DecodedRenderPrimitiveSet,
} from './render-primitive-decoder';
import {
  angleMarkGeometry,
  DEFAULT_ANGLE_MARK_RADIUS,
} from './svg-decoration-primitives';
import { sceneToScreen, type Viewport } from './viewport';

export interface RenderPrimitiveHit {
  readonly primitiveId: string;
  readonly entityId: string;
  readonly entityIds: readonly string[];
  readonly sourceStableId?: string;
  readonly sourceBindingIds: readonly string[];
  readonly sourceRange?: SourceRange;
  readonly statementIndex: number;
  readonly kind: DecodedRenderPrimitive['kind'];
  readonly references: readonly string[];
  readonly distance: number;
  readonly zIndex: number;
}

function distance(first: Pt, second: Pt): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function distanceToSegment(point: Pt, start: Pt, end: Pt): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return distance(point, start);
  const projection = Math.max(0, Math.min(1, (
    ((point.x - start.x) * dx + (point.y - start.y) * dy)
    / lengthSquared
  )));
  return distance(point, {
    x: start.x + projection * dx,
    y: start.y + projection * dy,
  });
}

function distanceToBounds(
  point: Pt,
  bounds: { left: number; top: number; right: number; bottom: number },
): number {
  const dx = Math.max(bounds.left - point.x, 0, point.x - bounds.right);
  const dy = Math.max(bounds.top - point.y, 0, point.y - bounds.bottom);
  return Math.hypot(dx, dy);
}

function pathDistance(
  screen: Pt,
  primitive: Extract<
    DecodedRenderPrimitive,
    {
      kind:
        | 'segment'
        | 'vector'
        | 'line'
        | 'ray'
        | 'polyline'
        | 'polygon';
    }
  >,
  viewport: Viewport,
  frame: ScreenFrame,
): number {
  let points: readonly Pt[];
  if (primitive.kind === 'line' || primitive.kind === 'ray') {
    const first = sceneToScreen(primitive.points[0], viewport);
    const second = sceneToScreen(primitive.points[1], viewport);
    const clipped = clipParametricLineToFrame(
      first,
      second,
      frame,
      primitive.kind,
      primitive.kind === 'ray' ? 0 : 16,
    );
    if (!clipped) return Number.POSITIVE_INFINITY;
    points = clipped;
  } else {
    points = primitive.points.map((point) => sceneToScreen(point, viewport));
  }

  let closest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    closest = Math.min(
      closest,
      distanceToSegment(screen, points[index - 1]!, points[index]!),
    );
  }
  if (primitive.kind === 'polygon' && points.length >= 3) {
    closest = Math.min(
      closest,
      distanceToSegment(screen, points[points.length - 1]!, points[0]!),
    );
  }
  return closest;
}

function primitiveDistance(
  screen: Pt,
  primitive: Exclude<DecodedRenderPrimitive, { kind: 'point' }>,
  viewport: Viewport,
  frame: ScreenFrame,
): number {
  if (
    primitive.kind === 'segment'
    || primitive.kind === 'vector'
    || primitive.kind === 'line'
    || primitive.kind === 'ray'
    || primitive.kind === 'polyline'
    || primitive.kind === 'polygon'
  ) {
    return pathDistance(screen, primitive, viewport, frame);
  }
  if (primitive.kind === 'circle') {
    const center = sceneToScreen(primitive.center, viewport);
    return Math.abs(
      distance(screen, center) - primitive.radius * viewport.scale,
    );
  }
  if (primitive.kind === 'label') {
    const at = sceneToScreen(primitive.at, viewport);
    return distanceToBounds(
      screen,
      labelScreenBounds(at, primitive.text, primitive.anchor ?? ''),
    );
  }
  const vertex = sceneToScreen(primitive.vertex, viewport);
  const from = sceneToScreen(primitive.from, viewport);
  const to = sceneToScreen(primitive.to, viewport);
  const angleGeometry = angleMarkGeometry({
    vertex,
    from,
    to,
    right: primitive.kind === 'right-angle',
    radius: DEFAULT_ANGLE_MARK_RADIUS,
  });
  if (!angleGeometry) return Number.POSITIVE_INFINITY;
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < angleGeometry.points.length; index += 1) {
    closest = Math.min(
      closest,
      distanceToSegment(
        screen,
        angleGeometry.points[index - 1]!,
        angleGeometry.points[index]!,
      ),
    );
  }
  return closest;
}

export function hitTestRenderPrimitives(
  screen: Pt,
  rendering: DecodedRenderPrimitiveSet,
  viewport: Viewport,
  frame: ScreenFrame,
  tolerance = 8,
): RenderPrimitiveHit | null {
  let best: RenderPrimitiveHit | null = null;
  // Decoded primitives are in SVG paint order. Walk backwards so a distance
  // tie at the same z-index selects the later-painted (visually topmost) item.
  for (let index = rendering.primitives.length - 1; index >= 0; index -= 1) {
    const primitive = rendering.primitives[index]!;
    if (
      primitive.kind === 'point'
      || primitive.statementIndex === null
      || primitive.entityIds.length === 0
    ) continue;
    const currentDistance = primitiveDistance(
      screen,
      primitive,
      viewport,
      frame,
    );
    if (!Number.isFinite(currentDistance) || currentDistance > tolerance) {
      continue;
    }
    const candidate: RenderPrimitiveHit = {
      primitiveId: primitive.primitiveId,
      entityId: primitive.entityIds[0]!,
      entityIds: primitive.entityIds,
      sourceStableId: primitive.sourceStableId,
      sourceBindingIds: primitive.sourceBindingIds,
      sourceRange: primitive.sourceRange,
      statementIndex: primitive.statementIndex,
      kind: primitive.kind,
      references: primitive.references,
      distance: currentDistance,
      zIndex: primitive.zIndex,
    };
    if (
      !best
      || candidate.zIndex > best.zIndex
      || (
        candidate.zIndex === best.zIndex
        && candidate.distance < best.distance
      )
    ) {
      best = candidate;
    }
  }
  return best;
}
