# Official TikZ + GeoGebra capability expansion plan

Date: 2026-08-16
Status: architecture baseline and implementation order
Owner: Math GeoHub TikZ Studio

## Decision in one sentence

Math GeoHub will expose the official PGF/TikZ surface through a source-preserving
frontend and an isolated execution lane, while the Canvas and agent use a
revision-bound, reversible two-dimensional semantic projection. GeoGebra's
tool/selection/event patterns are used as interaction design input, not as a
second geometry truth. “Full TikZ coverage” therefore means that source can be
opened, preserved, classified, and (where the compiler profile allows it)
compiled; it does not mean that arbitrary TeX expansion becomes a draggable
Canvas object.

## Provenance and source boundary

The following are the pinned primary sources used for this design. Links point
to the exact upstream revision where the repository has a stable revision.

### PGF/TikZ

- [PGF/TikZ repository at pinned commit `0a859c80b47a1f3e07b8164aec6de861c4118e2a`](https://github.com/pgf-tikz/pgf/tree/0a859c80b47a1f3e07b8164aec6de861c4118e2a)
- [Official TikZ/PGF manual](https://tikz.dev/)
- [Official PGF/TikZ manual PDF](https://pgf-tikz.github.io/pgf/pgfmanual.pdf)
- [PGF/TikZ GitHub organization](https://github.com/pgf-tikz)

The repository is the syntax and implementation inventory. The manual is the
user-facing semantic contract. The scanner must record both the pinned commit
and the manual chapter/section for every capability. A URL or a model answer
is not evidence that a key or command is supported.

### GeoGebra

- [GeoGebra Graphics Tools manual](https://geogebra.github.io/docs/manual/en/tools/Graphics_Tools/)
- [GeoGebra Apps API reference](https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/)
- [GeoGebra tool documentation](https://geogebra.github.io/docs/manual/en/Tools/)
- [GeoGebra reference repository mirror at pinned commit `c840cb6c75217082afb7651eb3f4d0d1c3203f49`](https://github.com/geogebra/geogebra/tree/c840cb6c75217082afb7651eb3f4d0d1c3203f49)

The local directory `E:\Portaitsweb\molamaker-site\public\geogebra` is a
compiled/deployed distribution and is not treated as an implementation
dependency. The interaction ideas below are extracted from public API/manual
concepts. Math GeoHub must not copy its compiled runtime, minified algorithms,
icons, fonts, or CSS. Any future code reuse requires an explicit license review.

## The target architecture

The source, execution, semantic, and rendering lanes are intentionally
different. They communicate through bounded, typed contracts and a single
document transaction boundary.

```text
  TikZ bytes / CodeMirror transaction        Natural-language agent request
                    |                                      |
                    v                                      v
              TikZ CST + source map                   Agent plan / patch
                    |                                      |
                    v                                      |
     key/style resolver + execution state -----------------+
                    |                                      |
                    v                                      v
             TikZ Execution IR                    Semantic transaction
       (macros, loops, math, keys, paths)                 |
                    |                                      v
                    +----------------------------> GeometryDoc / Semantic IR
                                                           |
                    +----------------------+-------------+------------------+
                    |                      |                                |
                    v                      v                                v
             Interactive SVG             Canvas tools                  Agent context
             RenderPrimitive             selection/drag                 explanation
                    |                      |                                |
                    +---------- commit through Broker --------------------+
                                               |
                                               v
                                  minimal source patch + revision

      GeometryDoc/source revision -----------------------> isolated TeX compiler
                                                           |
                                                           v
                                                    Rendering Truth artifact
                                                    SVG/PDF + provenance
```

There is no direct `Canvas -> source string` path and no `AI -> arbitrary
source replacement` path. All writes become CodeMirror-compatible source
patches, pass the Broker, and produce one revision-bound event. The source
remains persistent truth; `GeometryDoc` is a derived semantic projection that
is safe to discard and rebuild.

### Layer contracts

| Layer | Owns | May consume | Must never claim |
| --- | --- | --- | --- |
| CST / source map | tokens, command boundaries, comments, whitespace, unknown blocks, ranges | source bytes and lexer diagnostics | that parsing proves execution semantics |
| Key/style + Execution IR | ordered key effects, scopes, transforms, macro/loop expansion, arithmetic, generated provenance | CST, registry, execution profile | that generated nodes are author-editable source objects |
| Semantic IR / GeometryDoc | points, paths, circles, arcs, labels, constraints, dependencies, selection refs, stable IDs | execution IR and explicit adapters | that every TeX object has a reversible geometry meaning |
| Interactive rendering truth | responsive SVG primitives, hit regions, handles, transient previews | semantic IR and shared render profile | that its pixels equal TeX for arbitrary drivers |
| Exact rendering truth | isolated TeX artifact, compiler logs, engine/driver/profile hashes | source revision and compiler profile | that an artifact can mutate source or semantic truth |

`AI`, `CodeMirror`, `Canvas`, exact preview, VLM audit, and future dashboard
consumers read the same revision-bound snapshot. The AI may propose a
transaction or answer from context, but it does not bypass the transaction
protocol.

## Five-dimensional capability truth

A single “supported” boolean is unsafe for TikZ. Every catalog record and every
agent response must carry these five dimensions independently. The first four
describe meaning; the fifth describes observed output.

| Dimension | Question | Required record |
| --- | --- | --- |
| D1: syntax/source truth | Can the construct be tokenized, ranged, formatted, and preserved byte-for-byte when untouched? | CST node kind, source range, comments/trivia, unknown fallback, official source/manual reference |
| D2: key/state truth | Can ordered `pgfkeys` effects, styles, scopes, units, and transforms be resolved without losing order or namespace? | key namespace, handler, value AST, scope/transform stack, unresolved-key diagnostics |
| D3: execution truth | What does expansion/execution produce for the selected TeX profile? | Execution IR, macro/loop provenance, math environment, resource limits, generated-node map |
| D4: reversible semantic truth | Is there a stable two-dimensional geometry/constraint projection whose edits patch an upstream driver? | semantic entity IDs, dependencies, constraints, writer slots, edit policy, reversibility level |
| D5: rendering/evidence truth | What artifact did the exact compiler or interactive renderer actually produce? | artifact hash, compiler engine/driver/profile, SVG viewBox/style profile, logs, parity verdict, timestamp |

The product UI must show these dimensions separately. For example, a
`\foreach` result can be D1/D2/D3/D5 true while D4 is opaque and therefore
not draggable. A `circle` with a named center can be D1–D5 true for the core
profile. A driver-specific primitive may be preserved and exact-only while
being neither semantically projected nor interactive.

### Compatibility flags exposed to callers

For compact APIs the five dimensions are also exposed as the following flags:

```ts
type CapabilityTruth = {
  preserve: boolean;       // D1 source preservation
  syntax: boolean;         // D1 recognized/classified syntax
  execution: 'static' | 'profiled' | 'opaque' | 'blocked'; // D3
  semantic: 'none' | 'projected' | 'constrained' | 'reversible'; // D4
  interactive: 'none' | 'inspect' | 'edit' | 'construct'; // D4
  exact: 'unverified' | 'compiled' | 'parity-checked'; // D5
  keys: 'unresolved' | 'partial' | 'resolved'; // D2
};
```

`preserve`, `syntax`, `semantic`, `interactive`, and `exact` remain available
for compatibility with the existing capability catalog, but `execution`,
`keys`, and their evidence are not collapsed into a score. A capability is
never promoted to `interactive: edit` solely because it compiled once.

## TikZ registry and ingestion pipeline

The registry is generated from the pinned PGF source and manual metadata, then
reviewed as versioned data. It is not handwritten ad hoc inside React
components.

### Inventory pass

The scanner enumerates, at minimum:

1. `tex/latex/pgf/frontendlayer/tikz/*.code.tex` and every
   `tikzlibrary*.code.tex` file;
2. `tex/generic/pgf/` math, key, path, shape, decoration, graph, and system
   implementations;
3. official test fixtures and examples where available;
4. definitions and effects of `\\tikzset`, `\\tikzstyle`, `\\pgfkeys`,
   `\\tikzoption`, `\\def`, `\\newcommand`, and library dependencies;
5. manual chapter/section links and the pinned commit for every record.

The output is a `TikzCapabilityRecord` with ordered aliases, argument shape,
key handlers, execution profile, security profile, semantic adapter, writer
slots, renderer, and fixture IDs. A record with no adapter remains valid as a
preserved/exact/opaque record; it must not be dropped by a parser error.

### Parsing and execution

The pipeline is:

```text
bytes -> lossless lexer -> CST -> key/style resolution
      -> scoped execution state -> Execution IR -> semantic adapters
      -> GeometryDoc + provenance -> interactive/exact render lanes
```

The key resolver is ordered and namespace-aware. It records unknown keys as
structured diagnostics and keeps their original source. Scope and transform
stacks are explicit. A `foreach` expansion, macro expansion, or calculated
coordinate is represented as generated execution with a source/provenance
map; its generated instances are not silently promoted to literal source
coordinates.

### Adapter contract

Every semantically supported construct implements the same boundary:

```ts
interface TikzCapabilityAdapter {
  parse(node: TikzCstNode, context: ParseContext): ExecutionFragment;
  resolve(fragment: ExecutionFragment, state: ExecutionState): ResolvedFragment;
  project(fragment: ResolvedFragment): SemanticProjection | OpaqueProjection;
  inspect(projection: SemanticProjection): InspectionModel;
  planEdit(edit: SemanticEdit, context: EditContext): SourcePatchPlan;
  renderInteractive(projection: SemanticProjection, profile: RenderProfile): RenderPrimitive[];
  explain(projection: SemanticProjection): AgentFact[];
}
```

`planEdit` is the important safety boundary: a derived point, intersection,
or locus can only be changed by selecting an upstream driver or by creating an
explicit constraint. The adapter may return `requiresConfirmation` or
`opaque` instead of freezing a computed expression into a literal.

## Core two-dimensional semantic slices

The first implementation target is a complete, coherent 2D subset with
round-trip edits. The order below is intentional; each slice supplies the
primitives needed by the next slice.

| Slice | TikZ surface | GeometryDoc projection | GeoGebra interaction alignment | Acceptance focus |
| --- | --- | --- | --- | --- |
| S1 basic paths | `\\draw`, `\\path`, `\\fill`, `\\filldraw`, `--`, `cycle`, coordinates | Point, Segment, Polyline, ClosedPath | point/line/polygon tools, hit regions | create, select, move, minimal patch |
| S2 coordinates | named coordinates, anchors, units, coordinate systems | Point/Anchor, CoordinateRef | point tool, object names, dependency edges | labels and anchor references survive edits |
| S3 curves/shapes | `circle`, ellipse, rectangle, arc, Bézier, plot subset | Circle, Ellipse, Arc, Rect, BezierPath | circle/arc/conic tools | radius/center/control-point writer slots |
| S4 styles/keys | colors, line width, dash, opacity, caps/joins, `tikzset`, scoped styles | ManagedStyle slots and inherited state | quick style bar and contextual disabled states | style patch changes only owning source span |
| S5 transforms | `scope`, `shift`, `scale`, `rotate`, `x/y/z`, canvas transforms | TransformNode and matrix provenance | multi-selection transform, group preview | whole-selection transform, scope-safe patch |
| S6 labels/nodes | `node`, anchors, `node[pos]`, `label`, `pin`, `quotes` | Label/Node with attachment relation | text/object tool, anchor-aware drag | add/remove/reposition labels after construction |
| S7 relations | `calc`, `intersections`, `name path`, `through`, `angles` | constraints, relation edges, derived points | intersection, perpendicular, tangent, measurement tools | derived values remain derived and explainable |
| S8 repetition/math | `foreach`, PGF math, variables, conditionals in bounded profile | ExecutionGroup with generated provenance | duplicate/repeat and parameter controls | inspect generated objects; edit driver, not expansion |
| S9 layout/containers | `matrix`, `positioning`, `fit`, `chains`, trees | NodeGrid/LayoutRelation/Container | multi-select, group, alignment | layout edits preserve named nodes and constraints |
| S10 advanced 2D | decorations, patterns/shadings, markings, turtle/snakes | PathDecoration/Appearance or exact-only | preview/inspect, restricted edits | no false semantic claim; exact artifact evidence |
| S11 graphs/data | `graphs`, `graphdrawing`, data visualization | Layout/data projection or opaque execution | graph tool and result inspection | sandbox and profile-specific exact output |

Slices S1–S7 form the “Canvas-complete geometry” gate. S8–S11 expand the
official language surface but remain execution/provenance-aware. `pgfplots` is
tracked as an external package integration, not counted as a built-in TikZ
library.

### Coordinate expressions and relations

`calc` deserves a dedicated expression IR rather than string interpolation:

```text
CoordinateExpr := named(A)
                 | cartesian(x, y)
                 | polar(angle, radius)
                 | interpolation(A, t, B)
                 | projection(P, line)
                 | intersection(pathRef, pathRef)
```

`name path` and `name intersections` create graph edges across commands. An
intersection point is a derived node with source references and solver policy;
moving it directly either moves an upstream path or requests a constraint, and
never silently replaces the intersection expression.

### Transform semantics

Transforms are represented as a stack with scope boundaries and an explicit
local/global flag. A whole-selection Canvas transform is one transaction that
maps selected driving points/objects, preserves the selection's labels and
dependencies, and emits a minimal patch to the owning scope or coordinate
definitions. Preview matrices are ephemeral and are not journal events. The
render profile applies the same matrix to interactive primitives and to the
exact source lane's coordinate system.

## GeoGebra Tool/Command Catalog alignment

GeoGebra's useful architectural pattern is a capability-driven tool catalog,
not a second execution engine. Math GeoHub uses one catalog for command
palette, Canvas tools, AI planning, keyboard shortcuts, and TikZ emission.

### Catalog record

```ts
type GeometryToolRecord = {
  id: string;
  category:
    | 'movement' | 'point' | 'line' | 'special-line' | 'polygon'
    | 'circle-arc' | 'conic' | 'measurement' | 'transformation'
    | 'object' | 'action' | 'view';
  inputs: InputContract[];
  selection: SelectionRequirement;
  preconditions: CapabilityPredicate[];
  semanticEffect: SemanticOperation;
  tikzEmission: TikzEmissionPlan;
  reversible: 'direct' | 'upstream-driver' | 'constraint' | 'inspect-only';
  preview: PreviewPlan;
  undo: 'one-transaction' | 'none';
  aiDescription: string;
  fixtureIds: string[];
};
```

Examples include `select`, `pan`, `point`, `segment`, `ray`, `line`,
`perpendicular`, `parallel`, `midpoint`, `intersection`, `circle`, `arc`,
`polygon`, `angle`, `distance`, `reflect`, `rotate`, `translate`, `dilate`,
`label`, `style`, `group-transform`, `undo`, and `redo`. The catalog is a
registry, not a collection of UI callbacks. A tool advertises its required
selection and writes a semantic transaction plan; the Canvas only supplies
pointer coordinates and selection refs.

### Selection and gesture lifecycle

The interaction model follows a bounded lifecycle:

```text
idle -> selection(session basis) -> preview(pointer frames)
     -> validate(Catalog + GeometryDoc) -> commit(one Broker transaction)
     -> event(revision-bound) -> redraw/invalidate
```

Supported selection modes are single, multi, box, lasso, and dependency-group.
Selection, hover, current tool, handles, and drag previews are ephemeral. A
group is document metadata only when explicitly created. Pointer move must
never write source or journal entries. During a gesture unrelated overlays are
pointer-inert; keyboard and focus-visible equivalents remain available.

The event envelope contains only bounded identifiers and summaries:

```json
{
  "type": "document.committed",
  "documentId": "…",
  "epoch": 4,
  "revision": 17,
  "transactionId": "…",
  "origin": "canvas|code|agent|solver|system",
  "changedRefs": ["point:A", "segment:AB"],
  "sourceHash": "…"
}
```

This follows the useful GeoGebra API idea of add/update/remove/rename/clear,
click, and undo lifecycle listeners while keeping source bytes out of events.
Consumers re-read the current revision-bound truth rather than trusting a
stale payload.

## Exact and interactive rendering parity

The interactive SVG lane and exact TeX lane have different performance and
security constraints, but they must share identity and presentation metadata.

`RenderProfile` is immutable per artifact and contains the coordinate origin,
unit scale, viewBox, page/clip policy, font family/fallback, color space,
stroke normalization, marker definitions, opacity, line cap/join, and transform
matrix. Both renderers consume the same semantic IDs and profile hash. Exact
preview carries the source revision, semantic revision, compiler profile,
artifact hash, and an explicit parity verdict:

```text
matched       = compared against an exact artifact with evidence
drift         = compared and mismatch measured
not-compared  = no exact artifact or profile mismatch
```

The VLM visual auditor is read-only and cannot upgrade `not-compared` to
`matched`. It may report layout/label/occlusion hints tied to an artifact, but
the semantic layer remains the only writable truth. TeX compilation is isolated
from Next.js and asynchronous; it never runs in the pointer-move or frame loop.

## Agent, code, Canvas, and flow IO

The agent harness uses a natural-language surface with a typed internal
protocol. A user may ask a question, request a construction, ask for a
transformation, or request an explanation. The agent decides among:

```text
answer-only
inspect-only
construction-plan
source-proposal
semantic-mutation
exact-compile
```

For a construction or mutation, the agent produces one bounded transaction
proposal containing document ID, epoch, base revision/hash, target refs,
operation list, preconditions, expected changed refs, and a human-readable
summary. The server validates it against the current GeometryDoc and catalog,
then commits once. If the model emits multiple writes, mixed prose/code, a
stale basis, or an unsupported operation, the entire batch is isolated and
replanned; partial application is forbidden.

An explanation may include a dynamic geometry-flow widget. The widget stores
only step IDs, semantic refs, source statement indices, and short explanations.
It can focus or highlight the corresponding current objects, but it cannot
apply stale steps. Its flow basis must match document/epoch/revision/sourceHash;
otherwise it is closed and regenerated. TikZ source is available in an
inspection drawer or exact-preview panel, not dumped into ordinary chat.

## Capability truth and registry update policy

The official surface evolves. Every registry update must record:

- previous and new PGF commit;
- scanner version and generated catalog hash;
- additions/removals/changed keys and manual sections;
- fixtures added or invalidated;
- changes to semantic reversibility or security profile;
- exact compiler profile and artifact evidence.

Promotion levels are monotonic only when evidence exists:

```text
source-preserved
  -> parsed
  -> keys-resolved
  -> execution-profiled
  -> semantic-projected
  -> interactively-editable
  -> exact-compiled
  -> parity-verified
```

An upstream syntax change can invalidate a later level without deleting source
support. The UI and agent must expose the current level and the reason for a
blocked edit.

## Test fixture matrix and delivery gates

Every slice receives a fixture directory with source, expected CST ranges,
execution/semantic snapshots, patch expectations, and exact artifact metadata.
Fixtures are deterministic and are identified by capability, library, engine,
and risk profile.

### Required fixture families

| Family | Examples | Binary observable |
| --- | --- | --- |
| source preservation | comments, whitespace, unknown keys, mixed macros | untouched source bytes/hash identical after unrelated edit |
| basic geometry | point/segment/circle/arc/polygon | semantic refs and interactive hit-test match expected |
| keys/styles | scoped `tikzset`, inheritance, transforms | ordered key effects and minimal patch span |
| derived geometry | calc, midpoint, intersections, perpendicular | dependency graph, solver result, no frozen derived literal |
| labels/nodes | anchors, label, pin, quotes, positioning | label relation and writer slot survive transform |
| execution | foreach, macro, PGF math, conditionals | generated provenance and bounded expansion diagnostics |
| layout | matrix, graphs, trees, fit, chains | layout result or opaque status is explicit |
| exact rendering | representative engine/driver profiles | artifact exists, hash recorded, compiler log bounded |
| parity | same GeometryDoc/profile through both lanes | measured verdict is matched, drift, or not-compared |
| interaction | select/multi/box/lasso/drag/group-transform | one commit, expected revision, undo restores state |
| agent IO | answer, inspect, construction, stale proposal, repair | no partial writes; replay event sequence is bounded |
| resource safety | long input, deep expansion, large loop, external asset | request is bounded/rejected without process escape |

### Gates

1. **Registry gate:** the scanner enumerates the pinned files; every record has
   a source/manual reference, five-dimensional truth, and risk policy.
2. **CST gate:** valid source round-trips with comments/trivia; unsupported
   constructs are preserved and produce structured diagnostics.
3. **Execution gate:** key order, scope, transform, macro, loop, and math
   provenance are deterministic under resource limits.
4. **Semantic gate:** S1–S7 projections have stable IDs, dependencies,
   constraints, and reversible upstream writer slots.
5. **Transaction gate:** code, Canvas, and agent writes use one Broker path;
   stale/duplicate/multi-write proposals are rejected atomically and replay is
   possible from bounded events.
6. **Renderer gate:** interactive lane remains responsive; exact lane is
   isolated/asynchronous; profile and artifact hashes are captured.
7. **Parity gate:** no “exact” or VLM verdict is asserted without an artifact
   and profile-compatible comparison.
8. **Browser gate:** real browser flows cover construction, follow-up style or
   label edits, multi-selection transform, dynamic flow focus, and exact
   preview opening without raw TikZ flooding chat.
9. **Performance gate:** pointer preview stays off the transaction/journal
   path; memory is bounded for event, proposal, artifact, and replay caches.
10. **License/security gate:** isolated TeX, external assets, Lua/OGDF, RDF,
    shell escape, network, native bindings, and dependencies are explicitly
    profiled and denied by default.

Each passing gate must leave a real artifact: test report, snapshot, compiled
artifact/log, browser screenshot/trace, or measured profile under the active
evidence directory. A green assertion without captured evidence is not a
release claim.

## Explicit semantic boundary and non-promises

The following guarantees are deliberately not made:

- Arbitrary TeX macro expansion is not guaranteed to have a meaningful or
  reversible Canvas representation. It is preserved and can be executed in a
  selected isolated profile when safe.
- `\\foreach`, conditionals, and PGF math are not promised to become literal
  independently editable objects. Generated instances retain driver/provenance
  links and are edited by changing the loop or parameter.
- Graph drawing, Lua/OGDF/native bindings, externalization, RDF/network
  references, shipout/page effects, driver-specific primitives, animations,
  and arbitrary external assets are not promised to be interactive or
  deterministic across engines.
- `pgfplots` is not an official built-in TikZ library. It requires a separate
  package adapter, data/resource policy, and exact compiler profile.
- Browser SVG is not promised to be byte- or pixel-identical to every PDF/SVG
  driver. Parity is a measured, profile-specific verdict.
- A VLM is not a geometry solver, compiler, or source authority. It can flag
  visible defects only after an artifact is bound to the current revision.
- A GeoGebra-style tool label or preview does not grant support for a TikZ key.
  The catalog, parser, semantic adapter, transaction validation, and fixture
  evidence must all agree.

These boundaries let the system claim the useful form of completeness:
official source coverage and preservation, exact execution where profiled, and
deep reversible interaction for the coherent 2D semantic subset. They prevent
the agent or Canvas from inventing a geometry meaning for code that TikZ itself
only defines after arbitrary TeX execution.

## Implementation order

1. Keep the pinned catalog and scanner authoritative; add missing key/state and
   execution metadata rather than expanding UI-only command lists.
2. Stabilize CST/source maps and unknown-block preservation.
3. Finish S1–S4 with source patch tests and shared `RenderProfile`.
4. Finish S5–S7, including multi-selection transforms and derived-geometry
   solver policies.
5. Add catalog-driven labels, dynamic flow widgets, and agent answer-vs-write
   routing with stale-basis rejection.
6. Add S8–S11 execution/provenance adapters and exact-only fallbacks.
7. Expand compiler profiles and parity fixtures, then add the curated
   MathNet/Olympiad problem corpus as end-to-end workload—not as a substitute
   for language/transaction gates.

The result is an AI-native TikZ geometry workspace with a broad, honest
compatibility layer: source and exact rendering remain available across the
official language surface, while the Canvas is exceptionally capable where
reversible two-dimensional semantics can actually be established.
