import {
  parseTikzOptionSequence,
  type TikzOptionEntry,
} from '../syntax/option-sequence';

export const STYLE_COLORS = [
  'black', 'red', 'blue', 'green', 'orange', 'purple', 'gray', 'brown',
] as const;

export const STYLE_WIDTHS = [
  'thin', 'semithick', 'thick', 'very thick', 'ultra thick',
] as const;

export const STYLE_DASHES = ['dashed', 'densely dashed', 'dotted', 'dash dot'] as const;
export const STYLE_ARROWS = ['->', '<-', '<->'] as const;

export interface StyleDraft {
  color: string;
  drawColor: string | null;
  drawEnabled: boolean;
  width: string | null;
  dash: string | null;
  arrow: string | null;
  fill: boolean;
  fillColor: string | null;
  opacity: number | null;
  drawOpacity: number | null;
  textOpacity: number | null;
  lineCap: 'round' | 'rect' | 'butt' | null;
  lineJoin: 'round' | 'bevel' | 'miter' | null;
  roundedCorners: string | null;
  doubleLine: boolean;
  rotate: number | null;
  scale: number | null;
}

export const DEFAULT_STYLE_DRAFT: StyleDraft = {
  color: 'black',
  drawColor: null,
  drawEnabled: false,
  width: null,
  dash: null,
  arrow: null,
  fill: false,
  fillColor: null,
  opacity: null,
  drawOpacity: null,
  textOpacity: null,
  lineCap: null,
  lineJoin: null,
  roundedCorners: null,
  doubleLine: false,
  rotate: null,
  scale: null,
};

type StyleDraftKey = keyof StyleDraft;
type StyleOptionGroup =
  | 'color'
  | 'draw'
  | 'width'
  | 'dash'
  | 'arrow'
  | 'fill'
  | 'opacity'
  | 'drawOpacity'
  | 'textOpacity'
  | 'lineCap'
  | 'lineJoin'
  | 'roundedCorners'
  | 'doubleLine'
  | 'rotate'
  | 'scale';

const ALL_STYLE_KEYS: readonly StyleDraftKey[] = [
  'color',
  'drawColor',
  'drawEnabled',
  'width',
  'dash',
  'arrow',
  'fill',
  'fillColor',
  'opacity',
  'drawOpacity',
  'textOpacity',
  'lineCap',
  'lineJoin',
  'roundedCorners',
  'doubleLine',
  'rotate',
  'scale',
];

function styleOptionGroups(option: string): readonly StyleOptionGroup[] {
  if ((STYLE_COLORS as readonly string[]).includes(option)) return ['color'];
  if ((STYLE_WIDTHS as readonly string[]).includes(option)) return ['width'];
  if ((STYLE_DASHES as readonly string[]).includes(option)) return ['dash'];
  if ((STYLE_ARROWS as readonly string[]).includes(option)) return ['arrow'];
  if (option === 'draw' || /^draw\s*=/.test(option)) return ['draw'];
  if (/^color\s*=/.test(option)) return ['color'];
  if (option === 'fill' || /^fill\s*=/.test(option)) return ['fill'];
  if (/^fill\s+opacity\s*=/.test(option)) return ['opacity'];
  if (/^draw\s+opacity\s*=/.test(option)) return ['drawOpacity'];
  if (/^text\s+opacity\s*=/.test(option)) return ['textOpacity'];
  if (/^line\s+cap\s*=/.test(option)) return ['lineCap'];
  if (/^line\s+join\s*=/.test(option)) return ['lineJoin'];
  if (/^rounded\s+corners(?:\s*=|$)/.test(option)) return ['roundedCorners'];
  if (option === 'double') return ['doubleLine'];
  if (/^rotate\s*=/.test(option)) return ['rotate'];
  if (/^scale\s*=/.test(option)) return ['scale'];
  return [];
}

function groupForKey(key: StyleDraftKey): StyleOptionGroup {
  if (key === 'drawColor' || key === 'drawEnabled') return 'draw';
  if (key === 'fillColor') return 'fill';
  return key;
}

function assignmentWithPreservedPrefix(
  previous: string | null,
  keyPattern: RegExp,
  fallbackKey: string,
  value: string,
): string {
  const match = previous ? keyPattern.exec(previous) : null;
  return match ? `${match[1]}${value}` : `${fallbackKey}=${value}`;
}

function replacementForGroup(
  group: StyleOptionGroup,
  draft: StyleDraft,
  previous: string | null,
): string | null {
  switch (group) {
    case 'color':
      if (previous && /^color\s*=/.test(previous)) {
        return assignmentWithPreservedPrefix(
          previous,
          /^((?:color)\s*=\s*)(?:.*)$/,
          'color',
          draft.color,
        );
      }
      return draft.color === 'black' ? null : draft.color;
    case 'draw':
      if (!draft.drawEnabled) return null;
      if (draft.drawColor === null) return 'draw';
      return assignmentWithPreservedPrefix(
        previous,
        /^((?:draw)\s*=\s*)(?:.*)$/,
        'draw',
        draft.drawColor,
      );
    case 'width':
      return draft.width;
    case 'dash':
      return draft.dash;
    case 'arrow':
      return draft.arrow;
    case 'fill':
      if (!draft.fill) return null;
      return assignmentWithPreservedPrefix(
        previous,
        /^((?:fill)\s*=\s*)(?:.*)$/,
        'fill',
        draft.fillColor ?? draft.drawColor ?? draft.color,
      );
    case 'opacity':
      return draft.opacity === null
        ? null
        : assignmentWithPreservedPrefix(
            previous,
            /^((?:fill\s+opacity)\s*=\s*)(?:.*)$/,
            'fill opacity',
            String(draft.opacity),
          );
    case 'drawOpacity':
      return draft.drawOpacity === null
        ? null
        : assignmentWithPreservedPrefix(
            previous,
            /^((?:draw\s+opacity)\s*=\s*)(?:.*)$/,
            'draw opacity',
            String(draft.drawOpacity),
          );
    case 'textOpacity':
      return draft.textOpacity === null
        ? null
        : assignmentWithPreservedPrefix(
            previous,
            /^((?:text\s+opacity)\s*=\s*)(?:.*)$/,
            'text opacity',
            String(draft.textOpacity),
          );
    case 'lineCap':
      return draft.lineCap === null
        ? null
        : assignmentWithPreservedPrefix(
            previous,
            /^((?:line\s+cap)\s*=\s*)(?:.*)$/,
            'line cap',
            draft.lineCap,
          );
    case 'lineJoin':
      return draft.lineJoin === null
        ? null
        : assignmentWithPreservedPrefix(
            previous,
            /^((?:line\s+join)\s*=\s*)(?:.*)$/,
            'line join',
            draft.lineJoin,
          );
    case 'roundedCorners':
      if (draft.roundedCorners === null) return null;
      return assignmentWithPreservedPrefix(
        previous,
        /^((?:rounded\s+corners)\s*=\s*)(?:.*)$/,
        'rounded corners',
        draft.roundedCorners,
      );
    case 'doubleLine':
      return draft.doubleLine ? 'double' : null;
    case 'rotate':
      return draft.rotate === null
        ? null
        : assignmentWithPreservedPrefix(
            previous,
            /^((?:rotate)\s*=\s*)(?:.*)$/,
            'rotate',
            String(draft.rotate),
          );
    case 'scale':
      return draft.scale === null
        ? null
        : assignmentWithPreservedPrefix(
            previous,
            /^((?:scale)\s*=\s*)(?:.*)$/,
            'scale',
            String(draft.scale),
          );
  }
}

function removeOptionAt(raw: string, span: TikzOptionEntry): string {
  if (
    span.interpretedRange
    && (
      span.interpretedRange.start !== span.range.start
      || span.interpretedRange.end !== span.range.end
    )
  ) {
    return raw.slice(0, span.interpretedRange.start)
      + raw.slice(span.interpretedRange.end);
  }
  const hasCommaBefore = span.segmentRange.start > 0
    && raw[span.segmentRange.start - 1] === ',';
  const hasCommaAfter = span.segmentRange.end < raw.length
    && raw[span.segmentRange.end] === ',';
  if (hasCommaBefore) {
    return raw.slice(0, span.segmentRange.start - 1) + raw.slice(span.segmentRange.end);
  }
  if (hasCommaAfter) {
    return raw.slice(0, span.segmentRange.start) + raw.slice(span.segmentRange.end + 1);
  }
  return raw.slice(0, span.segmentRange.start) + raw.slice(span.segmentRange.end);
}

function appendOption(raw: string, option: string): string {
  if (raw.trim().length === 0) return option;
  const trailingWhitespace = raw.match(/\s*$/)?.[0] ?? '';
  const body = raw.slice(0, raw.length - trailingWhitespace.length);
  if (body.endsWith(',')) return `${body}${option}${trailingWhitespace}`;
  if (raw.includes('\n')) {
    const indentation = /(?:^|\n)([ \t]*)[^\n]*$/.exec(body)?.[1] ?? '';
    return `${body},\n${indentation}${option}${trailingWhitespace}`;
  }
  const spaced = /,\s+/.test(raw);
  return `${body},${spaced ? ' ' : ''}${option}${trailingWhitespace}`;
}

export function buildOptionsRaw(
  draft: StyleDraft,
  existingRaw: string | null = null,
  changedKeys: readonly StyleDraftKey[] = ALL_STYLE_KEYS,
): string {
  const groups = [...new Set(changedKeys.map(groupForKey))];
  let nextRaw = existingRaw ?? '';
  for (const group of groups) {
    const spans = parseTikzOptionSequence(nextRaw).entries;
    const target = [...spans]
      .reverse()
      .find((option) => (
        option.interpretedRange
        && styleOptionGroups(option.interpreted).includes(group)
      ));
    const replacement = replacementForGroup(
      group,
      draft,
      target?.interpreted ?? null,
    );
    if (target && replacement !== null) {
      const range = target.interpretedRange ?? target.range;
      nextRaw = nextRaw.slice(0, range.start)
        + replacement
        + nextRaw.slice(range.end);
    } else if (target) {
      nextRaw = removeOptionAt(nextRaw, target);
    } else if (replacement !== null) {
      nextRaw = appendOption(nextRaw, replacement);
    }
  }
  return nextRaw;
}

export function styleDraftFromRaw(raw: string | null): StyleDraft {
  if (!raw) return { ...DEFAULT_STYLE_DRAFT };
  const draft = { ...DEFAULT_STYLE_DRAFT };
  for (const option of parseTikzOptionSequence(raw).entries.map((entry) => entry.interpreted)) {
    if ((STYLE_COLORS as readonly string[]).includes(option)) draft.color = option;
    else if ((STYLE_WIDTHS as readonly string[]).includes(option)) draft.width = option;
    else if ((STYLE_DASHES as readonly string[]).includes(option)) draft.dash = option;
    else if ((STYLE_ARROWS as readonly string[]).includes(option)) draft.arrow = option;
    else if (option === 'draw') draft.drawEnabled = true;
    else if (/^draw\s*=/.test(option)) {
      draft.drawEnabled = true;
      const color = option.slice(option.indexOf('=') + 1).trim();
      draft.drawColor = color || null;
    }
    else if (option === 'fill') draft.fill = true;
    else if (/^color\s*=/.test(option)) {
      const color = option.slice(option.indexOf('=') + 1).trim();
      if (color) draft.color = color;
    }
    else if (/^fill\s*=/.test(option)) {
      draft.fill = true;
      const color = option.slice(option.indexOf('=') + 1).trim();
      draft.fillColor = color || null;
    } else {
      const opacity = /^fill\s+opacity\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)$/.exec(option);
      const drawOpacity = /^draw\s+opacity\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)$/.exec(option);
      const textOpacity = /^text\s+opacity\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)$/.exec(option);
      const lineCap = /^line\s+cap\s*=\s*(round|rect|butt)$/.exec(option);
      const lineJoin = /^line\s+join\s*=\s*(round|bevel|miter)$/.exec(option);
      const rounded = /^rounded\s+corners(?:\s*=\s*(.+))?$/.exec(option);
      const rotate = /^rotate\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(option);
      const scale = /^scale\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(option);
      if (opacity) draft.opacity = Number(opacity[1]);
      else if (drawOpacity) draft.drawOpacity = Number(drawOpacity[1]);
      else if (textOpacity) draft.textOpacity = Number(textOpacity[1]);
      else if (lineCap) draft.lineCap = lineCap[1] as StyleDraft['lineCap'];
      else if (lineJoin) draft.lineJoin = lineJoin[1] as StyleDraft['lineJoin'];
      else if (rounded) draft.roundedCorners = rounded[1]?.trim() || '2pt';
      else if (option === 'double') draft.doubleLine = true;
      else if (rotate) draft.rotate = Number(rotate[1]);
      else if (scale) draft.scale = Number(scale[1]);
    }
  }
  return draft;
}
