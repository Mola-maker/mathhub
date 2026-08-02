import { TIKZ_SYNTAX_CAPABILITIES } from './catalog';
import {
  createTikzAiCompactSchema,
  queryTikzSyntaxCapabilities,
  type TikzAiCompactSchema,
} from './query';
import type { TikzSyntaxCapability } from './types';
import {
  indexPgfUpstreamRegistry,
  listPgfRegistryDiagnostics,
  queryPgfUpstreamRegistry,
  type PgfCapabilityEntry,
  type PgfRegistryEntryStatus,
} from './upstream-registry';
import { PGF_TIKZ_UPSTREAM_REGISTRY } from './generated/pgf-3.1.11a-registry';

const ALWAYS_INCLUDE = new Set([
  'core:picture',
  'core:coordinates',
  'core:paths',
  'core:actions',
  'core:nodes',
  'core:transformations',
  'utilities:keys',
  'utilities:foreach',
  'math-engine:parsing',
  'system-layer:drivers',
]);

const INTENT_TOKENS: readonly [RegExp, readonly string[]][] = [
  [/(鍦唡鍦嗗懆|澶栨帴鍦唡鍐呭垏鍦唡涔濈偣鍦唡circle|circum|incircle)/i, ['circle', 'through']],
  [/(浜ょ偣|鐩镐氦|鏍硅酱|radical axis|intersection)/i, ['intersections', 'name path']],
  [/(瑙抾瑙掑钩鍒嗙嚎|鍨傜洿|鍨傝冻|涓瀭绾縷angle|perpendicular)/i, ['angles', 'quotes']],
  [/(鍙嶆紨|inversion)/i, ['circle', 'calc', 'intersections']],
  [/(骞宠|parallel)/i, ['calc', 'transformations']],
  [/(鍥涜竟褰瀹屽叏鍥涜竟褰鍦嗗唴鎺ュ洓杈瑰舰|quadrilateral)/i, ['intersections', 'calc']],
  [/(鐭╅樀|matrix)/i, ['matrix']],
  [/(鍥捐|鍥惧竷灞€|graph drawing|layout)/i, ['graph drawing', 'graphs']],
  [/(鏍憒tree)/i, ['trees']],
  [/(绠ご|鍚戦噺|arrow|vector)/i, ['arrows']],
  [/(瑁呴グ|decorate|decoration)/i, ['decorations']],
  [/(鍥炬|绾圭悊|pattern)/i, ['patterns']],
  [/(娓愬彉|闃村奖|shade|shading|fading)/i, ['shadings', 'fadings']],
  [/(涓夌淮|閫忚|3d|perspective)/i, ['3d', 'perspective']],
  [/(寰幆|閲嶅|foreach|repeat)/i, ['foreach']],
  [/(鍑芥暟|鏇茬嚎|plot|curve)/i, ['plots']],
  [/(鍔ㄧ敾|animate|animation)/i, ['animations']],
  [/(鏁版嵁|鏁版嵁鍙鍖東鍥捐〃|data visualization|chart)/i, ['datavisualization']],
  [/(鐢佃矾|circuit)/i, ['circuits']],
  [/(鑷姩鏈簗浣╃壒閲岀綉|automata|petri)/i, ['automata', 'petri']],
  [/(鎬濈淮瀵煎浘|mindmap)/i, ['mindmap']],
  [/(浣滅敤鍩焲scope)/i, ['scopes']],
  [/(鍙樻崲|鏃嬭浆|缂╂斁|骞崇Щ|transform|rotate|scale|shift)/i, ['transformations']],
];

/**
 * Geometry-intent aliases for the source-level PGF registry. The existing
 * catalog remains the broad capability index; these aliases only guide a
 * bounded upstream query and do not claim that every TeX construct is
 * semantically editable.
 */
/* const LEGACY_UPSTREAM_INTENT_TOKENS: readonly [RegExp, readonly string[]][] = [
//
  [/(鍦嗘垨鍦嗗懆|circle|circum|incircle)/i, ['draw', 'coordinate', 'intersections', 'veclen']],
  [/(浜ょ偣|鐩镐氦|radical axis|intersection)/i, ['name intersections', 'name path', 'intersections']],
  [/(瑙掑钩鍒嗙嚎|鍨傜洿|鍨傝冻|angle|perpendicular)/i, ['path', 'coordinate', 'calc']],
  [/(鍙嶆紨|inversion)/i, ['coordinate', 'calc', 'veclen']],
  [/(matrix|鐭╅樀)/i, ['matrix']],
  [/(graph drawing|layout|鍥捐|鍥惧竷灞€)/i, ['graphs', 'graph']],
  [/(foreach|repeat|寰幆|閲嶅)/i, ['foreach']],
  [/(plot|curve|鍑芥暟|鏇茬嚎)/i, ['pgf-function', 'plot']],
  [/(transform|rotate|scale|shift|鍙樻崲|鏃嬭浆|缂╂斁|骞崇Щ)/i, ['transformations', 'coordinate']],
];

//
]; */
const UPSTREAM_INTENT_TOKENS: readonly [RegExp, readonly string[]][] = [
  [/(\u5706|\u5916\u63a5\u5706|\u5185\u5207\u5706|circle|circum|incircle)/i, ['draw', 'coordinate', 'intersections', 'veclen']],
  [/(\u4ea4\u70b9|\u76f8\u4ea4|radical axis|intersection)/i, ['name intersections', 'name path', 'intersections']],
  [/(\u89d2\u5e73\u5206|\u5782\u76f4|\u5782\u8db3|angle|perpendicular)/i, ['path', 'coordinate', 'calc']],
  [/(\u53cd\u6f14|inversion)/i, ['coordinate', 'calc', 'veclen']],
  [/(\u77e9\u9635|matrix)/i, ['matrix']],
  [/(\u56fe\u8bba|\u56fe\u5e03\u5c40|graph drawing|layout)/i, ['graphs', 'graph']],
  [/(\u5faa\u73af|\u91cd\u590d|foreach|repeat)/i, ['foreach']],
  [/(\u51fd\u6570|\u66f2\u7ebf|plot|curve)/i, ['pgf-function', 'plot']],
  [/(\u53d8\u6362|\u65cb\u8f6c|\u7f29\u653e|\u5e73\u79fb|transform|rotate|scale|shift)/i, ['transformations', 'coordinate']],
];

const NORMALIZED_INTENT_TOKENS: readonly [RegExp, readonly string[]][] = [
  [/(\u4e5d\u70b9\u5706|\u5916\u63a5\u5706|\u5185\u5207\u5706|\u5706|nine-point circle|circumcircle|incircle|circle)/i, ['circle', 'through']],
  [/(\u6839\u8f74|\u4ea4\u70b9|\u76f8\u4ea4|radical axis|intersection)/i, ['intersections', 'name path']],
  [/(\u89d2\u5e73\u5206|\u5782\u76f4|\u5782\u8db3|angle bisector|perpendicular)/i, ['angles', 'quotes']],
  [/(\u53cd\u6f14|inversion)/i, ['circle', 'calc', 'intersections']],
  [/(\u5e73\u884c|parallel)/i, ['calc', 'transformations']],
  [/(\u5b8c\u5168\u56db\u8fb9\u5f62|\u5706\u5185\u63a5\u56db\u8fb9\u5f62|\u56db\u8fb9\u5f62|quadrilateral)/i, ['intersections', 'calc']],
  [/(\u77e9\u9635|matrix)/i, ['matrix']],
  [/(\u56fe\u8bba|\u56fe\u5e03\u5c40|graph drawing|layout)/i, ['graph drawing', 'graphs']],
  [/(\u6811|tree)/i, ['trees']],
  [/(\u7bad\u5934|\u5411\u91cf|arrow|vector)/i, ['arrows']],
  [/(\u88c5\u9970|decorate|decoration)/i, ['decorations']],
  [/(\u56fe\u6848|pattern)/i, ['patterns']],
  [/(\u9634\u5f71|\u6e10\u53d8|shade|shading|fading)/i, ['shadings', 'fadings']],
  [/(\u4e09\u7ef4|\u900f\u89c6|3d|perspective)/i, ['3d', 'perspective']],
  [/(\u5faa\u73af|\u91cd\u590d|foreach|repeat)/i, ['foreach']],
  [/(\u51fd\u6570|\u66f2\u7ebf|plot|curve)/i, ['plots']],
  [/(\u52a8\u753b|animate|animation)/i, ['animations']],
  [/(\u6570\u636e\u53ef\u89c6\u5316|\u56fe\u8868|data visualization|chart)/i, ['datavisualization']],
  [/(\u7535\u8def|circuit)/i, ['circuits']],
  [/(\u81ea\u52a8\u673a|\u4f69\u7279\u91cc\u7f51|automata|petri)/i, ['automata', 'petri']],
  [/(\u601d\u7ef4\u5bfc\u56fe|mindmap)/i, ['mindmap']],
  [/(\u4f5c\u7528\u57df|scope)/i, ['scopes']],
  [/(\u53d8\u6362|\u65cb\u8f6c|\u7f29\u653e|\u5e73\u79fb|transform|rotate|scale|shift)/i, ['transformations']],
];

// Keep the legacy English aliases while the normalized table supplies
// encoding-stable Chinese geometry intents.
const ACTIVE_INTENT_TOKENS: readonly [RegExp, readonly string[]][] = [
  ...INTENT_TOKENS,
  ...NORMALIZED_INTENT_TOKENS,
];

const UPSTREAM_INDEX = indexPgfUpstreamRegistry(PGF_TIKZ_UPSTREAM_REGISTRY);
const UPSTREAM_CONTEXT_MIN_ENTRIES = 8;
const UPSTREAM_CONTEXT_MAX_ENTRIES = 24;
const UPSTREAM_BOUNDARY_CORE_LIMIT = 4;
const UPSTREAM_BOUNDARY_DYNAMIC_LIMIT = 4;

export interface TikzAiUpstreamCompactEntry {
  id: string;
  title: string;
  surface: PgfCapabilityEntry['surface'];
  status: PgfRegistryEntryStatus;
  provenance: {
    version: string;
    sha: string;
    path: string;
    line?: readonly [number, number];
  };
  namespaces: readonly string[];
  keyPath?: string;
  grammar: {
    kind: PgfCapabilityEntry['valueGrammar']['kind'];
    description?: string;
  };
  effects: {
    scope: PgfCapabilityEntry['effects']['scope'];
    expansion: PgfCapabilityEntry['effects']['expansion'];
    outputs: readonly string[];
  };
  lanes: PgfCapabilityEntry['lanes'];
  writeback: PgfCapabilityEntry['writeback'];
  security: {
    level: PgfCapabilityEntry['security']['level'];
    tags: readonly PgfCapabilityEntry['security']['tags'][number][];
  };
  diagnostics?: readonly string[];
}

export interface TikzAiUpstreamCapabilityContext {
  schemaVersion: 'pgf-upstream-capability-v1';
  /** Static scanning is intentionally not a claim of complete TeX semantics. */
  exhaustive: false;
  source: {
    repository: string;
    version: string;
    sha: string;
    manual?: string;
    generatedBy: string;
    scanner: 'static-source-scan';
    networkAccess: 'disabled';
  };
  selection: {
    intentTokens: readonly string[];
    maxEntries: number;
    returnedEntries: number;
    boundary: {
      coreIds: readonly string[];
      dynamicIds: readonly string[];
      dynamicEntryCount: number;
      dynamicBoundaryTruncated: boolean;
    };
  };
  entries: readonly TikzAiUpstreamCompactEntry[];
  diagnostics: readonly { code: string; message: string }[];
  capabilityStatement: string;
}

/** Backward-compatible compact schema plus the bounded upstream language view. */
export interface TikzAiCapabilityContext extends TikzAiCompactSchema {
  upstream: TikzAiUpstreamCapabilityContext;
}

function relevantTokens(problem: string): string[] {
  const tokens = new Set(
    problem.match(/[A-Za-z][A-Za-z0-9_.-]*/g)?.map((token) => token.toLowerCase())
    ?? [],
  );
  for (const [pattern, values] of ACTIVE_INTENT_TOKENS) {
    if (!pattern.test(problem)) continue;
    for (const value of values) tokens.add(value);
  }
  return [...tokens];
}

function relevantUpstreamTokens(problem: string): string[] {
  const tokens = new Set(relevantTokens(problem));
  for (const [pattern, values] of UPSTREAM_INTENT_TOKENS) {
    if (!pattern.test(problem)) continue;
    for (const value of values) tokens.add(value);
  }
  return [...tokens];
}

function boundedUpstreamLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return UPSTREAM_CONTEXT_MIN_ENTRIES;
  return Math.max(
    UPSTREAM_CONTEXT_MIN_ENTRIES,
    Math.min(UPSTREAM_CONTEXT_MAX_ENTRIES, Math.floor(value)),
  );
}

function isCoreUpstreamEntry(entry: PgfCapabilityEntry): boolean {
  if (entry.status !== 'static') return false;
  if (!['command', 'environment', 'key'].includes(entry.surface)) return false;
  const haystack = [entry.id, entry.title, entry.keyPath ?? '', ...entry.namespaces]
    .join(' ')
    .toLowerCase();
  return ['draw', 'path', 'coordinate', 'tikzpicture', 'node'].some((token) => haystack.includes(token));
}

function isDynamicBoundaryEntry(entry: PgfCapabilityEntry): boolean {
  return entry.status !== 'static';
}

export function selectTikzCapabilitiesForAi(
  problem: string,
  maxEntries = 36,
): readonly TikzSyntaxCapability[] {
  const selected = new Map<string, TikzSyntaxCapability>();
  for (const entry of TIKZ_SYNTAX_CAPABILITIES) {
    if (ALWAYS_INCLUDE.has(entry.id)) selected.set(entry.id, entry);
  }
  for (const token of relevantTokens(problem)) {
    for (const entry of queryTikzSyntaxCapabilities({ text: token, limit: 8 })) {
      selected.set(entry.id, entry);
      if (selected.size >= maxEntries) return [...selected.values()];
    }
  }
  return [...selected.values()].slice(0, maxEntries);
}

/**
 * Select source-level capabilities by geometry intent while always retaining
 * a small core and dynamic/unsupported boundary. The lower bound is deliberate:
 * a one-entry context would hide the preservation and security contract.
 */
export function selectTikzUpstreamCapabilitiesForAi(
  problem: string,
  maxEntries = 16,
): readonly PgfCapabilityEntry[] {
  const limit = boundedUpstreamLimit(maxEntries);
  const selected = new Map<string, PgfCapabilityEntry>();
  const core = UPSTREAM_INDEX.registry.entries.filter(isCoreUpstreamEntry).slice(0, UPSTREAM_BOUNDARY_CORE_LIMIT);
  const dynamic = UPSTREAM_INDEX.registry.entries.filter(isDynamicBoundaryEntry).slice(0, UPSTREAM_BOUNDARY_DYNAMIC_LIMIT);
  for (const entry of [...core, ...dynamic]) selected.set(entry.id, entry);

  for (const token of relevantUpstreamTokens(problem)) {
    for (const entry of queryPgfUpstreamRegistry(UPSTREAM_INDEX, { text: token, limit: 8 })) {
      selected.set(entry.id, entry);
      if (selected.size >= limit) return [...selected.values()].slice(0, limit);
    }
  }
  return [...selected.values()].slice(0, limit);
}

function compactDiagnosticMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`;
}

function compactUpstreamEntry(entry: PgfCapabilityEntry): TikzAiUpstreamCompactEntry {
  const compact: TikzAiUpstreamCompactEntry = {
    id: entry.id,
    title: entry.title,
    surface: entry.surface,
    status: entry.status,
    provenance: {
      version: entry.upstream.version,
      sha: entry.upstream.sha,
      path: entry.upstream.path,
      ...(entry.upstream.line ? { line: entry.upstream.line } : {}),
    },
    namespaces: entry.namespaces,
    grammar: {
      kind: entry.valueGrammar.kind,
      ...(entry.valueGrammar.description ? { description: entry.valueGrammar.description } : {}),
    },
    effects: {
      scope: entry.effects.scope,
      expansion: entry.effects.expansion,
      outputs: entry.effects.outputs.map((output) => output.name ? `${output.kind}:${output.name}` : output.kind),
    },
    lanes: entry.lanes,
    writeback: entry.writeback,
    security: {
      level: entry.security.level,
      tags: entry.security.tags,
    },
  };
  if (entry.keyPath) compact.keyPath = entry.keyPath;
  if (entry.diagnostics?.length) {
    compact.diagnostics = entry.diagnostics.map((diagnostic) => `${diagnostic.code}: ${compactDiagnosticMessage(diagnostic.message)}`);
  }
  return compact;
}

export function buildTikzUpstreamCapabilityContextForAi(
  problem: string,
  maxEntries = 16,
): TikzAiUpstreamCapabilityContext {
  const limit = boundedUpstreamLimit(maxEntries);
  const intentTokens = relevantUpstreamTokens(problem);
  const selected = selectTikzUpstreamCapabilitiesForAi(problem, limit);
  const allDynamic = UPSTREAM_INDEX.registry.entries.filter(isDynamicBoundaryEntry);
  const coreIds = UPSTREAM_INDEX.registry.entries
    .filter(isCoreUpstreamEntry)
    .slice(0, UPSTREAM_BOUNDARY_CORE_LIMIT)
    .map((entry) => entry.id);
  const dynamicIds = allDynamic
    .slice(0, UPSTREAM_BOUNDARY_DYNAMIC_LIMIT)
    .map((entry) => entry.id);
  const manifest = UPSTREAM_INDEX.registry.manifest;
  const upstream = manifest.upstream;
  const diagnostics = listPgfRegistryDiagnostics(UPSTREAM_INDEX.registry)
    .slice(0, 8)
    .map((diagnostic) => ({ code: diagnostic.code, message: compactDiagnosticMessage(diagnostic.message) }));
  return {
    schemaVersion: 'pgf-upstream-capability-v1',
    exhaustive: false,
    source: {
      repository: upstream.repository,
      version: upstream.version,
      sha: upstream.sha,
      ...(upstream.manual ? { manual: upstream.manual } : {}),
      generatedBy: manifest.generatedBy,
      scanner: manifest.scanner.mode,
      networkAccess: manifest.scanner.networkAccess,
    },
    selection: {
      intentTokens,
      maxEntries: limit,
      returnedEntries: selected.length,
      boundary: {
        coreIds,
        dynamicIds,
        dynamicEntryCount: allDynamic.length,
        dynamicBoundaryTruncated: allDynamic.length > dynamicIds.length,
      },
    },
    entries: selected.map(compactUpstreamEntry),
    diagnostics,
    capabilityStatement: 'This is a bounded, non-exhaustive static registry view. It preserves official provenance and lane/security/writeback boundaries; dynamic or unsupported TeX remains exact-renderable source, not Canvas-editable geometry.',
  };
}

export function buildTikzCapabilityContextForAi(
  problem: string,
  maxEntries = 36,
): TikzAiCapabilityContext {
  return {
    ...createTikzAiCompactSchema(selectTikzCapabilitiesForAi(problem, maxEntries)),
    upstream: buildTikzUpstreamCapabilityContextForAi(problem),
  };
}

export function stringifyTikzCapabilityContextForAi(
  problem: string,
  maxEntries = 36,
): string {
  return JSON.stringify(buildTikzCapabilityContextForAi(problem, maxEntries));
}
