/**
 * GeoGebra command index — synced from the official manual:
 * https://github.com/geogebra/manual → scripts/sync-geogebra-manual.mjs
 *
 * Regenerate: npm run ggb:sync
 */
import generated from '@/lib/math/geogebra-command-index.generated.json';

export type GgbCommandCategory = keyof typeof generated.categories;

export const GGB_MANUAL_BASE = generated.manualBase;
export const GGB_INDEX_META = {
  syncedAt: generated.syncedAt,
  sourceRepo: generated.sourceRepo,
  sourceRef: generated.sourceRef,
  categoryCount: generated.categoryCount,
  uniqueCommandCount: generated.uniqueCommandCount,
} as const;

/** TriangleCenter index → name (official manual). */
export const TRIANGLE_CENTER_INDEX: Record<number, string> = {
  1: 'Incenter',
  2: 'Centroid',
  3: 'Circumcenter',
  4: 'Orthocenter',
  5: 'Nine-point center',
};

export const GGB_COMMAND_INDEX: Record<GgbCommandCategory, readonly string[]> =
  generated.categories as Record<GgbCommandCategory, readonly string[]>;

/** All unique command names across categories (canonical lookup set). */
export function getAllIndexedCommandNames(): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const names of Object.values(GGB_COMMAND_INDEX)) {
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export function isCommandIndexed(name: string): boolean {
  return getAllIndexedCommandNames().includes(name);
}

export type GgbCommandHit = {
  name: string;
  category: GgbCommandCategory;
  manualUrl: string;
};

export function manualUrlForCommand(name: string): string {
  return `${GGB_MANUAL_BASE}/${name}/`;
}

/** Search command names (case-insensitive substring). */
export function searchGgbCommands(
  query: string,
  options: { category?: GgbCommandCategory; limit?: number } = {},
): GgbCommandHit[] {
  const q = query.trim().toLowerCase();
  const limit = options.limit ?? 30;
  const hits: GgbCommandHit[] = [];
  const categories = options.category
    ? ([options.category] as GgbCommandCategory[])
    : (Object.keys(GGB_COMMAND_INDEX) as GgbCommandCategory[]);

  for (const cat of categories) {
    for (const name of GGB_COMMAND_INDEX[cat]) {
      if (!q || name.toLowerCase().includes(q)) {
        hits.push({ name, category: cat, manualUrl: manualUrlForCommand(name) });
      }
    }
  }

  hits.sort((a, b) => {
    const aExact = a.name.toLowerCase() === q ? 0 : 1;
    const bExact = b.name.toLowerCase() === q ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.name.localeCompare(b.name);
  });

  return hits.slice(0, limit);
}

/** Category summary for system prompt — full 502-name list is too large; use SERVER COMMAND LOOKUP. */
export function formatCompactCommandIndexForPrompt(): string {
  const cats = Object.entries(GGB_COMMAND_INDEX) as [GgbCommandCategory, readonly string[]][];
  const lines: string[] = [
    `OFFICIAL COMMAND INDEX (${GGB_INDEX_META.uniqueCommandCount} commands, ${GGB_INDEX_META.categoryCount} categories)`,
    `Synced from ${GGB_INDEX_META.sourceRepo}@${GGB_INDEX_META.sourceRef} (${GGB_INDEX_META.syncedAt.slice(0, 10)})`,
    `Manual: ${GGB_MANUAL_BASE}/`,
    '',
    'TRIANGLE CENTERS — TriangleCenter(A,B,C,n): 1=Incenter 2=Centroid 3=Circumcenter 4=Orthocenter',
    'NEVER invent TriangleCircumcenter, Circumcenter, DefTriangleCenter, tkz*, TikZ.',
    '',
    'CATEGORIES (use SERVER COMMAND LOOKUP signatures for this problem):',
    ...cats.map(([cat, names]) => `  ${cat}: ${names.length} commands`),
  ];
  return lines.join('\n');
}
