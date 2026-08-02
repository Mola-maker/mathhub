# Official PGF registry AI-context integration evidence

Date: 2026-08-02 (implementation snapshot for the 2026-08-01 architecture tranche)

## Scope

Updated only `lib/tikz/syntax/ai-context.ts`. The existing compact catalog
fields remain unchanged and now receive an additional bounded `upstream`
section sourced from the pinned PGF registry exported by
`lib/tikz/syntax/generated/pgf-3.1.11a-registry.ts`.

## Contract implemented

- `TikzAiCapabilityContext` extends the existing `TikzAiCompactSchema` without
  removing or renaming legacy fields.
- `buildTikzUpstreamCapabilityContextForAi` returns
  `pgf-upstream-capability-v1` with `exhaustive: false`, repository/version/SHA
  provenance, static scanner/network boundary, and an explicit capability
  statement.
- Source entries are selected through `queryPgfUpstreamRegistry` using
  geometry-intent aliases and bounded to 8–24 entries.
- A core boundary and dynamic/unsupported boundary are selected before intent
  results. Dynamic counts and truncation are reported rather than implying
  complete macro coverage.
- Each compact upstream entry retains source path/SHA, grammar, effects,
  parse/preview/exact lanes, writeback policy, security level/tags, and bounded
  diagnostic messages.
- Existing `stringifyTikzCapabilityContextForAi` continues to return JSON and
  now serializes the compatible legacy schema plus the upstream section.

## Static verification

Invocation:

```powershell
git diff --check -- lib/tikz/syntax/ai-context.ts
$text = Get-Content -Raw lib/tikz/syntax/ai-context.ts
[pscustomobject]@{
  HasUpstreamSchema = $text.Contains('pgf-upstream-capability-v1')
  HasNonExhaustive = $text.Contains('exhaustive: false')
  HasProvenance = $text.Contains('provenance')
  HasWriteback = $text.Contains('writeback')
  HasSecurity = $text.Contains('security')
  HasBoundary = $text.Contains('dynamicBoundaryTruncated')
  HasIntentQuery = $text.Contains('queryPgfUpstreamRegistry')
}
```

Observed result: `git diff --check` emitted no whitespace errors; all seven
contract markers were present in the non-empty source file.

Not run by design: tests, build, lint, typecheck, generator execution, TeX,
Docker, or browser automation.

