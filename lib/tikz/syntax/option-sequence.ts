/**
 * Lossless, ordered view of one TikZ/PGF option list (the bytes inside `[...]`).
 *
 * PGF keys are an ordered dispatch language: duplicate keys, handlers, current
 * paths, and unknown fallbacks can all be observable.  This representation is
 * therefore deliberately not a `Record<string, string>`.  It only finds safe
 * top-level comma/equal boundaries and keeps every source slice and range.
 */
export const TIKZ_OPTION_SEQUENCE_SCHEMA = 'tikz-option-sequence/v1' as const;

export interface TikzOptionRange {
  /** Inclusive UTF-16 source offset. */
  start: number;
  /** Exclusive UTF-16 source offset. */
  end: number;
}

export interface TikzOptionEntry {
  ordinal: number;
  /** Exact segment between adjacent top-level commas, including trivia. */
  segmentRaw: string;
  segmentRange: TikzOptionRange;
  /** Trimmed option bytes. */
  raw: string;
  range: TikzOptionRange;
  /**
   * Best-effort standard-catcode view used by the interactive subset.
   * Exact source remains in `raw`; macro/catcode-sensitive consumers must not
   * treat this projection as TeX execution truth.
   */
  interpreted: string;
  /** Contiguous source range for `interpreted`, or null across an inner comment. */
  interpretedRange: TikzOptionRange | null;
  /** Standard-catcode key/value view for bounded semantic consumers. */
  interpretedKey: string;
  interpretedValue: string | null;
  /** Exact trimmed key bytes before a safe top-level `=`. */
  key: string;
  keyRange: TikzOptionRange;
  /** Exact trimmed value bytes, or null for a valueless key/style. */
  value: string | null;
  valueRange: TikzOptionRange | null;
}

export interface TikzOptionSequence {
  schema: typeof TIKZ_OPTION_SEQUENCE_SCHEMA;
  raw: string;
  range: TikzOptionRange;
  ordered: true;
  balanced: boolean;
  entries: readonly TikzOptionEntry[];
}

interface ScanResult {
  boundaries: number[];
  balanced: boolean;
}

function standardCatcodeProjection(
  raw: string,
  baseOffset: number,
): { text: string; range: TikzOptionRange | null } {
  const characters: string[] = [];
  const sourceIndexes: number[] = [];
  let comment = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (comment) {
      // Under standard TeX catcodes the comment consumes the endline too.
      if (char === '\n' || char === '\r') {
        comment = false;
        if (char === '\r' && raw[index + 1] === '\n') index += 1;
      }
      continue;
    }
    if (char === '\\' && index + 1 < raw.length) {
      characters.push(char, raw[index + 1]!);
      sourceIndexes.push(index, index + 1);
      index += 1;
      continue;
    }
    if (char === '%') {
      comment = true;
      continue;
    }
    characters.push(char);
    sourceIndexes.push(index);
  }

  const projection = characters.join('');
  const leading = projection.match(/^\s*/u)?.[0].length ?? 0;
  const trailing = projection.match(/\s*$/u)?.[0].length ?? 0;
  const textEnd = Math.max(leading, projection.length - trailing);
  const text = projection.slice(leading, textEnd);
  const indexes = sourceIndexes.slice(leading, textEnd);
  if (indexes.length === 0) return { text, range: null };
  const contiguous = indexes.every((value, index) => (
    index === 0 || value === indexes[index - 1]! + 1
  ));
  return {
    text,
    range: contiguous
      ? {
        start: baseOffset + indexes[0]!,
        end: baseOffset + indexes[indexes.length - 1]! + 1,
      }
      : null,
  };
}

function scanTopLevel(raw: string, delimiter: ',' | '='): ScanResult {
  const boundaries: number[] = [];
  const stack: string[] = [];
  let comment = false;
  let quote = false;
  let math = false;
  let balanced = true;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (comment) {
      if (char === '\n' || char === '\r') comment = false;
      continue;
    }
    if (char === '\\') {
      // A control symbol protects its following character. For a control word,
      // skipping the first letter is enough because the remaining letters are
      // not structural delimiters.
      index += 1;
      continue;
    }
    if (char === '%') {
      comment = true;
      continue;
    }
    if (char === '"' && !math) {
      quote = !quote;
      continue;
    }
    if (char === '$' && !quote) {
      math = !math;
      continue;
    }
    if (quote || math) continue;

    if (char === '{' || char === '[' || char === '(') {
      stack.push(char);
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      const expected = char === '}' ? '{' : char === ']' ? '[' : '(';
      if (stack.at(-1) !== expected) balanced = false;
      else stack.pop();
      continue;
    }
    if (char === delimiter && stack.length === 0) {
      boundaries.push(index);
      if (delimiter === '=') break;
    }
  }

  return {
    boundaries,
    balanced: balanced && stack.length === 0 && !quote && !math,
  };
}

function trimRange(raw: string, start: number, end: number): TikzOptionRange {
  const segment = raw.slice(start, end);
  const leading = segment.match(/^\s*/u)?.[0].length ?? 0;
  const trailing = segment.match(/\s*$/u)?.[0].length ?? 0;
  return {
    start: start + leading,
    end: Math.max(start + leading, end - trailing),
  };
}

function entryOf(
  raw: string,
  segmentStart: number,
  segmentEnd: number,
  baseOffset: number,
  ordinal: number,
  opaque: boolean,
): TikzOptionEntry | null {
  const trimmed = trimRange(raw, segmentStart, segmentEnd);
  if (trimmed.start >= trimmed.end) return null;
  const optionRaw = raw.slice(trimmed.start, trimmed.end);
  const interpreted = standardCatcodeProjection(
    optionRaw,
    baseOffset + trimmed.start,
  );
  // An opaque entry gets no key/value split. scanTopLevel breaks at the first
  // top-level '=', so its balance verdict only covers the prefix and would
  // otherwise report a confident assignment inside unbalanced source — exactly
  // the pgfkeys boundary the fail-closed path refuses to invent.
  const assignment = opaque
    ? { boundaries: [], balanced: false }
    : scanTopLevel(optionRaw, '=');
  const equals = assignment.balanced ? assignment.boundaries[0] : undefined;
  const localKeyRange = trimRange(optionRaw, 0, equals ?? optionRaw.length);
  const localValueRange = equals === undefined
    ? null
    : trimRange(optionRaw, equals + 1, optionRaw.length);
  const absolute = (range: TikzOptionRange): TikzOptionRange => ({
    start: baseOffset + trimmed.start + range.start,
    end: baseOffset + trimmed.start + range.end,
  });
  const interpretedAssignment = opaque
    ? { boundaries: [], balanced: false }
    : scanTopLevel(interpreted.text, '=');
  const interpretedEquals = interpretedAssignment.balanced
    ? interpretedAssignment.boundaries[0]
    : undefined;
  const interpretedKey = interpreted.text
    .slice(0, interpretedEquals ?? interpreted.text.length)
    .trim();
  const interpretedValue = interpretedEquals === undefined
    ? null
    : interpreted.text.slice(interpretedEquals + 1).trim();

  return {
    ordinal,
    segmentRaw: raw.slice(segmentStart, segmentEnd),
    segmentRange: {
      start: baseOffset + segmentStart,
      end: baseOffset + segmentEnd,
    },
    raw: optionRaw,
    range: {
      start: baseOffset + trimmed.start,
      end: baseOffset + trimmed.end,
    },
    interpreted: interpreted.text,
    interpretedRange: interpreted.range,
    interpretedKey,
    interpretedValue,
    key: optionRaw.slice(localKeyRange.start, localKeyRange.end),
    keyRange: absolute(localKeyRange),
    value: localValueRange === null
      ? null
      : optionRaw.slice(localValueRange.start, localValueRange.end),
    valueRange: localValueRange === null ? null : absolute(localValueRange),
  };
}

export function parseTikzOptionSequence(
  raw: string,
  baseOffset = 0,
): TikzOptionSequence {
  const scan = scanTopLevel(raw, ',');
  // An unbalanced list is kept as one opaque ordered entry. Splitting it would
  // invent pgfkeys dispatch boundaries that the source has not established.
  const boundaries = scan.balanced ? scan.boundaries : [];
  const entries: TikzOptionEntry[] = [];
  let segmentStart = 0;
  for (const segmentEnd of [...boundaries, raw.length]) {
    const entry = entryOf(
      raw,
      segmentStart,
      segmentEnd,
      baseOffset,
      entries.length,
      !scan.balanced,
    );
    if (entry) entries.push(entry);
    segmentStart = segmentEnd + 1;
  }

  return {
    schema: TIKZ_OPTION_SEQUENCE_SCHEMA,
    raw,
    range: { start: baseOffset, end: baseOffset + raw.length },
    ordered: true,
    balanced: scan.balanced,
    entries,
  };
}

/** Safe convenience for consumers that only need ordered trimmed option bytes. */
export function orderedTikzOptionValues(raw: string | null | undefined): readonly string[] {
  if (!raw) return [];
  return parseTikzOptionSequence(raw).entries
    .map((entry) => entry.interpreted)
    .filter(Boolean);
}
