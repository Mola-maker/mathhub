import type { Pt } from '../semantics/calc-eval';
import type { RenderArrow } from './render-primitive-decoder';

function unit(from: Pt, to: Pt): Pt | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? { x: dx / length, y: dy / length } : null;
}

export const DEFAULT_ANGLE_MARK_RADIUS = 16;
export const RIGHT_ANGLE_MARK_SIZE = 12;

export type AngleMarkGeometry =
  | {
    readonly kind: 'right';
    readonly points: readonly [Pt, Pt, Pt];
  }
  | {
    readonly kind: 'arc';
    readonly center: Pt;
    readonly radius: number;
    readonly start: Pt;
    readonly end: Pt;
    readonly sweep: 0 | 1;
    readonly points: readonly Pt[];
  };

function arrowPath(tip: Pt, direction: Pt, strokeWidth: number): string {
  const factor = 1 + 0.5 * Math.max(strokeWidth - 1, 0);
  const length = 10 * factor;
  const halfWidth = 4 * factor;
  const normal = { x: -direction.y, y: direction.x };
  const base = {
    x: tip.x - direction.x * length,
    y: tip.y - direction.y * length,
  };
  return [
    `M ${tip.x} ${tip.y}`,
    `L ${base.x + normal.x * halfWidth} ${base.y + normal.y * halfWidth}`,
    `L ${base.x - normal.x * halfWidth} ${base.y - normal.y * halfWidth}`,
    'Z',
  ].join(' ');
}

export function SvgArrows({
  points,
  arrow,
  color,
  strokeWidth,
}: {
  points: readonly Pt[];
  arrow: RenderArrow;
  color: string;
  strokeWidth: number;
}) {
  if (arrow === 'none' || points.length < 2) return null;
  const firstDirection = unit(points[1], points[0]);
  const lastDirection = unit(points[points.length - 2], points[points.length - 1]);
  return (
    <g data-tikz-decoration="arrows" fill={color} pointerEvents="none">
      {(arrow === '<-' || arrow === '<->') && firstDirection
        ? <path d={arrowPath(points[0], firstDirection, strokeWidth)} />
        : null}
      {(arrow === '->' || arrow === '<->') && lastDirection
        ? <path d={arrowPath(points[points.length - 1], lastDirection, strokeWidth)} />
        : null}
    </g>
  );
}

export function angleMarkGeometry({
  vertex,
  from,
  to,
  right,
  radius,
}: {
  vertex: Pt;
  from: Pt;
  to: Pt;
  right: boolean;
  radius: number;
}): AngleMarkGeometry | null {
  const first = unit(vertex, from);
  const second = unit(vertex, to);
  if (!first || !second) return null;

  if (right) {
    const firstPoint = {
      x: vertex.x + first.x * RIGHT_ANGLE_MARK_SIZE,
      y: vertex.y + first.y * RIGHT_ANGLE_MARK_SIZE,
    };
    const corner = {
      x: firstPoint.x + second.x * RIGHT_ANGLE_MARK_SIZE,
      y: firstPoint.y + second.y * RIGHT_ANGLE_MARK_SIZE,
    };
    const secondPoint = {
      x: vertex.x + second.x * RIGHT_ANGLE_MARK_SIZE,
      y: vertex.y + second.y * RIGHT_ANGLE_MARK_SIZE,
    };
    return { kind: 'right', points: [firstPoint, corner, secondPoint] };
  }

  const start = {
    x: vertex.x + first.x * radius,
    y: vertex.y + first.y * radius,
  };
  const end = {
    x: vertex.x + second.x * radius,
    y: vertex.y + second.y * radius,
  };
  const cross = first.x * second.y - first.y * second.x;
  const sweep = (cross >= 0 ? 1 : 0) as 0 | 1;
  const startAngle = Math.atan2(first.y, first.x);
  let delta = Math.atan2(second.y, second.x) - startAngle;
  if (sweep === 1) {
    while (delta < 0) delta += Math.PI * 2;
    if (delta > Math.PI) delta -= Math.PI * 2;
  } else {
    while (delta > 0) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
  }
  const segments = Math.max(6, Math.ceil(Math.abs(delta) * radius / 4));
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const angle = startAngle + delta * (index / segments);
    return {
      x: vertex.x + Math.cos(angle) * radius,
      y: vertex.y + Math.sin(angle) * radius,
    };
  });
  return {
    kind: 'arc',
    center: vertex,
    radius,
    start,
    end,
    sweep,
    points,
  };
}

export function angleMarkPath(args: {
  vertex: Pt;
  from: Pt;
  to: Pt;
  right: boolean;
  radius: number;
}): string {
  const geometry = angleMarkGeometry(args);
  if (!geometry) return '';
  if (geometry.kind === 'right') {
    const [firstPoint, corner, secondPoint] = geometry.points;
    return [
      `M ${firstPoint.x} ${firstPoint.y}`,
      `L ${corner.x} ${corner.y}`,
      `L ${secondPoint.x} ${secondPoint.y}`,
    ].join(' ');
  }
  return [
    `M ${geometry.start.x} ${geometry.start.y}`,
    `A ${geometry.radius} ${geometry.radius} 0 0 ${geometry.sweep}`,
    `${geometry.end.x} ${geometry.end.y}`,
  ].join(' ');
}
