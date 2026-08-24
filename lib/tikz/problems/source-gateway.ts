import { createHash } from 'node:crypto';
import {
  GEOMETRY_PROBLEM_SOURCE_DESCRIPTORS,
  getGeometryProblemSourceDescriptor,
  type GeometryProblemSourceId,
  type GeometryProblemSourceMaterialRights,
  type GeometryProblemUsageDecision,
} from './source-catalog';

export type { GeometryProblemSourceId } from './source-catalog';

export type GeometryProblemSolutionProvenance =
  | 'dataset-provided'
  | 'official-solution'
  | 'unknown';

export interface GeometryProblemAssetReference {
  readonly assetId: string;
  readonly role: 'problem-diagram' | 'solution-diagram';
  readonly providerField: string;
  readonly width?: number;
  readonly height?: number;
  readonly mediaType?: string;
  /** Live search never treats an un-fetched image as integrity-attested. */
  readonly integrity: 'unverified-live-reference';
  readonly rightsDecision: GeometryProblemUsageDecision;
}

export interface GeometryProblemRightsSnapshot {
  readonly datasetLicenseId: string;
  readonly codeLicenseId: string;
  readonly sourceMaterialRights: GeometryProblemSourceMaterialRights;
  readonly redistribution: GeometryProblemUsageDecision;
  readonly commercial: GeometryProblemUsageDecision;
  readonly training: GeometryProblemUsageDecision;
  readonly rowOverride: 'none-declared' | 'declared-upstream' | 'not-exposed';
  readonly rightsholder?: string;
  readonly evidenceUrls: readonly string[];
  readonly notice: string;
}

export interface GeometryProblemProviderSnapshot {
  readonly datasetId: string;
  readonly config: string;
  readonly split: string;
  readonly rowIndex?: number;
  /** The live viewer API is mutable and has no revision parameter. */
  readonly revision: null;
  readonly revisionStatus: 'unpinned-live-viewer';
}

export interface GeometryProblemRecord {
  readonly id: string;
  readonly source: GeometryProblemSourceId;
  readonly title: string;
  readonly statement: string;
  readonly solutions: readonly string[];
  readonly topics: readonly string[];
  readonly language?: string;
  readonly competition?: string;
  readonly year?: number;
  readonly sourceUrl: string;
  readonly datasetUrl: string;
  /** Compatibility display fields; legal admission must use `rights`. */
  readonly license: string;
  readonly licenseId: string;
  readonly contentHash: string;
  readonly contentHashAlgorithm: 'sha256-utf8';
  readonly contentHashScope: 'normalized-live-snapshot';
  readonly solutionProvenance: GeometryProblemSolutionProvenance;
  readonly hasImages: boolean;
  readonly assets: readonly GeometryProblemAssetReference[];
  readonly provider: GeometryProblemProviderSnapshot;
  readonly rights: GeometryProblemRightsSnapshot;
  readonly taint: 'untrusted-external-reference';
  readonly admission: 'search-reference-only';
  readonly retrievedAt: string;
}

/** Public/search-tool projection. Full external bodies remain inside the bounded adapter. */
export interface GeometryProblemReferenceRecord extends Omit<
  GeometryProblemRecord,
  'statement' | 'solutions'
> {
  readonly statementPreview: string;
  readonly solutionCount: number;
}

export function geometryProblemReferenceRecord(
  entry: GeometryProblemRecord,
): GeometryProblemReferenceRecord {
  const { statement: _statement, solutions: _solutions, ...metadata } = entry;
  return {
    ...metadata,
    statementPreview: entry.statement.slice(0, 800),
    solutionCount: entry.solutions.length,
  };
}

export interface GeometryProblemSearchResult {
  readonly records: readonly GeometryProblemRecord[];
  readonly sourceStatus: readonly {
    readonly id: GeometryProblemSourceId;
    readonly enabled: boolean;
    readonly accessMode: 'live-search' | 'registry-only' | 'restricted-opt-in';
    readonly sourceMaterialRights: GeometryProblemSourceMaterialRights;
    readonly detail: string;
  }[];
}

interface HuggingFaceRow {
  readonly row_idx?: unknown;
  readonly row?: unknown;
}

const MATHNET_ROWS = 'https://datasets-server.huggingface.co/rows';
const MATHNET_SEARCH = 'https://datasets-server.huggingface.co/search';
const OLYMPIADBENCH_DATASET = 'Hothan/OlympiadBench';
const OLYMPIADBENCH_ROWS = 'https://datasets-server.huggingface.co/rows';
const OLYMPIADBENCH_SEARCH = 'https://datasets-server.huggingface.co/search';
const OLYMPIADBENCH_CONFIGS = [
  'TP_TO_maths_en_COMP',
  'TP_TO_maths_zh_COMP',
  'OE_MM_maths_en_COMP',
  'OE_MM_maths_zh_COMP',
] as const;
const MAX_PROBLEM_TEXT = 20_000;
const MAX_SOURCE_RESPONSE_BYTES = 1024 * 1024;
const MAX_SOURCE_SEARCH_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_SEARCH_REQUESTS = 10;
const REMOTE_SEARCH_ATTEMPT_MS = 3_500;
const SEARCH_CACHE_MAX_ENTRIES = 12;
const SEARCH_CACHE_TTL_MS = 60_000;
const SEARCH_NEGATIVE_CACHE_TTL_MS = 10_000;
const SEARCH_STALE_TTL_MS = 5 * 60_000;
const SEARCH_SINGLEFLIGHT_MAX = 8;
const REFERENCE_CACHE_MAX_ENTRIES = 48;
const REFERENCE_CACHE_TTL_MS = 10 * 60_000;

interface ProblemSearchCacheEntry {
  readonly value: GeometryProblemSearchResult;
  readonly expiresAt: number;
  readonly staleUntil: number;
}

const searchCache = new Map<string, ProblemSearchCacheEntry>();
const searchFlights = new Map<string, Promise<GeometryProblemSearchResult>>();
const referenceCache = new Map<string, {
  readonly value: GeometryProblemRecord;
  readonly expiresAt: number;
}>();

interface ProblemSourceRequestBudget {
  requests: number;
  bytes: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface GeometryProblemReferenceSelector {
  readonly source: GeometryProblemSourceId;
  readonly id: string;
  readonly contentHash: string;
  readonly provider: GeometryProblemProviderSnapshot;
}

function sameProvider(
  left: GeometryProblemProviderSnapshot,
  right: GeometryProblemProviderSnapshot,
): boolean {
  return left.datasetId === right.datasetId
    && left.config === right.config
    && left.split === right.split
    && left.rowIndex === right.rowIndex
    && left.revision === null
    && right.revision === null
    && left.revisionStatus === 'unpinned-live-viewer'
    && right.revisionStatus === 'unpinned-live-viewer';
}

function validReferenceSelector(
  input: GeometryProblemReferenceSelector,
): boolean {
  if (
    !input
    || (input.source !== 'mathnet' && input.source !== 'olympiadbench')
    || !input.id.startsWith(`${input.source}:`)
    || input.id.length > 192
    || !/^[a-f0-9]{64}$/u.test(input.contentHash)
    || !Number.isSafeInteger(input.provider?.rowIndex)
    || (input.provider.rowIndex ?? -1) < 0
    || (input.provider.rowIndex ?? 1_000_001) > 1_000_000
    || input.provider.split !== 'train'
    || input.provider.revision !== null
    || input.provider.revisionStatus !== 'unpinned-live-viewer'
  ) return false;
  if (input.source === 'mathnet') {
    return input.provider.datasetId === 'ShadenA/MathNet'
      && (input.provider.config === 'all' || input.provider.config === 'default');
  }
  return input.provider.datasetId === OLYMPIADBENCH_DATASET
    && (OLYMPIADBENCH_CONFIGS as readonly string[]).includes(input.provider.config);
}

function referenceKey(input: GeometryProblemReferenceSelector): string {
  return JSON.stringify({
    schemaVersion: 'geometry-problem-reference-key/v1',
    source: input.source,
    id: input.id,
    contentHash: input.contentHash,
    provider: input.provider,
  });
}

function recordMatchesReference(
  value: GeometryProblemRecord,
  input: GeometryProblemReferenceSelector,
): boolean {
  return value.source === input.source
    && value.id === input.id
    && value.contentHash === input.contentHash
    && sameProvider(value.provider, input.provider);
}

function touchReferenceCache(
  key: string,
  value: GeometryProblemRecord,
  expiresAt = Date.now() + REFERENCE_CACHE_TTL_MS,
): void {
  referenceCache.delete(key);
  referenceCache.set(key, { value, expiresAt });
  while (referenceCache.size > REFERENCE_CACHE_MAX_ENTRIES) {
    const oldest = referenceCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    referenceCache.delete(oldest);
  }
}

function text(value: unknown, max = MAX_PROBLEM_TEXT): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.slice(0, max)
    : null;
}

function stringList(value: unknown, maxItems: number, maxChars = MAX_PROBLEM_TEXT): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = text(entry, maxChars);
    return parsed ? [parsed] : [];
  }).slice(0, maxItems);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function problemContentHash(input: {
  readonly source: GeometryProblemSourceId;
  readonly id: string;
  readonly title: string;
  readonly statement: string;
  readonly solutions: readonly string[];
  readonly topics: readonly string[];
  readonly language: string | null;
  readonly competition: string | null;
  readonly year: number | null;
  readonly sourceUrl: string;
  readonly datasetUrl: string;
  readonly solutionProvenance: GeometryProblemSolutionProvenance;
  readonly hasImages: boolean;
  readonly provider: GeometryProblemProviderSnapshot;
  readonly rights: GeometryProblemRightsSnapshot;
  readonly assets: readonly GeometryProblemAssetReference[];
}): string {
  return createHash('sha256').update(canonicalJson({
    schemaVersion: 'geometry-problem-live-snapshot/v2',
    ...input,
  }), 'utf8').digest('hex');
}

function usageRights(source: GeometryProblemSourceId, value: Record<string, unknown>): GeometryProblemRightsSnapshot {
  const descriptor = getGeometryProblemSourceDescriptor(source);
  const rightsholder = text(value.rightsholder, 256)
    ?? text(value.copyright_holder, 256)
    ?? text(value.copyright, 256);
  const rowOverride = rightsholder
    ? 'declared-upstream' as const
    : source === 'mathnet'
      ? 'not-exposed' as const
      : 'none-declared' as const;
  return {
    datasetLicenseId: descriptor.datasetLicense.id,
    codeLicenseId: descriptor.codeLicense.id,
    sourceMaterialRights: descriptor.sourceMaterialRights,
    redistribution: descriptor.redistribution,
    commercial: descriptor.commercial,
    training: descriptor.training,
    rowOverride,
    ...(rightsholder ? { rightsholder } : {}),
    evidenceUrls: [
      descriptor.datasetLicense.url ?? descriptor.datasetUrl,
      descriptor.projectUrl,
    ],
    notice: descriptor.note,
  };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function assetReference(input: {
  readonly source: GeometryProblemSourceId;
  readonly normalizedId: string;
  readonly role: GeometryProblemAssetReference['role'];
  readonly providerField: string;
  readonly value: unknown;
}): GeometryProblemAssetReference | null {
  if (input.value === null || input.value === undefined) return null;
  const value = record(input.value) ? input.value : {};
  const width = positiveInteger(value.width);
  const height = positiveInteger(value.height);
  const mediaType = text(value.mime_type, 128) ?? text(value.mediaType, 128);
  return {
    assetId: `${input.normalizedId}:asset:${input.providerField}`,
    role: input.role,
    providerField: input.providerField,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(mediaType && /^image\/(?:png|jpeg|webp|svg\+xml)$/iu.test(mediaType)
      ? { mediaType: mediaType.toLowerCase() }
      : {}),
    integrity: 'unverified-live-reference',
    rightsDecision: getGeometryProblemSourceDescriptor(input.source).redistribution,
  };
}

async function boundedJsonResponse(
  response: Response,
  budget: ProblemSourceRequestBudget,
): Promise<unknown> {
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && (
    declared > MAX_SOURCE_RESPONSE_BYTES
    || budget.bytes + declared > MAX_SOURCE_SEARCH_BYTES
  )) {
    throw new Error('Problem source response exceeded its byte budget');
  }
  if (!response.body) throw new Error('Problem source response was empty');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let payload = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      budget.bytes += chunk.value.byteLength;
      if (
        bytes > MAX_SOURCE_RESPONSE_BYTES
        || budget.bytes > MAX_SOURCE_SEARCH_BYTES
      ) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Problem source response exceeded its byte budget');
      }
      payload += decoder.decode(chunk.value, { stream: true });
    }
    payload += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new Error('Problem source returned invalid JSON');
  }
}

function consumeSourceRequest(budget: ProblemSourceRequestBudget): void {
  budget.requests += 1;
  if (budget.requests > MAX_SOURCE_SEARCH_REQUESTS) {
    throw new Error('Problem source search exceeded its request budget');
  }
}

function mathNetRecord(
  value: unknown,
  rowIndex?: number,
  config: 'all' | 'default' = 'all',
): GeometryProblemRecord | null {
  if (!record(value)) return null;
  const id = text(value.id, 128) ?? text(value.unique_id, 128);
  const statement = text(value.problem_markdown);
  if (!id || !statement) return null;
  const topics = stringList(value.topics_flat, 24, 256);
  if (!topics.some((topic) => /geometry|几何/iu.test(topic))) return null;
  const competition = text(value.competition, 256) ?? undefined;
  const language = text(value.language, 64) ?? undefined;
  const problemNumber = text(value.problem_number, 64);
  const title = [competition, problemNumber ? `P${problemNumber}` : null]
    .filter(Boolean)
    .join(' · ') || `MathNet ${id.slice(0, 8)}`;
  const solutions = stringList(value.solutions_markdown, 4);
  const normalizedId = `mathnet:${id}`;
  const provider: GeometryProblemProviderSnapshot = {
    datasetId: 'ShadenA/MathNet',
    config,
    split: 'train',
    ...(Number.isSafeInteger(rowIndex) ? { rowIndex } : {}),
    revision: null,
    revisionStatus: 'unpinned-live-viewer',
  };
  const rights = usageRights('mathnet', value);
  const rawImages = Array.isArray(value.images) ? value.images : [];
  const rawSolutionImages = Array.isArray(value.solution_images) ? value.solution_images : [];
  const assets = [
    ...rawImages.slice(0, 8).map((image, index) => assetReference({
      source: 'mathnet', normalizedId, role: 'problem-diagram',
      providerField: `images[${index}]`, value: image,
    })),
    ...rawSolutionImages.slice(0, 4).map((image, index) => assetReference({
      source: 'mathnet', normalizedId, role: 'solution-diagram',
      providerField: `solution_images[${index}]`, value: image,
    })),
  ].filter((asset): asset is GeometryProblemAssetReference => asset !== null);
  const descriptor = getGeometryProblemSourceDescriptor('mathnet');
  const sourceUrl = `https://mathnet.mit.edu/explorer.html?p=${encodeURIComponent(id)}`;
  const hasImages = assets.length > 0 || value.has_images === true;
  return {
    id: normalizedId,
    source: 'mathnet',
    title,
    statement,
    solutions,
    topics,
    ...(language ? { language } : {}),
    ...(competition ? { competition } : {}),
    ...(Number.isSafeInteger(value.year) ? { year: value.year as number } : {}),
    sourceUrl,
    datasetUrl: descriptor.datasetUrl,
    license: descriptor.datasetLicense.label,
    licenseId: descriptor.datasetLicense.id,
    contentHash: problemContentHash({
      source: 'mathnet',
      id: normalizedId,
      title,
      statement,
      solutions,
      topics,
      language: language ?? null,
      competition: competition ?? null,
      year: Number.isSafeInteger(value.year) ? value.year as number : null,
      sourceUrl,
      datasetUrl: descriptor.datasetUrl,
      solutionProvenance: 'dataset-provided',
      hasImages,
      provider,
      rights,
      assets,
    }),
    contentHashAlgorithm: 'sha256-utf8',
    contentHashScope: 'normalized-live-snapshot',
    solutionProvenance: 'dataset-provided',
    hasImages,
    assets,
    provider,
    rights,
    taint: 'untrusted-external-reference',
    admission: 'search-reference-only',
    retrievedAt: new Date().toISOString(),
  };
}

function olympiadBenchRecord(
  value: unknown,
  config: string,
  rowIndex?: number,
): GeometryProblemRecord | null {
  if (!record(value) || value.subfield !== 'Geometry') return null;
  const rawId = typeof value.id === 'number' && Number.isSafeInteger(value.id)
    ? String(value.id)
    : text(value.id, 128);
  const statement = text(value.question);
  if (!rawId || !statement) return null;
  const solutions = stringList(value.solution, 4);
  const normalizedId = `olympiadbench:${config}:${rawId}`;
  const language = text(value.language, 64) ?? undefined;
  const topics = [
    'Geometry',
    text(value.subject, 64),
    text(value.question_type, 64),
    text(value.difficulty, 64),
  ].filter((entry): entry is string => Boolean(entry));
  const viewer = new URL(`https://huggingface.co/datasets/${OLYMPIADBENCH_DATASET}/viewer/${config}/train`);
  if (Number.isSafeInteger(rowIndex)) viewer.searchParams.set('row', String(rowIndex));
  const hasImages = value.modality === 'Multimodal'
    || Array.from({ length: 9 }, (_, index) => value[`image_${index + 1}`])
      .some((image) => image !== null && image !== undefined);
  const provider: GeometryProblemProviderSnapshot = {
    datasetId: OLYMPIADBENCH_DATASET,
    config,
    split: 'train',
    ...(Number.isSafeInteger(rowIndex) ? { rowIndex } : {}),
    revision: null,
    revisionStatus: 'unpinned-live-viewer',
  };
  const rights = usageRights('olympiadbench', value);
  const assets = Array.from({ length: 9 }, (_, index) => {
    const providerField = `image_${index + 1}`;
    return assetReference({
      source: 'olympiadbench', normalizedId, role: 'problem-diagram',
      providerField, value: value[providerField],
    });
  }).filter((asset): asset is GeometryProblemAssetReference => asset !== null);
  const descriptor = getGeometryProblemSourceDescriptor('olympiadbench');
  const sourceUrl = viewer.toString();
  return {
    id: normalizedId,
    source: 'olympiadbench',
    title: `OlympiadBench · ${language ?? 'unknown'} · ${rawId}`,
    statement,
    solutions,
    topics,
    ...(language ? { language } : {}),
    sourceUrl,
    datasetUrl: descriptor.datasetUrl,
    license: descriptor.datasetLicense.label,
    licenseId: descriptor.datasetLicense.id,
    contentHash: problemContentHash({
      source: 'olympiadbench',
      id: normalizedId,
      title: `OlympiadBench · ${language ?? 'unknown'} · ${rawId}`,
      statement,
      solutions,
      topics,
      language: language ?? null,
      competition: null,
      year: null,
      sourceUrl,
      datasetUrl: descriptor.datasetUrl,
      solutionProvenance: 'dataset-provided',
      hasImages,
      provider,
      rights,
      assets,
    }),
    contentHashAlgorithm: 'sha256-utf8',
    contentHashScope: 'normalized-live-snapshot',
    solutionProvenance: 'dataset-provided',
    hasImages,
    assets,
    provider,
    rights,
    taint: 'untrusted-external-reference',
    admission: 'search-reference-only',
    retrievedAt: new Date().toISOString(),
  };
}

function queryTerms(query: string): string[] {
  const generic = new Set([
    'geometry', 'geometric', 'problem', 'problems', 'olympiad', 'competition',
    'draw', 'construct', 'construction', 'proof', 'theorem',
    '几何', '题目', '问题', '竞赛', '作图', '构造', '证明',
  ]);
  return query.toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1 && !generic.has(term))
    .slice(0, 12);
}

function score(record: GeometryProblemRecord, terms: readonly string[]): number {
  if (terms.length === 0) return 1;
  const haystack = [record.title, record.statement, ...record.topics]
    .join('\n')
    .toLocaleLowerCase();
  return terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
}

function rankRecords(
  records: readonly GeometryProblemRecord[],
  terms: readonly string[],
  limit: number,
): GeometryProblemRecord[] {
  const ranked = records
    .map((candidate) => ({ candidate, rank: score(candidate, terms) }))
    .filter((entry) => terms.length === 0 || entry.rank > 0)
    .sort((left, right) => right.rank - left.rank);
  const bestRank = ranked[0]?.rank ?? 0;
  const minimumRank = terms.length > 1 && bestRank > 1 ? bestRank : 1;
  return ranked
    .filter((entry) => terms.length === 0 || entry.rank >= minimumRank)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

async function fetchMathNetRows(
  offset: number,
  query: string,
  signal: AbortSignal,
  budget: ProblemSourceRequestBudget,
): Promise<{ records: GeometryProblemRecord[]; usedRowFallback: boolean }> {
  const load = async (config: 'default' | 'all', search: boolean) => {
    const url = new URL(search ? MATHNET_SEARCH : MATHNET_ROWS);
    url.searchParams.set('dataset', 'ShadenA/MathNet');
    url.searchParams.set('config', config);
    url.searchParams.set('split', 'train');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('length', '48');
    if (search) url.searchParams.set('query', query.trim().slice(0, 240));
    const requestSignal = search
      ? AbortSignal.any([signal, AbortSignal.timeout(REMOTE_SEARCH_ATTEMPT_MS)])
      : signal;
    consumeSourceRequest(budget);
    const response = await fetch(url, {
      signal: requestSignal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`MathNet rows returned HTTP ${response.status}`);
    const body = await boundedJsonResponse(response, budget) as { rows?: HuggingFaceRow[] };
    return Array.isArray(body.rows) ? body.rows : [];
  };
  const loadConfig = async (config: 'default' | 'all') => {
    if (!query.trim()) return {
      rows: await load(config, false),
      usedRowFallback: false,
      config,
    };
    try {
      return { rows: await load(config, true), usedRowFallback: false, config };
    } catch (error) {
      if (signal.aborted) throw error;
      return { rows: await load(config, false), usedRowFallback: true, config };
    }
  };
  let loaded: {
    rows: HuggingFaceRow[];
    usedRowFallback: boolean;
    config: 'all' | 'default';
  };
  try {
    // MathNet's published aggregate subset is currently named `all`.
    loaded = await loadConfig('all');
  } catch (error) {
    if (signal.aborted) throw error;
    // Keep a compatibility fallback if the upstream dataset changes its
    // aggregate subset name without weakening attribution or row validation.
    loaded = await loadConfig('default');
  }
  return {
    records: loaded.rows.flatMap((entry) => {
      const parsed = mathNetRecord(
        entry.row,
        Number.isSafeInteger(entry.row_idx) ? entry.row_idx as number : undefined,
        loaded.config,
      );
      return parsed ? [parsed] : [];
    }),
    usedRowFallback: loaded.usedRowFallback,
  };
}

async function fetchOlympiadBenchRows(
  offset: number,
  query: string,
  signal: AbortSignal,
  budget: ProblemSourceRequestBudget,
): Promise<{
  records: GeometryProblemRecord[];
  failures: string[];
  rowFallbacks: number;
}> {
  const settled = await Promise.allSettled(OLYMPIADBENCH_CONFIGS.map(async (config) => {
    const load = async (search: boolean) => {
      const url = new URL(search ? OLYMPIADBENCH_SEARCH : OLYMPIADBENCH_ROWS);
      url.searchParams.set('dataset', OLYMPIADBENCH_DATASET);
      url.searchParams.set('config', config);
      url.searchParams.set('split', 'train');
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('length', '24');
      if (search) url.searchParams.set('query', query.trim().slice(0, 240));
      const requestSignal = search
        ? AbortSignal.any([signal, AbortSignal.timeout(REMOTE_SEARCH_ATTEMPT_MS)])
        : signal;
      consumeSourceRequest(budget);
      const response = await fetch(url, {
        signal: requestSignal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`${config}: HTTP ${response.status}`);
      return boundedJsonResponse(response, budget) as Promise<{ rows?: HuggingFaceRow[] }>;
    };
    let body: { rows?: HuggingFaceRow[] };
    let usedRowFallback = false;
    if (query.trim()) {
      try {
        body = await load(true);
      } catch (error) {
        if (signal.aborted) throw error;
        body = await load(false);
        usedRowFallback = true;
      }
    } else {
      body = await load(false);
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    return {
      records: rows.flatMap((entry) => {
        const parsed = olympiadBenchRecord(
          entry.row,
          config,
          Number.isSafeInteger(entry.row_idx) ? entry.row_idx as number : undefined,
        );
        return parsed ? [parsed] : [];
      }),
      usedRowFallback,
    };
  }));
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('Problem source search aborted', 'AbortError');
  }
  return {
    records: settled.flatMap((entry) => (
      entry.status === 'fulfilled' ? entry.value.records : []
    )),
    failures: settled.flatMap((entry) => (
      entry.status === 'rejected'
        ? [entry.reason instanceof Error ? entry.reason.message : 'unavailable']
        : []
    )),
    rowFallbacks: settled.filter((entry) => (
      entry.status === 'fulfilled' && entry.value.usedRowFallback
    )).length,
  };
}

async function searchGeometryProblemSourcesUncached(input: {
  readonly query: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly signal: AbortSignal;
}): Promise<GeometryProblemSearchResult> {
  const offset = Number.isSafeInteger(input.offset) && (input.offset ?? -1) >= 0
    ? Math.min(30_000, input.offset ?? 0)
    : 0;
  const limit = Number.isSafeInteger(input.limit) && (input.limit ?? 0) > 0
    ? Math.min(24, input.limit ?? 12)
    : 12;
  const terms = queryTerms(input.query);
  const budget: ProblemSourceRequestBudget = { requests: 0, bytes: 0 };
  // Sources are independent and must share the same wall-clock budget. A slow
  // dataset must not consume the entire deadline before the next source starts.
  const [mathNetResult, olympiadBenchResult] = await Promise.all([
    (async () => {
      try {
        const fetched = await fetchMathNetRows(offset, input.query, input.signal, budget);
        return {
          records: rankRecords(fetched.records, terms, limit),
          detail: fetched.usedRowFallback
            ? 'remote search unavailable; bounded row-window fallback used'
            : 'available',
          available: true,
        };
      } catch (error) {
        if (input.signal.aborted) throw error;
        return {
          records: [] as GeometryProblemRecord[],
          detail: error instanceof Error ? error.message : 'unavailable',
          available: false,
        };
      }
    })(),
    (async () => {
      try {
        const fetched = await fetchOlympiadBenchRows(offset, input.query, input.signal, budget);
        return {
          records: fetched.records,
          detail: fetched.failures.length > 0
            ? fetched.records.length > 0
              ? `partial: ${fetched.failures.length} configurations unavailable`
              : fetched.failures[0] ?? 'unavailable'
            : fetched.rowFallbacks > 0
              ? `remote search unavailable; ${fetched.rowFallbacks} row-window fallbacks used`
              : 'available',
          available: fetched.failures.length < OLYMPIADBENCH_CONFIGS.length,
        };
      } catch (error) {
        if (input.signal.aborted) throw error;
        return {
          records: [] as GeometryProblemRecord[],
          detail: error instanceof Error ? error.message : 'unavailable',
          available: false,
        };
      }
    })(),
  ]);
  const mathNet = mathNetResult.records;
  const mathNetDetail = mathNetResult.detail;
  const olympiadBench = olympiadBenchResult.records;
  const olympiadBenchDetail = olympiadBenchResult.detail;
  const formalGeoConfigured = Boolean(
    process.env.FORMALGEO_DATA_URL?.trim()
    && process.env.FORMALGEO_ACCEPT_RESTRICTED_LICENSE === '1',
  );
  return {
    records: rankRecords([...mathNet, ...olympiadBench], terms, limit),
    sourceStatus: GEOMETRY_PROBLEM_SOURCE_DESCRIPTORS.map((descriptor) => {
      const common = {
        id: descriptor.id,
        accessMode: descriptor.accessMode,
        sourceMaterialRights: descriptor.sourceMaterialRights,
      } as const;
      if (descriptor.id === 'mathnet') {
        return { ...common, enabled: mathNetResult.available, detail: mathNetDetail };
      }
      if (descriptor.id === 'olympiadbench') {
        return { ...common, enabled: olympiadBenchResult.available, detail: olympiadBenchDetail };
      }
      if (descriptor.id === 'formalgeo') {
        return {
          ...common,
          // There is intentionally no live FormalGeo adapter in this gateway.
          // Configuration alone must never make a restricted source searchable.
          enabled: false,
          detail: formalGeoConfigured
            ? 'restricted opt-in configured, but no searchable adapter is installed'
            : 'restricted opt-in disabled; pin and review the applicable post-2026 GPL/non-commercial terms',
        };
      }
      return {
        ...common,
        enabled: false,
        detail: `${descriptor.accessMode}: ${descriptor.note}`,
      };
    }),
  };
}

function normalizedSearchInput(input: {
  readonly query: string;
  readonly offset?: number;
  readonly limit?: number;
}): { query: string; offset: number; limit: number } {
  return {
    query: input.query.trim().slice(0, 240),
    offset: Number.isSafeInteger(input.offset) && (input.offset ?? -1) >= 0
      ? Math.min(30_000, input.offset ?? 0)
      : 0,
    limit: Number.isSafeInteger(input.limit) && (input.limit ?? 0) > 0
      ? Math.min(24, input.limit ?? 12)
      : 12,
  };
}

function cacheKey(input: ReturnType<typeof normalizedSearchInput>): string {
  return JSON.stringify({
    schemaVersion: 'geometry-problem-search-key/v1',
    query: input.query.toLocaleLowerCase(),
    offset: input.offset,
    limit: input.limit,
  });
}

function touchCache(key: string, entry: ProblemSearchCacheEntry): void {
  searchCache.delete(key);
  searchCache.set(key, entry);
  while (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldest = searchCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    searchCache.delete(oldest);
  }
}

function hasLiveResult(result: GeometryProblemSearchResult): boolean {
  return result.sourceStatus.some((status) => (
    (status.id === 'mathnet' || status.id === 'olympiadbench') && status.enabled
  ));
}

function staleResult(entry: ProblemSearchCacheEntry): GeometryProblemSearchResult {
  return {
    records: entry.value.records,
    sourceStatus: entry.value.sourceStatus.map((status) => ({
      ...status,
      detail: `stale-cache: ${status.detail}`,
    })),
  };
}

function waitWithCallerAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

/**
 * Bounded server-side cache and singleflight wrapper.  Live search remains a
 * mutable, untrusted reference lane; immutable corpus admission happens only
 * through a pinned ProblemArtifactManifest.
 */
export async function searchGeometryProblemSources(input: {
  readonly query: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly signal: AbortSignal;
}): Promise<GeometryProblemSearchResult> {
  const normalized = normalizedSearchInput(input);
  const key = cacheKey(normalized);
  const now = Date.now();
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > now) {
    touchCache(key, cached);
    return cached.value;
  }
  let flight = searchFlights.get(key);
  if (!flight) {
    if (searchFlights.size >= SEARCH_SINGLEFLIGHT_MAX) {
      if (cached && cached.staleUntil > now) return staleResult(cached);
      throw new Error('Problem search capacity exceeded');
    }
    const upstreamSignal = AbortSignal.timeout(12_000);
    flight = searchGeometryProblemSourcesUncached({
      ...normalized,
      signal: upstreamSignal,
    }).then((value) => {
      const observedAt = Date.now();
      if (!hasLiveResult(value) && cached && cached.staleUntil > observedAt) {
        return staleResult(cached);
      }
      const ttl = hasLiveResult(value) ? SEARCH_CACHE_TTL_MS : SEARCH_NEGATIVE_CACHE_TTL_MS;
      touchCache(key, {
        value,
        expiresAt: observedAt + ttl,
        staleUntil: observedAt + SEARCH_STALE_TTL_MS,
      });
      return value;
    }).finally(() => searchFlights.delete(key));
    searchFlights.set(key, flight);
  }
  return waitWithCallerAbort(flight, input.signal);
}

/**
 * Re-resolve one browser-selected live reference and require the normalized
 * snapshot hash to match. Browser row coordinates are only a locator; they
 * never become an integrity or rights assertion.
 */
export async function resolveGeometryProblemReference(input: {
  readonly selector: GeometryProblemReferenceSelector;
  readonly signal: AbortSignal;
}): Promise<GeometryProblemRecord | null> {
  const selector = input.selector;
  if (!validReferenceSelector(selector)) return null;
  const key = referenceKey(selector);
  const now = Date.now();
  const cached = referenceCache.get(key);
  if (cached && cached.expiresAt > now) {
    touchReferenceCache(key, cached.value, cached.expiresAt);
    return cached.value;
  }
  for (const entry of searchCache.values()) {
    if (entry.staleUntil <= now) continue;
    const match = entry.value.records.find((candidate) => (
      recordMatchesReference(candidate, selector)
    ));
    if (match) {
      touchReferenceCache(key, match);
      return match;
    }
  }

  const url = new URL(selector.source === 'mathnet' ? MATHNET_ROWS : OLYMPIADBENCH_ROWS);
  url.searchParams.set('dataset', selector.provider.datasetId);
  url.searchParams.set('config', selector.provider.config);
  url.searchParams.set('split', selector.provider.split);
  url.searchParams.set('offset', String(selector.provider.rowIndex));
  url.searchParams.set('length', '1');
  const budget: ProblemSourceRequestBudget = { requests: 0, bytes: 0 };
  consumeSourceRequest(budget);
  const response = await fetch(url, {
    signal: input.signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Problem reference returned HTTP ${response.status}`);
  const body = await boundedJsonResponse(response, budget) as { rows?: HuggingFaceRow[] };
  const row = Array.isArray(body.rows) ? body.rows[0] : undefined;
  if (!row || row.row_idx !== selector.provider.rowIndex) return null;
  const parsed = selector.source === 'mathnet'
    ? mathNetRecord(
      row.row,
      row.row_idx as number,
      selector.provider.config as 'all' | 'default',
    )
    : olympiadBenchRecord(row.row, selector.provider.config, row.row_idx as number);
  if (!parsed || !recordMatchesReference(parsed, selector)) return null;
  touchReferenceCache(key, parsed);
  return parsed;
}

export const __problemGatewayTest = {
  mathNetRecord,
  olympiadBenchRecord,
  queryTerms,
  rankRecords,
  score,
  resetGatewayCache(): void {
    searchCache.clear();
    searchFlights.clear();
    referenceCache.clear();
  },
};
