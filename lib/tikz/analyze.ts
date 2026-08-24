import { evaluateScene, type Scene } from './semantics/scene';
import { parseTikzCst, type TikzCst } from './document/tikz-cst';
import type { Tree } from '@lezer/common';
import { ParseError, type SourceRange, type Statement } from './subset/ast';
import { parseTikz } from './subset/parser';
import { staticCheck } from './subset/static-check';
import type { TikzCoordinateTransform } from './subset/coordinate-transform';

export interface AnalysisIssue {
  severity: 'error' | 'preview-only';
  message: string;
  range: SourceRange | null;
}

export interface Analysis {
  sourceRevision: number;
  status: 'complete' | 'partial' | 'invalid';
  cst: TikzCst;
  stmts: Statement[] | null;
  scene: Scene | null;
  issues: AnalysisIssue[];
  freePointRanges: Map<string, SourceRange>;
  /** World-to-source writeback uses the inverse of this per-point CTM. */
  freePointTransforms: Map<string, TikzCoordinateTransform>;
}

function freePointProjection(stmts: Statement[]): {
  ranges: Map<string, SourceRange>;
  transforms: Map<string, TikzCoordinateTransform>;
} {
  const ranges = new Map<string, SourceRange>();
  const transforms = new Map<string, TikzCoordinateTransform>();
  for (const statement of stmts) {
    if (statement.kind === 'coordinate' && statement.at.kind === 'literal') {
      ranges.set(statement.name, statement.at.range);
      if (statement.coordinateTransform) {
        transforms.set(statement.name, statement.coordinateTransform);
      }
    }
  }
  return { ranges, transforms };
}

const STATEMENT_WRAPPER_PREFIX = '\\begin{tikzpicture}\n';

function shiftSourceRanges<T>(value: T, delta: number): T {
  if (Array.isArray(value)) {
    return value.map((item) => shiftSourceRanges(item, delta)) as unknown as T;
  }
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (
    typeof record.start === 'number'
    && typeof record.end === 'number'
  ) {
    return {
      ...record,
      start: record.start + delta,
      end: record.end + delta,
    } as unknown as T;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      shiftSourceRanges(entry, delta),
    ]),
  ) as unknown as T;
}

function parseSemanticProjection(code: string, cst: TikzCst): Statement[] {
  if (
    cst.opaqueNodes.length === 0
    && !/\\begin\s*\{scope\}/u.test(code)
    && cst.statements.every((node) => !node.coordinateTransform)
  ) {
    return parseTikz(code).statements;
  }

  const statements: Statement[] = [];
  for (const node of cst.statements) {
    if (node.kind !== 'semantic') continue;
    const statementSource = code.slice(node.range.start, node.range.end);
    const wrapped = (
      `${STATEMENT_WRAPPER_PREFIX}${statementSource}\n\\end{tikzpicture}`
    );
    const statement = parseTikz(wrapped).statements[0];
    if (!statement) continue;
    const shifted = shiftSourceRanges(
      statement,
      node.range.start - STATEMENT_WRAPPER_PREFIX.length,
    );
    statements.push({
      ...shifted,
      ...(node.coordinateTransform ? { coordinateTransform: node.coordinateTransform } : {}),
      ...(node.inheritedStyleRaw ? { inheritedStyleRaw: node.inheritedStyleRaw } : {}),
    });
  }
  return statements;
}

export function analyze(code: string, sourceRevision = 0, cstTree?: Tree): Analysis {
  const cst = parseTikzCst(code, cstTree);
  if (code.trim().length === 0) {
    const stmts: Statement[] = [];
    return {
      sourceRevision,
      status: 'complete',
      cst,
      stmts,
      scene: evaluateScene(stmts, sourceRevision),
      issues: [],
      freePointRanges: new Map(),
      freePointTransforms: new Map(),
    };
  }
  if (cst.errorRanges.length > 0) {
    return {
      sourceRevision,
      status: 'invalid',
      cst,
      stmts: null,
      scene: null,
      issues: cst.errorRanges.map((range) => ({
        severity: 'error',
        message: 'TikZ 语法结构不完整',
        range,
      })),
      freePointRanges: new Map(),
      freePointTransforms: new Map(),
    };
  }
  let stmts: Statement[];
  try {
    stmts = parseSemanticProjection(code, cst);
  } catch (error) {
    if (error instanceof ParseError) {
      return {
        sourceRevision,
        status: 'invalid',
        cst,
        stmts: null,
        scene: null,
        issues: [{
          severity: 'error',
          message: error.message,
          range: { start: error.start, end: error.end },
        }],
        freePointRanges: new Map(),
        freePointTransforms: new Map(),
      };
    }
    return {
      sourceRevision,
      status: 'invalid',
      cst,
      stmts: null,
      scene: null,
      issues: [{
        severity: 'error',
        message: error instanceof Error
          ? error.message
          : '交互语义投影失败',
        range: null,
      }],
      freePointRanges: new Map(),
      freePointTransforms: new Map(),
    };
  }

  const picture = {
    scale: null,
    statements: stmts,
    range: { start: 0, end: code.length },
  };
  const staticIssues: AnalysisIssue[] = staticCheck(picture).map((issue) => ({
    severity: issue.severity,
    message: issue.message,
    range: issue.range,
  }));
  staticIssues.push(...cst.opaqueNodes.map((node) => ({
    severity: 'preview-only' as const,
    message: `${node.command || '未知 TikZ 语句'} 超出交互子集；源码已原样保留并交给精确编译器`,
    range: node.range,
  })));
  const freePoints = freePointProjection(stmts);

  if (staticIssues.some((issue) => issue.severity === 'error')) {
    return {
      sourceRevision,
      status: 'invalid',
      cst,
      stmts,
      scene: null,
      issues: staticIssues,
      freePointRanges: freePoints.ranges,
      freePointTransforms: freePoints.transforms,
    };
  }

  const scene = evaluateScene(stmts, sourceRevision);
  const evaluationIssues: AnalysisIssue[] = scene.issues.map((issue) => ({
    severity: 'error',
    message: issue.message,
    range: issue.stmtIndex >= 0 ? stmts[issue.stmtIndex]?.range ?? null : null,
  }));
  return {
    sourceRevision,
    status: evaluationIssues.length > 0
      ? 'invalid'
      : cst.opaqueNodes.length > 0
        ? 'partial'
        : 'complete',
    cst,
    stmts,
    scene,
    issues: [...staticIssues, ...evaluationIssues],
    freePointRanges: freePoints.ranges,
    freePointTransforms: freePoints.transforms,
  };
}
