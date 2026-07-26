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
  width: string | null;
  dash: string | null;
  arrow: string | null;
  fill: boolean;
  opacity: number | null;
}

export const DEFAULT_STYLE_DRAFT: StyleDraft = {
  color: 'black',
  width: null,
  dash: null,
  arrow: null,
  fill: false,
  opacity: null,
};

export function buildOptionsRaw(draft: StyleDraft): string {
  const options = [
    draft.color === 'black' ? null : draft.color,
    draft.width,
    draft.dash,
    draft.arrow,
    draft.fill ? `fill=${draft.color}` : null,
    draft.opacity === null ? null : `fill opacity=${draft.opacity}`,
  ];
  return options.filter((value): value is string => Boolean(value)).join(',');
}

export function styleDraftFromRaw(raw: string | null): StyleDraft {
  if (!raw) return { ...DEFAULT_STYLE_DRAFT };
  const draft = { ...DEFAULT_STYLE_DRAFT };
  for (const option of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
    if ((STYLE_COLORS as readonly string[]).includes(option)) draft.color = option;
    else if ((STYLE_WIDTHS as readonly string[]).includes(option)) draft.width = option;
    else if ((STYLE_DASHES as readonly string[]).includes(option)) draft.dash = option;
    else if ((STYLE_ARROWS as readonly string[]).includes(option)) draft.arrow = option;
    else if (option.startsWith('fill=')) {
      draft.fill = true;
      const color = option.slice(5).trim();
      if ((STYLE_COLORS as readonly string[]).includes(color)) draft.color = color;
    } else {
      const opacity = /^fill\s+opacity\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)$/.exec(option);
      if (opacity) draft.opacity = Number(opacity[1]);
    }
  }
  return draft;
}
