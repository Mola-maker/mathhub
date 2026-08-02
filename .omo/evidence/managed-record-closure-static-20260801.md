# Managed construction record closure — static evidence

Date: 2026-08-01

Scope: `lib/tikz/semantics/managed-construction.ts` only.

## Observable implementation evidence

- Schema-v2 identifier/reference validation is isolated in
  `schemaV2SemanticRecordIssue` (lines 367-548). It uses the same TikZ-safe
  name and persistent managed-reference patterns as Construction IR, reserves
  the managed: provenance prefix for references, and is gated on schema
  version 2, so schema-v1 decoding keeps its prior vocabulary.
- `semanticReferencesOf` and `semanticClosureIssues` (lines 555-864) enumerate
  entity dependencies, constraint references, relation endpoints, and output
  refs. The allowed set is exactly input record refs plus entity record names
  and ids. A managed cross-block ref is therefore accepted only when it is an
  explicit input ref.
- The same closure pass checks the new constraint kind contracts: line
  intersection line refs resolve to internal line entities; line-circle
  intersection line/circle refs resolve to line/circle entities; point and
  excluded-point refs resolve to internal point entities.
- Entity aliases are ownership-sensitive: an id/name collision across entity
  records emits `duplicate-entity-alias` before kind checks; kinds are not
  merged. The reserved `managed:` provenance prefix is rejected for entity
  ids/names, and any managed-prefixed reference must be an explicit input.
- A narrowly scoped tangent compatibility witness preserves pre-center-input
  tangent blocks only for the historical tuple: the circle is an explicit
  persistent managed input, the tangent line is uniquely declared, its `to`
  entity is the direction point, and only a `directed=true`,
  `kind=depends-on`, `from=directionPoint`, `to=exactCenter` relation is
  accepted. The center itself must remain a non-persistent TikZ name.
- `recordsOf` (lines 858-1143) preserves record source ranges, runs the v2
  closure after the continuous record prefix is decoded, and atomically returns
  `metadataStatus: invalid` with precise issue codes for invalid spelling,
  dangling refs, duplicate aliases, or incompatible internal kinds. It returns no partially
  decoded records on failure and never rewrites source bytes.

## Invocation / binary observables

The product owner owns automated and browser test execution for this turn; no
test, build, lint, typecheck, TeX, or Docker command was run. The binary source
observables above are the implementation artifact to be covered by the owner's
schema-v1 compatibility, malformed schema-v2, closure, and kind-compatibility
scenarios.
