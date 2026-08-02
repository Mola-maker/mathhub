# Architecture breakpoint audit - 2026-08-01

## Verdict

GAPS FOUND. The current code establishes a static typed IO loop for the managed
ConstructionPlan vocabulary, but it does not yet prove exhaustive official syntax
inventory, source-fidelity exact execution, or universal AI/Code/Canvas
reversibility.

The corrected architecture baseline is:

- `docs/superpowers/specs/2026-08-01-tikz-semantic-kernel-v5-architecture.md`

## Highest-priority contradictions

1. Exact source identity: `lib/tikz/exact/compile-tikz.ts` trims and sanitizes
   source before submission, and `services/tikz-compiler/compiler-core.mjs` trims
   again and rejects broad legal macro/library syntax. This violates the promise
   that exact compilation executes the submitted source bytes.
2. Registry completeness: the checked-in upstream registry is a representative
   seed. A `.code.tex` scan is larger, but still does not cover manual-only,
   driver, system, and Lua graph-drawing surfaces.
3. Managed schema v3: compatibility constants exist, but writer-slot ABI,
   plan-core records, Presentation IR, reader, merge, and source markers are not
   complete.
4. Macro provenance: capability classification exists, but there is no document
   chain from definition and invocation ranges to expansion products.
5. Active kernel: plugin IO types exist, but the active Studio still relies on
   legacy Analysis/Scene in important paths.
6. Solver: the current derived drag path reparses legacy Scene and does not solve
   a Geometry IR connected component with rank, DoF, conflicts, and branch tokens.

## Required breaking points

1. One five-lane capability vocabulary: preservation, inventory, semantics,
   interaction, exact execution.
2. Exhaustive upstream inventory manifest with per-file accounting and explicit
   scope gaps.
3. Lossless CST, stable identity reconciliation, multi-range source maps, and
   macro expansion provenance.
4. Schema-v3 stable writer slots and opaque-safe Presentation IR merge.
5. Active plugin coordinator and GeometryDoc as primary semantic projection.
6. Typed dependency graph shared by invalidation, delete, AI focus, and solver.
7. Geometry IR component solver with deterministic failure states.
8. Exact compiler submitted/executed source identity plus policy/profile matrix.
9. Exact artifact attached to RenderingTruth and SourceMap with a full basis.
10. Per-capability AI/Code/Canvas mutation parity through one Broker.

## Explicitly rejected claims

- Arbitrary TeX control flow is not statically invertible.
- All legal TeX cannot be executed under one strict no-file/no-network profile.
- Static inventory does not equal semantic understanding.
- Exact output means attested pinned-profile output, not a universal TikZ visual
  truth across engines, drivers, fonts, and bundles.
- Nonlinear constraints may be degenerate, inconsistent, underconstrained, or
  non-convergent.

## Dependency order

1. Freeze support vocabulary and exact product promises.
2. In parallel, fix exact source identity and finish deterministic registry
   sharding/completeness provenance.
3. Finish writer artifacts and lossless syntax/source-map foundations.
4. Implement schema-v3 plan-core/Presentation IR reader-writer-merge.
5. Activate Geometry Kernel and typed dependency graph.
6. Move solver and all authoring surfaces to the shared typed mutation lane.
7. Attach exact artifacts to RenderingTruth/SourceMap.
8. Product owner executes tests, browser QA, performance, isolation, ECS, and
   rollback gates.

## Verification boundary

This audit is static. No project tests, build, typecheck, TeX compilation, Docker,
or browser validation were run.

