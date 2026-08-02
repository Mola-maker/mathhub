# Construction IR migration evidence

Date: 2026-07-29

Scope: `lib/tikz/authoring/construction-ir.ts` and
`lib/tikz/authoring/construction-catalog.ts` only.

## Static scenarios

1. `Select-String -Path lib\\tikz\\authoring\\construction-catalog.ts -Pattern 'build\\('`
   - Observable: the nine migrated tools expose only `build(context)` wrappers
     that call `buildFromPlan`; no legacy `lines: directive(...)` writer remains
     in the catalog.
2. `Select-String -Path lib\\tikz\\authoring\\construction-ir.ts -Pattern "case '(perpendicular-bisector|angle-bisector|circumcircle|tangent-at-point|reflect-point|reflect-line|rotate-90|homothety-2|radical-axis)'"`
   - Observable: each migrated kind has an explicit writer branch and explicit
     input/output branch; all coordinate expressions call the shared calc
     serializer.
3. `git diff --no-index --check -- NUL <file>` for both changed files
   - Observable: Git reported only the expected untracked-file exit code and
     CRLF normalization warnings; no whitespace-error diagnostics were emitted.

The user explicitly owns test/build/lint/typecheck execution for this pass, so
none of those commands (and no Docker command) were run.

## Design evidence

- `ConstructionPlan` is a discriminated union with typed operation payloads.
- `ConstructionEntity`, `ConstructionConstraint`, `ConstructionRelation`, and
  `ConstructionOutput` carry language-neutral semantic records.
- `validateConstructionPlan` and `assertConstructionPlan` reject malformed
  names, duplicate slots, degenerate references, and unsafe writer hints.
- `compileConstructionPlan` is pure, preserves `status`/`selection`, emits one
  managed `@mathgeo` block, and requires an explicit `allowUnsafeOpaque` opt-in
  before an `opaque`/`unsafe: true` hint can emit source lines.
