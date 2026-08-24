import type { Pt } from '../semantics/calc-eval';
import type { RenderArrow, RenderArrowTip } from './render-primitive-decoder';

function unit(from: Pt, to: Pt): Pt | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length > 1e-9 ? { x: dx / length, y: dy / length } : null;
}

/** TikZ angles library default: /tikz/angle radius is initially 5mm. */
export const DEFAULT_ANGLE_MARK_RADIUS = 5 * (96 / 25.4);

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

function arrowGeometry(
  tip: Pt,
  direction: Pt,
  strokeWidth: number,
  presentationScale: number,
) {
  const length = 5 * (96 / 72.27) * presentationScale + strokeWidth * 1.5;
  const halfWidth = 2.1 * (96 / 72.27) * presentationScale + strokeWidth * 0.5;
  const normal = { x: -direction.y, y: direction.x };
  const base = {
    x: tip.x - direction.x * length,
    y: tip.y - direction.y * length,
  };
  const upper = { x: base.x + normal.x * halfWidth, y: base.y + normal.y * halfWidth };
  const lower = { x: base.x - normal.x * halfWidth, y: base.y - normal.y * halfWidth };
  const inset = {
    x: tip.x - direction.x * length * 0.68,
    y: tip.y - direction.y * length * 0.68,
  };
  return { tip, upper, lower, inset };
}

function ArrowTipSvg({
  tip,
  direction,
  kind,
  color,
  strokeWidth,
  presentationScale,
}: {
  tip: Pt;
  direction: Pt;
  kind: RenderArrowTip;
  color: string;
  strokeWidth: number;
  presentationScale: number;
}) {
  const geometry = arrowGeometry(tip, direction, strokeWidth, presentationScale);
  if (kind === 'to') {
    return (
      <path
        d={`M ${geometry.upper.x} ${geometry.upper.y} L ${geometry.tip.x} ${geometry.tip.y} L ${geometry.lower.x} ${geometry.lower.y}`}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  const path = kind === 'stealth'
    ? [
        `M ${geometry.tip.x} ${geometry.tip.y}`,
        `L ${geometry.upper.x} ${geometry.upper.y}`,
        `L ${geometry.inset.x} ${geometry.inset.y}`,
        `L ${geometry.lower.x} ${geometry.lower.y}`,
        'Z',
      ].join(' ')
    : [
        `M ${geometry.tip.x} ${geometry.tip.y}`,
        `L ${geometry.upper.x} ${geometry.upper.y}`,
        `L ${geometry.lower.x} ${geometry.lower.y}`,
        'Z',
      ].join(' ');
  return <path d={path} fill={color} stroke={color} strokeWidth={Math.max(0.2, strokeWidth * 0.5)} />;
}

export function SvgArrows({
  points,
  arrow,
  arrowTip = 'to',
  color,
  strokeWidth,
  presentationScale = 1,
  opacity = 1,
}: {
  points: readonly Pt[];
  arrow: RenderArrow;
  arrowTip?: RenderArrowTip;
  color: string;
  strokeWidth: number;
  presentationScale?: number;
  opacity?: number;
}) {
  if (arrow === 'none' || points.length < 2) return null;
  const firstDirection = unit(points[1], points[0]);
  const lastDirection = unit(points[points.length - 2], points[points.length - 1]);
  return (
    <g data-tikz-decoration="arrows" data-tikz-arrow-tip={arrowTip} opacity={opacity} pointerEvents="none">
      {(arrow === '<-' || arrow === '<->') && firstDirection
        ? <ArrowTipSvg tip={points[0]!} direction={firstDirection} kind={arrowTip} color={color} strokeWidth={strokeWidth} presentationScale={presentationScale} />
        : null}
      {(arrow === '->' || arrow === '<->') && lastDirection
        ? <ArrowTipSvg tip={points[points.length - 1]!} direction={lastDirection} kind={arrowTip} color={color} strokeWidth={strokeWidth} presentationScale={presentationScale} />
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
      x: vertex.x + first.x * radius,
      y: vertex.y + first.y * radius,
    };
    const corner = {
      x: firstPoint.x + second.x * radius,
      y: firstPoint.y + second.y * radius,
    };
    const secondPoint = {
      x: vertex.x + second.x * radius,
      y: vertex.y + second.y * radius,
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
