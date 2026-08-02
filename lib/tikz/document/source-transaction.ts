import type { SourceRange } from '../subset/ast';

export interface TextPatch {
  from: number;
  to: number;
  insert: string;
}

function assertPatch(source: string, patch: TextPatch): void {
  if (
    !Number.isInteger(patch.from)
    || !Number.isInteger(patch.to)
    || patch.from < 0
    || patch.to < patch.from
    || patch.to > source.length
  ) {
    throw new RangeError(`无效源码补丁 ${patch.from}..${patch.to}`);
  }
}

export function applyTextPatch(source: string, patch: TextPatch): string {
  assertPatch(source, patch);
  return `${source.slice(0, patch.from)}${patch.insert}${source.slice(patch.to)}`;
}

export function applyTextPatches(source: string, patches: readonly TextPatch[]): string {
  const ordered = [...patches].sort((a, b) => b.from - a.from || b.to - a.to);
  let boundary = source.length;
  let result = source;
  for (const patch of ordered) {
    assertPatch(source, patch);
    if (patch.to > boundary) {
      throw new RangeError('源码补丁区间相互重叠');
    }
    result = applyTextPatch(result, patch);
    boundary = patch.from;
  }
  return result;
}

export function minimalTextPatch(previous: string, next: string): TextPatch | null {
  if (previous === next) return null;
  let prefix = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (prefix < maxPrefix && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }

  let previousSuffix = previous.length;
  let nextSuffix = next.length;
  while (
    previousSuffix > prefix
    && nextSuffix > prefix
    && previous.charCodeAt(previousSuffix - 1) === next.charCodeAt(nextSuffix - 1)
  ) {
    previousSuffix -= 1;
    nextSuffix -= 1;
  }
  return {
    from: prefix,
    to: previousSuffix,
    insert: next.slice(prefix, nextSuffix),
  };
}

export function rangePatch(range: SourceRange, insert: string): TextPatch {
  return { from: range.start, to: range.end, insert };
}

export function assertTextPatch(source: string, patch: TextPatch): void {
  assertPatch(source, patch);
}
