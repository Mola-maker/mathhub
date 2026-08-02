import { formatCoordNumber } from '../patch/source-patch';

export type TikzCalcScalar = number | string;

function scalarSource(value: TikzCalcScalar): string {
  return typeof value === 'number' ? formatCoordNumber(value) : value;
}

/**
 * Wrap a calc-library expression as one TikZ coordinate.
 *
 * Keep this boundary explicit: callers provide the expression inside `$...$`,
 * while this serializer owns the required outer parentheses.
 */
export function calcCoordinate(expression: string): string {
  return `($${expression}$)`;
}

export function calcInterpolateCoordinate(
  from: string,
  factor: TikzCalcScalar,
  to: string,
  rotationDegrees?: TikzCalcScalar,
): string {
  const rotation = rotationDegrees === undefined
    ? ''
    : `${scalarSource(rotationDegrees)}:`;
  return calcCoordinate(
    `(${from})!${scalarSource(factor)}!${rotation}(${to})`,
  );
}

export function calcProjectionCoordinate(
  lineStart: string,
  projectedPoint: string,
  lineEnd: string,
): string {
  return calcCoordinate(
    `(${lineStart})!(${projectedPoint})!(${lineEnd})`,
  );
}

export function calcDifferenceCoordinate(
  minuend: string,
  subtrahend: string,
): string {
  return calcCoordinate(`(${minuend})-(${subtrahend})`);
}

export function calcOffsetCoordinate(
  origin: string,
  x: TikzCalcScalar,
  y: TikzCalcScalar,
): string {
  return calcCoordinate(
    `(${origin})+(${scalarSource(x)},${scalarSource(y)})`,
  );
}

export function calcTranslateByVectorCoordinate(
  origin: string,
  vectorStart: string,
  vectorEnd: string,
): string {
  return calcCoordinate(
    `(${origin})+(${vectorEnd})-(${vectorStart})`,
  );
}
