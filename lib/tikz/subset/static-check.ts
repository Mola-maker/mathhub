import type { TikzPicture, Statement, CoordExpr, CalcExpr, SourceRange } from './ast';

export interface CheckIssue {
  severity: 'error' | 'preview-only';
  message: string;
  range: SourceRange | null;
  stmtIndex: number | null;
}

export function collectCoordRefs(coord: CoordExpr): string[] {
  switch (coord.kind) {
    case 'literal': return [];
    case 'ref': return [coord.name];
    case 'calc': return collectCalcRefs(coord.expr);
  }
}

export function collectCalcRefs(e: CalcExpr): string[] {
  switch (e.op) {
    case 'coord': return collectCoordRefs(e.coord);
    case 'add':
    case 'sub':
      return [...collectCalcRefs(e.left), ...collectCalcRefs(e.right)];
    case 'interpolate':
    case 'rotate':
      return [...collectCalcRefs(e.a), ...collectCalcRefs(e.b)];
    case 'project':
      return [...collectCalcRefs(e.a), ...collectCalcRefs(e.p), ...collectCalcRefs(e.b)];
  }
}

function collectPathRefsFromCoord(coord: CoordExpr): string[] {
  return collectCoordRefs(coord);
}

export function staticCheck(pic: TikzPicture): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const pointDefs = new Map<string, { stmtIndex: number; range: SourceRange }>();
  const pathDefs = new Map<string, number>();

  // 1. collect definitions
  pic.statements.forEach((s, idx) => {
    if (s.kind === 'coordinate') {
      if (pointDefs.has(s.name)) {
        issues.push({ severity: 'error', message: `点 '${s.name}' 重复定义`, range: s.range, stmtIndex: idx });
      } else {
        pointDefs.set(s.name, { stmtIndex: idx, range: s.range });
      }
    } else if (s.kind === 'path') {
      if (s.namePath) {
        if (pathDefs.has(s.namePath)) {
          issues.push({ severity: 'error', message: `命名路径 '${s.namePath}' 重复定义`, range: s.range, stmtIndex: idx });
        } else {
          pathDefs.set(s.namePath, idx);
        }
      }
      // intersection bindings register points
      if (s.intersections) {
        for (const b of s.intersections.bindings) {
          if (pointDefs.has(b.name)) {
            issues.push({ severity: 'error', message: `点 '${b.name}' 重复定义`, range: b.range, stmtIndex: idx });
          } else {
            pointDefs.set(b.name, { stmtIndex: idx, range: b.range });
          }
        }
      }
    } else if (s.kind === 'let-coordinate') {
      if (pointDefs.has(s.name)) {
        issues.push({ severity: 'error', message: `点 '${s.name}' 重复定义`, range: s.range, stmtIndex: idx });
      } else {
        pointDefs.set(s.name, { stmtIndex: idx, range: s.range });
      }
    }
  });

  // 2. check refs
  pic.statements.forEach((s, idx) => {
    if (s.kind === 'coordinate') {
      for (const ref of collectPathRefsFromCoord(s.at)) {
        if (!pointDefs.has(ref)) {
          issues.push({ severity: 'error', message: `未定义的点 '${ref}'`, range: s.at.range, stmtIndex: idx });
        }
      }
    } else if (s.kind === 'let-coordinate') {
      for (const ref of collectPathRefsFromCoord(s.at)) {
        if (!pointDefs.has(ref)) {
          issues.push({ severity: 'error', message: `未定义的点 '${ref}'`, range: s.at.range, stmtIndex: idx });
        }
      }
      // \p bindings may reference named points
      for (const b of s.bindings) {
        if (b.type === 'point') {
          for (const ref of collectPathRefsFromCoord(b.value)) {
            if (!pointDefs.has(ref)) {
              issues.push({ severity: 'error', message: `未定义的点 '${ref}'`, range: b.range, stmtIndex: idx });
            }
          }
        }
      }
    } else if (s.kind === 'path') {
      // specs: polyline points + circle (center, through point)
      for (const spec of s.specs) {
        if (spec.type === 'polyline') {
          for (const p of spec.points) {
            for (const ref of collectPathRefsFromCoord(p)) {
              if (!pointDefs.has(ref)) {
                issues.push({ severity: 'error', message: `未定义的点 '${ref}'`, range: p.range, stmtIndex: idx });
              }
            }
          }
        } else if (spec.type === 'circle') {
          for (const ref of collectPathRefsFromCoord(spec.center)) {
            if (!pointDefs.has(ref)) {
              issues.push({ severity: 'error', message: `未定义的点 '${ref}'`, range: spec.center.range, stmtIndex: idx });
            }
          }
          if (spec.radius.kind === 'through') {
            for (const ref of collectPathRefsFromCoord(spec.radius.point)) {
              if (!pointDefs.has(ref)) {
                issues.push({ severity: 'error', message: `未定义的点 '${ref}'`, range: spec.radius.point.range, stmtIndex: idx });
              }
            }
          }
        }
      }
      // intersections.of
      if (s.intersections) {
        for (const name of s.intersections.of) {
          if (!pathDefs.has(name)) {
            issues.push({ severity: 'error', message: `未定义的命名路径 '${name}'`, range: s.range, stmtIndex: idx });
          }
        }
      }
    } else if (s.kind === 'node') {
      for (const ref of collectPathRefsFromCoord(s.at)) {
        if (!pointDefs.has(ref)) {
          issues.push({ severity: 'error', message: `未定义的点 '${ref}'`, range: s.at.range, stmtIndex: idx });
        }
      }
    } else if (s.kind === 'pic') {
      for (const ref of s.points) {
        if (!pointDefs.has(ref)) {
          issues.push({ severity: 'error', message: `未定义的点 '${ref}'`, range: s.range, stmtIndex: idx });
        }
      }
    }
  });

  return issues;
}

// suppress unused
void ({} as Statement);