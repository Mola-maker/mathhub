export const TIKZ_EXACT_COMPILER_PROFILES = [
  'tikz-standard-v1',
  'tikz-luatex-graphdrawing-v1',
] as const;

export type TikzExactCompilerProfileId =
  typeof TIKZ_EXACT_COMPILER_PROFILES[number];

export interface TikzExactProfileEvidence {
  readonly kind: 'graphdrawing-library' | 'graphdrawing-algorithm' | 'layout-key';
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface TikzExactProfileSelection {
  readonly profile: TikzExactCompilerProfileId;
  readonly reason: 'standard-tikz' | 'lua-graphdrawing-required';
  readonly evidence: TikzExactProfileEvidence | null;
}

const GRAPH_DRAWING_SIGNALS: readonly {
  readonly kind: TikzExactProfileEvidence['kind'];
  readonly pattern: RegExp;
}[] = [
  {
    kind: 'graphdrawing-algorithm',
    pattern: /\\usegdlibrary\s*\{[^}]+\}/u,
  },
  {
    kind: 'graphdrawing-library',
    pattern: /\\usetikzlibrary\s*\{[^}]*\bgraphdrawing\b[^}]*\}/u,
  },
  {
    kind: 'layout-key',
    // Layout algorithms are pgfkeys entries. Braces are deliberately not
    // accepted as boundaries because ordinary node text such as
    // `{spring layout}` must stay on the standard compiler profile.
    pattern: /(?:^|[\[,]\s*)(?:tree|layered|spring|spring electrical|force|circular|radial|random|stress|simple necklace|necklace|phylogenetic)\s+layout\b\s*(?==|[,\]])/imu,
  },
];

function sourceWithoutComments(source: string): string {
  let view = '';
  let offset = 0;
  while (offset < source.length) {
    if (source[offset] === '\\' && offset + 1 < source.length) {
      view += source[offset] + source[offset + 1];
      offset += 2;
      continue;
    }
    if (source[offset] === '%') {
      view += ' ';
      offset += 1;
      while (
        offset < source.length
        && source[offset] !== '\r'
        && source[offset] !== '\n'
      ) {
        view += ' ';
        offset += 1;
      }
      continue;
    }
    view += source[offset];
    offset += 1;
  }
  return view;
}

export function isTikzExactCompilerProfileId(
  value: unknown,
): value is TikzExactCompilerProfileId {
  return typeof value === 'string'
    && TIKZ_EXACT_COMPILER_PROFILES.includes(
      value as TikzExactCompilerProfileId,
    );
}

/**
 * Select the smallest exact runtime that truthfully supports the submitted
 * source. A plain `\\graph` remains on the standard profile; only Lua-backed
 * graph-drawing libraries or layout algorithms select the companion runtime.
 */
export function selectTikzExactCompilerProfile(
  source: string,
): TikzExactProfileSelection {
  const view = sourceWithoutComments(source);
  for (const signal of GRAPH_DRAWING_SIGNALS) {
    const match = signal.pattern.exec(view);
    if (!match || match.index === undefined) continue;
    return {
      profile: 'tikz-luatex-graphdrawing-v1',
      reason: 'lua-graphdrawing-required',
      evidence: {
        kind: signal.kind,
        start: match.index,
        end: match.index + match[0].length,
        text: source.slice(match.index, match.index + match[0].length),
      },
    };
  }
  return {
    profile: 'tikz-standard-v1',
    reason: 'standard-tikz',
    evidence: null,
  };
}
