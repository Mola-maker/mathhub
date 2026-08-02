# Adapter constraint-parameter refactor - code review

## Review scope

- Goal: review only `ManagedConstraintRecord`, `constraintParametersOf`, and the helper call site in `lib/tikz/ir/tikz-adapter.ts`.
- Success criteria: preserve the managed-constraint projection shape exactly; emit `parameters` only for `rotation`, `homothety`, `line-intersection`, and `line-circle-other-intersection`; cover every current managed constraint kind exhaustively; keep `assertNever` type-safe.
- Evidence inspected: current source at `tikz-adapter.ts:417-470` and `tikz-adapter.ts:1171-1181`, the source discriminated union at `construction-ir.ts:118-272`, `ManagedConstructionSemanticRecord` at `managed-construction.ts:18-28`, and `.omo/evidence/adapter-constraint-parameters-code-evidence.md`.
- The repository has no tracked baseline for `lib/tikz/ir/tikz-adapter.ts` (the directory is currently untracked), so behavioral parity was checked against the stated contract and the complete source union, not a Git before/after hunk.
- Per the product-owner boundary and review task, no test, build, lint, typecheck, browser, TeX, or Docker command was run.

## Verification

`ManagedConstraintRecord` uses `Extract<ManagedConstructionSemanticRecord, { recordType: 'constraint' }>` (`tikz-adapter.ts:422-425`). Because `ManagedConstructionSemanticRecord` is a union containing `ConstructionConstraint` as its constraint-record member, this retains the complete `ConstructionConstraint` discriminated union without an untyped cast.

The helper projects the four required parameter shapes exactly (`tikz-adapter.ts:436-450`):

- `rotation` -> `{ angleDegrees: record.angleDegrees }`
- `homothety` -> `{ scale: record.scale }`
- `line-intersection` -> `{ domain: record.domain }`
- `line-circle-other-intersection` -> `{ domain: record.domain, selector: record.selector }`

Every other current discriminant in `ConstructionConstraint` is listed explicitly and returns `undefined` (`tikz-adapter.ts:451-466`). This covers `point-reflection`, `line-reflection`, `midpoint`, `perpendicular-foot`, `on-circle`, `circle-through-three-points`, `tangent-at-point`, `perpendicular-bisector`, `angle-bisector`, `parallel`, `perpendicular`, `inversion`, `radical-axis`, `cyclic`, and `complete-quadrilateral`.

The default branch passes the entire narrowed record to `assertNever(record)` (`tikz-adapter.ts:427-429,467-468`). No `as never`, broad string discriminant, or other escape hatch weakens this check. A future `ConstructionConstraint.kind` addition must therefore be handled before the argument can remain assignable to `never`.

The call site computes the helper once and conditionally spreads only a returned object (`tikz-adapter.ts:1171-1181`). Parameter objects remain truthy even when scalar values are `0`, so zero-angle rotation and zero-scale homothety retain their fields. The `undefined` cases omit `parameters` entirely rather than emitting `parameters: undefined` or `{}`.

## Skill-perspective check

The requested `remove-ai-slops` and `programming` skills were not available in this session's skill catalog, so no skill file could be loaded. Their documented review criteria were applied manually. The diff adds no tests, implementation-mirroring fixtures, deletion-only assertions, parsing/normalization, untyped escape hatch, brittle prompt check, or unrelated abstraction. The small typed helper replaces a complex conditional at a legitimate adapter boundary and does not violate either perspective.

## Findings by severity

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None.

## Decision

- PASS
- `codeQualityStatus`: CLEAR
- `recommendation`: APPROVE
- `blockers`: none

The unavailable Git baseline and intentionally unrun automated checks are evidence limitations, not code findings for this narrowly scoped static refactor.
