/**
 * Versioned PGF/TikZ syntax capability types.
 *
 * The catalog deliberately models the product lanes separately: preserving
 * source bytes and producing an exact TeX render are not the same as making a
 * command editable on the interactive canvas.
 */

export const PGF_TIKZ_VERSION = '3.1.11a' as const;
export type PgfTikzVersion = typeof PGF_TIKZ_VERSION;

export const PGF_TIKZ_TAG_SHA =
  '839974a3f895bfb86f5a8bc155f0886c918f1bff' as const;

export const PGF_TIKZ_MANUAL_PAGE_COUNT = 1323 as const;

export const PGF_TIKZ_MANUAL_URL =
  'https://pgf-tikz.github.io/pgf/pgfmanual.pdf' as const;

export const PGF_TIKZ_REPOSITORY_URL =
  'https://github.com/pgf-tikz/pgf' as const;

export const PGF_TIKZ_TAG_URL =
  `${PGF_TIKZ_REPOSITORY_URL}/tree/${PGF_TIKZ_TAG_SHA}` as const;

export type TikzLayer =
  | 'core'
  | 'graph-drawing'
  | 'libraries'
  | 'data-visualization'
  | 'utilities'
  | 'math-engine'
  | 'object-engine'
  | 'basic-layer'
  | 'system-layer';

export const TIKZ_LAYERS: readonly TikzLayer[] = [
  'core',
  'graph-drawing',
  'libraries',
  'data-visualization',
  'utilities',
  'math-engine',
  'object-engine',
  'basic-layer',
  'system-layer',
];

export type TikzRecognitionMode = 'static' | 'tex-expansion' | 'driver';

export const TIKZ_RECOGNITION_MODES: readonly TikzRecognitionMode[] = [
  'static',
  'tex-expansion',
  'driver',
];

/** Capability flags for the five independently verifiable product lanes. */
export interface TikzCapabilityFlags {
  /** Untouched source bytes and unsupported blocks can survive a transaction. */
  preserve: boolean;
  /** The scanner/grammar can identify the command, key, or library surface. */
  syntax: boolean;
  /** A stable semantic projection can be built for the supported subset. */
  semantic: boolean;
  /** A canvas command can safely edit the source through a semantic patch. */
  interactive: boolean;
  /** The isolated TeX service can render the construct exactly. */
  exact: boolean;
}

export type TikzSecurityRiskLevel = 'none' | 'low' | 'moderate' | 'high' | 'critical';

export type TikzSecurityRiskTag =
  | 'untrusted-tex'
  | 'macro-expansion'
  | 'file-io'
  | 'shell-escape'
  | 'lua-runtime'
  | 'driver-output'
  | 'resource-exhaustion'
  | 'external-process'
  | 'network-reference'
  | 'user-content';

export interface TikzSecurityRisk {
  level: TikzSecurityRiskLevel;
  tags: readonly TikzSecurityRiskTag[];
  summary: string;
  mitigations: readonly string[];
}

export interface TikzOfficialReference {
  /** The canonical manual URL (the 1323-page PDF for this pinned release). */
  url: typeof PGF_TIKZ_MANUAL_URL;
  /** A stable source URL at the pinned commit, useful when PDF anchors move. */
  source: string;
  /** Human-readable manual chapter/section name. */
  section: string;
  /** Optional printed-page hint; ranges are intentionally omitted when not verified. */
  pages?: string;
}

/**
 * Every official generic front-end `tikzlibrary*.code.tex` name in the
 * `frontendlayer/tikz/libraries` tree of the 3.1.11a tag.
 *
 * This is intentionally a typed tuple rather than an open string array. It
 * prevents a typo from silently creating a second, non-official library name
 * and lets consumers use `TikzLibraryName` for exhaustive switches.
 */
export const TIKZ_LIBRARY_NAMES = [
  '3d',
  'angles',
  'animations',
  'arrows',
  'automata',
  'babel',
  'backgrounds',
  'bending',
  'calc',
  'calendar',
  'chains',
  'circuits',
  'circuits.ee',
  'circuits.ee.IEC',
  'circuits.logic',
  'circuits.logic.CDH',
  'circuits.logic.IEC',
  'circuits.logic.US',
  'datavisualization',
  'datavisualization.3d',
  'datavisualization.barcharts',
  'datavisualization.formats.functions',
  'datavisualization.polar',
  'datavisualization.sparklines',
  'decorations',
  'decorations.footprints',
  'decorations.fractals',
  'decorations.markings',
  'decorations.pathmorphing',
  'decorations.pathreplacing',
  'decorations.shapes',
  'decorations.text',
  'er',
  'fadings',
  'fit',
  'fixedpointarithmetic',
  'folding',
  'fpu',
  'graphs',
  'graphs.standard',
  'intersections',
  'lindenmayersystems',
  'math',
  'matrix',
  'mindmap',
  'patterns',
  'patterns.meta',
  'perspective',
  'petri',
  'plothandlers',
  'plotmarks',
  'positioning',
  'quotes',
  'rdf',
  'scopes',
  'shadings',
  'shadows',
  'shapes',
  'shapes.arrows',
  'shapes.callouts',
  'shapes.gates.logic.IEC',
  'shapes.gates.logic.US',
  'shapes.geometric',
  'shapes.misc',
  'shapes.multipart',
  'shapes.symbols',
  'snakes',
  'spy',
  'svg.path',
  'through',
  'topaths',
  'trees',
  'turtle',
  'views',
] as const;

export type TikzLibraryName = (typeof TIKZ_LIBRARY_NAMES)[number];

export type TikzCatalogLibrary = TikzLibraryName | 'core' | null;

export interface TikzSyntaxCapability {
  /** Stable, version-scoped identifier. */
  id: string;
  title: string;
  layer: TikzLayer;
  officialRef: TikzOfficialReference;
  /** `null` means a manual section rather than a `tikzlibrary` package. */
  library: TikzCatalogLibrary;
  recognition: TikzRecognitionMode;
  capabilities: TikzCapabilityFlags;
  securityRisk: TikzSecurityRisk;
  /** Search aliases used by CodeMirror command palettes and AI retrieval. */
  searchTokens: readonly string[];
  /** Optional minimal snippets; examples are never executed by the catalog. */
  examples?: readonly string[];
  /** Honest limitations and engine/driver conditions. */
  notes?: readonly string[];
}

/** Compatibility vocabulary used by the architecture draft registry. */
export type TikzDraftLayer =
  | 'tikz'
  | 'graph-drawing'
  | 'library'
  | 'data-visualization'
  | 'utility'
  | 'math-engine'
  | 'pgf-basic'
  | 'pgf-system'
  | 'tex-runtime';

export type TikzDraftSyntaxLevel = 'classified' | 'opaque';
export type TikzDraftSemanticLevel = 'none' | 'partial' | 'complete';
export type TikzDraftInteractiveLevel = 'none' | 'inspect' | 'edit';
export type TikzDraftExactLevel = 'compiler' | 'driver-dependent' | 'blocked-by-policy';
export type TikzDraftSecurityRisk = 'none' | 'resource' | 'file-io' | 'shell' | 'network' | 'driver';

export interface TikzDraftCapabilityProjection {
  id: string;
  pgfVersion: PgfTikzVersion;
  officialRef: string;
  layer: TikzDraftLayer;
  recognition: TikzRecognitionMode;
  preserve: true;
  syntax: TikzDraftSyntaxLevel;
  semantic: TikzDraftSemanticLevel;
  interactive: TikzDraftInteractiveLevel;
  exact: TikzDraftExactLevel;
  securityRisk: TikzDraftSecurityRisk;
}

export function toTikzDraftLayer(layer: TikzLayer): TikzDraftLayer {
  switch (layer) {
    case 'core':
      return 'tikz';
    case 'libraries':
      return 'library';
    case 'utilities':
      return 'utility';
    case 'object-engine':
      return 'tex-runtime';
    case 'basic-layer':
      return 'pgf-basic';
    case 'system-layer':
      return 'pgf-system';
    default:
      return layer;
  }
}

export function toTikzDraftCapabilities(
  capabilities: TikzCapabilityFlags,
  recognition: TikzRecognitionMode,
): Pick<
  TikzDraftCapabilityProjection,
  'preserve' | 'syntax' | 'semantic' | 'interactive' | 'exact'
> {
  return {
    preserve: true,
    syntax: capabilities.syntax ? 'classified' : 'opaque',
    semantic: capabilities.semantic
      ? capabilities.interactive
        ? 'complete'
        : 'partial'
      : 'none',
    interactive: capabilities.interactive
      ? 'edit'
      : capabilities.semantic
        ? 'inspect'
        : 'none',
    exact: capabilities.exact
      ? recognition === 'driver'
        ? 'driver-dependent'
        : 'compiler'
      : 'blocked-by-policy',
  };
}

export function toTikzDraftSecurityRisk(risk: TikzSecurityRisk): TikzDraftSecurityRisk {
  if (risk.tags.includes('shell-escape')) return 'shell';
  if (risk.tags.includes('network-reference')) return 'network';
  if (risk.tags.includes('file-io') || risk.tags.includes('external-process')) return 'file-io';
  if (risk.tags.includes('driver-output')) return 'driver';
  if (risk.tags.includes('resource-exhaustion') || risk.tags.includes('macro-expansion')) {
    return 'resource';
  }
  return 'none';
}

/** Build the draft shape on demand; catalog entries remain the sole source of truth. */
export function toTikzDraftCapability(
  capability: TikzSyntaxCapability,
): TikzDraftCapabilityProjection {
  return {
    id: capability.id,
    pgfVersion: PGF_TIKZ_VERSION,
    officialRef: capability.officialRef.source,
    layer: toTikzDraftLayer(capability.layer),
    recognition: capability.recognition,
    ...toTikzDraftCapabilities(capability.capabilities, capability.recognition),
    securityRisk: toTikzDraftSecurityRisk(capability.securityRisk),
  };
}

export interface TikzCatalogSource {
  version: PgfTikzVersion;
  tagSha: typeof PGF_TIKZ_TAG_SHA;
  manualPages: typeof PGF_TIKZ_MANUAL_PAGE_COUNT;
  manualUrl: typeof PGF_TIKZ_MANUAL_URL;
  repositoryUrl: typeof PGF_TIKZ_REPOSITORY_URL;
  tagUrl: typeof PGF_TIKZ_TAG_URL;
}

export const TIKZ_CATALOG_SOURCE: TikzCatalogSource = {
  version: PGF_TIKZ_VERSION,
  tagSha: PGF_TIKZ_TAG_SHA,
  manualPages: PGF_TIKZ_MANUAL_PAGE_COUNT,
  manualUrl: PGF_TIKZ_MANUAL_URL,
  repositoryUrl: PGF_TIKZ_REPOSITORY_URL,
  tagUrl: PGF_TIKZ_TAG_URL,
};
