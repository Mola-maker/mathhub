import type { Pt } from '../semantics/calc-eval';

export interface EllipticalArcGeometry {
  readonly center: Pt;
  /** Image of the source radius vector at angle 0 degrees. */
  readonly axisX: Pt;
  /** Image of the source radius vector at angle 90 degrees. */
  readonly axisY: Pt;
  readonly startAngleDeg: number;
  readonly endAngleDeg: number;
}

export function ellipticalArcPoint(
  arc: EllipticalArcGeometry,
  angleDeg: number,
): Pt {
  const angle = angleDeg * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: arc.center.x + arc.axisX.x * cos + arc.axisY.x * sin,
    y: arc.center.y + arc.axisX.y * cos + arc.axisY.y * sin,
  };
}

export function ellipticalArcDelta(arc: EllipticalArcGeometry): number {
  return arc.endAngleDeg - arc.startAngleDeg;
}

export function flattenEllipticalArc(
  arc: EllipticalArcGeometry,
  maxAngleStepDeg = 5,
): readonly Pt[] {
  const delta = ellipticalArcDelta(arc);
  const count = Math.max(
    1,
    Math.ceil(Math.abs(delta) / Math.max(0.25, maxAngleStepDeg)),
  );
  return Array.from({ length: count + 1 }, (_, index) => (
    ellipticalArcPoint(arc, arc.startAngleDeg + delta * index / count)
  ));
}

export function ellipticalArcFromStart(
  start: Pt,
  axisX: Pt,
  axisY: Pt,
  startAngleDeg: number,
  endAngleDeg: number,
): EllipticalArcGeometry {
  const angle = startAngleDeg * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    center: {
      x: start.x - axisX.x * cos - axisY.x * sin,
      y: start.y - axisX.y * cos - axisY.y * sin,
    },
    axisX,
    axisY,
    startAngleDeg,
    endAngleDeg,
  };
}

/**
 * Exact SVG unit-circle arc data. Splitting at 180 degrees also handles
 * full and multi-turn TikZ arcs without relying on one ambiguous SVG arc.
 */
export function ellipticalArcSvgUnitPath(
  arc: Pick<EllipticalArcGeometry, 'startAngleDeg' | 'endAngleDeg'>,
): string {
  const delta = ellipticalArcDelta({
    ...arc,
    center: { x: 0, y: 0 },
    axisX: { x: 1, y: 0 },
    axisY: { x: 0, y: 1 },
  });
  const segmentCount = Math.max(1, Math.ceil(Math.abs(delta) / 180));
  const point = (degrees: number): Pt => {
    const radians = degrees * Math.PI / 180;
    return { x: Math.cos(radians), y: Math.sin(radians) };
  };
  const start = point(arc.startAngleDeg);
  const commands = [`M ${start.x} ${start.y}`];
  for (let index = 1; index <= segmentCount; index += 1) {
    const target = point(arc.startAngleDeg + delta * index / segmentCount);
    commands.push(`A 1 1 0 0 ${delta >= 0 ? 1 : 0} ${target.x} ${target.y}`);
  }
  return commands.join(' ');
}
