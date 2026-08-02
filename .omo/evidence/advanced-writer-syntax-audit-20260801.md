# Advanced Construction Writer / Syntax Audit — 2026-08-01

## Final verdict

- Static architecture/syntax result: **PASS**
- Code-quality gate: **WATCH**
- Recommendation: **APPROVE for the product-owner test gate**
- Blocking findings: **none in the reviewed snapshot**

This is a read-only audit of the current
`ConstructionPlan -> validated semantic records -> TikZ writer -> source-neutral evaluator -> Preview IR`
paths for `inversion-point`, `radical-axis`, `cyclic-quadrilateral`, and
`complete-quadrilateral`.

No test, build, lint, typecheck, TeX compiler, browser, or Docker command was
run. Syntax conclusions are static conclusions against the repository's pinned
PGF/TikZ profile; runtime acceptance remains the product owner's gate.

## Syntax and architecture baseline

- The repository pins official PGF/TikZ `3.1.11a` and intentionally separates
  preserve/syntax, semantic, interactive, and exact capabilities
  (`docs/superpowers/research/2026-07-28-pgf-tikz-3.1.11a-capability-matrix.md:5-17,31-49`).
- The exact compiler wrapper preloads `calc`, `intersections`, and `through`, so
  the reviewed `\path let`, calc coordinate, and `circle through` forms have
  their required libraries
  (`services/tikz-compiler/compiler-core.mjs:14-23,77-87`).
- The shared serializer owns the required outer `($...$)` spelling for calc
  coordinates and emits the interpolation/difference/offset forms used by all
  four writers
  (`lib/tikz/authoring/tikz-coordinate-serializer.ts:9-67`).
- The architecture research requires guarded denominators, stable
  `exclude-known-point` intersection identity, and one evaluated projection for
  Canvas/AI/source consumers
  (`docs/superpowers/research/2026-08-01-tikz-constraint-solver-architecture.md:76-120,236-242`).
- Every source compilation passes through plan validation before the writer is
  called (`lib/tikz/authoring/construction-ir.ts:2056-2075`).

## Four-construction equivalence matrix

| Construction | TikZ writer and formula | Source-neutral evaluator | Semantic/output closure | Result |
| --- | --- | --- | --- | --- |
| `inversion-point` | Writes `O + (P-O)|R-O|^2/|P-O|^2` with `\path let`, `veclen`, and calc offset; also draws the dashed source-to-image guide (`lib/tikz/authoring/construction-ir.ts:1902-1912`). | Uses the identical squared-length ratio, rejects zero source/radius vectors before division, and registers both image point and guide segment (`lib/tikz/authoring/construction-eval.ts:572-599`). | `result` and `guide` are explicit plan fields (`lib/tikz/authoring/construction-ir.ts:456-463`); validation requires a point plus the exact source-result segment (`lib/tikz/authoring/construction-ir.ts:1420-1431`); catalog outputs both (`lib/tikz/authoring/construction-catalog.ts:1593-1668`). | **PASS** |
| `radical-axis` | Writes `C1 + ((d^2+r1^2-r2^2)/(2d^2))(C2-C1)`, derives a perpendicular direction, and draws the supporting line (`lib/tikz/authoring/construction-ir.ts:1914-1949`). Numeric radii are first converted to calc-coordinate offsets and then measured with `veclen`, so through-point and center-radius operands share the same TeX dimension system (`lib/tikz/authoring/construction-ir.ts:1919-1944`). | Uses the same power-equality formula, guards coincident/near-concentric centers, and registers the point, direction point, and line (`lib/tikz/authoring/construction-eval.ts:601-628`). Current source center/through references are authoritative; stale write-time centers are not revived (`lib/tikz/authoring/construction-eval.ts:375-398`). | The catalog emits all three typed outputs (`lib/tikz/authoring/construction-catalog.ts:1209-1276`); validation binds the line specifically to result/direction and rejects duplicate or near-concentric circles (`lib/tikz/authoring/construction-ir.ts:1434-1519`). | **PASS** |
| `cyclic-quadrilateral` | Builds the circumcenter from two perpendicular bisectors, then writes the factored nonzero line-circle root `t=-2(d dot (A-O))/|d|^2`; it draws the dashed secant, quadrilateral, and circumcircle (`lib/tikz/authoring/construction-ir.ts:1637-1684,1951-1965`). The calc syntax is dimensionally consistent and the chosen root is the other intersection relative to known point `A`. | Computes the same circumcenter/root, rejects coincident/collinear/tangent and B/C-collision cases, and registers center, fourth point, circle, secant line, and polygon (`lib/tikz/authoring/construction-eval.ts:630-678`). | The plan explicitly names `circle`, `secant`, and `polygon` (`lib/tikz/authoring/construction-ir.ts:473-483`); validation enforces circle center/through, secant endpoints, and polygon vertex order `[a,b,result,c]` (`lib/tikz/authoring/construction-ir.ts:1522-1542`). The catalog allocates collision-safe names, persists `exclude-known-point` with `domain: line`, and exposes all five outputs (`lib/tikz/authoring/construction-catalog.ts:1791-1922`). | **PASS** |
| `complete-quadrilateral` | The shared helper writes `t=cross(C-A,D-C)/cross(B-A,D-C)` and uses `A!t!B`; the writer applies it to `AB/CD` and `BC/DA`, draws all four extended supporting lines and the intersection connector (`lib/tikz/authoring/construction-ir.ts:1641-1655,1967-1985`). | Uses the same infinite-line determinant formula, guards collapsed, collinear, parallel, and coincident-intersection cases, then registers both points, four lines, and the connector segment (`lib/tikz/authoring/construction-eval.ts:401-418,680-720`). | All four side lines and the connector are explicit plan fields (`lib/tikz/authoring/construction-ir.ts:485-497`); validation enforces every endpoint pair and the connector endpoints (`lib/tikz/authoring/construction-ir.ts:1544-1572`). Catalog outputs all seven visible entities (`lib/tikz/authoring/construction-catalog.ts:1991-2137`). | **PASS** |

## AI / Code / Canvas IO closure

The reviewed snapshot closes the three required IO lanes for these four tools:

1. **Code/source IO:** `compileConstructionPlan` validates the immutable plan,
   writes standard calc/PGF syntax, and publishes the complete output list in
   the managed directive. Cyclic and complete use their typed output records
   directly (`lib/tikz/authoring/construction-ir.ts:2031-2052,2056-2075`).
2. **Semantic/AI IO:** output refs must resolve to entity **names**, and output
   kinds must match entity kinds
   (`lib/tikz/authoring/construction-ir.ts:1020-1067`). Per-kind entity-shape
   validation prevents a structurally accepted plan from describing different
   geometry to writer and AI (`lib/tikz/authoring/construction-ir.ts:1281-1307,1420-1572`).
3. **Canvas IO:** the evaluator dispatch includes all four advanced kinds
   (`lib/tikz/authoring/construction-eval.ts:1018-1029`), exposes their complete
   typed output lists (`lib/tikz/authoring/construction-eval.ts:880-909`), and
   Preview IR admits all four plus polygon projection
   (`lib/tikz/authoring/preview-ir.ts:62-98,400-423`).

Legacy/header-only role recovery is also aligned with the current catalog:
inversion has two roles, radical-axis three, cyclic five, and complete seven
(`lib/tikz/ir/tikz-adapter.ts:355-383`).

## Non-blocking watch items

### W1 — owner-run exact TeX/runtime gate remains outstanding

This audit did not execute TeX. The reviewed strings are valid static
PGF/TikZ/calc forms under the configured libraries, but actual engine output,
SVG equivalence, drag/re-evaluation, malformed-source recovery, and visual
extent remain for the product-owner test pass.

### W2 — guard tolerances are qualitatively aligned but not numerically identical

Catalog gesture validation generally uses `1e-7`/`1e-8`, while the evaluator
uses `CONSTRUCTION_EPSILON` (`1e-9`) with translation/scale-aware guards. Both
reject the required degeneracies, but a very narrow near-degenerate band can
be accepted or rejected at different lifecycle stages. This is not a formula
or syntax blocker, but a future single tolerance policy would make diagnostics
more predictable.

### W3 — unresolved radius expressions deliberately fail closed in Preview IR

The exact plan boundary permits a non-empty scalar expression for a radical
circle radius, while the source-neutral evaluator resolves through-point radii
or numeric radii only (`lib/tikz/authoring/construction-ir.ts:1453-1471`;
`lib/tikz/authoring/construction-eval.ts:386-398`). Catalog-generated circle
definitions provide numeric/evaluable geometry, so the reviewed authoring path
is closed. Arbitrary TeX-only scalar expressions remain exact-lane syntax and
must not be presented as draggable semantic geometry without a safe expression
evaluator.

### W4 — infinite lines use finite source display extents

Semantic evaluator geometry marks these entities as mathematical lines, while
the TikZ writer renders a conventional finite `[-3,4]` interpolation extent
(`lib/tikz/authoring/construction-ir.ts:1633-1635`;
`lib/tikz/authoring/construction-eval.ts:299-316`). This is a deliberate visual
projection rather than an algebra mismatch, but viewport-aware clipping is a
future rendering-quality improvement.

## Gate decision

The previous radical-axis unit mismatch, missing advanced evaluators, missing
cyclic/complete entity-shape checks, and lagging fallback roles are all closed
in the current snapshot. The four writers are formula-equivalent to their
source-neutral evaluators, their typed outputs reach AI/managed code and Canvas,
and the emitted constructs use the configured PGF/TikZ libraries.

**Static review: PASS. No blocking finding. Proceed to the product-owner-run
test/exact-compiler/browser gate with W1-W4 recorded.**
