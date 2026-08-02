# Construction evaluation kernel code review — re-review

## Decision

- **Verdict:** PASS
- **codeQualityStatus:** WATCH
- **recommendation:** APPROVE
- **Reviewed scope:** current `lib/tikz/authoring/construction-eval.ts` against `construction-ir.ts`, `construction-catalog.ts`, the writer formulas, the preview adapter/consumer, and the updated `tools.test.ts` fixtures.
- **Evidence boundary:** the authoring files remain untracked, so Git has no target-file patch to compare against a committed baseline. I inspected their complete current contents and the relevant catalog/writer/consumer sections. Per the owner instruction and `AGENTS.md`, I did not run tests, build, lint, typecheck, browser, TeX, or Docker commands. Absence of owner-run test output is recorded as a verification boundary, not a code-architecture blocker.

## Skill-perspective check

The named `remove-ai-slops` and `programming` skills are not present in the available skill catalog or the local skill locations checked. I applied the criteria supplied in the reviewer instructions directly.

- **remove-ai-slops:** no blocking violation in the repair. The change uses the existing typed entity graph and direct numerical formulas; it does not add parsing, normalization, deletion-only tests, tautological tests, or constant-mirroring test logic.
- **programming:** no blocking violation in the repair. The invalid field access is removed without casts or untyped escape hatches, and unresolved tangent data now fails closed.

## Findings

### CRITICAL

None.

### HIGH

None. All previously reported HIGH findings are resolved by inspection.

### MEDIUM

None remaining.

### LOW

#### L1. Result aliases and per-kind visible ordering remain duplicate API surface

`ConstructionEvaluationResult` still exposes identical `points`/`evaluatedPoints` and `entities`/`evaluatedEntities` aliases (`construction-eval.ts:72-83`, `620-627`). `visibleNames` also retains a per-kind output-order switch (`construction-eval.ts:564-585`). This is non-blocking because the switch now resolves parallel/perpendicular line identities through the typed entity graph, but future plan kinds must keep this projection synchronized.

#### L2. Circumcircle still collapses rare arithmetic overflow into collinearity

`circumcenter` returns `null` for both a guarded determinant and a non-finite derived center/radius (`construction-eval.ts:432-454`), while the caller reports all `null` values as `collinear-points` (`construction-eval.ts:470-473`). Ordinary finite geometry and the requested translation-invariant case are handled correctly; only extreme finite inputs that overflow intermediate arithmetic could receive a misleading diagnostic.

## Resolved HIGH findings

### Parallel/perpendicular line identity and TypeScript API

`lineEntityName` now discovers the constructed line by the exact typed `from`/`to` pair (`construction-eval.ts:245-256`). Parallel and perpendicular evaluators register that entity at `construction-eval.ts:347-385`, and `visibleNames` uses the same lookup at `construction-eval.ts:569-573`.

This matches the catalog exactly:

- parallel line entity: `from: through`, `to: q` (`construction-catalog.ts:1281-1288`);
- perpendicular line entity: `from: through`, `to: q` (`construction-catalog.ts:1360-1367`).

The evaluator no longer accesses the absent `plan.line` property on `ParallelLineConstructionPlan` or `PerpendicularLineConstructionPlan`. Result geometry order is direction point followed by constructed line, and ids come from the matching catalog entities.

### Translation-invariant degeneracy and circumcenter

`isZeroDirection` now uses only `dx`/`dy` (`construction-eval.ts:162-168`), so translating the same geometry no longer changes zero-direction classification.

`circumcenter` now:

1. translates B and C into vectors relative to A;
2. scales the determinant guard from local edge lengths;
3. computes the local circumcenter and translates it back.

The implementation at `construction-eval.ts:432-454` is algebraically correct:

- `D = 2 * cross(AB, AC)`;
- local `x = (|AB|² AC.y - |AC|² AB.y) / D`;
- local `y = (AB.x |AC|² - AC.x |AB|²) / D`.

This removes the previous origin-dependent rejection and large-offset cancellation path for ordinary coordinates.

### Tangent touch seed and radius semantics

The preview adapter still binds the pointer-projected circumference position to the fresh `plan.touch` identity (`tools.ts:590-615`); the evaluator correctly reads that touch and never substitutes the circle's through witness (`construction-eval.ts:479-491`). This preserves the clicked tangent branch.

Radius resolution at `construction-eval.ts:499-517` now accepts only:

- a numeric `circle.radius`;
- a numeric `circle.evaluatedRadius` for a symbolic radius;
- or a finite through-point distance when that witness is the available definition.

If no finite positive radius can be resolved, it emits `invalid-radius` and returns before registering touch, direction, or line geometry. Missing/non-finite through witnesses likewise cannot leak visible tangent geometry. A resolved radius mismatch produces `point-not-on-circle` and also returns before registration.

### Map iterator API

The immutable map now declares `MapIterator` for `entries`, `keys`, `values`, and `[Symbol.iterator]` (`construction-eval.ts:113-126`), matching the repository's TypeScript 5.9 / `esnext` `ReadonlyMap` surface by inspection.

## Eight-kind contract audit

| Plan kind | Formula and degeneracy result | Entity id/order result |
|---|---|---|
| midpoint | PASS — 0.5 interpolation; coincident endpoints fail closed. | PASS — result point. |
| perpendicular-foot | PASS — standard orthogonal projection; zero reference direction fails closed. | PASS — result point. |
| parallel-line | PASS — `through + (referenceEnd-referenceStart)`. | PASS — catalog direction-point id, then matched constructed-line id. |
| perpendicular-line | PASS — counter-clockwise 90-degree reference-vector rotation. | PASS — catalog direction-point id, then matched constructed-line id. |
| perpendicular-bisector | PASS — midpoint plus rotated segment direction. | PASS — midpoint, direction point, line. |
| angle-bisector | PASS — normalized arm sum selects the writer's interior branch; zero arms and exactly opposite arms return no geometry with `zero-direction`. | PASS — direction point, line. |
| circumcircle | PASS — local-coordinate circumcenter; coincident and collinear inputs fail closed. | PASS — center, circle. |
| tangent-at-point | PASS — pointer-seeded touch, resolved radius check, perpendicular radial direction; unresolved/mismatched cases return no geometry. | PASS — touch, direction point, line. |

## Other contracts

- **Missing/non-finite references:** directly referenced missing or non-finite points stop the relevant operation and add typed diagnostics.
- **Immutability:** source points are copied; output points/geometries/entities/diagnostics/arrays are frozen; the public map API exposes no mutator; plan and source inputs are not mutated by inspection.
- **Unsupported behavior:** unsupported plan kinds return `status: unsupported`, one `unsupported-plan-kind` diagnostic, an immutable finite source snapshot, and no evaluated entities/geometries (`construction-eval.ts:526-562`, `678-683`).
- **Updated fixture inspection:** `tools.test.ts` now supplies `sourceRevision`, stable point ids, interaction sessions, revision, viewport setter, and the current patch API. These are compatibility-fixture updates, not evaluator behavior tests. No obvious implementation-mirroring or tautological assertion was introduced.

## Verification boundary

No owner-run test/typecheck artifact was supplied, and none was run during this review. Static inspection finds no remaining architecture or obvious TypeScript/API blocker. Owner execution should still confirm compilation plus the eight-kind behavioral matrix, immutability attempts, translated-coordinate cases, opposite-angle arms, symbolic tangent radius with/without `evaluatedRadius`, missing through witnesses, and unsupported kinds.

## Blockers

None.

