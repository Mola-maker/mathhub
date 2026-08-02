import {
  PGF_TIKZ_MANUAL_URL,
  PGF_TIKZ_REPOSITORY_URL,
  PGF_TIKZ_TAG_SHA,
  TIKZ_LIBRARY_NAMES,
  type TikzCapabilityFlags,
  type TikzCatalogLibrary,
  type TikzLayer,
  type TikzLibraryName,
  type TikzOfficialReference,
  type TikzRecognitionMode,
  type TikzSecurityRisk,
  type TikzSecurityRiskLevel,
  type TikzSecurityRiskTag,
  type TikzSyntaxCapability,
} from './types';

const SOURCE_ROOT = `${PGF_TIKZ_REPOSITORY_URL}/blob/${PGF_TIKZ_TAG_SHA}`;

function officialReference(sourceFile: string, section: string): TikzOfficialReference {
  return {
    url: PGF_TIKZ_MANUAL_URL,
    source: `${SOURCE_ROOT}/${sourceFile}`,
    section,
  };
}

function laneCapabilities(
  overrides: Partial<TikzCapabilityFlags> = {},
): TikzCapabilityFlags {
  return {
    // The source document is the source of truth. Unknown commands are still
    // retained by the transaction layer, so preservation is intentionally
    // broader than semantic or interactive support.
    preserve: true,
    syntax: true,
    semantic: false,
    interactive: false,
    // Exact rendering is delegated to the isolated TeX service. Some entries
    // require a particular engine/driver; that condition is recorded in notes.
    exact: true,
    ...overrides,
  };
}

function securityRisk(
  level: TikzSecurityRiskLevel,
  tags: readonly TikzSecurityRiskTag[],
  summary: string,
  mitigations: readonly string[],
): TikzSecurityRisk {
  return { level, tags, summary, mitigations };
}

const LOW_RISK = securityRisk(
  'low',
  ['user-content'],
  'User-provided TikZ is still untrusted input even when this surface is declarative.',
  [
    'Compile in the isolated TeX service with shell escape disabled.',
    'Apply request, memory, and wall-clock limits before accepting output.',
  ],
);

const EXPANSION_RISK = securityRisk(
  'moderate',
  ['untrusted-tex', 'macro-expansion', 'resource-exhaustion'],
  'Macro expansion and key handlers can consume significant TeX resources or expose unexpected expansion paths.',
  [
    'Use the compiler allowlist and expansion/resource budgets.',
    'Never execute the input in the Next.js process.',
  ],
);

const DRIVER_RISK = securityRisk(
  'moderate',
  ['untrusted-tex', 'driver-output', 'resource-exhaustion'],
  'Backend-dependent output can exercise driver code and produce unexpectedly large artifacts.',
  [
    'Pin an approved TeX engine and driver profile.',
    'Keep compilation isolated and cap output size and duration.',
  ],
);

const HIGH_LUA_RISK = securityRisk(
  'high',
  ['untrusted-tex', 'lua-runtime', 'resource-exhaustion'],
  'The feature can invoke Lua/graph-drawing runtimes and must not run with ambient host privileges.',
  [
    'Run LuaTeX/graph drawing in a sandbox with no network or filesystem access.',
    'Permit only the pinned PGF modules and enforce CPU/memory limits.',
  ],
);

const HIGH_FILE_RISK = securityRisk(
  'high',
  ['untrusted-tex', 'file-io', 'external-process', 'resource-exhaustion'],
  'The feature can read or write external assets, invoke helpers, or create unbounded artifacts.',
  [
    'Disable shell escape and external file writes for untrusted jobs.',
    'Use a temporary read-only input tree and an allowlisted output directory.',
  ],
);

const HIGH_NETWORK_RISK = securityRisk(
  'high',
  ['untrusted-tex', 'network-reference', 'file-io'],
  'Metadata and external references can become an information-disclosure or resource-exhaustion boundary.',
  [
    'Resolve references only from a local allowlist.',
    'Strip network access from compiler workers and bound included data.',
  ],
);

const HIGH_EXPANSION_RISK = securityRisk(
  'high',
  ['untrusted-tex', 'macro-expansion', 'resource-exhaustion'],
  'Recursive macro or grammar expansion can exhaust the TeX worker even without filesystem or network access.',
  [
    'Apply expansion-depth, CPU, memory, and output-size budgets.',
    'Keep the source in the isolated compiler worker and reject shell escape.',
  ],
);

type CapabilitySeed = {
  id: string;
  title: string;
  layer: TikzLayer;
  sourceFile: string;
  section: string;
  library: TikzCatalogLibrary;
  recognition: TikzRecognitionMode;
  capabilities: TikzCapabilityFlags;
  securityRisk: TikzSecurityRisk;
  searchTokens: readonly string[];
  examples?: readonly string[];
  notes?: readonly string[];
};

function seedToCapability(seed: CapabilitySeed): TikzSyntaxCapability {
  const officialRef = officialReference(seed.sourceFile, seed.section);
  return {
    id: seed.id,
    title: seed.title,
    layer: seed.layer,
    officialRef,
    library: seed.library,
    recognition: seed.recognition,
    capabilities: seed.capabilities,
    securityRisk: seed.securityRisk,
    searchTokens: seed.searchTokens,
    ...(seed.examples ? { examples: seed.examples } : {}),
    ...(seed.notes ? { notes: seed.notes } : {}),
  };
}

const CORE_CAPABILITIES: readonly TikzSyntaxCapability[] = [
  seedToCapability({
    id: 'core:picture',
    title: 'TikZ pictures and scopes',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-design.tex',
    section: 'TikZ core / pictures, styles, and design principles',
    library: 'core',
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['tikzpicture', 'tikz', 'scope', 'style', 'tikzset'],
    examples: ['\\begin{tikzpicture}\\draw (0,0) -- (1,0);\\end{tikzpicture}'],
    notes: ['Canvas edits are emitted as minimal CodeMirror source patches.'],
  }),
  seedToCapability({
    id: 'core:coordinates',
    title: 'Coordinates and coordinate systems',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-coordinates.tex',
    section: 'TikZ core / coordinates',
    library: 'core',
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['coordinate', 'cartesian', 'polar', 'canvas polar', 'node anchor'],
    examples: ['(1,2)', '(30:2cm)', '($(A)!0.5!(B)$)'],
  }),
  seedToCapability({
    id: 'core:paths',
    title: 'Paths, move-to/line-to, curves, and cycles',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-paths.tex',
    section: 'TikZ core / paths',
    library: 'core',
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['draw', 'path', 'move to', 'line to', 'to', 'controls', 'cycle'],
    examples: ['\\draw (0,0) -- (1,0) .. controls (1,1) and (2,1) .. (2,0);'],
  }),
  seedToCapability({
    id: 'core:actions',
    title: 'Path actions, fills, clips, and scopes',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-actions.tex',
    section: 'TikZ core / actions on paths',
    library: 'core',
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['draw', 'fill', 'filldraw', 'clip', 'pattern', 'shade'],
    examples: ['\\fill[blue!20] (0,0) rectangle (2,1);'],
  }),
  seedToCapability({
    id: 'core:nodes',
    title: 'Nodes, labels, anchors, and positioning',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-shapes.tex',
    section: 'TikZ core / nodes and shapes',
    library: 'core',
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['node', 'coordinate', 'label', 'anchor', 'shape', 'text'],
    examples: ['\\node (A) at (0,0) {A};'],
  }),
  seedToCapability({
    id: 'core:matrices',
    title: 'Matrices of nodes',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-matrices.tex',
    section: 'TikZ core / matrices',
    library: 'core',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['matrix', 'matrix of nodes', 'row sep', 'column sep'],
    examples: ['\\matrix (m) [matrix of nodes] { A & B \\\\ C & D \\\\ };'],
    notes: ['Cell expansion and row/column delimiters require TeX-aware parsing.'],
  }),
  seedToCapability({
    id: 'core:graphs',
    title: 'Graph syntax and edge specifications',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-graphs.tex',
    section: 'TikZ core / graph syntax',
    library: 'core',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['graph', 'edge', 'edge from parent', 'graph syntax'],
    examples: ['\\graph { A -- { B, C } };'],
    notes: ['Graph expansion is retained exactly but is not currently a direct drag model.'],
  }),
  seedToCapability({
    id: 'core:pics',
    title: 'Pic scopes and parameterized pictures',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-pics.tex',
    section: 'TikZ core / pics',
    library: 'core',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['pic', 'pics', 'pic type', 'parameterized picture'],
    examples: ['\\pic {seagull};'],
  }),
  seedToCapability({
    id: 'core:plots',
    title: 'Plots and plot handlers',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-plots.tex',
    section: 'TikZ core / plots',
    library: 'core',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['plot', 'plot coordinates', 'domain', 'samples', 'gnuplot'],
    examples: ['\\draw plot[domain=0:1] (\\x,{\\x*\\x});'],
    notes: ['Plot data is exact-renderable; source-level points are not inferred as editable constraints.'],
  }),
  seedToCapability({
    id: 'core:arrows',
    title: 'Arrow tips and line endings',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-arrows.tex',
    section: 'TikZ core / arrow tips',
    library: 'core',
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['arrow', 'arrow tip', 'stealth', 'latex', 'bend'],
    examples: ['\\draw[-{Latex[length=3mm]}] (0,0) -- (1,0);'],
  }),
  seedToCapability({
    id: 'core:transformations',
    title: 'Coordinate and canvas transformations',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-transformations.tex',
    section: 'TikZ core / transformations',
    library: 'core',
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['transform', 'shift', 'scale', 'rotate', 'xshift', 'yshift'],
    examples: ['\\begin{scope}[xshift=1cm,rotate=30] ... \\end{scope}'],
    notes: ['Derived coordinates remain expressions; a drag patches the upstream driver.'],
  }),
  seedToCapability({
    id: 'core:transparency',
    title: 'Transparency groups and opacity',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-transparency.tex',
    section: 'TikZ core / transparency',
    library: 'core',
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['opacity', 'transparency', 'transparency group'],
    examples: ['\\fill[fill opacity=.4] (0,0) circle (1cm);'],
  }),
  seedToCapability({
    id: 'core:decorations',
    title: 'Path decorations',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-decorations.tex',
    section: 'TikZ core / decorations',
    library: 'core',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['decorate', 'decoration', 'markings', 'path morphing'],
    examples: ['\\draw[decorate,decoration={snake}] (0,0) -- (2,0);'],
  }),
  seedToCapability({
    id: 'core:animations',
    title: 'Animations and time-dependent attributes',
    layer: 'core',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-tikz-animations.tex',
    section: 'TikZ core / animations',
    library: 'core',
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['animate', 'animation', 'timeline', 'begin on', 'end on'],
    examples: ['\\fill[animate={fill opacity={0:0;1:1}}] (0,0) circle (1cm);'],
    notes: ['Animation timelines are preserved and exact-rendered only on supported output drivers.'],
  }),
];

const GRAPH_DRAWING_CAPABILITIES: readonly TikzSyntaxCapability[] = [
  seedToCapability({
    id: 'graph-drawing:overview',
    title: 'Graph Drawing system overview',
    layer: 'graph-drawing',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-gd-overview.tex',
    section: 'Graph Drawing / overview and architecture',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: HIGH_LUA_RISK,
    searchTokens: ['graph drawing', 'lua', 'layout', 'node', 'edge'],
    notes: ['Exact output depends on a sandboxed LuaTeX graph-drawing runtime.'],
  }),
  seedToCapability({
    id: 'graph-drawing:usage-tikz',
    title: 'Using graph drawing from TikZ',
    layer: 'graph-drawing',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-gd-usage-tikz.tex',
    section: 'Graph Drawing / usage from TikZ',
    library: 'core',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: HIGH_LUA_RISK,
    searchTokens: ['graph drawing', 'graph', 'layout', 'layered layout', 'spring layout'],
    examples: ['\\graph [layered layout] { a -> b -> c };'],
  }),
  seedToCapability({
    id: 'graph-drawing:binding-layer',
    title: 'Graph Drawing binding layer',
    layer: 'graph-drawing',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-gd-binding-layer.tex',
    section: 'Graph Drawing / binding layer',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: HIGH_LUA_RISK,
    searchTokens: ['binding layer', 'lua binding', 'graph drawing'],
  }),
  seedToCapability({
    id: 'graph-drawing:display-layer',
    title: 'Graph Drawing display layer',
    layer: 'graph-drawing',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-gd-display-layer.tex',
    section: 'Graph Drawing / display layer',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: HIGH_LUA_RISK,
    searchTokens: ['display layer', 'graph drawing', 'render graph'],
  }),
  seedToCapability({
    id: 'graph-drawing:algorithm-layer',
    title: 'Graph Drawing algorithm layer',
    layer: 'graph-drawing',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-gd-algorithm-layer.tex',
    section: 'Graph Drawing / algorithm layer and algorithm parameters',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: HIGH_LUA_RISK,
    searchTokens: ['algorithm layer', 'algorithm', 'layout parameter'],
  }),
  seedToCapability({
    id: 'graph-drawing:ogdf',
    title: 'OGDF and C graph-drawing bindings',
    layer: 'graph-drawing',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-gd-ogdf.tex',
    section: 'Graph Drawing / OGDF algorithms and native bindings',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: HIGH_FILE_RISK,
    searchTokens: ['ogdf', 'native binding', 'c graph drawing'],
    notes: ['The isolated compiler may reject native OGDF algorithms when the worker profile does not provide them.'],
  }),
];

const DATA_VISUALIZATION_CAPABILITIES: readonly TikzSyntaxCapability[] = [
  seedToCapability({
    id: 'data-visualization:introduction',
    title: 'Data Visualization model and command flow',
    layer: 'data-visualization',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-dv-introduction.tex',
    section: 'Data Visualization / introduction',
    library: 'datavisualization',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['datavisualization', 'data visualization', 'visualizer'],
    examples: ['\\datavisualization [school book axes]'],
  }),
  seedToCapability({
    id: 'data-visualization:backend',
    title: 'Data Visualization backend and data pipeline',
    layer: 'data-visualization',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-dv-backend.tex',
    section: 'Data Visualization / backend',
    library: 'datavisualization',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['data pipeline', 'backend', 'data point', 'data store'],
  }),
  seedToCapability({
    id: 'data-visualization:axes',
    title: 'Axes, scales, and coordinate systems',
    layer: 'data-visualization',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-dv-axes.tex',
    section: 'Data Visualization / axes and scales',
    library: 'datavisualization',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['axis', 'axes', 'scale', 'ticks', 'data visualization'],
  }),
  seedToCapability({
    id: 'data-visualization:visualizers',
    title: 'Visualizers and visualizer options',
    layer: 'data-visualization',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-dv-visualizers.tex',
    section: 'Data Visualization / visualizers',
    library: 'datavisualization',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['visualizer', 'scatter', 'bar chart', 'line visualizer'],
  }),
  seedToCapability({
    id: 'data-visualization:stylesheets',
    title: 'Data Visualization stylesheets',
    layer: 'data-visualization',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-dv-stylesheets.tex',
    section: 'Data Visualization / stylesheets',
    library: 'datavisualization',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['stylesheet', 'style sheet', 'data visualization style'],
  }),
  seedToCapability({
    id: 'data-visualization:formats',
    title: 'Data Visualization data formats',
    layer: 'data-visualization',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-dv-formats.tex',
    section: 'Data Visualization / data formats',
    library: 'datavisualization.formats.functions',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['data format', 'function', 'csv', 'data visualization'],
  }),
  seedToCapability({
    id: 'data-visualization:polar',
    title: 'Polar and three-dimensional data visualization',
    layer: 'data-visualization',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-dv-polar.tex',
    section: 'Data Visualization / polar coordinates',
    library: 'datavisualization.polar',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['polar', '3d', 'three dimensional', 'data visualization'],
  }),
];

const UTILITY_CAPABILITIES: readonly TikzSyntaxCapability[] = [
  seedToCapability({
    id: 'utilities:keys',
    title: 'PGF keys and key-value handlers',
    layer: 'utilities',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-pgfkeys.tex',
    section: 'Utilities / pgfkeys',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['pgfkeys', 'key value', '.code', '.style', '.initial'],
    examples: ['\\tikzset{my style/.style={draw,blue}}'],
  }),
  seedToCapability({
    id: 'utilities:filtered-keys',
    title: 'Filtered key handlers',
    layer: 'utilities',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-pgfkeysfiltered.tex',
    section: 'Utilities / filtered keys',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['pgfkeysfiltered', 'filtered key', 'key handler'],
  }),
  seedToCapability({
    id: 'utilities:foreach',
    title: 'Foreach iteration utility',
    layer: 'utilities',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-pgffor.tex',
    section: 'Utilities / pgffor',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['foreach', 'pgffor', 'iteration', 'loop'],
    examples: ['\\foreach \\x in {1,2,3} \\draw (\\x,0) circle (1pt);'],
  }),
  seedToCapability({
    id: 'utilities:calendar',
    title: 'PGF calendar calculations',
    layer: 'utilities',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-pgfcalendar.tex',
    section: 'Utilities / pgfcalendar',
    library: 'calendar',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['calendar', 'date', 'weekday', 'pgfcalendar'],
  }),
  seedToCapability({
    id: 'utilities:pages',
    title: 'Page and shipout utilities',
    layer: 'utilities',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-pages.tex',
    section: 'Utilities / pages',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['pages', 'shipout', 'page background'],
  }),
  seedToCapability({
    id: 'utilities:module-parser',
    title: 'PGF module parser',
    layer: 'utilities',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-module-parser.tex',
    section: 'Utilities / module parser',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['module parser', 'pgf module', 'parser'],
  }),
  seedToCapability({
    id: 'utilities:profiler',
    title: 'PGF profiler and diagnostics',
    layer: 'utilities',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-library-profiler.tex',
    section: 'Utilities / profiler',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['profiler', 'diagnostics', 'performance'],
  }),
];

const MATH_ENGINE_CAPABILITIES: readonly TikzSyntaxCapability[] = [
  seedToCapability({
    id: 'math-engine:parsing',
    title: 'PGF math expression parser',
    layer: 'math-engine',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-math-parsing.tex',
    section: 'Math engines / parsing',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['pgfmath', 'parse', 'expression', 'function'],
    examples: ['\\pgfmathparse{sin(30)}'],
  }),
  seedToCapability({
    id: 'math-engine:commands',
    title: 'PGF math commands',
    layer: 'math-engine',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-math-commands.tex',
    section: 'Math engines / commands',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['pgfmathsetmacro', 'pgfmathparse', 'pgfmathtruncatemacro'],
  }),
  seedToCapability({
    id: 'math-engine:algorithms',
    title: 'PGF math algorithms',
    layer: 'math-engine',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-math-algorithms.tex',
    section: 'Math engines / algorithms',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['math algorithm', 'gcd', 'random', 'round'],
  }),
  seedToCapability({
    id: 'math-engine:number-printing',
    title: 'Number printing and formatting',
    layer: 'math-engine',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-math-numberprinting.tex',
    section: 'Math engines / number printing',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['number printing', 'fixed', 'scientific', 'format number'],
  }),
  seedToCapability({
    id: 'math-engine:design',
    title: 'Math engine design and precision',
    layer: 'math-engine',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-math-design.tex',
    section: 'Math engines / design and precision',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['math design', 'precision', 'floating point'],
  }),
  seedToCapability({
    id: 'math-engine:fpu',
    title: 'Floating point unit (FPU)',
    layer: 'math-engine',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-library-fpu.tex',
    section: 'Math engines / floating point unit',
    library: 'fpu',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['fpu', 'floating point', 'scientific notation'],
    notes: ['FPU precision and overflow behavior are TeX-engine dependent.'],
  }),
  seedToCapability({
    id: 'math-engine:fixed-point',
    title: 'Fixed-point arithmetic engine',
    layer: 'math-engine',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-library-fixedpoint.tex',
    section: 'Math engines / fixed-point arithmetic',
    library: 'fixedpointarithmetic',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['fixed point', 'fixedpointarithmetic', 'arithmetic'],
  }),
  seedToCapability({
    id: 'math-engine:math-library',
    title: 'TikZ math library',
    layer: 'math-engine',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-library-math.tex',
    section: 'Math engines / TikZ math library',
    library: 'math',
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['math library', 'let', 'veclen', 'foreach math'],
    examples: ['\\path let \\p1=(A), \\n1={veclen(\\x1,\\y1)} in ...;'],
  }),
];

const OBJECT_ENGINE_CAPABILITIES: readonly TikzSyntaxCapability[] = [
  seedToCapability({
    id: 'object-engine:overview',
    title: 'PGF object-oriented engine',
    layer: 'object-engine',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-oo.tex',
    section: 'Object engines / object-oriented programming',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['object oriented', 'object', 'class', 'method'],
    notes: ['Object definitions are preserved, but no canvas object mutation is inferred from arbitrary TeX classes.'],
  }),
  seedToCapability({
    id: 'object-engine:classes',
    title: 'Object classes and inheritance',
    layer: 'object-engine',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-oo.tex',
    section: 'Object engines / classes and inheritance',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['class', 'inheritance', 'object class'],
  }),
  seedToCapability({
    id: 'object-engine:attributes',
    title: 'Object attributes and method dispatch',
    layer: 'object-engine',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-oo.tex',
    section: 'Object engines / attributes and methods',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['attribute', 'method dispatch', 'object method'],
  }),
];

const BASIC_LAYER_CAPABILITIES: readonly TikzSyntaxCapability[] = [
  seedToCapability({
    id: 'basic-layer:overview',
    title: 'PGF basic layer overview',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-design.tex',
    section: 'Basic layer / design and concepts',
    library: null,
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['pgf', 'basic layer', 'design'],
  }),
  seedToCapability({
    id: 'basic-layer:paths',
    title: 'PGF basic-layer paths',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-paths.tex',
    section: 'Basic layer / paths',
    library: null,
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['pgfpath', 'basic path', 'path construction'],
  }),
  seedToCapability({
    id: 'basic-layer:actions',
    title: 'PGF basic-layer actions',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-actions.tex',
    section: 'Basic layer / actions',
    library: null,
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['pgfusepath', 'stroke', 'fill', 'clip'],
  }),
  seedToCapability({
    id: 'basic-layer:nodes',
    title: 'PGF basic-layer nodes',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-nodes.tex',
    section: 'Basic layer / nodes',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: true, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['pgfnode', 'basic node', 'anchor'],
  }),
  seedToCapability({
    id: 'basic-layer:scopes',
    title: 'PGF scopes and graphics state',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-scopes.tex',
    section: 'Basic layer / scopes',
    library: null,
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['pgfscope', 'scope', 'graphics state'],
  }),
  seedToCapability({
    id: 'basic-layer:transformations',
    title: 'PGF transformations',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-transformations.tex',
    section: 'Basic layer / transformations',
    library: null,
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['pgftransform', 'transform', 'matrix'],
  }),
  seedToCapability({
    id: 'basic-layer:matrices',
    title: 'PGF matrices',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-matrices.tex',
    section: 'Basic layer / matrices',
    library: null,
    recognition: 'static',
    capabilities: laneCapabilities({ semantic: true, interactive: true }),
    securityRisk: LOW_RISK,
    searchTokens: ['pgfmatrix', 'matrix', 'coordinate transform'],
  }),
  seedToCapability({
    id: 'basic-layer:transparency',
    title: 'PGF transparency',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-transparency.tex',
    section: 'Basic layer / transparency',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['pgftransparency', 'opacity', 'transparency'],
  }),
  seedToCapability({
    id: 'basic-layer:patterns',
    title: 'PGF patterns',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-patterns.tex',
    section: 'Basic layer / patterns',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['pgf pattern', 'pattern', 'pattern color'],
  }),
  seedToCapability({
    id: 'basic-layer:shadings',
    title: 'PGF shadings',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-shadings.tex',
    section: 'Basic layer / shadings',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['pgf shading', 'shade', 'shading'],
  }),
  seedToCapability({
    id: 'basic-layer:decorations',
    title: 'PGF decorations',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-decorations.tex',
    section: 'Basic layer / decorations',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['pgf decoration', 'decoration', 'path replacement'],
  }),
  seedToCapability({
    id: 'basic-layer:plots',
    title: 'PGF plots',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-plots.tex',
    section: 'Basic layer / plots',
    library: null,
    recognition: 'tex-expansion',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: EXPANSION_RISK,
    searchTokens: ['pgfplotstream', 'plot', 'plot stream'],
  }),
  seedToCapability({
    id: 'basic-layer:images',
    title: 'PGF images and external resources',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-images.tex',
    section: 'Basic layer / images',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: HIGH_FILE_RISK,
    searchTokens: ['pgf image', 'image', 'includegraphics', 'external resource'],
  }),
  seedToCapability({
    id: 'basic-layer:animations',
    title: 'PGF basic-layer animations',
    layer: 'basic-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-base-animations.tex',
    section: 'Basic layer / animations',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['pgf animation', 'animation', 'timeline'],
  }),
];

const SYSTEM_LAYER_CAPABILITIES: readonly TikzSyntaxCapability[] = [
  seedToCapability({
    id: 'system-layer:overview',
    title: 'PGF system layer overview',
    layer: 'system-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-pgfsys-overview.tex',
    section: 'System layer / overview',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['pgfsys', 'system layer', 'driver'],
    notes: ['System-layer primitives are backend contracts, not canvas objects.'],
  }),
  seedToCapability({
    id: 'system-layer:commands',
    title: 'System-layer commands',
    layer: 'system-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-pgfsys-commands.tex',
    section: 'System layer / commands',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['pgfsys', 'system command', 'driver command'],
  }),
  seedToCapability({
    id: 'system-layer:paths',
    title: 'System-layer paths',
    layer: 'system-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-pgfsys-paths.tex',
    section: 'System layer / paths',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['pgfsys path', 'driver path', 'system path'],
  }),
  seedToCapability({
    id: 'system-layer:protocol',
    title: 'System-layer protocol',
    layer: 'system-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-pgfsys-protocol.tex',
    section: 'System layer / protocol',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['pgfsys protocol', 'protocol', 'driver protocol'],
  }),
  seedToCapability({
    id: 'system-layer:animations',
    title: 'System-layer animations',
    layer: 'system-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-pgsys-animations.tex',
    section: 'System layer / animations',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['pgfsys animation', 'driver animation'],
  }),
  seedToCapability({
    id: 'system-layer:drivers',
    title: 'Output drivers and backend portability',
    layer: 'system-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-drivers.tex',
    section: 'System layer / drivers',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: DRIVER_RISK,
    searchTokens: ['driver', 'pdftex', 'dvips', 'dvisvgm', 'xetex', 'luatex'],
    notes: ['Exact output is engine/driver specific; the catalog does not promise browser SVG parity.'],
  }),
  seedToCapability({
    id: 'system-layer:externalization',
    title: 'TikZ externalization and generated artifacts',
    layer: 'system-layer',
    sourceFile: 'doc/generic/pgf/pgfmanual-en-library-external.tex',
    section: 'System layer / externalization',
    library: null,
    recognition: 'driver',
    capabilities: laneCapabilities({ semantic: false, interactive: false }),
    securityRisk: HIGH_FILE_RISK,
    searchTokens: ['external', 'externalization', 'tikzexternalize', 'write18', 'shell escape'],
    notes: [
      'Externalization is intentionally classified as a driver/file boundary, not as a Canvas object.',
      'Production workers must disable shell escape and permit only an explicit artifact directory.',
    ],
  }),
];

const LIBRARY_TITLES: Record<TikzLibraryName, string> = {
  '3d': 'Three-dimensional coordinate systems',
  angles: 'Angles and angle quotes',
  animations: 'TikZ animations',
  arrows: 'Arrow tips and arrow declarations',
  automata: 'Finite-state automata',
  babel: 'Babel compatibility',
  backgrounds: 'Backgrounds and fitting scopes',
  bending: 'Bending arrows',
  calc: 'Coordinate calculations',
  calendar: 'Calendars',
  chains: 'Node chains',
  circuits: 'Circuit shapes',
  'circuits.ee': 'Electrical engineering circuit symbols',
  'circuits.ee.IEC': 'IEC electrical engineering symbols',
  'circuits.logic': 'Logic circuit symbols',
  'circuits.logic.CDH': 'CDH logic gate symbols',
  'circuits.logic.IEC': 'IEC logic gate symbols',
  'circuits.logic.US': 'US logic gate symbols',
  datavisualization: 'Data Visualization core library',
  'datavisualization.3d': 'Three-dimensional data visualizers',
  'datavisualization.barcharts': 'Data Visualization bar charts',
  'datavisualization.formats.functions': 'Function data format',
  'datavisualization.polar': 'Polar data visualizers',
  'datavisualization.sparklines': 'Sparkline visualizers',
  decorations: 'Path decorations',
  'decorations.footprints': 'Footprint decorations',
  'decorations.fractals': 'Fractal decorations',
  'decorations.markings': 'Marking decorations',
  'decorations.pathmorphing': 'Path morphing decorations',
  'decorations.pathreplacing': 'Path replacing decorations',
  'decorations.shapes': 'Shape decorations',
  'decorations.text': 'Text decorations',
  er: 'Entity–relationship diagrams',
  fadings: 'Fadings and fading scopes',
  fit: 'Fitting nodes to coordinates',
  fixedpointarithmetic: 'Fixed-point arithmetic',
  folding: 'Paper folding diagrams',
  fpu: 'Floating point unit',
  graphs: 'Graph syntax',
  'graphs.standard': 'Standard graph layouts',
  intersections: 'Path intersections',
  lindenmayersystems: 'Lindenmayer systems',
  math: 'TikZ math expressions',
  matrix: 'Matrix of nodes',
  mindmap: 'Mind maps',
  patterns: 'Pattern fills',
  'patterns.meta': 'Parameterized patterns',
  perspective: 'Perspective projections',
  petri: 'Petri nets',
  plothandlers: 'Plot handlers',
  plotmarks: 'Plot marks',
  positioning: 'Relative node positioning',
  quotes: 'Node and edge quotes',
  rdf: 'RDF diagrams',
  scopes: 'Named scopes',
  shadings: 'Shadings',
  shadows: 'Drop shadows',
  shapes: 'Node shapes',
  'shapes.arrows': 'Arrow node shapes',
  'shapes.callouts': 'Callout node shapes',
  'shapes.gates.logic.IEC': 'IEC logic gate node shapes',
  'shapes.gates.logic.US': 'US logic gate node shapes',
  'shapes.geometric': 'Geometric node shapes',
  'shapes.misc': 'Miscellaneous node shapes',
  'shapes.multipart': 'Multipart node shapes',
  'shapes.symbols': 'Symbol node shapes',
  snakes: 'Legacy snake decorations',
  spy: 'Spy scopes',
  'svg.path': 'SVG path conversion',
  through: 'Nodes through a point',
  topaths: 'To-path syntax',
  trees: 'Tree layouts',
  turtle: 'Turtle graphics',
  views: 'Views and view scopes',
};

const INTERACTIVE_LIBRARIES: ReadonlySet<TikzLibraryName> = new Set([
  '3d',
  'angles',
  'arrows',
  'bending',
  'calc',
  'intersections',
  'matrix',
  'positioning',
  'quotes',
  'shapes',
  'shapes.arrows',
  'shapes.callouts',
  'shapes.geometric',
  'shapes.misc',
  'shapes.multipart',
  'shapes.symbols',
  'through',
  'topaths',
]);

const SEMANTIC_LIBRARIES: ReadonlySet<TikzLibraryName> = new Set([
  ...INTERACTIVE_LIBRARIES,
  'automata',
  'chains',
  'circuits',
  'circuits.ee',
  'circuits.ee.IEC',
  'circuits.logic',
  'circuits.logic.CDH',
  'circuits.logic.IEC',
  'circuits.logic.US',
  'graphs',
  'graphs.standard',
  'mindmap',
  'petri',
  'trees',
]);

const EXPANSION_LIBRARIES: ReadonlySet<TikzLibraryName> = new Set([
  'angles',
  'automata',
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
  'fit',
  'fixedpointarithmetic',
  'folding',
  'fpu',
  'graphs',
  'graphs.standard',
  'lindenmayersystems',
  'math',
  'matrix',
  'mindmap',
  'patterns.meta',
  'perspective',
  'petri',
  'plothandlers',
  'positioning',
  'quotes',
  'rdf',
  'scopes',
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
  'through',
  'topaths',
  'trees',
  'turtle',
  'views',
]);

const DRIVER_LIBRARIES: ReadonlySet<TikzLibraryName> = new Set([
  'animations',
  'babel',
  'backgrounds',
  'fadings',
  'patterns',
  'shadings',
  'shadows',
  'svg.path',
]);

const HIGH_LUA_LIBRARIES: ReadonlySet<TikzLibraryName> = new Set();

const HIGH_EXPANSION_LIBRARIES: ReadonlySet<TikzLibraryName> = new Set([
  'lindenmayersystems',
]);

const HIGH_NETWORK_LIBRARIES: ReadonlySet<TikzLibraryName> = new Set(['rdf']);

function libraryDirectory(name: TikzLibraryName): string {
  if (name === 'circuits' || name.startsWith('circuits.')) return 'circuits';
  if (name === 'datavisualization' || name.startsWith('datavisualization.')) {
    return 'datavisualization';
  }
  if (name === 'graphs' || name.startsWith('graphs.')) return 'graphs';
  return '';
}

function librarySourceFile(name: TikzLibraryName): string {
  const directory = libraryDirectory(name);
  const prefix = directory ? `/${directory}` : '';
  return `tex/generic/pgf/frontendlayer/tikz/libraries${prefix}/tikzlibrary${name}.code.tex`;
}

function humanizeLibrary(name: TikzLibraryName): string {
  return LIBRARY_TITLES[name];
}

function librarySecurity(name: TikzLibraryName): TikzSecurityRisk {
  if (HIGH_NETWORK_LIBRARIES.has(name)) return HIGH_NETWORK_RISK;
  if (HIGH_LUA_LIBRARIES.has(name)) return HIGH_LUA_RISK;
  if (HIGH_EXPANSION_LIBRARIES.has(name)) return HIGH_EXPANSION_RISK;
  if (DRIVER_LIBRARIES.has(name)) return DRIVER_RISK;
  if (EXPANSION_LIBRARIES.has(name)) return EXPANSION_RISK;
  return LOW_RISK;
}

function libraryRecognition(name: TikzLibraryName): TikzRecognitionMode {
  if (DRIVER_LIBRARIES.has(name)) return 'driver';
  if (EXPANSION_LIBRARIES.has(name)) return 'tex-expansion';
  return 'static';
}

function libraryNotes(name: TikzLibraryName): readonly string[] {
  const notes = [
    'The source invocation and unknown options are preserved even when no semantic adapter is available.',
  ];
  if (!INTERACTIVE_LIBRARIES.has(name)) {
    notes.push('Exact rendering and preservation do not imply Canvas editing support for this library.');
  }
  if (HIGH_LUA_LIBRARIES.has(name)) {
    notes.push('Requires a sandboxed LuaTeX/graph-drawing profile for exact rendering.');
  }
  if (HIGH_EXPANSION_LIBRARIES.has(name)) {
    notes.push('Apply strict expansion and resource budgets before exact compilation.');
  }
  if (DRIVER_LIBRARIES.has(name)) {
    notes.push('Output is conditional on the selected TeX backend driver.');
  }
  return notes;
}

function libraryExamples(name: TikzLibraryName): readonly string[] | undefined {
  const examples: Partial<Record<TikzLibraryName, readonly string[]>> = {
    calc: ['($(A)!0.5!(B)$)'],
    intersections: ['\\path[name intersections={of=pathA and pathB}] (intersection-1);'],
    positioning: ['\\node[right=of A] (B) {B};'],
    quotes: ['\\draw (A) to["label"] (B);'],
    matrix: ['\\matrix [matrix of nodes] { A & B \\\\ C & D \\\\ };'],
    graphs: ['\\graph [layered layout] { a -> b -> c };'],
    shapes: ['\\node[ellipse,draw] {shape};'],
    decorations: ['\\draw[decorate,decoration=snake] (0,0) -- (2,0);'],
    'datavisualization.formats.functions': [
      '\\datavisualization [scientific axes] data [format=function] { function x=0..1; };',
    ],
  };
  return examples[name];
}

function libraryCapability(name: TikzLibraryName): TikzSyntaxCapability {
  const semantic = SEMANTIC_LIBRARIES.has(name);
  const interactive = INTERACTIVE_LIBRARIES.has(name);
  return seedToCapability({
    id: `tikz-library:${name}`,
    title: humanizeLibrary(name),
    layer: 'libraries',
    sourceFile: librarySourceFile(name),
    section: `TikZ library / ${name}`,
    library: name,
    recognition: libraryRecognition(name),
    capabilities: laneCapabilities({ semantic, interactive }),
    securityRisk: librarySecurity(name),
    searchTokens: [
      name,
      ...name.split('.'),
      `\\usetikzlibrary{${name}}`,
      humanizeLibrary(name),
    ],
    examples: libraryExamples(name),
    notes: libraryNotes(name),
  });
}

/** One generated entry per official generic front-end `tikzlibrary*.code.tex` file. */
export const TIKZ_LIBRARY_CAPABILITIES: readonly TikzSyntaxCapability[] =
  TIKZ_LIBRARY_NAMES.map(libraryCapability);

/**
 * Complete versioned syntax catalog. The first groups cover major manual
 * chapters; the final group is the exhaustive 74-library table.
 */
export const TIKZ_SYNTAX_CAPABILITIES: readonly TikzSyntaxCapability[] = [
  ...CORE_CAPABILITIES,
  ...GRAPH_DRAWING_CAPABILITIES,
  ...DATA_VISUALIZATION_CAPABILITIES,
  ...UTILITY_CAPABILITIES,
  ...MATH_ENGINE_CAPABILITIES,
  ...OBJECT_ENGINE_CAPABILITIES,
  ...BASIC_LAYER_CAPABILITIES,
  ...SYSTEM_LAYER_CAPABILITIES,
  ...TIKZ_LIBRARY_CAPABILITIES,
];

export const TIKZ_SYNTAX_CATALOG = TIKZ_SYNTAX_CAPABILITIES;
/** Naming aliases for registry-oriented callers. */
export const TIKZ_SYNTAX_CAPABILITY_CATALOG = TIKZ_SYNTAX_CAPABILITIES;
export const PGF_TIKZ_SYNTAX_CAPABILITY_REGISTRY = TIKZ_SYNTAX_CAPABILITIES;

export const TIKZ_SYNTAX_CATALOG_BY_ID: ReadonlyMap<string, TikzSyntaxCapability> =
  new Map(TIKZ_SYNTAX_CAPABILITIES.map((entry) => [entry.id, entry]));

/** A read-only check used by callers and documentation generators. */
export function assertTikzSyntaxCatalogIntegrity(): void {
  const ids = new Set<string>();
  for (const entry of TIKZ_SYNTAX_CAPABILITIES) {
    if (ids.has(entry.id)) throw new Error(`Duplicate TikZ syntax capability id: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.title || !entry.officialRef.url || !entry.officialRef.source) {
      throw new Error(`Incomplete TikZ syntax capability: ${entry.id}`);
    }
    if (entry.library && entry.library !== 'core' && !TIKZ_LIBRARY_NAMES.includes(entry.library)) {
      throw new Error(`Unknown TikZ library in capability: ${entry.id}`);
    }
  }
  const catalogLibraries = new Set(
    TIKZ_LIBRARY_CAPABILITIES
      .map((entry) => entry.library)
      .filter((library): library is TikzLibraryName => library !== null && library !== 'core'),
  );
  for (const library of TIKZ_LIBRARY_NAMES) {
    if (!catalogLibraries.has(library)) {
      throw new Error(`Missing official TikZ library in catalog: ${library}`);
    }
  }
}
