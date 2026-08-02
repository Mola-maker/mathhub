/**
 * Checked-in seed artifact for PGF/TikZ 3.1.11a.
 *
 * The complete artifact is produced by `tools/generate-pgf-registry.mjs` from
 * a caller-supplied, pinned local checkout. This seed intentionally contains
 * representative official surfaces and an explicit dynamic/unsupported
 * record so consumers can exercise the preservation boundary before a local
 * source scan is available. It must not be mistaken for exhaustive TeX
 * execution semantics.
 */

import {
  validatePgfUpstreamRegistry,
  type PgfCapabilityEntry,
  type PgfEffects,
  type PgfRegistryLanes,
  type PgfSecurityPolicy,
  type PgfUpstreamRegistry,
  type PgfUpstreamSource,
} from '../upstream-registry';

const VERSION = '3.1.11a' as const;
const SHA = '839974a3f895bfb86f5a8bc155f0886c918f1bff' as const;
const REPOSITORY = 'https://github.com/pgf-tikz/pgf' as const;
const MANUAL = 'https://pgf-tikz.github.io/pgf/pgfmanual.pdf' as const;

const source = (path: string, line?: readonly [number, number]): PgfUpstreamSource => ({
  repository: REPOSITORY,
  version: VERSION,
  sha: SHA,
  path,
  ...(line ? { line } : {}),
});

const LOW_SECURITY: PgfSecurityPolicy = {
  level: 'low',
  tags: ['user-content'],
  summary: 'Declarative user TikZ remains untrusted input.',
  mitigations: ['Compile only in the isolated TeX service.', 'Bound request, memory, and output size.'],
};

const EXPANSION_SECURITY: PgfSecurityPolicy = {
  level: 'moderate',
  tags: ['untrusted-tex', 'macro-expansion', 'resource-exhaustion'],
  summary: 'Key handlers and macro expansion may consume TeX resources.',
  mitigations: ['Apply expansion/resource budgets.', 'Never execute source in the Next.js process.'],
};

const DYNAMIC_SECURITY: PgfSecurityPolicy = {
  level: 'high',
  tags: ['untrusted-tex', 'macro-expansion', 'resource-exhaustion', 'external-process'],
  summary: 'Dynamic TeX source cannot be safely interpreted by the static scanner.',
  mitigations: ['Preserve and route to isolated exact TeX.', 'Reject Canvas writeback and cap execution.'],
};

const interactiveLanes: PgfRegistryLanes = {
  preserve: true,
  parse: 'full',
  preview: 'plugin',
  exact: 'server',
};

const inspectOnlyLanes: PgfRegistryLanes = {
  preserve: true,
  parse: 'partial',
  preview: 'opaque',
  exact: 'server',
};

const opaqueLanes: PgfRegistryLanes = {
  preserve: true,
  parse: 'opaque',
  preview: 'opaque',
  exact: 'server',
};

const pathEffects: PgfEffects = {
  scope: 'local',
  expansion: 'none',
  outputs: [{ kind: 'path', sourceBound: true }],
};

const pointEffects: PgfEffects = {
  scope: 'local',
  expansion: 'none',
  outputs: [{ kind: 'coordinate', sourceBound: true }],
};

const staticEntry = (
  partial: Omit<PgfCapabilityEntry, 'upstream'> & { sourcePath: string; sourceLine?: readonly [number, number] },
): PgfCapabilityEntry => {
  const { sourcePath, sourceLine, ...entry } = partial;
  return { ...entry, upstream: source(sourcePath, sourceLine) };
};

const entries: readonly PgfCapabilityEntry[] = [
  staticEntry({
    id: 'pgf-3.1.11a:command:draw',
    title: '\\draw path command',
    surface: 'command',
    status: 'static',
    sourcePath: 'tex/generic/pgf/frontendlayer/tikz/tikz.code.tex',
    namespaces: ['/tikz'],
    valueGrammar: { kind: 'path', description: 'TikZ path terminated by semicolon' },
    effects: pathEffects,
    lanes: interactiveLanes,
    writeback: 'transaction-only',
    security: LOW_SECURITY,
  }),
  staticEntry({
    id: 'pgf-3.1.11a:command:path',
    title: '\\path command',
    surface: 'command',
    status: 'static',
    sourcePath: 'tex/generic/pgf/frontendlayer/tikz/tikz.code.tex',
    namespaces: ['/tikz'],
    valueGrammar: { kind: 'path', description: 'Path expression terminated by semicolon' },
    effects: pathEffects,
    lanes: interactiveLanes,
    writeback: 'transaction-only',
    security: LOW_SECURITY,
  }),
  staticEntry({
    id: 'pgf-3.1.11a:command:coordinate',
    title: '\\coordinate declaration',
    surface: 'command',
    status: 'static',
    sourcePath: 'tex/generic/pgf/frontendlayer/tikz/tikz.code.tex',
    namespaces: ['/tikz'],
    valueGrammar: {
      kind: 'coordinate',
      description: 'Named coordinate followed by an at-coordinate expression',
      args: [
        { name: 'name', grammar: 'token' },
        { name: 'coordinate', grammar: 'coordinate' },
      ],
    },
    effects: pointEffects,
    lanes: interactiveLanes,
    writeback: 'transaction-only',
    security: LOW_SECURITY,
  }),
  staticEntry({
    id: 'pgf-3.1.11a:command:node',
    title: '\\node declaration',
    surface: 'command',
    status: 'static',
    sourcePath: 'tex/generic/pgf/frontendlayer/tikz/tikz.code.tex',
    namespaces: ['/tikz'],
    valueGrammar: { kind: 'balanced-group', description: 'Node options, anchor/coordinate, and balanced text group' },
    effects: { scope: 'local', expansion: 'tex', outputs: [{ kind: 'node', sourceBound: true }] },
    lanes: inspectOnlyLanes,
    writeback: 'transaction-only',
    security: EXPANSION_SECURITY,
  }),
  staticEntry({
    id: 'pgf-3.1.11a:environment:tikzpicture',
    title: 'tikzpicture environment',
    surface: 'environment',
    status: 'static',
    sourcePath: 'tex/generic/pgf/frontendlayer/tikz/tikz.code.tex',
    namespaces: ['/tikz'],
    valueGrammar: { kind: 'balanced-group', description: 'Balanced TikZ command stream' },
    effects: { scope: 'group', expansion: 'tex', outputs: [{ kind: 'scene', sourceBound: true }] },
    lanes: inspectOnlyLanes,
    writeback: 'transaction-only',
    security: EXPANSION_SECURITY,
  }),
  staticEntry({
    id: 'pgf-3.1.11a:key:/tikz/name path',
    title: 'name path key',
    surface: 'key',
    status: 'static',
    sourcePath: 'tex/generic/pgf/frontendlayer/tikz/tikz.code.tex',
    namespaces: ['/tikz'],
    keyPath: '/tikz/name path',
    valueGrammar: { kind: 'token', description: 'Path name token' },
    effects: { scope: 'local', expansion: 'macro', outputs: [{ kind: 'named-path', sourceBound: true }] },
    lanes: inspectOnlyLanes,
    writeback: 'transaction-only',
    security: EXPANSION_SECURITY,
  }),
  staticEntry({
    id: 'pgf-3.1.11a:key:/tikz/name intersections',
    title: 'name intersections key',
    surface: 'key',
    status: 'static',
    sourcePath: 'tex/generic/pgf/frontendlayer/tikz/libraries/tikzlibraryintersections.code.tex',
    namespaces: ['/tikz', '/tikz/intersections'],
    keyPath: '/tikz/name intersections',
    valueGrammar: { kind: 'key-value', description: 'of=pathA and pathB, by=prefix' },
    effects: {
      scope: 'local',
      expansion: 'foreach',
      outputs: [{ kind: 'coordinate', name: 'intersection-*', sourceBound: true }],
    },
    lanes: inspectOnlyLanes,
    writeback: 'transaction-only',
    security: EXPANSION_SECURITY,
  }),
  staticEntry({
    id: 'pgf-3.1.11a:handler:pgfkeys-code',
    title: 'pgfkeys .code handler',
    surface: 'handler',
    status: 'static',
    sourcePath: 'tex/generic/pgf/utilities/pgfkeys.code.tex',
    namespaces: ['/pgf', '/pgf/keys'],
    keyPath: '/handlers/.code',
    valueGrammar: { kind: 'balanced-group', description: 'Executable TeX handler body' },
    effects: { scope: 'group', expansion: 'tex', outputs: [] },
    lanes: opaqueLanes,
    writeback: 'never',
    security: EXPANSION_SECURITY,
    notes: ['Handler bodies are preserved but are not Canvas-editable source declarations.'],
  }),
  staticEntry({
    id: 'pgf-3.1.11a:library:intersections',
    title: 'intersections TikZ library',
    surface: 'library',
    status: 'static',
    sourcePath: 'tex/generic/pgf/frontendlayer/tikz/libraries/tikzlibraryintersections.code.tex',
    namespaces: ['/tikz/intersections'],
    valueGrammar: { kind: 'none', description: '\\usetikzlibrary{intersections}' },
    effects: { scope: 'document', expansion: 'macro', outputs: [{ kind: 'derived-coordinate', sourceBound: true }] },
    lanes: inspectOnlyLanes,
    writeback: 'transaction-only',
    security: EXPANSION_SECURITY,
  }),
  staticEntry({
    id: 'pgf-3.1.11a:library:calc',
    title: 'calc TikZ library',
    surface: 'library',
    status: 'static',
    sourcePath: 'tex/generic/pgf/frontendlayer/tikz/libraries/tikzlibrarycalc.code.tex',
    namespaces: ['/tikz/calc'],
    valueGrammar: { kind: 'expression', description: 'Coordinate interpolation expression' },
    effects: { scope: 'document', expansion: 'macro', outputs: [{ kind: 'coordinate-expression', sourceBound: true }] },
    lanes: inspectOnlyLanes,
    writeback: 'transaction-only',
    security: EXPANSION_SECURITY,
  }),
  staticEntry({
    id: 'pgf-3.1.11a:pgf-function:veclen',
    title: 'PGF math veclen function',
    surface: 'pgf-function',
    status: 'static',
    sourcePath: 'tex/generic/pgf/math/pgfmathfunctions.basic.code.tex',
    namespaces: ['/pgf/math'],
    valueGrammar: {
      kind: 'expression',
      description: 'veclen(x,y) numeric expression',
      args: [{ name: 'arguments', grammar: 'number', repeatable: true }],
    },
    effects: { scope: 'local', expansion: 'none', outputs: [{ kind: 'number', sourceBound: true }] },
    lanes: inspectOnlyLanes,
    writeback: 'safe',
    security: LOW_SECURITY,
  }),
  staticEntry({
    id: 'pgf-3.1.11a:dynamic:tikz.code.tex',
    title: 'dynamic TeX constructs in tikz.code.tex',
    surface: 'handler',
    status: 'dynamic',
    sourcePath: 'tex/generic/pgf/frontendlayer/tikz/tikz.code.tex',
    namespaces: ['/tikz'],
    valueGrammar: { kind: 'dynamic', description: 'Macro-generated key paths or command bodies' },
    effects: { scope: 'group', expansion: 'dynamic', outputs: [] },
    lanes: opaqueLanes,
    writeback: 'never',
    security: DYNAMIC_SECURITY,
    diagnostics: [
      {
        code: 'dynamic-macro',
        message: 'Static scanning cannot expand dynamic macro/key construction; preserve source and route exact rendering to TeX.',
        source: source('tex/generic/pgf/frontendlayer/tikz/tikz.code.tex'),
      },
    ],
  }),
  staticEntry({
    id: 'pgf-3.1.11a:unsupported:graph-mini-language',
    title: 'graph library mini-language',
    surface: 'handler',
    status: 'unsupported',
    sourcePath: 'tex/generic/pgf/frontendlayer/tikz/libraries/graphs/tikzlibrarygraphs.code.tex',
    namespaces: ['/tikz/graphs'],
    valueGrammar: { kind: 'opaque', description: 'Graph quote/foreach grammar requires TeX execution' },
    effects: { scope: 'local', expansion: 'foreach', outputs: [{ kind: 'expanded-graph', sourceBound: true }] },
    lanes: opaqueLanes,
    writeback: 'never',
    security: DYNAMIC_SECURITY,
    diagnostics: [
      {
        code: 'unsupported-surface',
        message: 'Graph quote and foreach expansion is preserved as opaque source until an approved execution-product adapter exists.',
        source: source('tex/generic/pgf/frontendlayer/tikz/libraries/graphs/tikzlibrarygraphs.code.tex'),
      },
    ],
  }),
];

const RAW_REGISTRY: PgfUpstreamRegistry = {
  manifest: {
    schema: 'pgf-upstream-registry/v1',
    upstream: { repository: REPOSITORY, version: VERSION, sha: SHA, manual: MANUAL },
    generatedBy: 'checked-in seed; regenerate from an explicit local PGF checkout',
    scanner: { mode: 'static-source-scan', dynamicMacrosPreserved: true, networkAccess: 'disabled' },
    diagnostics: [
      {
        code: 'unrecognized-source',
        message: 'This checked-in seed is representative, not an exhaustive scan. Run the local-only generator for a full source inventory.',
        source: source('tex/generic/pgf'),
      },
    ],
  },
  entries,
};

export const PGF_3_1_11A_REGISTRY = validatePgfUpstreamRegistry(RAW_REGISTRY);
export const PGF_TIKZ_UPSTREAM_REGISTRY = PGF_3_1_11A_REGISTRY;

