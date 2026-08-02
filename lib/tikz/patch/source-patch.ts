import type { Pt } from '../semantics/calc-eval';
import type { SourceRange } from '../subset/ast';
import {
  applyTextPatch,
  rangePatch,
  type TextPatch,
} from '../document/source-transaction';

function assertRange(code: string, range: SourceRange): void {
  if (
    !Number.isInteger(range.start)
    || !Number.isInteger(range.end)
    || range.start < 0
    || range.end < range.start
    || range.end > code.length
  ) {
    throw new RangeError(`无效源码范围 ${range.start}..${range.end}`);
  }
}

export function formatCoordNumber(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError('坐标必须是有限数字');
  const rounded = Number(value.toFixed(4));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function patchCoordinateLiteral(
  code: string,
  range: SourceRange,
  next: Pt,
): string {
  return applyTextPatch(code, coordinateLiteralPatch(code, range, next));
}

export function coordinateLiteralPatch(
  code: string,
  range: SourceRange,
  next: Pt,
): TextPatch {
  assertRange(code, range);
  return rangePatch(
    range,
    `(${formatCoordNumber(next.x)},${formatCoordNumber(next.y)})`,
  );
}

export function patchStyleOptions(
  code: string,
  range: SourceRange | null,
  nextRaw: string,
  insertPos: number,
): string {
  return applyTextPatch(code, styleOptionsPatch(code, range, nextRaw, insertPos));
}

export function styleOptionsPatch(
  code: string,
  range: SourceRange | null,
  nextRaw: string,
  insertPos: number,
): TextPatch {
  if (range) {
    assertRange(code, range);
    return rangePatch(range, `[${nextRaw}]`);
  }
  if (!Number.isInteger(insertPos) || insertPos < 0 || insertPos > code.length) {
    throw new RangeError(`无效样式插入位置 ${insertPos}`);
  }
  return { from: insertPos, to: insertPos, insert: `[${nextRaw}]` };
}
