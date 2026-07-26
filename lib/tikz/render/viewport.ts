import type { Pt } from '../semantics/calc-eval';

export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const CM_TO_PX = 40;

export function sceneToScreen(p: Pt, vp: Viewport): Pt {
  return {
    x: p.x * vp.scale + vp.offsetX,
    y: -p.y * vp.scale + vp.offsetY,
  };
}

export function screenToScene(p: Pt, vp: Viewport): Pt {
  return {
    x: (p.x - vp.offsetX) / vp.scale,
    y: -(p.y - vp.offsetY) / vp.scale,
  };
}

export function fitViewport(
  points: Pt[],
  width: number,
  height: number,
  padding = 32,
): Viewport {
  if (points.length === 0 || width <= 0 || height <= 0) {
    return {
      scale: CM_TO_PX,
      offsetX: Math.max(width, 1) / 2,
      offsetY: Math.max(height, 1) / 2,
    };
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const boundsWidth = Math.max(maxX - minX, 1e-6);
  const boundsHeight = Math.max(maxY - minY, 1e-6);
  const availableWidth = Math.max(width - 2 * padding, 1);
  const availableHeight = Math.max(height - 2 * padding, 1);
  const scale = Math.min(
    Math.max(Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight), 6),
    240,
  );

  return {
    scale,
    offsetX: width / 2 - ((minX + maxX) / 2) * scale,
    offsetY: height / 2 + ((minY + maxY) / 2) * scale,
  };
}

