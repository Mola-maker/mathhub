# TikZ Canvas constraint-solver architecture research

Date: 2026-08-01

Scope: research and architecture alignment only. This document does not claim a
numeric solver implementation or product verification.

## Sources reviewed

- [SolveSpace solver technology](https://solvespace.github.io/solvespace-web/tech.html)
  describes its equation/Jacobian/Newton approach, treatment of underconstrained
  systems, and the use of dragged coordinates to choose a nearby solution.
- [SolveSpace library boundary](https://solvespace.github.io/solvespace-web/library.html)
  exposes the solver separately from the CAD UI, supporting a worker/service
  boundary rather than renderer-owned solving.
- [JSXGraph Board API](https://jsxgraph.org/beta/docs/symbols/JXG.Board.html)
  documents `prepareUpdate`, `needsUpdate`, `inUpdate`, and explicit board update
  lifecycle controls.
- [JSXGraph radical-axis source](https://jsxgraph.org/docs/symbols/src/src_base_line.js.html)
  derives the axis from two circle equations and registers both circles as
  reactive parents.
- [JSXGraph Intersection](https://jsxgraph.org/docs/symbols/Intersection.html)
  models an intersection as a parent-owned dynamic point, exposes the solution
  branch/index, and distinguishes finite-element intersection from infinite-line
  intersection through `alwaysIntersect`.
- [JSXGraph OtherIntersection](https://jsxgraph.org/docs/symbols/OtherIntersection.html)
  selects the intersection that differs from a supplied point or point set. It
  exists specifically to keep the intended branch when candidate order changes
  during interaction.
- [GeoGebra Intersect command](https://geogebra.github.io/docs/manual/en/commands/Intersect/)
  separates all-solutions, indexed-solution, and initial-point numerical forms,
  supporting an explicit selector/method contract rather than implicit array
  ordering.
- [PGF base-points intersections](https://github.tikz.dev/base-points)
  warns that non-intersecting line arithmetic can overflow and that path
  intersection ordering is algorithm-dependent. The kernel must therefore
  guard parallel/coincident inputs and define its own deterministic branch.
- [SolveSpace parallel and tangent constraints](https://solvespace.readthedocs.io/en/latest/constraints/parallel_tangent.html)
  treats incidence/coincidence as a precondition for tangent constraints,
  reinforcing typed precondition diagnostics instead of formula-only output.
- [tldraw bindings](https://tldraw.dev/sdk-features/bindings) documents
  directional `fromId`/`toId` records, an incremental binding index, isolation
  callbacks, and `onOperationComplete` transaction batching.
- Tavily searches across GitHub, tldraw, and JSXGraph additionally found
  SolveSpace language bindings and layout/pin binding examples. These were used
  as corroborating implementation references, not as authority over the primary
  project documentation above.

## Recommended kernel boundary

```text
TikZ CST / managed records (source truth)
              |
      Semantic constraint graph
              |
 directional adjacency + affected closure
              |
   numeric solver worker (derived truth)
              |
 residual/rank/convergence diagnostics
              |
     Rendering Truth / Canvas
```

- TikZ source and managed records remain immutable inputs during a solve.
- Entities own variables; typed constraints own residual equations; relations
  own directional dependency/index edges.
- A drag starts one transaction, changes only the pointer-controlled variable,
  solves the affected connected component using the previous solution as the
  initial state, then either commits one source/history operation or rolls back.
- Renderer and hit-test consume solved Geometry Truth; neither can mutate solver
  state or generate a second source writer.
- Deletion runs an isolation/bake or explicit cascade policy before removing
  graph edges, then emits diagnostics after the full operation completes.

## Required diagnostics and guards

- `DEGENERATE`: zero-length direction, coincident centers, parallel intersection
  denominator, rank-deficient construction, or an undefined entire locus.
- `INCONSISTENT`: required residuals cannot all be satisfied.
- `UNDERCONSTRAINED`: degrees of freedom remain after required constraints.
- `NON_CONVERGENT`: the numeric iteration cannot reach the configured residual
  threshold from the last-valid solution.

Parallel/perpendicular constraints should use cross/dot residuals rather than
angle subtraction. Intersections, inversion, and radical-axis formulas must
perform denominator/rank guards before evaluation. Failed solves retain the
last-valid Geometry Truth and must never serialize NaN or Infinity into TikZ,
managed metadata, AI context, or SVG.

## Intersection identity and branch selection

An intersection is not just a derived coordinate. It is a typed operation whose
identity includes its parents, geometric domain, and branch selector:

```text
LineLineIntersection
  parents: lineA, lineB
  domain: line | ray | segment
  selector: unique
  status: intersect | parallel | coincident | degenerate

LineCircleIntersection
  parents: line, circle
  domain: line | ray | segment
  selector: index | exclude-known-point | nearest-to-seed
  status: secant | tangent | no-intersection | degenerate
```

For a cyclic-quadrilateral construction, the fourth vertex uses
`exclude-known-point(A)` rather than `candidate[1]`. This survives candidate
reordering during drag. When the secant becomes tangent, the selected branch
disappears and the transaction reports a typed diagnostic while preserving the
last-valid result. Line-line evaluation must check its determinant before
division and distinguish parallel, coincident, and degenerate-line cases.

Dependency updates mark descendants dirty, evaluate parents first, then commit
both the coordinate and status atomically. AI context, Canvas, and TikZ writer
therefore observe the same intersection identity and never choose branches
independently.

## Preview transaction boundary

The current canvas must not keep a second raw-TikZ preview compiler alongside
the typed commit compiler. A preview is an ephemeral execution of the same pure
semantic command:

```text
Pointer input
  -> immutable command with deterministic commandId
  -> same plan / validation / Geometry IR projection as commit
  -> ephemeral draft store (history, source and network disabled)
  -> same primitive renderer
  -> discard on cancel OR promote the exact final draft in one Broker commit
```

Primary references:

- [tldraw shapes](https://tldraw.dev/sdk-features/shapes) uses immutable shape
  records and keeps geometry/rendering behavior in the shared ShapeUtil path.
- [tldraw editor](https://tldraw.dev/sdk-features/editor) routes changes through
  one Editor API, supports deterministic explicit IDs, and batches mutations in
  `Editor.run`.
- [tldraw history](https://tldraw.dev/sdk-features/history) documents marks,
  rollback through `bailToMark`, and history-ignored operations suitable for a
  transient drag draft.
- [Excalidraw v0.18.0 release API](https://github.com/excalidraw/excalidraw/releases/tag/v0.18.0)
  distinguishes updates captured immediately, eventually, or never. A preview
  corresponds to `NEVER`; pointer-up emits one undoable commit.

Draft IDs are derived from the interaction/command identity and reused across
pointer moves. Preview state cannot write TikZ, history, AI memory, persistence,
or network. This removes preview/commit semantic drift while retaining
source-as-truth for committed changes.

Implementation alignment on 2026-08-01: the raw creation-preview writer and
legacy Scene reparse were removed. Phase 1 now creates a deterministic draft
`ConstructionPlan`, projects primitive and opposite-corner rectangle geometry
into an immutable Preview IR, and renders it without touching source. Derived
constraint plans return an explicit unsupported diagnostic and generic ghost
until the solver can provide evaluated draft geometry; writer formulas must not
be duplicated into the preview layer.

## Source-neutral derived preview evaluator

Repository inspection found that the next missing boundary is not another SVG
preview component. `ConstructionPlan` already contains typed construction
intent, but its forward geometry is only expressed inside TikZ writer formulas.
The browser therefore needs one pure `construction-eval` kernel that accepts a
plan plus a revision-bound point snapshot and returns evaluated entities and
typed diagnostics. Preview IR consumes that result; source evaluation and the
reverse drag solver remain separate lanes.

The evaluator must follow the fail-closed contracts used by mature geometry
systems:

- SolveSpace validates the entity and workplane shape of midpoint,
  parallel/perpendicular, and tangent constraints before solving
  ([pinned source](https://github.com/solvespace/solvespace/blob/81f473ff18e2b1ffa7de389b7cf76daf1ac739c2/src/slvs/lib.cpp#L643-L715));
  its [constraint documentation](https://solvespace.readthedocs.io/en/latest/constraints/)
  also exposes failure-to-solve as an explicit state.
- JSXGraph models a perpendicular foot as a derived point with parent
  dependencies and an orthogonal projection
  ([pinned source](https://github.com/jsxgraph/jsxgraph/blob/4b97351634951e3e36277f35270dc37edb26bbae/src/element/composition.js#L316-L390)).
  Its three-point angle bisector keeps a helper point in the dependency graph
  ([pinned source](https://github.com/jsxgraph/jsxgraph/blob/4b97351634951e3e36277f35270dc37edb26bbae/src/element/composition.js#L1113-L1192)),
  while two-line bisectors use normalized standard-form coefficients and both
  deterministic signs
  ([pinned source](https://github.com/jsxgraph/jsxgraph/blob/4b97351634951e3e36277f35270dc37edb26bbae/src/element/composition.js#L1240-L1318)).
- tldraw's [transaction contract](https://tldraw.dev/reference/state/transaction)
  batches state changes, defers side effects, and reverts on abort. A preview
  uses the same model as an immutable transaction over `baseRevision`, then
  pointer-up performs compare-and-swap before the single source commit.

The first evaluator tranche is midpoint, perpendicular foot, parallel and
perpendicular lines, perpendicular/angle bisectors, circumcircle, and tangent.
Every operation rejects non-finite values and zero-length directions. Line-line
intersection guards the determinant; circumcircle guards its collinearity
determinant; line-circle guards the discriminant; branch-producing operations
carry an explicit selector and deterministic ordering. Only after this tranche
is stable should intersections, transforms, inversion, radical axis, and
multi-constraint competition constructions enter the same evaluator.

Implementation alignment on 2026-08-01: the first tranche now runs through a
pure `construction-eval` kernel. Draft evaluation starts from the complete
revision-bound Scene point snapshot, overlays current gesture anchors, and maps
evaluated point/line/circle records into Preview IR. Tangent gestures bind the
pointer-projected position to the derived `touch` identity. Direction and
circumcircle degeneracy guards are translation-invariant, and unresolved
symbolic circle radii fail closed. Primitive/rectangle previews retain their
existing direct projection; later construction kinds retain the unsupported
diagnostic and generic ghost until their evaluator tranche is implemented.

## Second evaluator tranche research

Tavily and Exa were queried again before extending the kernel. The broad
Tavily research transport failed, but the Tavily search retry and Exa search
both returned usable maintained-source evidence:

- JSXGraph's documented reflection routine projects through a non-zero line
  direction and mirrors the point by twice the perpendicular offset
  ([source view](http://jsxgraph.org/docs/symbols/src/src_math_geometry.js.html)).
- tldraw's v5 intersection primitives make coincidence/parallelism explicit
  before division and expose a precision parameter
  ([pinned tag source](https://github.com/tldraw/tldraw/blob/v5.0.0/packages/editor/src/lib/primitives/intersect.ts)).
- `algeobra` represents computed primitives as dependency-backed definitions,
  so changes to direct or indirect parents trigger recomputation
  ([repository](https://github.com/sibaku/algeobra)).
- Euclid.ts uses immutable geometry objects specifically to support downstream
  change detection
  ([repository](https://github.com/mathigon/euclid.js/)).
- flatten-js notes that intersection arrays do not have a predefined order
  ([repository](https://github.com/homfen/flatten-js)); therefore Semantic IR
  cannot use array index alone as a persistent intersection identity.

For Math GeoHub, point/line reflection, rotation, homothety, and inversion stay
closed-form and immutable. Radical axis, line-line intersection, and the second
line-circle intersection use translation/scale-aware determinant guards. Every
multi-root operation carries its semantic selector (`unique` or
`exclude-known-point`) rather than inheriting a library's incidental result
order. Complex cyclic/complete-quadrilateral previews must reuse the same
evaluated entities instead of adding Canvas-only formulas.

Implementation alignment on 2026-08-01: the second tranche now evaluates
reflection, 90-degree rotation, homothety, inversion, radical axis, cyclic
quadrilateral, and complete quadrilateral from the same immutable plan used by
the TikZ writer. Writer-visible guides, circles, secants, polygons, four
supporting lines, and diagonals have explicit plan/entity/output identities.
The validator proves their entity kinds and endpoint/vertex bindings. Numeric
circle radii are converted to TeX coordinate lengths before `veclen`, and
catalog/evaluator degeneracy checks use translation-invariant relative scales.

## Typed AI/Canvas/Code write lane

Managed TikZ blocks remain `writable: false` for raw byte patches. This is a
security and consistency invariant, not a missing permission: geometry edits
must regenerate the semantic records, fingerprint, and TikZ body together.
The first typed boundary is `construction-plan-proposal/v1`:

1. AI or Canvas submits a validated `ConstructionPlan`, never a managed-body
   string.
2. The trusted compiler checks document basis, read scope, binding capability,
   same construction ID/kind, source range, block content fingerprint, and the
   complete previous canonical plan.
3. `compileConstructionPlan` regenerates one attached block and lowers it to a
   single source patch.
4. The existing Broker verifies revision/source CAS and permits only a valid
   whole-block replacement before CodeMirror commits it.

Schema-v2 does not persist presentation/style as independent semantic data.
Therefore same-ID replacement currently fails closed when the existing block
does not byte-match the canonical previous plan. The next schema must add a
`ManagedPresentationIR` plus per-kind plan hydrator/mutation registry; only
then may styled blocks support field-level semantic replacement without visual
loss. Raw managed bindings must never be made writable to bypass this gate.

## Migration order

1. Finish typed constraints for every existing authoring tool.
2. Build and cache the directional adjacency index from constraint/relation
   records.
3. Add an affected-component planner and typed degeneracy diagnostics without a
   numeric solver.
4. Introduce a worker-isolated residual/Jacobian solver behind the same graph
   contract.
5. Move drag writeback from direct coordinate patching to
   solve -> transaction -> managed recompile.

This order prevents a numerical engine from becoming another truth source while
the current catalog still contains semantically incomplete tools.
