# Geometry IR incremental invalidation evidence

Artifact path: `.omo/evidence/invalidation-layer-implementation.md`

Validation boundary: source inspection only. No tests, build, lint, typecheck,
Docker command, or runtime execution was performed.

## Scenario matrix

| Criterion | Invocation | Binary observable |
| --- | --- | --- |
| Accept previous/current IR + SourceMap and before/after UTF-16 ranges | `rg -n "GeometryUtf16SourceChange|GeometryInvalidationInput|computeGeometryInvalidation" lib/tikz/ir/invalidation.ts` | Exit 0; declarations at lines 22, 34, and 446 |
| Return changed binding/entity/constraint/relation/render IDs | `rg -n "changedBindingIds|changedEntityIds|changedConstraintIds|changedRelationIds|changedRenderIds" lib/tikz/ir/invalidation.ts` | Exit 0; all five result fields and return assignments present |
| Return dependency ancestor, descendant, and combined closure | `rg -n "dependencyAncestorIds|dependencyDescendantIds|dependencyClosureIds|dependencyPairs|buildDependencyGraph|traverse" lib/tikz/ir/invalidation.ts` | Exit 0; three closure fields plus graph normalization/traversal present |
| Detect opaque barriers and conservative full-reproject fallbacks | `rg -n "opaqueBarrier|fullReprojectReason|basis-mismatch|plugin-set-changed|revision-regressed|invalid-source-range|unmapped-source-change|opaque-barrier|dependency-closure-limit" lib/tikz/ir/invalidation.ts` | Exit 0; barrier/result fields and seven reason codes present |
| Whitespace/error check for the new untracked file | `git diff --no-index --check -- NUL lib/tikz/ir/invalidation.ts` | Expected diff exit 1 was normalized to success; no whitespace error output. Git only reported the repository's LF-to-CRLF checkout warning |

## Captured artifact

```text
path=E:\Portaitsweb\math_geohub\lib\tikz\ir\invalidation.ts
bytes=24432
lines=749
sha256=22cd1cf799fe21ed106210d953e88e36210b0b875959f512f1135b311a106174
git-status=?? lib/tikz/ir/invalidation.ts
```
