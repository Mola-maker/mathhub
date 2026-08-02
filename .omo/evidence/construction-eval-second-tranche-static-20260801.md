# Construction evaluator second tranche - static evidence

Date: 2026-08-01

Scope: source-neutral evaluation and AI/Code/Canvas contract closure for
reflection, rotation, homothety, inversion, radical axis, cyclic quadrilateral,
and complete quadrilateral.

## Implemented boundaries

- `construction-eval.ts` evaluates every derived catalog kind through immutable
  point/entity/geometry results and typed fail-closed diagnostics.
- `preview-ir.ts` maps the evaluator's point, segment, line, circle, and polygon
  outputs without parsing or generating TikZ.
- `construction-ir.ts` keeps writer-visible identities explicit and validates
  entity kind plus endpoint/vertex bindings.
- `construction-catalog.ts` declares every rendered helper as an entity/output;
  generated aliases use the revision-bound allocator.
- `tikz-adapter.ts` fallback roles now match the managed record vocabulary.
- Radical-axis numeric radii are converted through calc coordinate offsets and
  `veclen`, avoiding scene-unit/TeX-point mixing.
- Cyclic secant and complete-quadrilateral supporting lines/diagonal are visible
  in both exact source and Preview IR.
- Degeneracy checks are translation-invariant and reject tangent/no-second-root,
  concentric circles, parallel lines, repeated vertices, coincident opposite
  intersections, and duplicate supporting lines.

## Typed managed write foundation

- `managedConstructionPlanRecompilePatches` accepts a validated plan and emits
  only a same-ID/same-kind whole-block replacement guarded by range and content
  fingerprint.
- Schema-v2 replacement additionally requires the current block to equal the
  canonical compilation of `previousPlan`; styled/diverged blocks fail closed.
- `construction-plan-proposal/v1` separates semantic write capabilities from
  raw `writable`, lowers trusted plan creation/replacement to one source patch,
  and is revalidated on both server and client before Broker/CodeMirror commit.

## Review and execution boundary

- Independent advanced writer review: PASS/WATCH, no blockers.
- Independent transform/inversion review: PASS/WATCH, no blockers.
- `git diff --check`: no whitespace errors; repository-wide CRLF warnings only.
- Per owner instruction, no tests, build, lint, typecheck, TeX, browser, or
  Docker commands were run.

