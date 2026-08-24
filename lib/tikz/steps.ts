import { collectCoordRefs } from './subset/static-check';
import type { CalcExpr, CoordExpr, Statement } from './subset/ast';
import type { Scene } from './semantics/scene';

export interface ConstructionStep {
  index: number;
  title: string;
  stmtIndex: number;
  refs: string[];
}

function calcTitle(name: string, expression: CalcExpr): string {
  const refs = collectCoordRefs({ kind: 'calc', expr: expression, range: expression.range });
  if (expression.op === 'interpolate') {
    const ratio = expression.t.kind === 'num-lit' ? expression.t.value : null;
    if (ratio === 0.5 && refs.length >= 2) return `${name}：${refs[0]}、${refs[1]} 的中点`;
    return `${name}：在 ${refs.slice(0, 2).join('、')} 上按比例取点`;
  }
  if (expression.op === 'project') {
    return `${name}：${refs[1] ?? '点'} 到 ${refs[0] ?? ''}${refs[2] ?? ''} 的垂足`;
  }
  if (expression.op === 'rotate') {
    const angle = expression.angleDeg.kind === 'num-lit' ? expression.angleDeg.value : '给定';
    return `${name}：旋转 ${angle}° 构造`;
  }
  return `${name}：向量合成构造`;
}

function coordinateTitle(name: string, coordinate: CoordExpr): string {
  if (coordinate.kind === 'literal') return `自由点 ${name}`;
  if (coordinate.kind === 'ref') return `${name}：复制点 ${coordinate.name}`;
  return calcTitle(name, coordinate.expr);
}

function statementSteps(statement: Statement, stmtIndex: number): Omit<ConstructionStep, 'index'>[] {
  if (statement.kind === 'coordinate') {
    return [{
      title: coordinateTitle(statement.name, statement.at),
      stmtIndex,
      refs: [statement.name, ...collectCoordRefs(statement.at)],
    }];
  }
  if (statement.kind === 'let-coordinate') {
    return [{
      title: `${statement.name}：计算构造`,
      stmtIndex,
      refs: [statement.name, ...collectCoordRefs(statement.at)],
    }];
  }
  if (statement.kind === 'node') {
    return [{ title: `标注：${statement.text.replace(/\$/g, '')}`, stmtIndex, refs: collectCoordRefs(statement.at) }];
  }
  if (statement.kind === 'pic') {
    return [{
      title: statement.picType === 'right-angle' ? '作图：直角标记' : '作图：角标记',
      stmtIndex,
      refs: [...statement.points],
    }];
  }
  if (statement.kind === 'graph') {
    return [{
      title: `作图：静态图（${statement.nodes.length} 个节点，${statement.edges.length} 条关系）`,
      stmtIndex,
      refs: statement.nodes.map((node) => node.name),
    }];
  }

  const steps: Omit<ConstructionStep, 'index'>[] = [];
  if (statement.namePath) {
    steps.push({ title: `构造路径 ${statement.namePath}`, stmtIndex, refs: [] });
  }
  if (statement.intersections) {
    for (const binding of statement.intersections.bindings) {
      steps.push({
        title: `${binding.name}：${statement.intersections.of[0]} 与 ${statement.intersections.of[1]} 的交点`,
        stmtIndex,
        refs: [binding.name],
      });
    }
  }
  if (statement.command !== 'path') {
    for (const spec of statement.specs) {
      const refs = spec.type === 'polyline'
        ? spec.points.flatMap(collectCoordRefs)
        : spec.type === 'rectangle'
          ? [spec.first, spec.opposite].flatMap(collectCoordRefs)
        : spec.type === 'cubic-bezier'
          ? [spec.start, spec.control1, spec.control2, spec.end].flatMap(collectCoordRefs)
        : spec.type === 'circular-arc'
          ? collectCoordRefs(spec.start)
        : spec.type === 'ellipse'
          ? collectCoordRefs(spec.center)
        : [
            ...collectCoordRefs(spec.center),
            ...(spec.radius.kind === 'through' ? collectCoordRefs(spec.radius.point) : []),
          ];
      steps.push({
        title: spec.type === 'circle'
          ? `作图：圆${statement.command.startsWith('fill') ? '（填充）' : ''}`
          : spec.type === 'cubic-bezier'
            ? '作图：三次 Bézier 曲线'
          : spec.type === 'rectangle'
            ? '作图：矩形'
          : spec.type === 'circular-arc'
            ? '作图：圆弧'
          : spec.type === 'ellipse'
            ? '作图：椭圆'
          : `作图：${spec.cycle ? '多边形' : '折线'}`,
        stmtIndex,
        refs,
      });
    }
  }
  return steps;
}

export function deriveSteps(statements: Statement[], scene: Scene): ConstructionStep[] {
  void scene.graphOrder;
  const steps = statements.flatMap(statementSteps);
  return steps.map((step, index) => ({ ...step, index }));
}
