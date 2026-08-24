import type { Pt } from '../semantics/calc-eval';

export interface CircularArcGeometry {
  readonly center: Pt;
  readonly radius: number;
  readonly startAngleDeg: number;
  readonly endAngleDeg: number;
}

export function circularArcPoint(arc: CircularArcGeometry, angleDeg: number): Pt {
  const angle = angleDeg * Math.PI / 180;
  return {
    x: arc.center.x + arc.radius * Math.cos(angle),
    y: arc.center.y + arc.radius * Math.sin(angle),
  };
}

export function circularArcDelta(arc: CircularArcGeometry): number {
  return arc.endAngleDeg - arc.startAngleDeg;
}

export function flattenCircularArc(
  arc: CircularArcGeometry,
  maxAngleStepDeg = 5,
): readonly Pt[] {
  const delta = circularArcDelta(arc);
  const count = Math.max(1, Math.ceil(Math.abs(delta) / Math.max(0.25, maxAngleStepDeg)));
  return Array.from({ length: count + 1 }, (_, index) => (
    circularArcPoint(arc, arc.startAngleDeg + delta * index / count)
  ));
}

export function circularArcFromStart(
  start: Pt,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CircularArcGeometry {
  const startAngle = startAngleDeg * Math.PI / 180;
  return {
    center: {
      x: start.x - radius * Math.cos(startAngle),
      y: start.y - radius * Math.sin(startAngle),
    },
    radius,
    startAngleDeg,
    endAngleDeg,
  };
}
