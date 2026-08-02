/**
 * Maps the three coordinate systems used by the studio:
 *
 * - CodeMirror / JavaScript UTF-16 code-unit offsets
 * - compiler and content-hash UTF-8 byte offsets
 * - zero-based line / UTF-16 column positions
 *
 * A source patch is always expressed in UTF-16 offsets at the UI boundary.
 * Protocol and compiler envelopes can carry all three positions so a range is
 * never silently reinterpreted as bytes.
 */

export interface SourcePosition {
  utf16: number;
  utf8: number;
  line: number;
  column: number;
}

export interface IndexedSourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export type OffsetBias = 'left' | 'right';

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function byteLengthOfCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function upperBound(values: readonly number[] | Uint32Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (values[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class SourceIndex {
  readonly source: string;
  readonly utf16Length: number;
  readonly utf8Length: number;

  private readonly byteAtUtf16: Uint32Array;
  private readonly utf16Boundary: Uint8Array;
  private readonly boundaryUtf16: number[];
  private readonly boundaryUtf8: number[];
  private readonly lineStarts: number[];

  constructor(source: string) {
    this.source = source;
    this.utf16Length = source.length;
    this.byteAtUtf16 = new Uint32Array(source.length + 1);
    this.utf16Boundary = new Uint8Array(source.length + 1);
    this.boundaryUtf16 = [0];
    this.boundaryUtf8 = [0];
    this.lineStarts = [0];

    let utf16 = 0;
    let utf8 = 0;
    this.utf16Boundary[0] = 1;
    while (utf16 < source.length) {
      const codePoint = source.codePointAt(utf16) ?? 0;
      const width = codePoint > 0xffff ? 2 : 1;
      const nextUtf16 = utf16 + width;
      const nextUtf8 = utf8 + byteLengthOfCodePoint(codePoint);

      this.byteAtUtf16[utf16] = utf8;
      if (width === 2) {
        // The middle of a surrogate pair is not a valid UTF-8 boundary. Keep
        // the enclosing byte range so callers can select an explicit bias.
        this.byteAtUtf16[utf16 + 1] = utf8;
      }
      this.byteAtUtf16[nextUtf16] = nextUtf8;
      this.utf16Boundary[nextUtf16] = 1;
      this.boundaryUtf16.push(nextUtf16);
      this.boundaryUtf8.push(nextUtf8);

      if (codePoint === 0x0a) this.lineStarts.push(nextUtf16);
      utf16 = nextUtf16;
      utf8 = nextUtf8;
    }
    this.utf8Length = utf8;
  }

  isUtf16Boundary(offset: number): boolean {
    const normalized = clampInteger(offset, 0, this.utf16Length);
    return this.utf16Boundary[normalized] === 1;
  }

  normalizeUtf16(offset: number, bias: OffsetBias = 'left'): number {
    let normalized = clampInteger(offset, 0, this.utf16Length);
    if (this.utf16Boundary[normalized] === 1) return normalized;
    if (bias === 'right') {
      while (
        normalized < this.utf16Length
        && this.utf16Boundary[normalized] !== 1
      ) normalized += 1;
      return normalized;
    }
    while (normalized > 0 && this.utf16Boundary[normalized] !== 1) {
      normalized -= 1;
    }
    return normalized;
  }

  utf16ToUtf8(offset: number, bias: OffsetBias = 'left'): number {
    const normalized = this.normalizeUtf16(offset, bias);
    return this.byteAtUtf16[normalized]!;
  }

  utf8ToUtf16(offset: number, bias: OffsetBias = 'left'): number {
    const target = clampInteger(offset, 0, this.utf8Length);
    const insertion = upperBound(this.boundaryUtf8, target);
    const leftIndex = Math.max(0, insertion - 1);
    if (this.boundaryUtf8[leftIndex] === target || bias === 'left') {
      return this.boundaryUtf16[leftIndex]!;
    }
    return this.boundaryUtf16[Math.min(
      this.boundaryUtf16.length - 1,
      insertion,
    )]!;
  }

  utf16ToLineColumn(offset: number, bias: OffsetBias = 'left'): {
    line: number;
    column: number;
  } {
    const normalized = this.normalizeUtf16(offset, bias);
    const line = Math.max(0, upperBound(this.lineStarts, normalized) - 1);
    return {
      line,
      column: normalized - this.lineStarts[line]!,
    };
  }

  lineColumnToUtf16(
    line: number,
    column: number,
    bias: OffsetBias = 'left',
  ): number {
    const normalizedLine = clampInteger(line, 0, this.lineStarts.length - 1);
    const lineStart = this.lineStarts[normalizedLine]!;
    const nextLineStart = this.lineStarts[normalizedLine + 1] ?? this.utf16Length;
    const lineEnd = normalizedLine + 1 < this.lineStarts.length
      ? Math.max(lineStart, nextLineStart - 1)
      : nextLineStart;
    return this.normalizeUtf16(
      lineStart + clampInteger(column, 0, lineEnd - lineStart),
      bias,
    );
  }

  position(offset: number, bias: OffsetBias = 'left'): SourcePosition {
    const utf16 = this.normalizeUtf16(offset, bias);
    const lineColumn = this.utf16ToLineColumn(utf16, bias);
    return {
      utf16,
      utf8: this.byteAtUtf16[utf16]!,
      ...lineColumn,
    };
  }

  range(
    start: number,
    end: number,
    startBias: OffsetBias = 'left',
    endBias: OffsetBias = 'right',
  ): IndexedSourceRange {
    const normalizedStart = this.normalizeUtf16(start, startBias);
    const normalizedEnd = Math.max(
      normalizedStart,
      this.normalizeUtf16(end, endBias),
    );
    return {
      start: this.position(normalizedStart),
      end: this.position(normalizedEnd),
    };
  }
}
