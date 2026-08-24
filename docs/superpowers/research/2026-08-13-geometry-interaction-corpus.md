# Geometry interaction corpus and acceptance map

## Sources and selection policy

This corpus turns reference geometry into interaction tests instead of copying
diagram source verbatim. The primary references are:

- Official TikZ transformations: <https://tikz.dev/tikz-transformations>
- Official TikZ path construction: <https://tikz.dev/tikz-paths>
- Official TikZ intersections: <https://tikz.dev/base-points>
- Official Euclid tutorial: <https://tikz.dev/tutorial-Euclid>
- Math-Net Kvant olympiad geometry collection:
  <https://m.mathnet.ru/links/5da29c89e50b3bd01104e69218cece57/kvant4579.pdf>
- Math-Net inversion and advanced Euclidean geometry:
  <https://www.mathnet.ru/links/7933c6a2d20bf0b9ef1061ea6ba28682/mp995.pdf>
- Math-Net university student olympiad problems:
  <https://www.mathnet.ru/php/getFT.phtml?jrnid=rm&paperid=3216&what=fullt>
- Math-Net classical and modern cubic curves:
  <https://www.mathnet.ru/links/7b22605023215ae0f866bc3d6e34fde5/mp1103.pdf>
- Fermat-Torricelli construction research:
  <https://www.mathnet.ru/links/795f1890746fd0edf3fe427d87e01898/sm67_eng.pdf>
- Apollonian-circle research:
  <https://www.mathnet.ru/links/435cdf741eff96e3857291d1e475376a/semr1285.pdf>

The TikZ sources define language and rendering semantics. Math-Net sources
define realistic university/olympiad construction pressure. Source code from
the references is not treated as a parser fixture unless it is independently
reduced and reviewed.

## Interaction matrix

| Family | Representative construction | Required Canvas interaction | Code/AI invariant | Current gate |
| --- | --- | --- | --- | --- |
| Triangle centers | centroid, incenter, circumcenter, orthocenter | drag one free vertex; derived center follows | formulas and source trivia preserved | corpus fixtures |
| Nine-point circle | side midpoints, altitude feet, Euler midpoint | select whole construction; translate/rotate as one transaction | one trusted Catalog intent and managed block; no duplicated circle | composite Catalog tool + browser |
| Fermat point | equilateral auxiliaries and 120-degree lines | rotate auxiliary triangle; intersection follows | angle dependency remains semantic | planned fixture |
| Apollonius | two-circle intersections and radical axis | drag either center/radius point | intersections may become unsatisfied, never fabricated | existing circle/intersection fixtures |
| Simson/Euler | perpendicular feet and collinearity | delete or move the source point with dependency preview | cascade is explicit; block is default | existing fixture + deletion tests |
| Transformations | translation, rotation, homothety, reflection | Shift/Ctrl/Cmd multi-select or Select All; transform closure | Broker derives writable free-point domain from selected entity IDs | automated transform tests |
| Path geometry | lines, rays, polygons, arcs, cubic Bézier | segment-level selection/hit test and control-point editing | unsupported syntax remains opaque and exact-renderable | line/polygon/arc/cubic current; anchors remain opaque |

## Whole-selection transform semantics

Math GeoHub follows TikZ's coordinate-transform model: shift, rotate, scale and
reflection modify coordinates, while stroke widths, dash lengths and text size
remain presentation properties unless a future explicit `transform shape`
operation is requested. A selected object is lowered to its dependency closure;
only directly writable free points receive source patches. Derived points are
recomputed from the unchanged construction graph.

Acceptance rules:

1. The client sends selected semantic entity IDs, never a self-declared list of
   writable variables.
2. The Broker rebuilds the current GeometryDoc and independently derives the
   same free-point closure.
3. All coordinate patches are one atomic transaction and one revision.
4. Any stale entity, opaque dependency or non-direct coordinate fails closed.
5. A selection containing an ordinary segment transforms both endpoints; an
   unrelated free point remains byte-identical.
6. Rotation and scale default to the centroid of the writable selection.

## Next high-value vertical slices

1. Add Fermat point and Apollonius fixtures with numeric incidence assertions.
2. Extend the completed cubic Bézier and circular-arc Path IR with direct
   control-handle authoring and exact differential fixtures.
3. Add visible transform handles on top of the completed rectangular marquee,
   modifier-click, Select All button, and Mod+A flows.
4. Add exact-compiler differential fixtures for every official TikZ library in
   the pinned compiler profile; exact coverage must not be presented as Canvas
   editability.

## 2026-08-13 competition-geometry stress gates

The test corpus now separates construction difficulty from syntax breadth:

1. Nine-point circle: general, right and obtuse triangles. The nine incidence
   points must remain equidistant from the managed center; the right-triangle
   case prevents a degenerate altitude segment from breaking the orthocenter.
2. Inversion: center, radius witness and inverse point, including the explicit
   undefined case at the inversion center.
3. Circle power: two circles, common chord and radical axis, including disjoint
   circles where the algebraic axis exists without fabricated intersections.
4. Complete/cyclic quadrilaterals: source dependency closure, intersection
   disappearance, atomic deletion and whole-selection transformation.
5. Cubic curves and circular arcs: official TikZ path syntax, hit testing,
   bounding, selection and exact-render differential output.
6. Transformation matrix: translation, rotation, uniform scale, reflection,
   slant and matrix transforms. Interactive writes only target Broker-derived
   free coordinates; TikZ node-shape transforms remain an explicit future
   presentation operation because official TikZ does not transform node shapes
   unless `transform shape` is requested.

Host-browser evidence after the composite upgrade:

- the competition toolbar exposes `九点圆` as one tool;
- selecting A, B and C commits one managed `nine-point-circle` block;
- the projection changes from `5 点 · 9 图元` to `16 点 · 10 图元` and selects
  the circle plus its eleven managed point outputs;
- restoring the editor source returns the projection to the original fixture.

## 2026-08-13 group-transform handle research

The visible transform affordance is based on maintained editor behavior rather
than a canvas-local source mutation shortcut:

- Fabric.js keeps resize, rotation and skew controls in screen space, places
  controls from normalized object bounds, and supports pixel offsets for
  handles such as the rotation control. Its transform documentation also
  separates viewport, parent and object transforms.
  <https://fabricjs.com/docs/old-docs/control-api/>
  <https://fabricjs.com/docs/transformations/>
- tldraw stores selected shape IDs as the source selection state and derives
  selection bounds/rotation from the current shape records. Its group transform
  flow transforms all selected shapes around one shared selection center.
  <https://tldraw.dev/sdk-features/selection>
  <https://tldraw.dev/sdk-features/shape-transforms>
- Excalidraw renders one common bounding box for a multi-selection and snapshots
  initial element geometry before resize/rotation. Rotation is derived with
  `atan2`, angle snapping is a gesture modifier, and resize is computed from an
  anchor instead of incrementally mutating the previous pointer frame.
  <https://github.com/excalidraw/excalidraw/blob/eb959128/packages/excalidraw/renderer/interactiveScene.ts>
  <https://github.com/excalidraw/excalidraw/blob/eb959128/packages/element/src/resizeElements.ts>

Math GeoHub therefore uses this interaction contract:

1. Bounds are derived from selected immutable RenderingTruth primitives; Scene
   UUIDs and source ranges are not used as geometry identity.
2. Handles keep a constant screen-pixel size. The rotation handle stays above
   the selection and corner handles apply uniform scale around the visible
   selection-bounds center. That screen center is converted to an explicit
   scene coordinate before the trusted transform protocol is compiled.
3. Pointer-down freezes the selection, bounds and revision. Pointer-move only
   updates an ephemeral overlay; it never edits TikZ text.
4. Pointer-up submits one `canvas-point-move-proposal/v1` transaction through
   the Broker. The Broker rebuilds the dependency closure and either writes all
   free coordinates in one revision or writes nothing.
5. The center handle translates the group. Shift snaps rotation to 15 degrees;
   scaling is clamped away from zero. Escape/pointer-cancel discards the preview.
6. Infinite line/ray bounds use their defining points for handles, not their
   viewport-clipped visual extent, so zooming does not move the transform center.

Host-browser evidence after the transform-handle slice:

- Select All produced one shared selection frame with one center move handle,
  one rotation handle and four uniform-scale corner handles for 14 projected
  objects;
- an atomic group translation rewrote A/B/C from `(0,0)`, `(4,0)`, `(1.2,2.8)`
  to `(1,0)`, `(5,0)`, `(2.2,2.8)` while M/H remained derived from their
  original TikZ construction expressions;
- 90-degree rotation, 1.5x uniform scale and reflection about the y-axis each
  completed through the same whole-selection transaction path; all three kept
  M/H as derived TikZ expressions instead of flattening them into coordinates;
- the editor source was restored and the current projection returned to
  `5 points / 9 elements` after the smoke check;
- the browser transport available in this session exposed click/fill but not a
  trusted native pointer-drag primitive. Handle layout and the already shared
  Broker commit path were verified in-browser; pointer delta/snap/clamp logic is
  covered by the added pure gesture specifications for the product owner to run.

## 2026-08-13 Fermat--Torricelli construction gate

The next trusted olympiad construction follows the mathematical problem, not a
single memorized intersection diagram:

- For a triangle whose three angles are strictly below 120 degrees, the unique
  interior minimizer has the three vertex rays separated by 120 degrees. A
  classical straightedge-and-compass construction erects outward equilateral
  triangles and intersects the lines from their new vertices to the opposite
  original vertices.
- If one triangle angle is at least 120 degrees, the distance minimizer is that
  vertex. An interactive tool must expose this branch rather than fabricate an
  unstable or exterior line intersection.
- The official TikZ Euclid tutorial confirms that rotated calc coordinates and
  named/interpreted intersections are the intended source-level primitives for
  geometric construction. The writer therefore uses calc rotation and a
  deterministic analytic line-intersection expression, while the semantic
  plan records the 120-degree branch explicitly.

Primary/review sources:

- Fermat--Torricelli problem review and construction:
  <https://link.springer.com/article/10.1007/s00591-025-00402-y>
- Krarup and Roos, *On the Fermat point of a triangle*:
  <https://www.nieuwarchief.nl/serie5/pdf/naw5-2017-18-4-280.pdf>
- Official TikZ Euclid construction tutorial:
  <https://tikz.dev/tutorial-Euclid>
- Official TikZ coordinate/intersection syntax:
  <https://tikz.dev/tikz-coordinates>

Acceptance fixtures are: an acute scalene triangle, an obtuse triangle below
120 degrees, exact 120 degrees, above 120 degrees, reversed vertex orientation,
near-collinear rejection, and drag across the 120-degree boundary. The last
case must recompile the trusted managed plan or report that its branch is stale;
it must never silently keep the wrong semantic mode.
# 2026-08-13 update — cubic path architecture

Official TikZ path syntax uses `.. controls (c1) and (c2) ..` for a cubic Bézier,
while node anchors use a separate `(node.anchor)` coordinate grammar. They must
not share a generic "dot" fallback. The implementation therefore introduces a
typed `dotdot` token and a `cubic-bezier` path segment, while anchor syntax
remains lossless/opaque until its coordinate semantics are modeled.

The interactive path kernel follows the segment-union approach used by
`svgpathtools` and the edit behavior demonstrated by Weasel: the four defining
points stay semantic inputs, de Casteljau subdivision is shared by hit testing
and intersection approximation, and moving or group-transforming those points
rewrites the original coordinate definitions rather than replacing the curve
with a sampled polyline. `modern-path2d` additionally confirms that path
rendering, transforms, hit tests, and bounds belong behind one path abstraction.

Sources:

- TikZ paths: https://tikz.dev/tikz-paths
- TikZ node anchors: https://tikz.dev/tikz-shapes
- TikZ transformations: https://tikz.dev/tikz-transformations
- svgpathtools segment model: https://github.com/mathandy/svgpathtools
- modern-path2d geometry surface: https://github.com/qq15725/modern-path2d
- Weasel Bézier anchor insertion: https://github.com/orochi235/weasel/commit/177eb36960ea56859cca3eda20666bda5c3d077b

The same Path IR now carries TikZ circular arcs in both positional
`arc (start:end:radius)` and keyed `arc[start angle=...,end angle=...,radius=...]`
forms. The path current point determines the circle center exactly as TikZ
defines it; RenderingTruth emits an SVG elliptical-arc command, while hit tests
and intersection evaluation share one bounded angular flattening kernel.

Host-browser evidence on 2026-08-13 (without Docker or project test commands):

- cubic fixture projected as `4 点 · 1 图元`, emitted one SVG `C` command,
  was hit-selected as `cubic-bezier · A–C1–C2–B`, and whole-selection translate
  rewrote all four coordinate definitions in one visible update;
- circular-arc fixture projected as `1 点 · 1 图元`, emitted one SVG `A`
  command, and was hit-selected as `circular-arc · A`; whole-selection
  translation rewrote the current-point coordinate, while rotate/scale/reflect
  were explicitly rejected with source unchanged until angle/radius slots gain
  a Broker-attested write protocol;
- the editor was restored to the original `5 点 · 9 图元` triangle fixture
  after the smoke checks.

## 2026-08-13 Math-Net and official TikZ follow-up

- A Math-Net English paper uses equilateral triangles erected on a triangle and
  discusses why an exterior candidate is not the Fermat solution. Retain it as
  a branch/adversarial fixture rather than copying one diagram:
  <https://www.mathnet.ru/links/6be03033365070a157af1951c5533b28/sm67_eng.pdf>
- The official coordinate manual documents calc rotation, implicit node
  anchors, tangent coordinates and named-path intersections. These are separate
  capability tiers: calc rotations are interactive; node-border anchors and
  arbitrary path intersections stay opaque/exact-only until they gain typed IR:
  <https://tikz.dev/tikz-coordinates>
- The official shape library is an exact-render corpus for geometric nodes and
  anchors, not permission to treat every node shape as editable Euclidean data:
  <https://tikz.dev/library-shapes>

Next competition corpus: Simson line, Miquel point, Apollonius circle,
pole/polar and complete-quadrilateral theorems. Each ships as one Catalog
construction or remains exact-only; no multi-fence AI expansion.

## Simson line interaction stress fixture

- Math-Net: A. N. Afanasyev, “Oriented angles, generalized pedal triangles and
  generalized Simson lines”, <https://www.mathnet.ru/eng/mo816>. This makes a
  strong competition regression fixture because one point on a circumcircle,
  three perpendicular projections and a collinearity invariant must remain
  connected as one construction graph.
- Official TikZ projection syntax is `($(a)!(p)!(b)$)`:
  <https://tikz.dev/tikz-coordinates>. Each pedal point should use this exact
  writer spelling instead of a flattened numeric coordinate.
- Whole-selection transformations follow the documented TikZ transform model:
  <https://tikz.dev/tikz-transformations>. The Canvas operation must transform
  the writable ancestor domain and re-evaluate all three feet; it must not move
  one output point independently.
- Maintained constraint/UI references: FreeCAD Sketcher
  (<https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Sketcher_Workbench.md>)
  and JSketcher (<https://github.com/xibyte/jsketcher>). Both support treating
  constraints/history as first-class state instead of flattening the picture.

Acceptance corpus: acute/right/obtuse triangles; a fourth point on the
circumcircle; all three feet collinear within a scale-aware tolerance; one
managed transaction; group translate/rotate/scale/reflection; Canvas movement
of the circle point; interactive/exact-render agreement; and fail-closed
rejection with zero source changes when the fourth point is off the circle.

## 2026-08-13 implementation decision: generated-circle-point Simson tool

The first trusted vertical slice is intentionally named and advertised as a
generated-circle-point construction: the user selects only triangle vertices
`A/B/C`; the Catalog creates the circumcenter/circumcircle, a constrained point
`P` on that circle, the three pedal feet, and their common line in one managed
transaction. This makes the natural-language command “画一条西姆松线” usable
without asking the teacher to pre-construct a fourth point, while preserving a
real `on-circle` plus `rotation` parameter instead of flattening `P`.

The distinct four-input variant “through an existing point P” remains a
separate future tool (`simson-line-by-point`). The two operations must not share
one ambiguous input contract. Math-Net's generalized-pedal formulation remains
the theorem-level corpus (<https://www.mathnet.ru/eng/mo816>), while the writer
uses the official `calc` projection modifier `($(A)!(P)!(B)$)` documented at
<https://tikz.dev/tikz-coordinates>.

Implemented invariants for the three-input slice:

- one closed `construction-intent/v1`, one trusted Catalog plan and one Broker
  source transaction;
- a semantic `collinear` constraint over the three feet in addition to three
  `perpendicular-foot` constraints;
- source-neutral numeric evaluation checks the circumcircle incidence and a
  scale-aware cross product before emitting visible geometry;
- the managed writer preserves construction formulas and never serializes the
  derived points as numeric literals;
- collinear triangle vertices fail before proposal creation, with zero source
  changes.

Whole-selection transforms now carry the resolved affine transform in the
typed Canvas proof. The Broker replays the matrix against the complete free
variable closure and rejects missing/subset/non-affine coordinate batches.
Managed primitive-point block recompilation, external-dependent impact review,
and orientation-reversing transforms of angle-bearing constructions remain
explicit follow-up gates; the UI must not claim those unsupported cases work.

## Next research-backed competition slices

- `miquel-complete-quadrilateral`: one complete-quadrilateral dependency graph
  and its four circumcircles, with a unique finite common point.
- `apollonius-circle-ratio`: the distance-ratio locus for two points and a
  positive ratio distinct from one; do not conflate this with Apollonius' three
  tangent-circle problem. A modern Math-Net use of the distance-ratio circle is
  available at <https://www.mathnet.ru/php/getFT.phtml?jrnid=cgtm&paperid=313&what=fullt>.
- `polar-of-point` and `pole-of-line`: separate tools after the public intent
  ABI gains an exact `line` binding type. Do not infer a line from two unrelated
  point mentions.

## 2026-08-13 selection-transform capability gate

The selection surface now queries a read-only semantic capability before a
write. The result names the selected entities, the actual free driver points,
the canonical source-patch count, the complete downstream impact set and the
selection-external dependents. Invalid numbers no longer fall back silently to
zero or one. This follows the source-native rule: the UI must explain the
semantic write domain before it asks the Broker to commit it.

The first capability table is deliberately fail-closed. Cubic Bezier paths are
blocked because their inline control-point slots do not yet have attested
write ranges. Scaling a center-radius circle is blocked because moving only
the center while leaving the radius literal unchanged is not a geometric
scale. Circular-arc rotation/scale/reflection stays blocked until the angle and
radius slots join the same atomic proof. Official path syntax confirms that
circle radii and Bezier controls are independent path parameters rather than
ordinary point dependencies: <https://tikz.dev/tikz-paths>.

Host-browser regression evidence: the current sample selects 14 rendered
objects, resolves them to 3 writable driver points and 3 source patches, and
disables Apply with the visible reason when a numeric field contains `abc`.
The next protocol slice is managed primitive-point whole-block recompilation
plus an exact external-impact acknowledgement; until that is complete, the UI
must not claim managed composite transforms are writable.

Official TikZ regression sources remain the coordinate, intersection and
transformation chapters: <https://tikz.dev/tikz-coordinates> and
<https://tikz.dev/tikz-transformations>. Coordinate transforms and canvas
transforms are intentionally different; interactive group transforms operate
on semantic coordinates and must not silently scale line widths or labels.
