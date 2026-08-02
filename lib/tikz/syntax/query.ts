import { TIKZ_SYNTAX_CAPABILITIES } from './catalog';
import {
  TIKZ_CATALOG_SOURCE,
  TIKZ_LAYERS,
  TIKZ_RECOGNITION_MODES,
  TIKZ_LIBRARY_NAMES,
  type TikzCapabilityFlags,
  type TikzCatalogLibrary,
  type TikzCatalogSource,
  type TikzLayer,
  type TikzLibraryName,
  type TikzRecognitionMode,
  type TikzSecurityRiskLevel,
  type TikzSyntaxCapability,
} from './types';

export interface TikzSyntaxQuery {
  /** Search title, id, library, section, and the entry's searchable tokens. */
  text?: string;
  layer?: TikzLayer | readonly TikzLayer[];
  library?: TikzCatalogLibrary | readonly TikzCatalogLibrary[];
  recognition?: TikzRecognitionMode | readonly TikzRecognitionMode[];
  capabilities?: Partial<TikzCapabilityFlags>;
  securityRisk?: TikzSecurityRiskLevel | readonly TikzSecurityRiskLevel[];
  /** A non-positive limit means no limit. */
  limit?: number;
}

export interface TikzSyntaxCatalogSummary {
  source: TikzCatalogSource;
  total: number;
  libraryCount: number;
  officialLibraryNames: readonly TikzLibraryName[];
  byLayer: Readonly<Record<TikzLayer, number>>;
  byRecognition: Readonly<Record<TikzRecognitionMode, number>>;
  bySecurityRisk: Readonly<Record<TikzSecurityRiskLevel, number>>;
  capabilityCoverage: Readonly<Record<keyof TikzCapabilityFlags, {
    enabled: number;
    total: number;
    ratio: number;
  }>>;
  exactAndPreserveNotInteractive: {
    count: number;
    ids: readonly string[];
  };
  /** Deliberately explicit product-language claim, suitable for UI copy. */
  canvasEditabilityStatement: string;
}

export interface TikzAiCompactEntry {
  id: string;
  title: string;
  layer: TikzLayer;
  library: TikzCatalogLibrary;
  /** Pinned source URL for grounding; the manual URL is in schema.source. */
  ref: string;
  recognition: TikzRecognitionMode;
  /** Ordered `p s m i e` flags; `-` means the lane is not available. */
  capabilities: string;
  /** Alias retained for clients that use the shorter field name. */
  caps: string;
  securityRisk: TikzSecurityRiskLevel;
  tokens: readonly string[];
}

export interface TikzAiCompactSchema {
  schemaVersion: 'pgf-tikz-capability-v1';
  source: Pick<TikzCatalogSource, 'version' | 'tagSha' | 'manualPages' | 'manualUrl'>;
  capabilityOrder: readonly ['preserve', 'syntax', 'semantic', 'interactive', 'exact'];
  capabilityEncoding: string;
  canvasEditabilityStatement: string;
  entries: readonly TikzAiCompactEntry[];
}

export const CANVAS_EDITABILITY_STATEMENT =
  'Exact TeX rendering and source preservation cover the official surface; neither one implies that a command is editable on the interactive Canvas.' as const;

function asArray<T>(value: T | readonly T[] | undefined): readonly T[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value as readonly T[];
  return [value as T];
}

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchesAny<T>(value: T, filter: T | readonly T[] | undefined): boolean {
  const values = asArray(filter);
  return values === undefined || values.includes(value);
}

function matchesText(entry: TikzSyntaxCapability, text: string | undefined): boolean {
  if (!text) return true;
  const needle = normalizedText(text);
  if (!needle) return true;
  const haystack = [
    entry.id,
    entry.title,
    entry.layer,
    entry.library ?? '',
    entry.officialRef.section,
    ...entry.searchTokens,
  ]
    .join(' ')
    .toLocaleLowerCase();
  return haystack.includes(needle);
}

function matchesCapabilities(
  capabilities: TikzCapabilityFlags,
  filter: Partial<TikzCapabilityFlags> | undefined,
): boolean {
  if (!filter) return true;
  return (Object.keys(filter) as (keyof TikzCapabilityFlags)[]).every(
    (key) => filter[key] === undefined || capabilities[key] === filter[key],
  );
}

function scoreText(entry: TikzSyntaxCapability, text: string): number {
  const needle = normalizedText(text);
  if (!needle) return 0;
  const id = entry.id.toLocaleLowerCase();
  const title = entry.title.toLocaleLowerCase();
  const library = (entry.library ?? '').toLocaleLowerCase();
  if (id === needle || library === needle) return 100;
  if (title === needle) return 90;
  if (id.startsWith(needle) || library.startsWith(needle)) return 80;
  if (title.startsWith(needle)) return 70;
  if (entry.searchTokens.some((token) => token.toLocaleLowerCase() === needle)) return 60;
  return 10;
}

/**
 * Query the pinned catalog without executing TeX. Text queries are ranked by
 * stable lexical signals; all other filters preserve catalog order.
 */
export function queryTikzSyntaxCapabilities(
  query: TikzSyntaxQuery = {},
  catalog: readonly TikzSyntaxCapability[] = TIKZ_SYNTAX_CAPABILITIES,
): readonly TikzSyntaxCapability[] {
  const risk = asArray(query.securityRisk);
  const filtered = catalog.filter((entry) => {
    if (!matchesText(entry, query.text)) return false;
    if (!matchesAny(entry.layer, query.layer)) return false;
    if (!matchesAny(entry.library, query.library)) return false;
    if (!matchesAny(entry.recognition, query.recognition)) return false;
    if (risk && !risk.includes(entry.securityRisk.level)) return false;
    return matchesCapabilities(entry.capabilities, query.capabilities);
  });

  const ranked = query.text
    ? filtered
        .map((entry, index) => ({ entry, index, score: scoreText(entry, query.text!) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map(({ entry }) => entry)
    : filtered;
  if (query.limit === undefined || query.limit <= 0) return ranked;
  return ranked.slice(0, Math.floor(query.limit));
}

/** Alias for command-palette/search consumers. */
export const searchTikzSyntaxCatalog = queryTikzSyntaxCapabilities;
export const findTikzSyntaxCapabilities = queryTikzSyntaxCapabilities;

function emptyRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function coverage(total: number, enabled: number): { enabled: number; total: number; ratio: number } {
  return {
    enabled,
    total,
    ratio: total === 0 ? 0 : Number((enabled / total).toFixed(4)),
  };
}

export function summarizeTikzSyntaxCapabilities(
  catalog: readonly TikzSyntaxCapability[] = TIKZ_SYNTAX_CAPABILITIES,
): TikzSyntaxCatalogSummary {
  const byLayer = emptyRecord(TIKZ_LAYERS);
  const byRecognition = emptyRecord(TIKZ_RECOGNITION_MODES);
  const riskLevels: readonly TikzSecurityRiskLevel[] = [
    'none',
    'low',
    'moderate',
    'high',
    'critical',
  ];
  const bySecurityRisk = emptyRecord(riskLevels);
  const dimensions: (keyof TikzCapabilityFlags)[] = [
    'preserve',
    'syntax',
    'semantic',
    'interactive',
    'exact',
  ];
  const enabled = emptyRecord(dimensions);
  const notInteractive: string[] = [];

  for (const entry of catalog) {
    byLayer[entry.layer] += 1;
    byRecognition[entry.recognition] += 1;
    bySecurityRisk[entry.securityRisk.level] += 1;
    for (const dimension of dimensions) {
      if (entry.capabilities[dimension]) enabled[dimension] += 1;
    }
    if (entry.capabilities.preserve && entry.capabilities.exact && !entry.capabilities.interactive) {
      notInteractive.push(entry.id);
    }
  }

  const capabilityCoverage = Object.fromEntries(
    dimensions.map((dimension) => [dimension, coverage(catalog.length, enabled[dimension])]),
  ) as Readonly<Record<keyof TikzCapabilityFlags, {
    enabled: number;
    total: number;
    ratio: number;
  }>>;

  const presentLibraries = TIKZ_LIBRARY_NAMES.filter((library) =>
    catalog.some((entry) => entry.library === library),
  );

  return {
    source: TIKZ_CATALOG_SOURCE,
    total: catalog.length,
    libraryCount: presentLibraries.length,
    officialLibraryNames: presentLibraries,
    byLayer,
    byRecognition,
    bySecurityRisk,
    capabilityCoverage,
    exactAndPreserveNotInteractive: {
      count: notInteractive.length,
      ids: notInteractive,
    },
    canvasEditabilityStatement: CANVAS_EDITABILITY_STATEMENT,
  };
}

export const summarizeTikzSyntaxCatalog = summarizeTikzSyntaxCapabilities;
export const getTikzSyntaxCapabilitySummary = summarizeTikzSyntaxCapabilities;

function compactCapabilities(capabilities: TikzCapabilityFlags): string {
  return [
    capabilities.preserve ? 'p' : '-',
    capabilities.syntax ? 's' : '-',
    capabilities.semantic ? 'm' : '-',
    capabilities.interactive ? 'i' : '-',
    capabilities.exact ? 'e' : '-',
  ].join('');
}

export const TIKZ_AI_COMPACT_SCHEMA_DESCRIPTOR = {
  schemaVersion: 'pgf-tikz-capability-v1',
  capabilityOrder: ['preserve', 'syntax', 'semantic', 'interactive', 'exact'],
  capabilityEncoding: 'five characters in p s m i e order; a dash means false',
  source: TIKZ_CATALOG_SOURCE,
} as const;

export function createTikzAiCompactSchema(
  catalog: readonly TikzSyntaxCapability[] = TIKZ_SYNTAX_CAPABILITIES,
): TikzAiCompactSchema {
  const entries = catalog.map((entry): TikzAiCompactEntry => {
    const capabilities = compactCapabilities(entry.capabilities);
    return {
      id: entry.id,
      title: entry.title,
      layer: entry.layer,
      library: entry.library,
      ref: entry.officialRef.source,
      recognition: entry.recognition,
      capabilities,
      caps: capabilities,
      securityRisk: entry.securityRisk.level,
      tokens: entry.searchTokens,
    };
  });

  return {
    schemaVersion: 'pgf-tikz-capability-v1',
    source: {
      version: TIKZ_CATALOG_SOURCE.version,
      tagSha: TIKZ_CATALOG_SOURCE.tagSha,
      manualPages: TIKZ_CATALOG_SOURCE.manualPages,
      manualUrl: TIKZ_CATALOG_SOURCE.manualUrl,
    },
    capabilityOrder: ['preserve', 'syntax', 'semantic', 'interactive', 'exact'],
    capabilityEncoding: 'five characters in p s m i e order; a dash means false',
    canvasEditabilityStatement: CANVAS_EDITABILITY_STATEMENT,
    entries,
  };
}

export const buildTikzAiCompactSchema = createTikzAiCompactSchema;
export const toTikzAiCompactSchema = createTikzAiCompactSchema;

export function stringifyTikzAiCompactSchema(
  catalog: readonly TikzSyntaxCapability[] = TIKZ_SYNTAX_CAPABILITIES,
): string {
  return JSON.stringify(createTikzAiCompactSchema(catalog));
}
