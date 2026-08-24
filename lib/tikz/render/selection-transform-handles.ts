import type { SelectionTransform } from '../authoring/selection-transform';
import type { Pt } from '../semantics/calc-eval';
import type { ScreenRect } from './selection-marquee';

export type SelectionTransformHandle =
  | 'move'
  | 'rotate'
  | 'scale-nw'
  | 'scale-ne'
  | 'scale-se'
  | 'scale-sw';

export interface SelectionTransformGesture {
  readonly pointerId: number;
  readonly handle: SelectionTransformHandle;
  readonly revision: number;
  readonly bounds: ScreenRect;
  readonly start: Pt;
  readonly current: Pt;
}

export interface SelectionTransformHandleLayout {
  readonly bounds: ScreenRect;
  readonly center: Pt;
  readonly rotation: Pt;
  readonly corners: Readonly<Record<'nw' | 'ne' | 'se' | 'sw', Pt>>;
}

const MIN_HANDLE_BOUNDS = 28;
export const SELECTION_ROTATION_HANDLE_OFFSET = 32;

function expandedDimension(min: number, max: number): readonly [number, number] {
  const size = max - min;
  if (size >= MIN_HANDLE_BOUNDS) return [min, max];
  const center = (min + max) / 2;
  return [center - MIN_HANDLE_BOUNDS / 2, center + MIN_HANDLE_BOUNDS / 2];
}

export function selectionTransformHandleLayout(
  sourceBounds: ScreenRect,
): SelectionTransformHandleLayout {
  const [left, right] = expandedDimension(sourceBounds.left, sourceBounds.right);
  const [top, bottom] = expandedDimension(sourceBounds.top, sourceBounds.bottom);
  const bounds = { left, top, right, bottom };
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  return {
    bounds,
    center,
    rotation: { x: center.x, y: top - SELECTION_ROTATION_HANDLE_OFFSET },
    corners: {
      nw: { x: left, y: top },
      ne: { x: right, y: top },
      se: { x: right, y: bottom },
      sw: { x: left, y: bottom },
    },
  };
}

function normalizeDegrees(degrees: number): number {
  let result = degrees % 360;
  if (result > 180) result -= 360;
  if (result <= -180) result += 360;
  return result;
}

export function selectionTransformFromGesture(
  gesture: SelectionTransformGesture,
  viewportScale: number,
  snapRotation = false,
): SelectionTransform {
  if (!Number.isFinite(viewportScale) || viewportScale <= 0) {
    throw new TypeError('Viewport scale must be positive.');
  }
  if (gesture.handle === 'move') {
    return {
      kind: 'translate',
      dx: (gesture.current.x - gesture.start.x) / viewportScale,
      dy: -(gesture.current.y - gesture.start.y) / viewportScale,
    };
  }
  const layout = selectionTransformHandleLayout(gesture.bounds);
  if (gesture.handle === 'rotate') {
    const startAngle = Math.atan2(
      gesture.start.y - layout.center.y,
      gesture.start.x - layout.center.x,
    );
    const currentAngle = Math.atan2(
      gesture.current.y - layout.center.y,
      gesture.current.x - layout.center.x,
    );
    // SVG screen coordinates grow downward, while TikZ scene coordinates grow
    // upward. Negate the screen-space angle before writing scene coordinates.
    let degrees = normalizeDegrees(-(currentAngle - startAngle) * 180 / Math.PI);
    if (snapRotation) degrees = Math.round(degrees / 15) * 15;
    return { kind: 'rotate', degrees, center: 'selection' };
  }
  const startDistance = Math.hypot(
    gesture.start.x - layout.center.x,
    gesture.start.y - layout.center.y,
  );
  const currentDistance = Math.hypot(
    gesture.current.x - layout.center.x,
    gesture.current.y - layout.center.y,
  );
  const factor = Math.max(0.05, Math.min(100, currentDistance / Math.max(1, startDistance)));
  return { kind: 'scale', factor, center: 'selection' };
}

export function selectionTransformPreviewLayout(
  gesture: SelectionTransformGesture,
): { readonly layout: SelectionTransformHandleLayout; readonly rotationDegrees: number } {
  const initial = selectionTransformHandleLayout(gesture.bounds);
  if (gesture.handle === 'move') {
    const dx = gesture.current.x - gesture.start.x;
    const dy = gesture.current.y - gesture.start.y;
    return {
      layout: selectionTransformHandleLayout({
        left: initial.bounds.left + dx,
        top: initial.bounds.top + dy,
        right: initial.bounds.right + dx,
        bottom: initial.bounds.bottom + dy,
      }),
      rotationDegrees: 0,
    };
  }
  if (gesture.handle === 'rotate') {
    const transform = selectionTransformFromGesture(gesture, 1);
    return {
      layout: initial,
      rotationDegrees: transform.kind === 'rotate' ? -transform.degrees : 0,
    };
  }
  const transform = selectionTransformFromGesture(gesture, 1);
  const factor = transform.kind === 'scale' ? transform.factor : 1;
  const halfWidth = (initial.bounds.right - initial.bounds.left) * factor / 2;
  const halfHeight = (initial.bounds.bottom - initial.bounds.top) * factor / 2;
  return {
    layout: selectionTransformHandleLayout({
      left: initial.center.x - halfWidth,
      top: initial.center.y - halfHeight,
      right: initial.center.x + halfWidth,
      bottom: initial.center.y + halfHeight,
    }),
    rotationDegrees: 0,
  };
}

/** SVG-space preview matrix for the same frozen pivot used by the writer. */
export function selectionTransformPreviewSvgTransform(
  gesture: SelectionTransformGesture,
): string {
  const layout = selectionTransformHandleLayout(gesture.bounds);
  if (gesture.handle === 'move') {
    return `translate(${gesture.current.x - gesture.start.x} ${gesture.current.y - gesture.start.y})`;
  }
  const transform = selectionTransformFromGesture(gesture, 1);
  if (transform.kind === 'rotate') {
    return `rotate(${-transform.degrees} ${layout.center.x} ${layout.center.y})`;
  }
  const factor = transform.kind === 'scale' ? transform.factor : 1;
  return [
    `translate(${layout.center.x} ${layout.center.y})`,
    `scale(${factor})`,
    `translate(${-layout.center.x} ${-layout.center.y})`,
  ].join(' ');
}
