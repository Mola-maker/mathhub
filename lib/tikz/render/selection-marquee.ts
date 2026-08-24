import type { Pt } from '../semantics/calc-eval';
import { flattenCubicBezier } from '../geometry/cubic-bezier';
import { flattenCircularArc } from '../geometry/circular-arc';
import { flattenEllipticalArc } from '../geometry/elliptical-arc';
import { flattenEllipse } from '../geometry/ellipse';
import { clipParametricLineToFrame, type ScreenFrame } from './line-clip';
import type { DecodedRenderPrimitive } from './render-primitive-decoder';
import { sceneToScreen, type Viewport } from './viewport';

export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type MarqueeSelectionMode = 'contain' | 'intersect';

export function normalizedScreenRect(first: Pt, second: Pt): ScreenRect {
  return {
    left: Math.min(first.x, second.x),
    top: Math.min(first.y, second.y),
    right: Math.max(first.x, second.x),
    bottom: Math.max(first.y, second.y),
  };
}

export function screenPointsBounds(points: readonly Pt[]): ScreenRect | null {
  if (points.length === 0) return null;
  return points.reduce<ScreenRect>((bounds, point) => ({
    left: Math.min(bounds.left, point.x),
    top: Math.min(bounds.top, point.y),
    right: Math.max(bounds.right, point.x),
    bottom: Math.max(bounds.bottom, point.y),
  }), {
    left: points[0]!.x,
    top: points[0]!.y,
    right: points[0]!.x,
    bottom: points[0]!.y,
  });
}

export function renderPrimitiveScreenPoints(
  primitive: DecodedRenderPrimitive,
  viewport: Viewport,
  frame: ScreenFrame,
  extent: 'visual' | 'definition' = 'visual',
): readonly Pt[] {
  if (primitive.kind === 'point') return [sceneToScreen(primitive.position, viewport)];
  if (primitive.kind === 'line' || primitive.kind === 'ray') {
    if (extent === 'definition') {
      return primitive.points.map((point) => sceneToScreen(point, viewport));
    }
    const clipped = clipParametricLineToFrame(
      sceneToScreen(primitive.points[0], viewport),
      sceneToScreen(primitive.points[1], viewport),
      frame,
      primitive.kind,
      primitive.kind === 'ray' ? 0 : 16,
    );
    return clipped ?? [];
  }
  if (
    primitive.kind === 'segment'
    || primitive.kind === 'vector'
    || primitive.kind === 'polyline'
    || primitive.kind === 'polygon'
  ) return primitive.points.map((point) => sceneToScreen(point, viewport));
  if (primitive.kind === 'cubic-bezier') {
    return flattenCubicBezier({
      start: sceneToScreen(primitive.start, viewport),
      control1: sceneToScreen(primitive.control1, viewport),
      control2: sceneToScreen(primitive.control2, viewport),
      end: sceneToScreen(primitive.end, viewport),
    }, 0.75);
  }
  if (primitive.kind === 'circular-arc') {
    return flattenCircularArc(primitive, 3)
      .map((point) => sceneToScreen(point, viewport));
  }
  if (primitive.kind === 'elliptical-arc') {
    return flattenEllipticalArc(primitive, 3)
      .map((point) => sceneToScreen(point, viewport));
  }
  if (primitive.kind === 'circle') {
    const center = sceneToScreen(primitive.center, viewport);
    const radius = primitive.radius * viewport.scale;
    return [
      { x: center.x - radius, y: center.y },
      { x: center.x + radius, y: center.y },
      { x: center.x, y: center.y - radius },
      { x: center.x, y: center.y + radius },
    ];
  }
  if (primitive.kind === 'graph-node') {
    const center = sceneToScreen(primitive.center, viewport);
    const radius = primitive.radius * viewport.scale;
    return [
      { x: center.x - radius, y: center.y },
      { x: center.x + radius, y: center.y },
      { x: center.x, y: center.y - radius },
      { x: center.x, y: center.y + radius },
    ];
  }
  if (primitive.kind === 'ellipse') {
    return flattenEllipse(primitive, 48)
      .map((point) => sceneToScreen(point, viewport));
  }
  if (primitive.kind === 'label') return [sceneToScreen(primitive.at, viewport)];
  if (primitive.kind === 'angle' || primitive.kind === 'right-angle') {
    return [primitive.vertex, primitive.from, primitive.to]
      .map((point) => sceneToScreen(point, viewport));
  }
  return [];
}

function intersects(first: ScreenRect, second: ScreenRect): boolean {
  return first.left <= second.right
    && first.right >= second.left
    && first.top <= second.bottom
    && first.bottom >= second.top;
}

function contains(outer: ScreenRect, inner: ScreenRect): boolean {
  return outer.left <= inner.left
    && outer.right >= inner.right
    && outer.top <= inner.top
    && outer.bottom >= inner.bottom;
}

/**
 * Window selection uses the same decoded RenderingTruth consumed by hit-test.
 * It returns semantic primitives only; callers remain responsible for turning
 * those immutable hits into revision-bound SelectionTargets.
 */
export function renderPrimitivesInScreenRect(
  primitives: readonly DecodedRenderPrimitive[],
  rect: ScreenRect,
  viewport: Viewport,
  frame: ScreenFrame,
  mode: MarqueeSelectionMode = 'intersect',
): readonly DecodedRenderPrimitive[] {
  return primitives.filter((primitive) => {
    if (!primitive.interactive || primitive.entityIds.length === 0) return false;
    const bounds = screenPointsBounds(renderPrimitiveScreenPoints(primitive, viewport, frame));
    return bounds
      ? mode === 'contain' ? contains(rect, bounds) : intersects(rect, bounds)
      : false;
  });
}

/**
 * Bounds used by group-transform handles. Infinite paths deliberately use
 * their defining points so the transform center is stable across pan/zoom.
 */
export function renderPrimitivesScreenBounds(
  primitives: readonly DecodedRenderPrimitive[],
  viewport: Viewport,
  frame: ScreenFrame,
): ScreenRect | null {
  return screenPointsBounds(primitives.flatMap((primitive) => (
    renderPrimitiveScreenPoints(primitive, viewport, frame, 'definition')
  )));
}
