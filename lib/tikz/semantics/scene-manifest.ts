import type { SourceRange, Statement, CoordExpr, CalcExpr, NumExpr, PathSpec } from '../subset/ast';
import { evaluateScene, type Scene, type SceneElement, type SceneIssue, type ScenePoint } from './scene';
import type { Pt } from './calc-eval';
import type { TikzCst } from '../document/tikz-cst';
import {
  hashSource,
  hashSourceAsync,
  utf8Bytes,
  type SourceHashAlgorithm,
} from '../document/source-hash';

export { hashSource, hashSourceAsync } from '../document/source-hash';

/**
 * A small, versioned semantic projection intended for prompts, diagnostics and
 * cross-window hand-off.  It is deliberately not a second document source of
 * truth: TikZ source remains the only persisted representation.
 */
export const SCENE_MANIFEST_VERSION = 1 as const;

export type SceneManifestHashAlgorithm = SourceHashAlgorithm;

export interface SceneManifestInput {
  source?: string;
  /** Both spellings are accepted so callers can pass an Analysis directly. */
  revision?: number;
  sourceRevision?: number;
  stmts?: readonly Statement[] | null;
  statements?: readonly Statement[] | null;
  scene?: Scene | null;
  cst?: TikzCst | null;
  issues?: readonly SceneManifestInputIssue[] | null;
}

export interface SceneManifestInputIssue {
  severity?: string;
  kind?: string;
  message: string;
  stmtIndex?: number | null;
  stmt?: number | null;
  range?: SourceRange | null;
}

export interface SceneManifestBudget {
  /** Approximate JSON UTF-8 byte budget. */
  maxBytes?: number;
  /** Approximate model-token budget (JSON bytes / 4). */
  maxTokens?: number;
  maxPoints?: number;
  maxPaths?: number;
  maxElements?: number;
  maxIssues?: number;
  maxOpaqueNodes?: number;
  maxConstructionOrder?: number;
}

export interface SceneManifestOptions extends SceneManifestBudget {
  /** Do not evaluate statements when Analysis supplied no Scene. */
  evaluateMissingScene?: boolean;
}

export type SceneManifestPosition = { x: number | null; y: number | null };

export interface SceneManifestPoint {
  stableId: string;
  name: string;
  internal: boolean;
  position: SceneManifestPosition;
  free: boolean;
  dependsOn: string[];
  stmt: number;
  range: SourceRange | null;
}

export interface SceneManifestPathSpec {
  type: 'polyline' | 'rectangle' | 'cubic-bezier' | 'circular-arc' | 'ellipse' | 'circle';
  /** Canonical coordinate tokens, e.g. `(A)` or `$(A)!0.5!(B)`. */
  points?: string[];
  cycle?: boolean;
  sourcePathOperator?: 'polyline' | 'rectangle';
  start?: string;
  control1?: string;
  control2?: string;
  end?: string;
  first?: string;
  opposite?: string;
  startAngleDeg?: number;
  endAngleDeg?: number;
  center?: string;
  radius?: number | { through: string } | null;
  xRadius?: number;
  yRadius?: number;
  rotationDegrees?: number;
}

export interface SceneManifestIntersectionBinding {
  index: number;
  name: string;
  range: SourceRange | null;
}

export interface SceneManifestIntersections {
  of: [string, string];
  bindings: SceneManifestIntersectionBinding[];
}

export interface SceneManifestPath {
  name: string;
  stmt: number;
  range: SourceRange | null;
  specs: SceneManifestPathSpec[];
  intersections: SceneManifestIntersections | null;
}

export interface SceneManifestElement {
  stableId: string;
  kind: SceneElement['kind'];
  stmt: number;
  refs: string[];
  range: SourceRange | null;
  style?: SceneElement['style'];
  points?: SceneManifestPosition[];
  cycle?: boolean;
  /** Lossless source operator used to preserve rectangle transform semantics. */
  sourcePathOperator?: 'polyline' | 'rectangle';
  start?: SceneManifestPosition;
  control1?: SceneManifestPosition;
  control2?: SceneManifestPosition;
  end?: SceneManifestPosition;
  startAngleDeg?: number;
  endAngleDeg?: number;
  center?: SceneManifestPosition;
  axisX?: SceneManifestPosition;
  axisY?: SceneManifestPosition;
  radius?: number | null;
  xRadius?: number | null;
  yRadius?: number | null;
  rotationDegrees?: number | null;
  at?: SceneManifestPosition;
  text?: string;
  anchor?: string;
  vertex?: SceneManifestPosition;
  from?: SceneManifestPosition;
  to?: SceneManifestPosition;
  right?: boolean;
  outlined?: boolean;
  layoutIntent?: string;
  layoutAlgorithm?: string | null;
  layoutFidelity?: string;
  exactCompilerRequired?: boolean;
}

export interface SceneManifestIssue {
  severity?: string;
  kind?: string;
  message: string;
  stmt: number | null;
  range: SourceRange | null;
}

export interface SceneManifestTruncation {
  maxBytes?: number;
  maxTokens?: number;
  omitted: Partial<Record<'points' | 'namedPaths' | 'elements' | 'issues' | 'opaqueNodes' | 'constructionOrder', number>>;
  budgetExceeded?: boolean;
}

export interface SceneManifestOpaqueNode {
  syntaxId: string;
  command: string;
  impact: 'local' | 'scope' | 'document';
  recognition: 'semantic-plugin' | 'static-structure' | 'tex-expansion';
  range: SourceRange;
  byteRange: SourceRange;
  capability: 'preserve-and-exact';
}

export interface SceneManifest {
  schemaVersion: typeof SCENE_MANIFEST_VERSION;
  language: {
    id: 'pgf-tikz';
    pgfVersion: '3.1.11a';
    compatibilityProfile: 'math-geohub-safe-v1';
  };
  sourceHash: string;
  hashAlgorithm: SceneManifestHashAlgorithm;
  sourceRevision: number;
  coverage: {
    statementCount: number;
    semanticStatementCount: number;
    opaqueStatementCount: number;
    semanticRatio: number;
    truncated: boolean;
  };
  points: SceneManifestPoint[];
  namedPaths: SceneManifestPath[];
  elements: SceneManifestElement[];
  issues: SceneManifestIssue[];
  opaqueNodes: SceneManifestOpaqueNode[];
  constructionOrder: string[];
  freePointNames: string[];
  truncated?: SceneManifestTruncation;
  /** Non-enumerable ergonomic alias for consumers that call the field `paths`. */
  readonly paths: SceneManifestPath[];
  /** Non-enumerable ergonomic alias for consumers that call the field `revision`. */
  readonly revision: number;
  /** Non-enumerable source metadata alias; omitted from compact JSON. */
  readonly source: { hash: string; algorithm: SceneManifestHashAlgorithm; revision: number };
}

function finiteRevision(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function finiteNumber(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function position(value: Pt | undefined): SceneManifestPosition {
  return { x: value ? finiteNumber(value.x) : null, y: value ? finiteNumber(value.y) : null };
}

function validRange(range: SourceRange | null | undefined): SourceRange | null {
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) return null;
  return { start: Math.max(0, Math.floor(range.start)), end: Math.max(0, Math.floor(range.end)) };
}

function stmtRange(stmts: readonly Statement[], stmt: number): SourceRange | null {
  return validRange(stmts[stmt]?.range);
}

function numToken(value: number | NumExpr): string {
  if (typeof value === 'number') return String(finiteNumber(value) ?? 0);
  switch (value.kind) {
    case 'num-lit': return String(finiteNumber(value.value) ?? 0);
    case 'num-var': return value.name;
    case 'num-comp': return `${value.pvar}.${value.axis}`;
    case 'num-bin': return `(${numToken(value.left)}${value.binop}${numToken(value.right)})`;
    case 'num-call': return `${value.fn}(${numToken(value.arg)})`;
    case 'veclen': return `veclen(${numToken(value.x)},${numToken(value.y)})`;
  }
}

function calcToken(value: CalcExpr): string {
  switch (value.op) {
    case 'coord': return coordToken(value.coord);
    case 'add': return `(${calcToken(value.left)}+${calcToken(value.right)})`;
    case 'sub': return `(${calcToken(value.left)}-${calcToken(value.right)})`;
    case 'interpolate': return `${calcToken(value.a)}!${numToken(value.t)}!${calcToken(value.b)}`;
    case 'rotate': return `${calcToken(value.a)}!${numToken(value.t)}!${numToken(value.angleDeg)}:${calcToken(value.b)}`;
    case 'project': return `${calcToken(value.a)}|${calcToken(value.p)}|${calcToken(value.b)}`;
  }
}

function coordToken(value: CoordExpr): string {
  switch (value.kind) {
    case 'literal': return `(${numToken(value.x)},${numToken(value.y)})`;
    case 'ref': return `(${value.name}${value.anchor ? `.${value.anchor}` : ''})`;
    case 'calc': return `$(${calcToken(value.expr)})`;
  }
}

function compactPathSpec(spec: PathSpec): SceneManifestPathSpec {
  if (spec.type === 'polyline') {
    return {
      type: 'polyline',
      points: spec.points.map(coordToken),
      cycle: spec.cycle,
    };
  }
  if (spec.type === 'rectangle') {
    return {
      type: 'rectangle',
      first: coordToken(spec.first),
      opposite: coordToken(spec.opposite),
    };
  }
  if (spec.type === 'cubic-bezier') {
    return {
      type: 'cubic-bezier',
      start: coordToken(spec.start),
      control1: coordToken(spec.control1),
      control2: coordToken(spec.control2),
      end: coordToken(spec.end),
    };
  }
  if (spec.type === 'circular-arc') {
    return {
      type: 'circular-arc', start: coordToken(spec.start),
      startAngleDeg: finiteNumber(spec.startAngleDeg) ?? undefined,
      endAngleDeg: finiteNumber(spec.endAngleDeg) ?? undefined,
      radius: finiteNumber(spec.radius),
    };
  }
  if (spec.type === 'ellipse') {
    return {
      type: 'ellipse',
      center: coordToken(spec.center),
      xRadius: finiteNumber(spec.xRadius) ?? undefined,
      yRadius: finiteNumber(spec.yRadius) ?? undefined,
    };
  }
  return {
    type: 'circle',
    center: coordToken(spec.center),
    radius: spec.radius.kind === 'literal'
      ? finiteNumber(spec.radius.value)
      : { through: coordToken(spec.radius.point) },
  };
}

function entriesOfPoints(points: Map<string, ScenePoint> | Record<string, ScenePoint>): [string, ScenePoint][] {
  return points instanceof Map ? [...points.entries()] : Object.entries(points);
}

/** Locale-independent ordering keeps manifests byte-stable across clients. */
function compareStrings(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function dedupeSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort(compareStrings);
}

function pointManifest(scenePoint: ScenePoint, stmts: readonly Statement[]): SceneManifestPoint {
  return {
    stableId: scenePoint.stableId || `point:${scenePoint.name}`,
    name: scenePoint.name,
    internal: Boolean(scenePoint.internal),
    position: position(scenePoint.position),
    free: Boolean(scenePoint.free),
    dependsOn: dedupeSorted(scenePoint.dependsOn),
    stmt: scenePoint.stmtIndex,
    range: stmtRange(stmts, scenePoint.stmtIndex),
  };
}

function pathManifest(statement: Extract<Statement, { kind: 'path' }>, stmt: number): SceneManifestPath | null {
  if (!statement.namePath) return null;
  return {
    name: statement.namePath,
    stmt,
    range: validRange(statement.range),
    specs: statement.specs.map(compactPathSpec),
    intersections: statement.intersections
      ? {
        of: [...statement.intersections.of] as [string, string],
        bindings: statement.intersections.bindings
          .map((binding) => ({ index: binding.index, name: binding.name, range: validRange(binding.range) }))
          .sort((a, b) => a.index - b.index || compareStrings(a.name, b.name)),
      }
      : null,
  };
}

function elementManifest(element: SceneElement, index: number, stmts: readonly Statement[]): SceneManifestElement {
  const base: SceneManifestElement = {
    stableId: element.stableId || `element:${element.stmtIndex}:${index}`,
    kind: element.kind,
    stmt: element.stmtIndex,
    refs: dedupeSorted(element.refs),
    range: stmtRange(stmts, element.stmtIndex),
    style: element.style,
  };
  switch (element.kind) {
    case 'polyline': return {
      ...base,
      points: element.points.map(position),
      cycle: element.cycle,
      sourcePathOperator: element.sourcePathOperator ?? 'polyline',
    };
    case 'cubic-bezier': return {
      ...base,
      start: position(element.start),
      control1: position(element.control1),
      control2: position(element.control2),
      end: position(element.end),
    };
    case 'circular-arc': return {
      ...base,
      start: position(element.start), end: position(element.end),
      center: position(element.center), radius: finiteNumber(element.radius),
      startAngleDeg: finiteNumber(element.startAngleDeg) ?? undefined,
      endAngleDeg: finiteNumber(element.endAngleDeg) ?? undefined,
    };
    case 'elliptical-arc': return {
      ...base,
      start: position(element.start), end: position(element.end),
      center: position(element.center),
      axisX: position(element.axisX), axisY: position(element.axisY),
      xRadius: finiteNumber(element.xRadius),
      yRadius: finiteNumber(element.yRadius),
      rotationDegrees: finiteNumber(element.rotationDegrees),
      startAngleDeg: finiteNumber(element.startAngleDeg) ?? undefined,
      endAngleDeg: finiteNumber(element.endAngleDeg) ?? undefined,
    };
    case 'circle': return { ...base, center: position(element.center), radius: finiteNumber(element.radius) };
    case 'graph-node': return {
      ...base,
      center: position(element.center),
      radius: finiteNumber(element.radius),
      text: element.text,
      outlined: element.outlined,
      layoutIntent: element.layoutIntent,
      layoutAlgorithm: element.layoutAlgorithm,
      layoutFidelity: element.layoutFidelity,
      exactCompilerRequired: element.exactCompilerRequired,
    };
    case 'ellipse': return {
      ...base,
      center: position(element.center),
      xRadius: finiteNumber(element.xRadius),
      yRadius: finiteNumber(element.yRadius),
      rotationDegrees: finiteNumber(element.rotationDegrees),
    };
    case 'label': return { ...base, at: position(element.at), text: element.text, anchor: element.anchor };
    case 'angle-mark': return {
      ...base,
      vertex: position(element.vertex),
      from: position(element.from),
      to: position(element.to),
      right: element.right,
    };
  }
}

function issueManifest(issue: SceneManifestInputIssue | SceneIssue, stmts: readonly Statement[]): SceneManifestIssue {
  const stmt = ('stmt' in issue ? issue.stmt : undefined)
    ?? ('stmtIndex' in issue ? issue.stmtIndex : undefined)
    ?? null;
  const issueRange = 'range' in issue ? issue.range : null;
  return {
    severity: 'severity' in issue && issue.severity ? issue.severity : 'error',
    kind: 'kind' in issue && issue.kind ? issue.kind : undefined,
    message: issue.message,
    stmt: typeof stmt === 'number' && Number.isFinite(stmt) ? stmt : null,
    range: validRange(issueRange) ?? (typeof stmt === 'number' ? stmtRange(stmts, stmt) : null),
  };
}

function issueKey(issue: SceneManifestIssue): string {
  const range = issue.range ? `${issue.range.start}:${issue.range.end}` : '';
  return `${issue.severity ?? ''}|${issue.kind ?? ''}|${issue.stmt ?? ''}|${range}|${issue.message}`;
}

function compareRange(a: { stmt: number; range: SourceRange | null }, b: { stmt: number; range: SourceRange | null }): number {
  const ar = a.range?.start ?? Number.MAX_SAFE_INTEGER;
  const br = b.range?.start ?? Number.MAX_SAFE_INTEGER;
  return ar - br || a.stmt - b.stmt;
}

function normalizeLimit(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}

function jsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value) ?? '').byteLength;
}

function approximateTokens(value: unknown): number {
  return Math.ceil(jsonBytes(value) / 4);
}

type ManifestSection = 'points' | 'namedPaths' | 'elements' | 'issues' | 'opaqueNodes' | 'constructionOrder';

function ensureTruncation(manifest: UnaliasedSceneManifest, options: SceneManifestOptions, omitted: Partial<Record<ManifestSection, number>>, budgetExceeded = false): void {
  const hasOmissions = Object.values(omitted).some((count) => (count ?? 0) > 0);
  if (!hasOmissions && !budgetExceeded) return;
  manifest.truncated = {
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    omitted: Object.fromEntries(Object.entries(omitted).filter(([, count]) => (count ?? 0) > 0)) as SceneManifestTruncation['omitted'],
    ...(budgetExceeded ? { budgetExceeded: true } : {}),
  };
}

/**
 * A manifest before addAliases() attaches its non-enumerable `paths`,
 * `revision` and `source` aliases. Trimming only touches enumerable sections.
 */
type UnaliasedSceneManifest = Omit<SceneManifest, 'paths' | 'revision' | 'source'>;

function trimManifest(
  manifest: UnaliasedSceneManifest,
  options: SceneManifestOptions,
): UnaliasedSceneManifest {
  const omitted: Partial<Record<ManifestSection, number>> = {};
  const limits: [ManifestSection, number | undefined][] = [
    ['points', normalizeLimit(options.maxPoints)],
    ['namedPaths', normalizeLimit(options.maxPaths)],
    ['elements', normalizeLimit(options.maxElements)],
    ['issues', normalizeLimit(options.maxIssues)],
    ['opaqueNodes', normalizeLimit(options.maxOpaqueNodes)],
    ['constructionOrder', normalizeLimit(options.maxConstructionOrder)],
  ];
  for (const [section, limit] of limits) {
    if (limit === undefined) continue;
    const value = manifest[section];
    if (value.length <= limit) continue;
    omitted[section] = value.length - limit;
    (value as unknown[]).splice(limit);
  }

  const exceeds = (): boolean => (
    (options.maxBytes !== undefined && jsonBytes(manifest) > options.maxBytes)
    || (options.maxTokens !== undefined && approximateTokens(manifest) > options.maxTokens)
  );
  let guard = 0;
  // Keep points and diagnostics longest; generated elements and path metadata
  // are the first context to drop when a prompt budget is tight.
  const dropOrder: ManifestSection[] = [
    'elements',
    'namedPaths',
    'constructionOrder',
    'points',
    'opaqueNodes',
    'issues',
  ];
  while (exceeds() && guard++ < 100_000) {
    const section = dropOrder.find((candidate) => manifest[candidate].length > 0);
    if (!section) break;
    manifest[section].pop();
    omitted[section] = (omitted[section] ?? 0) + 1;
    // Update before the next size calculation so the truncation marker itself
    // is accounted for in the budget.
    ensureTruncation(manifest, options, omitted);
  }
  const budgetExceeded = exceeds();
  ensureTruncation(manifest, options, omitted, budgetExceeded);
  return manifest;
}

function addAliases(manifest: UnaliasedSceneManifest): SceneManifest {
  Object.defineProperty(manifest, 'paths', { value: manifest.namedPaths, enumerable: false, configurable: false });
  Object.defineProperty(manifest, 'revision', { value: manifest.sourceRevision, enumerable: false, configurable: false });
  Object.defineProperty(manifest, 'source', {
    value: { hash: manifest.sourceHash, algorithm: manifest.hashAlgorithm, revision: manifest.sourceRevision },
    enumerable: false,
    configurable: false,
  });
  // The three aliases exist from here on. defineProperty is invisible to the
  // type system, so the completed shape is asserted once, at this boundary.
  return manifest as SceneManifest;
}

function materializeManifest(
  input: SceneManifestInput,
  options: SceneManifestOptions,
  sourceHash: string,
  hashAlgorithm: SceneManifestHashAlgorithm,
): SceneManifest {
  const revision = finiteRevision(input.revision ?? input.sourceRevision ?? input.scene?.sourceRevision);
  const stmts = input.stmts ?? input.statements ?? [];
  let scene = input.scene ?? null;
  if (!scene && options.evaluateMissingScene !== false && stmts.length > 0) {
    scene = evaluateScene([...stmts], revision);
  }

  const points = scene
    ? entriesOfPoints(scene.points).map(([, value]) => pointManifest(value, stmts))
    : [];
  points.sort((a, b) => compareRange(a, b) || compareStrings(a.name, b.name) || compareStrings(a.stableId, b.stableId));

  const namedPaths = stmts
    .map((statement, index) => statement.kind === 'path' ? pathManifest(statement, index) : null)
    .filter((path): path is SceneManifestPath => path !== null)
    .sort((a, b) => compareRange(a, b) || compareStrings(a.name, b.name));

  const elements = scene
    ? scene.elements.map((element, index) => elementManifest(element, index, stmts))
    : [];
  elements.sort((a, b) => compareRange(a, b) || compareStrings(a.kind, b.kind) || compareStrings(a.stableId, b.stableId));

  const issueInputs: SceneManifestInputIssue[] = [
    ...(input.issues ?? []),
    ...(scene?.issues ?? []),
  ];
  const issueMap = new Map<string, SceneManifestIssue>();
  for (const issue of issueInputs) {
    const normalized = issueManifest(issue, stmts);
    issueMap.set(issueKey(normalized), normalized);
  }
  const issues = [...issueMap.values()];
  issues.sort((a, b) => (
    (a.range?.start ?? Number.MAX_SAFE_INTEGER) - (b.range?.start ?? Number.MAX_SAFE_INTEGER)
    || (a.stmt ?? Number.MAX_SAFE_INTEGER) - (b.stmt ?? Number.MAX_SAFE_INTEGER)
    || compareStrings(a.severity ?? '', b.severity ?? '')
    || compareStrings(a.kind ?? '', b.kind ?? '')
    || compareStrings(a.message, b.message)
  ));

  const graphOrder = scene?.graphOrder ?? [];
  const constructionOrder = dedupeStable([
    ...graphOrder,
    ...stmts.flatMap((statement) => {
      if (statement.kind === 'coordinate' || statement.kind === 'let-coordinate') return [statement.name];
      if (statement.kind === 'path') {
        return [
          ...(statement.namePath ? [`path:${statement.namePath}`] : []),
          ...(statement.intersections?.bindings.map((binding) => binding.name) ?? []),
        ];
      }
      return [];
    }),
  ]);
  const freePointNames = points.filter((point) => point.free).map((point) => point.name);
  const cstCoverage = input.cst?.coverage ?? {
    statementCount: stmts.length,
    semanticStatementCount: stmts.length,
    opaqueStatementCount: 0,
    semanticRatio: 1,
  };
  const opaqueNodes: SceneManifestOpaqueNode[] = (input.cst?.opaqueNodes ?? []).map((node) => ({
    syntaxId: node.syntaxId,
    command: node.command,
    impact: node.impact,
    recognition: node.recognition,
    range: { ...node.range },
    byteRange: {
      start: node.indexedRange.start.utf8,
      end: node.indexedRange.end.utf8,
    },
    capability: 'preserve-and-exact',
  }));

  const manifest = addAliases(trimManifest({
    schemaVersion: SCENE_MANIFEST_VERSION,
    language: {
      id: 'pgf-tikz',
      pgfVersion: '3.1.11a',
      compatibilityProfile: 'math-geohub-safe-v1',
    },
    sourceHash,
    hashAlgorithm,
    sourceRevision: revision,
    coverage: {
      ...cstCoverage,
      truncated: false,
    },
    points,
    namedPaths,
    elements,
    issues,
    opaqueNodes,
    constructionOrder,
    freePointNames,
  }, options));
  manifest.coverage.truncated = Boolean(manifest.truncated);

  return manifest;
}

function dedupeStable(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/** Build a compact manifest synchronously using the deterministic FNV fallback. */
export function buildSceneManifest(input: SceneManifestInput, options: SceneManifestOptions = {}): SceneManifest {
  const source = input.source ?? '';
  return materializeManifest(input, options, hashSource(source), 'fnv1a64-utf8');
}

/** Build a manifest with SHA-256 when Web Crypto is available. */
export async function buildSceneManifestAsync(input: SceneManifestInput, options: SceneManifestOptions = {}): Promise<SceneManifest> {
  const source = input.source ?? '';
  const digest = await hashSourceAsync(source);
  return materializeManifest(input, options, digest.hash, digest.algorithm);
}

// Short aliases keep call sites readable without duplicating implementation.
export const createSceneManifest = buildSceneManifest;
export const toSceneManifest = buildSceneManifest;

/** Stable compact JSON serialization; object key order is schema-defined above. */
export function serializeSceneManifest(manifest: SceneManifest): string {
  return JSON.stringify(manifest);
}
