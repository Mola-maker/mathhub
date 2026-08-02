# PGF scanner diagnostic compatibility evidence

Date: 2026-08-02 (implementation snapshot for the 2026-08-01 architecture tranche)

## Change

`lib/tikz/syntax/upstream-registry.ts` now accepts the generator's typed
`scanner-entry-deduplication` diagnostic in both `PgfDiagnosticCode` and the
runtime validator enum. The code is documented as scanner bookkeeping only;
it does not mark the registry exhaustive, alter entry status, or weaken source
preservation/security boundaries.

## Static verification

Invocation:

```powershell
rg -n "scanner-entry-deduplication|exhaustive|non-exhaustive|diagnostic" lib/tikz/syntax/upstream-registry.ts
git diff --check -- lib/tikz/syntax/upstream-registry.ts
```

Observed result: the diagnostic appears in the typed union and validator
allowlist; the non-exhaustive clarification remains in the diagnostic comment;
`git diff --check` emitted no whitespace errors.

Not run by design: tests, build, lint, typecheck, TeX, Docker, browser, or the
registry generator.

