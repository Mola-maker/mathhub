/**
 * Lossless, source-pinned PGF/TikZ capability registry.
 *
 * This registry is deliberately different from the interactive command
 * palette in `lib/tikz/commands`. It describes the upstream language surface
 * and its execution boundary. A generated registry can classify a command or
 * key without pretending that TeX's dynamic macro system is statically
 * understood. Unknown and dynamic entries are therefore first-class records
 * with provenance and diagnostics.
 */

export const PGF_UPSTREAM_REGISTRY_SCHEMA = 'pgf-upstream-registry/v1' as const;
export type PgfUpstreamRegistrySchema = typeof PGF_UPSTREAM_REGISTRY_SCHEMA;

export type PgfRegistrySurface =
  | 'command'
  | 'environment'
  | 'key'
  | 'handler'
  | 'library'
  | 'pgf-function';

export type PgfRegistryEntryStatus = 'static' | 'unsupported' | 'dynamic';

export type PgfScopeEffect = 'local' | 'group' | 'document';
export type PgfExpansionEffect = 'none' | 'macro' | 'foreach' | 'tex' | 'dynamic';

export type PgfParseLane = 'full' | 'partial' | 'opaque';
export type PgfPreviewLane = 'plugin' | 'opaque';
export type PgfExactLane = 'tex' | 'wasm' | 'server' | 'blocked';

export type PgfWritebackPolicy = 'safe' | 'transaction-only' | 'never';
export type PgfSecurityLevel = 'none' | 'low' | 'moderate' | 'high' | 'critical';

export type PgfSecurityTag =
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

export interface PgfUpstreamSource {
  readonly repository: string;
  /** A release/tag name, for example `3.1.11a`. */
  readonly version: string;
  /** A full immutable commit SHA; short hashes are rejected by validation. */
  readonly sha: string;
  /** Path inside the pinned checkout, never an absolute host path. */
  readonly path: string;
  readonly line?: readonly [number, number];
}

export type PgfValueGrammarKind =
  | 'none'
  | 'token'
  | 'balanced-group'
  | 'key-value'
  | 'path'
  | 'coordinate'
  | 'number'
  | 'dimension'
  | 'expression'
  | 'opaque'
  | 'dynamic';

export interface PgfValueGrammar {
  readonly kind: PgfValueGrammarKind;
  /** Human-readable grammar name, e.g. `key=value,...` or `tikz path`. */
  readonly description?: string;
  /** Optional non-executing hint used by parser/AI retrieval. */
  readonly pattern?: string;
  readonly args?: readonly PgfArgumentSpec[];
}

export interface PgfArgumentSpec {
  readonly name: string;
  readonly grammar: PgfValueGrammarKind;
  readonly optional?: boolean;
  readonly repeatable?: boolean;
}

export interface PgfExecutionOutput {
  readonly kind: string;
  readonly name?: string;
  readonly description?: string;
  /** Generated output is read-only in Canvas and maps back to source origin. */
  readonly sourceBound?: boolean;
}

export interface PgfEffects {
  readonly scope: PgfScopeEffect;
  readonly expansion: PgfExpansionEffect;
  readonly outputs: readonly PgfExecutionOutput[];
}

export interface PgfRegistryLanes {
  /** Source bytes are retained even when all other lanes are opaque. */
  readonly preserve: true;
  readonly parse: PgfParseLane;
  readonly preview: PgfPreviewLane;
  readonly exact: PgfExactLane;
}

export interface PgfSecurityPolicy {
  readonly level: PgfSecurityLevel;
  readonly tags: readonly PgfSecurityTag[];
  readonly summary: string;
  readonly mitigations: readonly string[];
}

export type PgfDiagnosticCode =
  | 'dynamic-macro'
  | 'unsupported-surface'
  | 'malformed-source'
  | 'unrecognized-source'
  | 'dynamic-key-path'
  /** Scanner bookkeeping only; this never changes the non-exhaustive claim. */
  | 'scanner-entry-deduplication';

export interface PgfRegistryDiagnostic {
  readonly code: PgfDiagnosticCode;
  readonly message: string;
  readonly source: PgfUpstreamSource;
}

export interface PgfCapabilityEntry {
  /** Stable id; generated ids include the pinned upstream version. */
  readonly id: string;
  readonly title: string;
  readonly surface: PgfRegistrySurface;
  readonly status: PgfRegistryEntryStatus;
  readonly upstream: PgfUpstreamSource;
  /** `/tikz`, `/pgf`, `/pgf/number format`, or a library namespace. */
  readonly namespaces: readonly string[];
  /** Present for key/handler entries; omitted for command-only surfaces. */
  readonly keyPath?: string;
  readonly valueGrammar: PgfValueGrammar;
  readonly effects: PgfEffects;
  readonly lanes: PgfRegistryLanes;
  readonly writeback: PgfWritebackPolicy;
  readonly security: PgfSecurityPolicy;
  readonly diagnostics?: readonly PgfRegistryDiagnostic[];
  /** Static scanner notes and source-specific provenance. */
  readonly notes?: readonly string[];
}

export interface PgfRegistryManifest {
  readonly schema: PgfUpstreamRegistrySchema;
  readonly upstream: Omit<PgfUpstreamSource, 'path' | 'line'> & {
    readonly manual?: string;
  };
  readonly generatedBy: string;
  readonly generatedAt?: string;
  readonly scanner: {
    readonly mode: 'static-source-scan';
    readonly dynamicMacrosPreserved: true;
    readonly networkAccess: 'disabled';
  };
  readonly diagnostics: readonly PgfRegistryDiagnostic[];
}

export interface PgfUpstreamRegistry {
  readonly manifest: PgfRegistryManifest;
  readonly entries: readonly PgfCapabilityEntry[];
}

const SURFACES: readonly PgfRegistrySurface[] = [
  'command',
  'environment',
  'key',
  'handler',
  'library',
  'pgf-function',
];
const STATUSES: readonly PgfRegistryEntryStatus[] = ['static', 'unsupported', 'dynamic'];
const GRAMMARS: readonly PgfValueGrammarKind[] = [
  'none',
  'token',
  'balanced-group',
  'key-value',
  'path',
  'coordinate',
  'number',
  'dimension',
  'expression',
  'opaque',
  'dynamic',
];
const SCOPES: readonly PgfScopeEffect[] = ['local', 'group', 'document'];
const EXPANSIONS: readonly PgfExpansionEffect[] = ['none', 'macro', 'foreach', 'tex', 'dynamic'];
const PARSE_LANES: readonly PgfParseLane[] = ['full', 'partial', 'opaque'];
const PREVIEW_LANES: readonly PgfPreviewLane[] = ['plugin', 'opaque'];
const EXACT_LANES: readonly PgfExactLane[] = ['tex', 'wasm', 'server', 'blocked'];
const WRITEBACK: readonly PgfWritebackPolicy[] = ['safe', 'transaction-only', 'never'];
const SECURITY_LEVELS: readonly PgfSecurityLevel[] = [
  'none',
  'low',
  'moderate',
  'high',
  'critical',
];
const SECURITY_TAGS: readonly PgfSecurityTag[] = [
  'untrusted-tex',
  'macro-expansion',
  'file-io',
  'shell-escape',
  'lua-runtime',
  'driver-output',
  'resource-exhaustion',
  'external-process',
  'network-reference',
  'user-content',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new Error(`Invalid PGF registry at ${path}: ${message}`);
}

function stringAt(value: unknown, path: string, options: { nonEmpty?: boolean } = {}): string {
  if (typeof value !== 'string' || (options.nonEmpty && value.trim() === '')) {
    fail(path, 'expected a non-empty string');
  }
  return value;
}

function enumAt<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(path, `expected one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function arrayAt(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value;
}

function optionalStringAt(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return stringAt(value, path);
}

function validateUpstreamSource(value: unknown, path: string): PgfUpstreamSource {
  if (!isRecord(value)) fail(path, 'expected an object');
  const sha = stringAt(value.sha, `${path}.sha`, { nonEmpty: true });
  if (!/^[0-9a-f]{40}$/i.test(sha)) fail(`${path}.sha`, 'expected a full 40-character hexadecimal SHA');
  const source: PgfUpstreamSource = {
    repository: stringAt(value.repository, `${path}.repository`, { nonEmpty: true }),
    version: stringAt(value.version, `${path}.version`, { nonEmpty: true }),
    sha,
    path: stringAt(value.path, `${path}.path`, { nonEmpty: true }),
  };
  if (source.path.startsWith('/') || source.path.includes('\\') || /^[A-Za-z]:[\\/]/.test(source.path) || source.path.split('/').includes('..')) {
    fail(`${path}.path`, 'must be a relative provenance path inside the pinned checkout');
  }
  if (value.line !== undefined) {
    const line = arrayAt(value.line, `${path}.line`);
    if (line.length !== 2 || !line.every((item) => Number.isInteger(item) && (item as number) > 0)) {
      fail(`${path}.line`, 'expected [positive start line, positive end line]');
    }
    (source as { line?: readonly [number, number] }).line = [line[0] as number, line[1] as number];
  }
  return source;
}

function validateArgument(value: unknown, path: string): PgfArgumentSpec {
  if (!isRecord(value)) fail(path, 'expected an object');
  const result: PgfArgumentSpec = {
    name: stringAt(value.name, `${path}.name`, { nonEmpty: true }),
    grammar: enumAt(value.grammar, GRAMMARS, `${path}.grammar`),
  };
  if (value.optional !== undefined && typeof value.optional !== 'boolean') fail(`${path}.optional`, 'expected boolean');
  if (value.repeatable !== undefined && typeof value.repeatable !== 'boolean') fail(`${path}.repeatable`, 'expected boolean');
  if (value.optional !== undefined) (result as { optional?: boolean }).optional = value.optional as boolean;
  if (value.repeatable !== undefined) (result as { repeatable?: boolean }).repeatable = value.repeatable as boolean;
  return result;
}

function validateValueGrammar(value: unknown, path: string): PgfValueGrammar {
  if (!isRecord(value)) fail(path, 'expected an object');
  const result: PgfValueGrammar = { kind: enumAt(value.kind, GRAMMARS, `${path}.kind`) };
  const description = optionalStringAt(value.description, `${path}.description`);
  const pattern = optionalStringAt(value.pattern, `${path}.pattern`);
  if (description !== undefined) (result as { description?: string }).description = description;
  if (pattern !== undefined) (result as { pattern?: string }).pattern = pattern;
  if (value.args !== undefined) {
    const args = arrayAt(value.args, `${path}.args`).map((item, index) => validateArgument(item, `${path}.args[${index}]`));
    (result as { args?: readonly PgfArgumentSpec[] }).args = args;
  }
  return result;
}

function validateEffects(value: unknown, path: string): PgfEffects {
  if (!isRecord(value)) fail(path, 'expected an object');
  const outputs = arrayAt(value.outputs, `${path}.outputs`).map((item, index): PgfExecutionOutput => {
    if (!isRecord(item)) fail(`${path}.outputs[${index}]`, 'expected an object');
    const output: PgfExecutionOutput = {
      kind: stringAt(item.kind, `${path}.outputs[${index}].kind`, { nonEmpty: true }),
    };
    const name = optionalStringAt(item.name, `${path}.outputs[${index}].name`);
    const description = optionalStringAt(item.description, `${path}.outputs[${index}].description`);
    if (name !== undefined) (output as { name?: string }).name = name;
    if (description !== undefined) (output as { description?: string }).description = description;
    if (item.sourceBound !== undefined) {
      if (typeof item.sourceBound !== 'boolean') fail(`${path}.outputs[${index}].sourceBound`, 'expected boolean');
      (output as { sourceBound?: boolean }).sourceBound = item.sourceBound as boolean;
    }
    return output;
  });
  return {
    scope: enumAt(value.scope, SCOPES, `${path}.scope`),
    expansion: enumAt(value.expansion, EXPANSIONS, `${path}.expansion`),
    outputs,
  };
}

function validateLanes(value: unknown, path: string): PgfRegistryLanes {
  if (!isRecord(value)) fail(path, 'expected an object');
  if (value.preserve !== true) fail(`${path}.preserve`, 'must be true: source preservation is mandatory');
  return {
    preserve: true,
    parse: enumAt(value.parse, PARSE_LANES, `${path}.parse`),
    preview: enumAt(value.preview, PREVIEW_LANES, `${path}.preview`),
    exact: enumAt(value.exact, EXACT_LANES, `${path}.exact`),
  };
}

function validateSecurity(value: unknown, path: string): PgfSecurityPolicy {
  if (!isRecord(value)) fail(path, 'expected an object');
  const tags = arrayAt(value.tags, `${path}.tags`).map((item, index) => enumAt(item, SECURITY_TAGS, `${path}.tags[${index}]`));
  return {
    level: enumAt(value.level, SECURITY_LEVELS, `${path}.level`),
    tags,
    summary: stringAt(value.summary, `${path}.summary`, { nonEmpty: true }),
    mitigations: arrayAt(value.mitigations, `${path}.mitigations`).map((item, index) => stringAt(item, `${path}.mitigations[${index}]`, { nonEmpty: true })),
  };
}

function validateDiagnostic(value: unknown, path: string): PgfRegistryDiagnostic {
  if (!isRecord(value)) fail(path, 'expected an object');
  return {
    code: enumAt(value.code, ['dynamic-macro', 'unsupported-surface', 'malformed-source', 'unrecognized-source', 'dynamic-key-path', 'scanner-entry-deduplication'], `${path}.code`),
    message: stringAt(value.message, `${path}.message`, { nonEmpty: true }),
    source: validateUpstreamSource(value.source, `${path}.source`),
  };
}

function validateEntry(value: unknown, path: string): PgfCapabilityEntry {
  if (!isRecord(value)) fail(path, 'expected an object');
  const namespaces = arrayAt(value.namespaces, `${path}.namespaces`).map((item, index) => stringAt(item, `${path}.namespaces[${index}]`, { nonEmpty: true }));
  if (namespaces.length === 0) fail(`${path}.namespaces`, 'must contain at least one namespace');
  const keyPath = optionalStringAt(value.keyPath, `${path}.keyPath`);
  const diagnostics = value.diagnostics === undefined
    ? undefined
    : arrayAt(value.diagnostics, `${path}.diagnostics`).map((item, index) => validateDiagnostic(item, `${path}.diagnostics[${index}]`));
  const status = enumAt(value.status, STATUSES, `${path}.status`);
  const upstream = validateUpstreamSource(value.upstream, `${path}.upstream`);
  if ((status === 'dynamic' || status === 'unsupported') && (!diagnostics || diagnostics.length === 0)) {
    fail(`${path}.diagnostics`, `${status} entries must retain at least one provenance diagnostic`);
  }
  if (value.surface === 'key' && !keyPath) fail(`${path}.keyPath`, 'key entries require keyPath');
  const result: PgfCapabilityEntry = {
    id: stringAt(value.id, `${path}.id`, { nonEmpty: true }),
    title: stringAt(value.title, `${path}.title`, { nonEmpty: true }),
    surface: enumAt(value.surface, SURFACES, `${path}.surface`),
    status,
    upstream,
    namespaces,
    valueGrammar: validateValueGrammar(value.valueGrammar, `${path}.valueGrammar`),
    effects: validateEffects(value.effects, `${path}.effects`),
    lanes: validateLanes(value.lanes, `${path}.lanes`),
    writeback: enumAt(value.writeback, WRITEBACK, `${path}.writeback`),
    security: validateSecurity(value.security, `${path}.security`),
  };
  if (diagnostics?.some((item) => item.source.version !== upstream.version || item.source.sha !== upstream.sha)) {
    fail(`${path}.diagnostics`, 'diagnostic provenance must match the entry version and SHA');
  }
  if (status !== 'static' && value.writeback !== 'never') {
    fail(`${path}.writeback`, `${status} entries must use never writeback`);
  }
  if (value.writeback === 'safe' && value.lanes?.parse === 'opaque') {
    fail(`${path}.writeback`, 'opaque entries cannot be marked safe for writeback');
  }
  if (keyPath !== undefined) (result as { keyPath?: string }).keyPath = keyPath;
  if (diagnostics !== undefined) (result as { diagnostics?: readonly PgfRegistryDiagnostic[] }).diagnostics = diagnostics;
  if (value.notes !== undefined) {
    (result as { notes?: readonly string[] }).notes = arrayAt(value.notes, `${path}.notes`).map((item, index) => stringAt(item, `${path}.notes[${index}]`));
  }
  return result;
}

function validateManifest(value: unknown, path: string): PgfRegistryManifest {
  if (!isRecord(value)) fail(path, 'expected an object');
  if (value.schema !== PGF_UPSTREAM_REGISTRY_SCHEMA) fail(`${path}.schema`, `must equal ${PGF_UPSTREAM_REGISTRY_SCHEMA}`);
  if (!isRecord(value.upstream)) fail(`${path}.upstream`, 'expected an object');
  const sha = stringAt(value.upstream.sha, `${path}.upstream.sha`, { nonEmpty: true });
  if (!/^[0-9a-f]{40}$/i.test(sha)) fail(`${path}.upstream.sha`, 'expected a full 40-character hexadecimal SHA');
  if (!isRecord(value.scanner)) fail(`${path}.scanner`, 'expected an object');
  if (value.scanner.mode !== 'static-source-scan') fail(`${path}.scanner.mode`, 'must be static-source-scan');
  if (value.scanner.dynamicMacrosPreserved !== true) fail(`${path}.scanner.dynamicMacrosPreserved`, 'must be true');
  if (value.scanner.networkAccess !== 'disabled') fail(`${path}.scanner.networkAccess`, 'must be disabled');
  return {
    schema: PGF_UPSTREAM_REGISTRY_SCHEMA,
    upstream: {
      repository: stringAt(value.upstream.repository, `${path}.upstream.repository`, { nonEmpty: true }),
      version: stringAt(value.upstream.version, `${path}.upstream.version`, { nonEmpty: true }),
      sha,
      ...(value.upstream.manual === undefined ? {} : { manual: stringAt(value.upstream.manual, `${path}.upstream.manual`) }),
    },
    generatedBy: stringAt(value.generatedBy, `${path}.generatedBy`, { nonEmpty: true }),
    ...(value.generatedAt === undefined ? {} : { generatedAt: stringAt(value.generatedAt, `${path}.generatedAt`) }),
    scanner: { mode: 'static-source-scan', dynamicMacrosPreserved: true, networkAccess: 'disabled' },
    diagnostics: arrayAt(value.diagnostics, `${path}.diagnostics`).map((item, index) => validateDiagnostic(item, `${path}.diagnostics[${index}]`)),
  };
}

/** Validate unknown JSON/runtime input and return a typed immutable-shape value. */
export function validatePgfUpstreamRegistry(value: unknown): PgfUpstreamRegistry {
  if (!isRecord(value)) fail('$', 'expected an object');
  const manifest = validateManifest(value.manifest, '$.manifest');
  const entries = arrayAt(value.entries, '$.entries').map((item, index) => validateEntry(item, `$.entries[${index}]`));
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) fail('$.entries', `duplicate entry id ${entry.id}`);
    ids.add(entry.id);
    if (entry.upstream.version !== manifest.upstream.version || entry.upstream.sha !== manifest.upstream.sha) {
      fail(`$.entries[${entry.id}].upstream`, 'entry provenance must match manifest version and SHA');
    }
  }
  return { manifest, entries };
}

export function assertPgfUpstreamRegistry(value: unknown): asserts value is PgfUpstreamRegistry {
  validatePgfUpstreamRegistry(value);
}

export interface PgfRegistryIndex {
  readonly registry: PgfUpstreamRegistry;
  readonly byId: ReadonlyMap<string, PgfCapabilityEntry>;
  readonly bySurface: ReadonlyMap<PgfRegistrySurface, readonly PgfCapabilityEntry[]>;
  readonly byNamespace: ReadonlyMap<string, readonly PgfCapabilityEntry[]>;
  readonly byKeyPath: ReadonlyMap<string, readonly PgfCapabilityEntry[]>;
  readonly byStatus: ReadonlyMap<PgfRegistryEntryStatus, readonly PgfCapabilityEntry[]>;
}

function pushIndex<T>(map: Map<T, PgfCapabilityEntry[]>, key: T, entry: PgfCapabilityEntry): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(entry);
  else map.set(key, [entry]);
}

function readonlyBuckets<T>(map: Map<T, PgfCapabilityEntry[]>): ReadonlyMap<T, readonly PgfCapabilityEntry[]> {
  return new Map(Array.from(map.entries(), ([key, entries]) => [key, Object.freeze(entries.slice())] as const));
}

/** Build deterministic indexes once; query calls are then allocation-light. */
export function indexPgfUpstreamRegistry(registry: PgfUpstreamRegistry): PgfRegistryIndex {
  const checked = validatePgfUpstreamRegistry(registry);
  const byId = new Map<string, PgfCapabilityEntry>();
  const bySurface = new Map<PgfRegistrySurface, PgfCapabilityEntry[]>();
  const byNamespace = new Map<string, PgfCapabilityEntry[]>();
  const byKeyPath = new Map<string, PgfCapabilityEntry[]>();
  const byStatus = new Map<PgfRegistryEntryStatus, PgfCapabilityEntry[]>();
  for (const entry of checked.entries) {
    byId.set(entry.id, entry);
    pushIndex(bySurface, entry.surface, entry);
    pushIndex(byStatus, entry.status, entry);
    for (const namespace of entry.namespaces) pushIndex(byNamespace, namespace, entry);
    if (entry.keyPath) pushIndex(byKeyPath, entry.keyPath, entry);
  }
  return {
    registry: checked,
    byId,
    bySurface: readonlyBuckets(bySurface),
    byNamespace: readonlyBuckets(byNamespace),
    byKeyPath: readonlyBuckets(byKeyPath),
    byStatus: readonlyBuckets(byStatus),
  };
}

export interface PgfRegistryQuery {
  readonly text?: string;
  readonly surface?: PgfRegistrySurface | readonly PgfRegistrySurface[];
  readonly namespace?: string | readonly string[];
  readonly keyPath?: string | readonly string[];
  readonly status?: PgfRegistryEntryStatus | readonly PgfRegistryEntryStatus[];
  readonly securityLevel?: PgfSecurityLevel | readonly PgfSecurityLevel[];
  readonly limit?: number;
}

function arrayFilter<T>(value: T | readonly T[] | undefined): readonly T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function includesFilter<T>(value: T, filter: T | readonly T[] | undefined): boolean {
  const values = arrayFilter(filter);
  return values === undefined || values.includes(value);
}

/** Search indexed static metadata; this never executes TeX or macro expansion. */
export function queryPgfUpstreamRegistry(
  index: PgfRegistryIndex,
  query: PgfRegistryQuery = {},
): readonly PgfCapabilityEntry[] {
  const text = query.text?.trim().toLocaleLowerCase();
  const namespace = arrayFilter(query.namespace);
  const keyPath = arrayFilter(query.keyPath);
  const candidates = query.keyPath && keyPath?.length === 1
    ? index.byKeyPath.get(keyPath[0]!) ?? []
    : query.surface && arrayFilter(query.surface)?.length === 1
      ? index.bySurface.get(arrayFilter(query.surface)![0]!) ?? []
      : query.status && arrayFilter(query.status)?.length === 1
        ? index.byStatus.get(arrayFilter(query.status)![0]!) ?? []
        : index.registry.entries;
  const filtered = candidates.filter((entry) => {
    if (!includesFilter(entry.surface, query.surface)) return false;
    if (!includesFilter(entry.status, query.status)) return false;
    if (!includesFilter(entry.security.level, query.securityLevel)) return false;
    if (namespace && !namespace.some((value) => entry.namespaces.includes(value))) return false;
    if (keyPath && (!entry.keyPath || !keyPath.includes(entry.keyPath))) return false;
    if (text) {
      const haystack = [entry.id, entry.title, entry.surface, entry.keyPath ?? '', ...entry.namespaces].join(' ').toLocaleLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
  if (query.limit === undefined || query.limit <= 0) return filtered;
  return filtered.slice(0, Math.floor(query.limit));
}

export function getPgfUpstreamEntry(index: PgfRegistryIndex, id: string): PgfCapabilityEntry | undefined {
  return index.byId.get(id);
}

export function getPgfEntriesForKey(index: PgfRegistryIndex, keyPath: string): readonly PgfCapabilityEntry[] {
  return index.byKeyPath.get(keyPath) ?? [];
}

export function listPgfRegistryDiagnostics(registry: PgfUpstreamRegistry): readonly PgfRegistryDiagnostic[] {
  const diagnostics = [...registry.manifest.diagnostics];
  for (const entry of registry.entries) if (entry.diagnostics) diagnostics.push(...entry.diagnostics);
  return diagnostics;
}
