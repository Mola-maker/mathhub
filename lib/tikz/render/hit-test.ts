import type { Pt } from '../semantics/calc-eval';
import type { Scene } from '../semantics/scene';
import { sceneToScreen, type Viewport } from './viewport';

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

export function hitTestPointHandle(
  screen: Pt,
  scene: Scene,
  viewport: Viewport,
  radiusPx = 10,
): string | null {
  let best: string | null = null;
  let bestDistance = radiusPx;
  for (const point of scene.points.values()) {
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
): { stmtIndex: number; refs: string[] } | null {
  let best: { stmtIndex: number; refs: string[] } | null = null;
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
    } else if (element.kind === 'circle') {
      const center = sceneToScreen(element.center, viewport);
      currentDistance = Math.abs(distance(screen, center) - element.radius * viewport.scale);
    } else if (element.kind === 'label') {
      const at = sceneToScreen(element.at, viewport);
      const width = Math.max(10, element.text.replace(/\$/g, '').length * 8);
      currentDistance = distanceToSegment(
        screen,
        { x: at.x - width / 2, y: at.y },
        { x: at.x + width / 2, y: at.y },
      );
    } else {
      currentDistance = Math.abs(
        distance(screen, sceneToScreen(element.vertex, viewport)) - 16,
      );
    }

    if (currentDistance <= bestDistance) {
      bestDistance = currentDistance;
      best = { stmtIndex: element.stmtIndex, refs: element.refs };
    }
  }
  return best;
}

