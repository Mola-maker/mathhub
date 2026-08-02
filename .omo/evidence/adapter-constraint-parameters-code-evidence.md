# Adapter constraint-parameter extraction evidence

## Scope

- Owned file: `lib/tikz/ir/tikz-adapter.ts`.
- Change: replaced the nested conditional spread that built managed
  `GeometryConstraint.parameters` with the typed `constraintParametersOf`
  helper.
- No tests, build, lint, typecheck, browser, TeX, or Docker commands were run,
  per the product-owner validation boundary.

## Static scenario and observable

Invocation:

```powershell
rg -n "constraintParametersOf|Unexpected managed|const parameters|parameters }" `
  lib/tikz/ir/tikz-adapter.ts
```

Expected observable and observed source state:

- `ManagedConstraintRecord` narrows `ManagedConstructionSemanticRecord` to
  constraint records (lines 422-425).
- `constraintParametersOf` explicitly returns parameters only for
  `rotation`, `homothety`, `line-intersection`, and
  `line-circle-other-intersection` (lines 436-450).
- Every other current managed constraint kind returns `undefined`, with an
  `assertNever` safeguard for future discriminant additions (lines 451-469).
- The adapter computes the helper once and conditionally spreads the returned
  object, preserving the previous runtime shape: only the four kinds receive a
  `parameters` field; all others omit it (lines 1171-1180).

Artifact: this evidence file and the source lines above.
