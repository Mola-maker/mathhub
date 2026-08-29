import type {
  GeometryConstraint,
  GeometryEntity,
  GeometryRelation,
} from '../ir/model';

export type ConstraintDiagnosticCode =
  | 'dangling-reference'
  | 'duplicate-constraint'
  | 'redundant-constraint'
  | 'over-constrained-candidate'
  | 'unsatisfied'
  | 'unknown';

export interface ConstraintDiagnostic {
  code: ConstraintDiagnosticCode;
  message: string;
  entityIds: string[];
  constraintIds: string[];
  relationIds: string[];
  /** Always structural: no numeric residual or solver convergence is implied. */
  structural: true;
}

export interface ConstraintComponent {
  id: string;
  entityIds: string[];
  constraintIds: string[];
  relationIds: string[];
  estimatedDof: number | null;
}

export interface ConstraintDiagnosticsInput {
  entities: readonly GeometryEntity[];
  constraints: readonly GeometryConstraint[];
  relations: readonly GeometryRelation[];
}

export interface ConstraintDiagnosticsReport {
  components: ConstraintComponent[];
  diagnostics: ConstraintDiagnostic[];
  /** Explicitly distinguishes planning heuristics from numerical solving. */
  mode: 'structural-planning-only';
}

const entityDof: Record<string, number> = {
  point: 2, line: 4, segment: 4, circle: 3, arc: 5, conic: 5, path: 0,
};
const constraintDof: Record<string, number> = {
  coincident: 2, point_on: 1, 'point-on-object': 1, parallel: 1,
  perpendicular: 1, tangent: 1, horizontal: 1, vertical: 1,
  distance: 1, length: 1, radius: 1, angle: 1, equal: 1,
  'point-on-circle': 1, 'on-circle': 1,
  midpoint: 2, 'perpendicular-foot': 2,
  'circle-through-three-points': 3,
  'tangent-at-point': 2,
  'perpendicular-bisector': 1, 'angle-bisector': 1,
  // These weights are deliberately structural planning heuristics. They
  // count independent scalar equations in the 2-D construction record; they
  // do not claim that a numerical solver has evaluated residuals or rank.
  'point-reflection': 2,
  // A line reflection record carries both the projection foot and the
  // reflected point, hence two coordinates for each derived point.
  'line-reflection': 4,
  rotation: 2,
  homothety: 2,
  // The typed record closes both the equal-power point and its axis direction
  // witness. This is a planning weight for those two derived scalar conditions.
  'radical-axis': 2,
  // The intersection point satisfies one incidence equation per parent
  // line. The `domain` field is a discrete selector and adds no equation.
  'line-intersection': 2,
  // Line incidence plus circle incidence; excluding the known point chooses a
  // discrete branch and therefore does not change the continuous count.
  'line-circle-other-intersection': 2,
  inversion: 2,
  // A named triangle center is fixed by two independent scalar equations.
  circumcenter: 2,
  orthocenter: 2,
  // Every supported n-ary fact (n >= 4) contains at least the quadrilateral
  // codimension-one condition. Weight 1 is exact for n=4 and conservative for
  // larger point sets.
  cyclic: 1,
  concyclic: 1,
  collinear: 1,
  'complete-quadrilateral': 1,
};

function refs(args: readonly { entityId?: string }[]): string[] {
  return [...new Set(args.flatMap((arg) => arg.entityId ? [arg.entityId] : []))];
}

function diagnostic(code: ConstraintDiagnosticCode, message: string, entityIds: string[], constraintIds: string[] = [], relationIds: string[] = []): ConstraintDiagnostic {
  return { code, message, entityIds, constraintIds, relationIds, structural: true };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** Builds a constraint/entity graph and conservative symbolic diagnostics. */
export function diagnoseConstraintStructure(input: ConstraintDiagnosticsInput): ConstraintDiagnosticsReport {
  const entityIds = new Set(input.entities.map((entity) => entity.id));
  const entitiesById = new Map(input.entities.map((entity) => [entity.id, entity]));
  const constraintsById = new Map(input.constraints.map((constraint) => [constraint.id, constraint]));
  const diagnostics: ConstraintDiagnostic[] = [];
  const edges = new Map<string, Set<string>>();
  const danglingConstraintIds = new Set<string>();
  const duplicateConstraintIds = new Set<string>();
  const connect = (a: string, b: string) => {
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a)!.add(b); edges.get(b)!.add(a);
  };
  input.entities.forEach((entity) => edges.set(`e:${entity.id}`, new Set()));
  const signatures = new Map<string, string>();
  for (const constraint of input.constraints) {
    const ids = refs(constraint.arguments);
    const missing = ids.filter((id) => !entityIds.has(id));
    if (missing.length) {
      danglingConstraintIds.add(constraint.id);
      diagnostics.push(diagnostic('dangling-reference', `Constraint ${constraint.id} references missing entities: ${missing.join(', ')}`, missing, [constraint.id]));
    }
    const node = `c:${constraint.id}`;
    edges.set(node, new Set()); ids.filter((id) => entityIds.has(id)).forEach((id) => connect(node, `e:${id}`));
    const signature = `${constraint.kind}|${[...ids].sort().join(',')}|${canonicalJson(constraint.parameters ?? {})}`;
    const previous = signatures.get(signature);
    if (previous) {
      duplicateConstraintIds.add(constraint.id);
      diagnostics.push(diagnostic('duplicate-constraint', `Constraint ${constraint.id} duplicates ${previous}`, ids, [previous, constraint.id]));
      diagnostics.push(diagnostic('redundant-constraint', `Duplicate constraint ${constraint.id} is structurally redundant`, ids, [constraint.id]));
    } else signatures.set(signature, constraint.id);
    if (constraint.enabled === false) diagnostics.push(diagnostic('unknown', `Constraint ${constraint.id} is disabled; satisfiability is unknown`, ids, [constraint.id]));
    if (!constraintDof[constraint.kind]) diagnostics.push(diagnostic('unknown', `Constraint kind ${constraint.kind} has no known symbolic DoF weight`, ids, [constraint.id]));
  }
  for (const relation of input.relations) {
    const ids = refs(relation.participants); const missing = ids.filter((id) => !entityIds.has(id));
    if (missing.length) diagnostics.push(diagnostic('dangling-reference', `Relation ${relation.id} references missing entities: ${missing.join(', ')}`, missing, [], [relation.id]));
    const node = `r:${relation.id}`; edges.set(node, new Set()); ids.filter((id) => entityIds.has(id)).forEach((id) => connect(node, `e:${id}`));
  }
  const seen = new Set<string>(); const components: ConstraintComponent[] = [];
  for (const start of edges.keys()) {
    if (seen.has(start)) continue;
    const queue = [start]; seen.add(start); const nodes: string[] = [];
    while (queue.length) { const node = queue.shift()!; nodes.push(node); for (const next of edges.get(node) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); } }
    const es = nodes.filter((n) => n.startsWith('e:')).map((n) => n.slice(2));
    const cs = nodes.filter((n) => n.startsWith('c:')).map((n) => n.slice(2));
    const rs = nodes.filter((n) => n.startsWith('r:')).map((n) => n.slice(2));
    const entityWeights = es.map((id) => entityDof[entitiesById.get(id)?.kind ?? '']);
    const activeConstraints = cs
      .map((id) => constraintsById.get(id))
      .filter((constraint): constraint is GeometryConstraint => (
        constraint !== undefined
        && constraint.enabled !== false
        && !duplicateConstraintIds.has(constraint.id)
        && !danglingConstraintIds.has(constraint.id)
      ));
    const constraintWeights = activeConstraints.map((constraint) => constraintDof[constraint.kind]);
    const estimateKnown = (
      es.length > 0
      && entityWeights.every((weight) => weight !== undefined)
      && constraintWeights.every((weight) => weight !== undefined)
      && cs.every((id) => !danglingConstraintIds.has(id))
    );
    const dof = entityWeights.reduce((sum, weight) => sum + (weight ?? 0), 0);
    const reduction = constraintWeights.reduce((sum, weight) => sum + (weight ?? 0), 0);
    const estimatedDof = estimateKnown ? Math.max(0, dof - reduction) : null;
    const id = `component-${components.length + 1}`; components.push({ id, entityIds: es, constraintIds: cs, relationIds: rs, estimatedDof });
    if (estimateKnown && reduction > dof) diagnostics.push(diagnostic('over-constrained-candidate', `Component ${id} has more known constraint equations than estimated entity DoF`, es, cs, rs));
  }
  return { components, diagnostics, mode: 'structural-planning-only' };
}
