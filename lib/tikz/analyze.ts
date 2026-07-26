import { evaluateScene, type Scene } from './semantics/scene';
import { ParseError, type SourceRange, type Statement } from './subset/ast';
import { parseTikz } from './subset/parser';
import { staticCheck } from './subset/static-check';

export interface AnalysisIssue {
  severity: 'error' | 'preview-only';
  message: string;
  range: SourceRange | null;
}

export interface Analysis {
  stmts: Statement[] | null;
  scene: Scene | null;
  issues: AnalysisIssue[];
  freePointRanges: Map<string, SourceRange>;
}

function freeRanges(stmts: Statement[]): Map<string, SourceRange> {
  const ranges = new Map<string, SourceRange>();
  for (const statement of stmts) {
    if (statement.kind === 'coordinate' && statement.at.kind === 'literal') {
      ranges.set(statement.name, statement.at.range);
    }
  }
  return ranges;
}

export function analyze(code: string): Analysis {
  let stmts: Statement[];
  try {
    stmts = parseTikz(code).statements;
  } catch (error) {
    if (error instanceof ParseError) {
      return {
        stmts: null,
        scene: null,
        issues: [{
          severity: 'error',
          message: error.message,
          range: { start: error.start, end: error.end },
        }],
        freePointRanges: new Map(),
      };
    }
    throw error;
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
  const ranges = freeRanges(stmts);

  if (staticIssues.some((issue) => issue.severity === 'error')) {
    return {
      stmts,
      scene: null,
      issues: staticIssues,
      freePointRanges: ranges,
    };
  }

  const scene = evaluateScene(stmts);
  const evaluationIssues: AnalysisIssue[] = scene.issues.map((issue) => ({
    severity: 'error',
    message: issue.message,
    range: issue.stmtIndex >= 0 ? stmts[issue.stmtIndex]?.range ?? null : null,
  }));
  return {
    stmts,
    scene,
    issues: [...staticIssues, ...evaluationIssues],
    freePointRanges: ranges,
  };
}

