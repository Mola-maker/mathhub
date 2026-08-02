import type { TextPatch } from '../document/source-transaction';
import type { SourceRange } from '../subset/ast';

const LABEL_ANCHORS = new Set([
  'above',
  'below',
  'left',
  'right',
  'above left',
  'above right',
  'below left',
  'below right',
  'center',
]);

function assertRange(source: string, range: SourceRange): void {
  if (
    !Number.isInteger(range.start)
    || !Number.isInteger(range.end)
    || range.start < 0
    || range.end < range.start
    || range.end > source.length
  ) {
    throw new RangeError('无效 TikZ 语句范围');
  }
}

function escaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

export function labelTextPatch(
  source: string,
  statementRange: SourceRange,
  text: string,
): TextPatch {
  assertRange(source, statementRange);
  let close = statementRange.end - 1;
  while (close >= statementRange.start && source[close] !== '}') close -= 1;
  if (close < statementRange.start) throw new SyntaxError('标签缺少文本分组');

  let depth = 0;
  for (let cursor = close; cursor >= statementRange.start; cursor -= 1) {
    if (escaped(source, cursor)) continue;
    if (source[cursor] === '}') depth += 1;
    else if (source[cursor] === '{') {
      depth -= 1;
      if (depth === 0) {
        return { from: cursor + 1, to: close, insert: text };
      }
    }
  }
  throw new SyntaxError('标签文本分组不完整');
}

export function deleteStatementPatch(
  source: string,
  statementRange: SourceRange,
): TextPatch {
  assertRange(source, statementRange);
  let to = statementRange.end;
  while (to < source.length && (source[to] === ' ' || source[to] === '\t')) to += 1;
  if (source[to] === '\r' && source[to + 1] === '\n') to += 2;
  else if (source[to] === '\n' || source[to] === '\r') to += 1;
  return { from: statementRange.start, to, insert: '' };
}

function splitTopLevelOptions(raw: string): string[] {
  const options: string[] = [];
  let start = 0;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '{') braces += 1;
    else if (char === '}') braces = Math.max(0, braces - 1);
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets = Math.max(0, brackets - 1);
    else if (char === '(') parentheses += 1;
    else if (char === ')') parentheses = Math.max(0, parentheses - 1);
    else if (
      char === ','
      && braces === 0
      && brackets === 0
      && parentheses === 0
    ) {
      options.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }
  options.push(raw.slice(start).trim());
  return options.filter(Boolean);
}

export function replaceLabelAnchorRaw(
  raw: string | null,
  anchor: string,
): string {
  if (!LABEL_ANCHORS.has(anchor)) throw new TypeError(`不支持的标签锚点 ${anchor}`);
  const preserved = raw
    ? splitTopLevelOptions(raw).filter((option) => !LABEL_ANCHORS.has(option))
    : [];
  return [anchor, ...preserved].join(',');
}
