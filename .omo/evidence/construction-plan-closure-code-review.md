# ConstructionPlan structural-closure code review

Date: 2026-08-01

Scope: read-only re-review of the current structural validation in
`lib/tikz/authoring/construction-ir.ts`, the H1/H2 compatibility fixes in
`lib/tikz/authoring/construction-catalog.ts`, and the updated evidence at
`.omo/evidence/construction-ir-structural-validation-code-evidence.md`.

No test, build, lint, typecheck, TeX, Docker, or browser command was run.

## Verdict

- `codeQualityStatus`: **CLEAR**
- `recommendation`: **APPROVE**
- blockers: none

## Skill-perspective check

The requested `remove-ai-slops` and `programming` skills were not available in
the exposed skill catalog, so they could not be loaded. Their documented
criteria were applied manually. No tests were added in this scope, so there are
no tautological, deletion-only, constant-mirroring, or brittle prompt tests to
flag. The explicit discriminated switches remain justified boundary code; the
fix adds no `any` escape hatch, generic string walker, needless parser, or
unrelated normalization. The current diff does not violate either skill
perspective.

## Findings

### CRITICAL

None.

### HIGH

None. Both prior HIGH findings are resolved.

### MEDIUM

None.

### LOW

#### L1 - the first section of the evidence retains stale line ranges

The follow-up section identifies the new helpers correctly, but the earlier
summary still cites pre-fix ranges such as `validateEntity` at 587-664 and
`validateReferenceClosure` at 837-897. In the current source those helpers are
at 594-671 and 847-904. This is documentation drift only; the claims were
independently verified against the current source.

Suggested action: refresh those ranges on the next evidence edit.

## Prior blocker resolution

### H1 resolved - persistent provenance is input-only

- `hasPersistentReferencePrefix` reserves the entire literal `managed:` prefix
  before the TikZ name regex is evaluated (`construction-ir.ts:538-553`). A
  valid or malformed `managed:` value cannot become a local plan id, entity id,
  or entity name through `validName`.
- `validateReferenceClosure` now keeps `inputReferences` separate from the
  combined local `allowed` aliases (`construction-ir.ts:847-864`). Its `check`
  branch requires every valid persistent reference to exist specifically in
  `inputReferences`; a local entity alias cannot satisfy it
  (`construction-ir.ts:866-875`).
- Selection, entity fields, constraint fields, relation endpoints, outputs,
  and plan-level fields all cross that same check (`construction-ir.ts:877-903`).
- The ordinary circle center/through compatibility exception remains narrow:
  valid persistent witnesses are explicitly emitted as plan reference entries
  (`construction-ir.ts:832-839`) and must therefore prove input provenance.
  Ordinary TikZ center/through names remain mirrored source witnesses owned by
  the already-declared circle input.
- Entity validation uses `validName` for both id and name
  (`construction-ir.ts:594-603`), so local aliases reject the persistent prefix
  at the record boundary as well as at closure construction.

This now implements the architecture rule that an undeclared `managed:*`
reference cannot become an implicit cross-block dependency.

### H2 resolved - the three catalog plans close

- Tangent-at-point declares both the durable circle identity and its center
  witness as inputs (`construction-catalog.ts:998-1004`). Its constraint and
  dependency relation references to `circle.centerName` therefore close
  (`construction-catalog.ts:1018-1031`).
- Parallel-line declares `line-${a}-${b}` as a typed line entity whose endpoints
  are the two reference-point inputs (`construction-catalog.ts:1273-1292`). The
  parallel constraint targets that declared alias, and dependency relations
  connect the reference line to both endpoints
  (`construction-catalog.ts:1293-1310`).
- Perpendicular-line applies the same typed reference-line model and endpoint
  dependencies (`construction-catalog.ts:1352-1389`).
- Neither reference line is exposed as an output, which is consistent with its
  role as an internal semantic dependency rather than a newly requested
  construction result.

## Structural validation completeness

- Entity validation explicitly covers point, segment/vector/line/ray,
  polyline/polygon, rectangle, circle, label, angle, and right-angle records,
  including discriminator, record type, id/name, cardinality, endpoint, point
  literal, and circle XOR checks (`construction-ir.ts:594-671`).
- Entity reference extraction covers every reference-bearing current entity
  variant (`construction-ir.ts:673-705`).
- Constraint reference extraction covers every current constraint variant,
  including transforms, circle constraints, line intersection, line/circle
  other-intersection, cyclic, and complete quadrilateral
  (`construction-ir.ts:707-755`).
- Relation records validate record type, id, supported kind, distinct valid
  endpoints, and optional boolean direction. Entity ids/names, relation ids,
  output ids/refs, and constraint ids are checked for the intended per-record
  identity rules (`construction-ir.ts:906-1149`).
- Closure is computed from inputs plus entity ids/names and applied to entity,
  constraint, relation, output, selection, and top-level writer references
  (`construction-ir.ts:847-904`).
- `compileConstructionPlan` calls `assertConstructionPlan` before writer body
  generation and before `directive` can call semantic record serialization
  (`construction-ir.ts:1917-1955`). Ordinary dangling references and persistent
  provenance failures therefore fail closed before serialization.

## Current catalog compatibility matrix (static/conceptual)

| Plan family | Closure result | Notes |
|---|---|---|
| All primitive plans | PASS | Inputs and entity aliases cover every primitive reference. |
| Rectangle by opposite corners | PASS | Derived corners, edges, polygon, and rectangle are declared entities. |
| Midpoint / perpendicular foot | PASS | Input points plus the derived point entity close all fields. |
| Point on circle | PASS | Durable circle id is an input; ordinary center/through values are writer witnesses. |
| Parallel / perpendicular line | PASS | New line and typed reference line are both declared; endpoint dependencies close. |
| Perpendicular bisector / angle bisector / circumcircle | PASS | All derived point, line, and circle aliases are declared. |
| Tangent at point | PASS | Circle id and center witness are inputs; touch, direction, and line are entities. |
| Point/line reflection, rotation, homothety, inversion | PASS | Inputs and derived entities cover all constraint and plan refs. |
| Radical axis | PASS | Both persistent circle identities are explicit inputs; other refs are local entities. |
| Cyclic quadrilateral | PASS | Center, circle, secant, fourth point, and polygon are declared entities. |
| Complete quadrilateral | PASS | Four lines, two intersections, and diagonal are declared entities. |

## Final recommendation

**APPROVE.** The current implementation now enforces input-only provenance for
persistent references, preserves the intended ordinary circle-witness
compatibility exception, closes all current catalog plan shapes, and keeps the
compiler fail-closed before serialization. Automated and browser execution
remain explicitly outside this review and product-owner owned.
