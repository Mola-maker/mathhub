# Source-neutral Construction Evaluation — Static Evidence

Date: 2026-08-01

## Architecture boundary

- `lib/tikz/authoring/construction-eval.ts` evaluates a revision-bound
  `ConstructionPlan + ReadonlyMap<string, Pt>` without parsing, compiling, or
  writing TikZ.
- The result is immutable and carries evaluated points, entity geometry,
  diagnostics, and `valid | invalid | unsupported` status.
- Supported first tranche: midpoint, perpendicular foot, parallel line,
  perpendicular line, perpendicular bisector, angle bisector, circumcircle,
  and tangent at point.
- Non-finite inputs, missing references, zero directions, opposite angle arms,
  coincident circumcircle points, collinear circumcircle points, invalid radii,
  and off-circle tangent points fail closed.

## Preview integration

- `lib/tikz/authoring/preview-ir.ts` projects evaluated point, infinite-line,
  and circle records into the existing immutable `PreviewGeometry` union.
- Unsupported complex plans retain the generic ghost fallback and never invent
  geometry.
- `lib/tikz/render/tools.ts` seeds the draft evaluator from the entire current
  Scene point snapshot, then overlays current gesture anchors.
- Tangent preview aliases the pointer-projected circle anchor to the plan's
  derived `touch` identity. It does not substitute the circle's construction
  witness, so preview and click refer to the same tangent point.

## Research alignment

- SolveSpace validates construction entity combinations before solving.
- JSXGraph represents derived geometry through parent-dependent projection and
  bisector computations.
- tldraw transaction semantics support immutable draft evaluation followed by
  one atomic commit or rollback.
- Full references are recorded in
  `docs/superpowers/research/2026-08-01-tikz-constraint-solver-architecture.md`.

## Verification boundary

- Static source inspection and `git diff --check` were performed.
- Per product-owner instruction, no tests, build, lint, typecheck, browser,
  TeX, or Docker commands were run.
- Independent code reviews are recorded separately before this phase can be
  approved.
