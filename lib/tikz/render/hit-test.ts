import type { Pt } from '../semantics/calc-eval';
import { flattenCubicBezier } from '../geometry/cubic-bezier';
import { flattenCircularArc } from '../geometry/circular-arc';
import { flattenEllipticalArc } from '../geometry/elliptical-arc';
import { flattenEllipse } from '../geometry/ellipse';
import type { Scene, SceneElement } from '../semantics/scene';
import { labelScreenBounds, type ScreenBounds } from './label-layout';
import {
  angleMarkGeometry,
  DEFAULT_ANGLE_MARK_RADIUS,
} from './svg-decoration-primitives';
import { sceneToScreen, tikzPresentationScale, type Viewport } from './viewport';

const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function distanceToSegment(point: Pt, start: Pt, end: Pt): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return distance(point, start);
  const ratio = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return distance(point, {
    x: start.x + ratio * dx,
    y: start.y + ratio * dy,
  });
}

function distanceToBounds(point: Pt, bounds: ScreenBounds): number {
  const dx = Math.max(bounds.left - point.x, 0, point.x - bounds.right);
  const dy = Math.max(bounds.top - point.y, 0, point.y - bounds.bottom);
  return Math.hypot(dx, dy);
}

export interface ElementHit {
  stableId: string;
  stmtIndex: number;
  refs: string[];
  kind: SceneElement['kind'];
  element: SceneElement;
  distance: number;
}

export function hitTestPointHandle(
  screen: Pt,
  scene: Scene,
  viewport: Viewport,
  radiusPx = 10,
): string | null {
  let best: string | null = null;
  let bestDistance = radiusPx;
  for (const point of scene.points.values()) {
    if (point.internal) continue;
    const currentDistance = distance(screen, sceneToScreen(point.position, viewport));
    if (currentDistance <= bestDistance) {
      bestDistance = currentDistance;
      best = point.name;
    }
  }
  return best;
}

export function hitTestElement(
  screen: Pt,
  scene: Scene,
  viewport: Viewport,
  tolerancePx = 6,
): ElementHit | null {
  let best: ElementHit | null = null;
  let bestDistance = tolerancePx;

  for (const element of scene.elements) {
    let currentDistance = Number.POSITIVE_INFINITY;
    if (element.kind === 'polyline') {
      const points = element.points.map((point) => sceneToScreen(point, viewport));
      const segments = element.cycle
        ? points.map((point, index) => [point, points[(index + 1) % points.length]] as const)
        : points.slice(0, -1).map((point, index) => [point, points[index + 1]] as const);
      for (const [start, end] of segments) {
        currentDistance = Math.min(currentDistance, distanceToSegment(screen, start, end));
      }
    } else if (element.kind === 'cubic-bezier') {
      const curve = {
        start: sceneToScreen(element.start, viewport),
        control1: sceneToScreen(element.control1, viewport),
        control2: sceneToScreen(element.control2, viewport),
        end: sceneToScreen(element.end, viewport),
      };
      const points = flattenCubicBezier(curve, 0.75);
      for (let index = 1; index < points.length; index += 1) {
        currentDistance = Math.min(currentDistance, distanceToSegment(screen, points[index - 1]!, points[index]!));
      }
    } else if (element.kind === 'circular-arc') {
      const points = flattenCircularArc(element, 3)
        .map((point) => sceneToScreen(point, viewport));
      for (let index = 1; index < points.length; index += 1) {
        currentDistance = Math.min(currentDistance, distanceToSegment(screen, points[index - 1]!, points[index]!));
      }
    } else if (element.kind === 'elliptical-arc') {
      const points = flattenEllipticalArc(element, 3)
        .map((point) => sceneToScreen(point, viewport));
      for (let index = 1; index < points.length; index += 1) {
        currentDistance = Math.min(currentDistance, distanceToSegment(screen, points[index - 1]!, points[index]!));
      }
    } else if (element.kind === 'circle') {
      const center = sceneToScreen(element.center, viewport);
      currentDistance = Math.abs(distance(screen, center) - element.radius * viewport.scale);
    } else if (element.kind === 'graph-node') {
      const center = sceneToScreen(element.center, viewport);
      currentDistance = Math.max(0, distance(screen, center) - element.radius * viewport.scale);
    } else if (element.kind === 'ellipse') {
      const points = flattenEllipse(element, 96)
        .map((point) => sceneToScreen(point, viewport));
      for (let index = 1; index < points.length; index += 1) {
        currentDistance = Math.min(
          currentDistance,
          distanceToSegment(screen, points[index - 1]!, points[index]!),
        );
      }
    } else if (element.kind === 'label') {
      const at = sceneToScreen(element.at, viewport);
      currentDistance = distanceToBounds(
        screen,
        labelScreenBounds(
          at,
          element.text,
          element.anchor,
          tikzPresentationScale(viewport),
        ),
      );
    } else {
      const geometry = angleMarkGeometry({
        vertex: sceneToScreen(element.vertex, viewport),
        from: sceneToScreen(element.from, viewport),
        to: sceneToScreen(element.to, viewport),
        right: element.right,
        radius: DEFAULT_ANGLE_MARK_RADIUS * tikzPresentationScale(viewport),
      });
      if (geometry) {
        for (let index = 1; index < geometry.points.length; index += 1) {
          currentDistance = Math.min(
            currentDistance,
            distanceToSegment(
              screen,
              geometry.points[index - 1]!,
              geometry.points[index]!,
            ),
          );
        }
      }
    }

    if (currentDistance <= bestDistance) {
      bestDistance = currentDistance;
      best = {
        stableId: element.stableId,
        stmtIndex: element.stmtIndex,
        refs: element.refs,
        kind: element.kind,
        element,
        distance: currentDistance,
      };
    }
  }
  return best;
}
