import { analyze } from '../analyze';
import { applyTextPatches, type TextPatch } from '../document/source-transaction';
import { coordinateLiteralPatch } from '../patch/source-patch';
import { buildDependencyGraph } from '../semantics/dependency-graph';
import { solveNonlinear } from './nonlinear-solver';
import type { DerivedDragRequest, DerivedDragResult } from './protocol';

function unsolved(request: DerivedDragRequest, message: string): DerivedDragResult {
  return {
    sourceRevision: request.sourceRevision,
    status: 'unsolved',
    patches: [],
    residual: Number.POSITIVE_INFINITY,
    iterations: 0,
    variables: [],
    message,
  };
}

export function solveDerivedDrag(request: DerivedDragRequest): DerivedDragResult {
  const initialAnalysis = analyze(request.source, request.sourceRevision);
  if (!initialAnalysis.scene || !initialAnalysis.stmts) {
    return unsolved(request, '当前源码无法形成可求解的语义场景');
  }
  const draggedPoint = initialAnalysis.scene.points.get(request.pointName);
  if (!draggedPoint) return unsolved(request, `找不到派生点 ${request.pointName}`);

  const graph = buildDependencyGraph(initialAnalysis.stmts);
  const upstreamFree = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    if (initialAnalysis.freePointRanges.has(id)) upstreamFree.add(id);
    for (const dependency of graph.dependencies.get(id) ?? []) visit(dependency);
  };
  visit(request.pointName);

  const variablePoints = graph.order.filter((id) => upstreamFree.has(id));
  if (variablePoints.length === 0) {
    return unsolved(request, `派生点 ${request.pointName} 没有可写回的上游自由点`);
  }

  const initialValues = variablePoints.flatMap((name) => {
    const point = initialAnalysis.scene!.points.get(name);
    return point ? [point.position.x, point.position.y] : [];
  });
  if (initialValues.length !== variablePoints.length * 2) {
    return unsolved(request, '上游自由点求值不完整');
  }

  const patchesFor = (values: readonly number[]): TextPatch[] => (
    variablePoints.map((name, index) => coordinateLiteralPatch(
      request.source,
      initialAnalysis.freePointRanges.get(name)!,
      { x: values[index * 2], y: values[index * 2 + 1] },
    ))
  );
  const targetResidual = (values: readonly number[]): [number, number] => {
    try {
      const candidate = applyTextPatches(request.source, patchesFor(values));
      const analysis = analyze(candidate, request.sourceRevision);
      const point = analysis.scene?.points.get(request.pointName);
      if (!point) return [1_000, 1_000];
      return [
        point.position.x - request.target.x,
        point.position.y - request.target.y,
      ];
    } catch {
      return [1_000, 1_000];
    }
  };

  const regularization = 0.01;
  const solved = solveNonlinear({
    initial: initialValues,
    maxIterations: 18,
    tolerance: 1e-6,
    finiteDifferenceStep: 1e-4,
    maxVariableStep: 2,
    residual(values) {
      const target = targetResidual(values);
      return [
        ...target,
        ...values.map((value, index) => (
          regularization * (value - initialValues[index])
        )),
      ];
    },
  });
  const finalTargetResidual = targetResidual(solved.values);
  const residual = Math.hypot(...finalTargetResidual);
  if (!Number.isFinite(residual) || residual > 0.03) {
    return {
      sourceRevision: request.sourceRevision,
      status: 'unsolved',
      patches: [],
      residual,
      iterations: solved.iterations,
      variables: variablePoints,
      message: '拖动目标与当前构造约束不兼容',
    };
  }

  return {
    sourceRevision: request.sourceRevision,
    status: initialValues.length > 2 ? 'underconstrained' : 'solved',
    patches: patchesFor(solved.values),
    residual,
    iterations: solved.iterations,
    variables: variablePoints,
  };
}
