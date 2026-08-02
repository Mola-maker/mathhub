export interface NonlinearSolveOptions {
  initial: readonly number[];
  residual(values: readonly number[]): readonly number[];
  maxIterations?: number;
  tolerance?: number;
  finiteDifferenceStep?: number;
  maxVariableStep?: number;
}

export interface NonlinearSolveResult {
  values: number[];
  residualNorm: number;
  iterations: number;
  converged: boolean;
}

function squaredNorm(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value * value, 0);
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

    const divisor = augmented[column][column];
    for (let entry = column; entry <= size; entry += 1) {
      augmented[column][entry] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

export function solveNonlinear(options: NonlinearSolveOptions): NonlinearSolveResult {
  const maxIterations = options.maxIterations ?? 18;
  const tolerance = options.tolerance ?? 1e-3;
  const finiteDifferenceStep = options.finiteDifferenceStep ?? 1e-4;
  const maxVariableStep = options.maxVariableStep ?? 2;
  let values = [...options.initial];
  let residual = [...options.residual(values)];
  let cost = squaredNorm(residual);
  let damping = 1e-2;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const residualNorm = Math.sqrt(cost);
    if (residualNorm <= tolerance) {
      return { values, residualNorm, iterations: iteration, converged: true };
    }

    const jacobian = Array.from(
      { length: residual.length },
      () => Array(values.length).fill(0),
    );
    for (let variable = 0; variable < values.length; variable += 1) {
      const shifted = [...values];
      const step = finiteDifferenceStep * Math.max(1, Math.abs(values[variable]));
      shifted[variable] += step;
      const shiftedResidual = options.residual(shifted);
      for (let row = 0; row < residual.length; row += 1) {
        jacobian[row][variable] = (shiftedResidual[row] - residual[row]) / step;
      }
    }

    const normal = Array.from(
      { length: values.length },
      () => Array(values.length).fill(0),
    );
    const gradient = Array(values.length).fill(0);
    for (let left = 0; left < values.length; left += 1) {
      for (let row = 0; row < residual.length; row += 1) {
        gradient[left] += jacobian[row][left] * residual[row];
      }
      for (let right = 0; right < values.length; right += 1) {
        for (let row = 0; row < residual.length; row += 1) {
          normal[left][right] += jacobian[row][left] * jacobian[row][right];
        }
      }
      normal[left][left] += damping;
    }

    const delta = solveLinearSystem(normal, gradient.map((value) => -value));
    if (!delta) break;
    const candidate = values.map((value, index) => (
      value + Math.max(-maxVariableStep, Math.min(maxVariableStep, delta[index]))
    ));
    const candidateResidual = [...options.residual(candidate)];
    const candidateCost = squaredNorm(candidateResidual);
    if (candidateCost < cost) {
      values = candidate;
      residual = candidateResidual;
      cost = candidateCost;
      damping = Math.max(1e-8, damping * 0.35);
    } else {
      damping = Math.min(1e8, damping * 8);
    }
  }

  return {
    values,
    residualNorm: Math.sqrt(cost),
    iterations: maxIterations,
    converged: Math.sqrt(cost) <= tolerance,
  };
}
