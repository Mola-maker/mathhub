# TikZ Triad IO Architecture Review

> Date: 2026-08-10
> Status: implementation checkpoint, not product completion
> Goal: Code, AI comprehension, and TikZ Canvas are equivalent IO surfaces over one source-bound semantic kernel.
> Product boundary: canvas capability first; visual restyling follows later.
> Deployment boundary: ECS web/API plus private exact compiler, CDN for immutable assets and registry shards.

## 1. Decision

The v5 architecture remains the correct baseline, but implementation must stop
treating TikZ options and managed writer output as incidental strings. The next
runtime breakpoint is a source-preserving construction/presentation pipeline:

```text
CodeMirror source bytes
        |
Lossless CST + ordered PGF option sequence
        |
GeometryDoc = semantic core + construction bindings + ManagedPresentationIR
        |
Geometry Transaction Broker
    /          |          \
  Code         AI        Canvas
        |
minimal source transaction -> reparse -> reproject -> render
```

TikZ is not replaced by Geometry IR. Source remains the authoring truth; IR is a
revision-scoped projection. Unsupported TeX/TikZ remains exact, addressable, and
opaque rather than being normalized into fabricated geometry.

## 2. External evidence and consequences

### 2.1 PGF keys are an ordered dispatch language

The pinned official PGF implementation processes key/value input in order,
resolves current paths and handlers, and invokes unknown-key fallback behavior.
It is therefore unsafe to normalize options into a JavaScript object or to split
them with `raw.split(',')`.

Primary evidence:

- PGF key parsing/dispatch at pinned source:
  <https://github.com/pgf-tikz/pgf/blob/1c7fc0fdc3ec8a6bdcfd68785c6bbd43ec110178/tex/generic/pgf/utilities/pgfkeys.code.tex#L311-L335>
- handlers and unknown fallback:
  <https://github.com/pgf-tikz/pgf/blob/1c7fc0fdc3ec8a6bdcfd68785c6bbd43ec110178/tex/generic/pgf/utilities/pgfkeys.code.tex#L422-L455>
- official manual surface: <https://tikz.dev/pgfkeys>

Consequence: the syntax layer needs an ordered, duplicate-preserving sequence
with exact source slices and ranges. Semantic consumers may derive a view, but
must never rewrite untouched entries or reorder dispatch.

### 2.2 Incremental CST is necessary but insufficient

Tree-sitter explicitly targets incremental parsing and useful trees in the
presence of syntax errors. The maintained LaTeX grammar also states that TeX
catcodes and macro expansion prevent a conventional grammar from fully parsing
the language.

Primary evidence:

- Tree-sitter incremental/error-tolerant CST:
  <https://github.com/tree-sitter/tree-sitter/blob/4f7ab225840f05e080851cc839a1fa92bbf46a36/docs/src/index.md#L5-L14>
- incremental implementation model:
  <https://github.com/tree-sitter/tree-sitter/blob/4f7ab225840f05e080851cc839a1fa92bbf46a36/docs/src/5-implementation.md#L3-L12>
- LaTeX grammar limitations:
  <https://github.com/latex-lsp/tree-sitter-latex/blob/fa8df448fc2c0192a8c2f8cfc97de53cb2b4ecb9/README.md#L6-L10>

Consequence: Lezer remains the editor CST, not semantic truth. Dynamic/macrolike
regions require preserved opaque nodes and, where exact execution is permitted,
separate expansion provenance.

### 2.3 Compiler-shaped semantic projection is the durable pattern

Typst separates tokens, syntax trees, typed AST views, semantic content, layout,
and export. It incrementally reparses bounded syntax while memoizing semantic
work, but also documents stabilization constraints between layout and document
introspection.

Primary evidence:

- pipeline overview:
  <https://github.com/typst/typst/blob/a51e028041cac426f97d34335bb01d8f1d8e5e8f/crates/typst/src/lib.rs#L1-L21>
- bounded markup reparse:
  <https://github.com/typst/typst/blob/a51e028041cac426f97d34335bb01d8f1d8e5e8f/crates/typst-syntax/src/parser.rs#L63-L82>
- memoized parse/checkpoints:
  <https://github.com/typst/typst/blob/a51e028041cac426f97d34335bb01d8f1d8e5e8f/crates/typst-syntax/src/parser.rs#L1889-L1907>

Consequence: Math GeoHub must version source, kernel, plugin, and projection
bases separately. Interactive render output never becomes semantic identity.

### 2.4 Minimal source patches are proven practical for TikZ editors

The maintained TikZ editor project links semantic objects to source ranges and
applies minimal edits so formatting can survive. Its partial syntax support also
confirms that preserving all source and semantically editing a safe subset are
separate capability lanes.

Reference: <https://github.com/DominikPeters/tikz-editor>

### 2.5 Editor and dynamic-geometry transactions must remain atomic

CodeMirror 6 defines a transaction as one state transition and allows multiple
change specs whose ranges all address the starting document. Transaction
annotations carry the origin of the complete change. GeoGebra's scripting
surface likewise executes construction command sequences in order and exposes
construction event listeners, while JSXGraph keeps dependent geometry in one
update graph across SVG/Canvas renderers.

Primary evidence:

- CodeMirror transaction/change specification:
  <https://codemirror.net/docs/ref/#state.TransactionSpec>
- CodeMirror state transaction guide: <https://codemirror.net/docs/guide/>
- GeoGebra scripting/event model:
  <https://geogebra.github.io/docs/manual/en/Scripting/>
- JSXGraph dependency/rendering architecture: <https://github.com/jsxgraph/jsxgraph>

Consequence: raw-circle adoption, owned input points, and the final construction
must be one multi-change transaction over original UTF-16 coordinates. A later
"repair" transaction or client-only `minimalTextPatch` destroys the capability
boundaries and can expose a half-created construction. The Broker must replay
the entire batch and either commit one revision or write nothing.

### 2.6 Incremental reparsing must expand until the boundary is balanced

Typst's bounded reparser accepts a replacement only when the selected range is
balanced and the parser ends exactly at the requested boundary. Its parser memo
arena associates reusable nodes and parser checkpoints with token-start offsets.

Primary evidence:

- bounded balanced reparse:
  <https://github.com/typst/typst/blob/a51e028041cac426f97d34335bb01d8f1d8e5e8f/crates/typst-syntax/src/parser.rs#L63-L82>
- offset-based parser memoization:
  <https://github.com/typst/typst/blob/a51e028041cac426f97d34335bb01d8f1d8e5e8f/crates/typst-syntax/src/parser.rs#L1889-L1907>

Consequence: a Code/AI/Canvas patch first invalidates the smallest enclosing CST
node. If braces, option lists, scopes, or environments no longer balance, the
reparse boundary expands outward instead of manufacturing a partial semantic
node. Cache keys include source revision, grammar/plugin digest, and CST range.

### 2.7 Solver and compiler output are derived truth, not source truth

Typst explicitly repeats layout while introspection feedback can still change
and validates a stability constraint before returning the document. JSXGraph
separates user visibility from computed visibility, including intersections that
temporarily have no real coordinates.

Primary evidence:

- layout/introspection stabilization loop:
  <https://github.com/typst/typst/blob/a51e028041cac426f97d34335bb01d8f1d8e5e8f/crates/typst/src/lib.rs#L136-L161>
- JSXGraph derived `visPropCalc` state:
  <https://github.com/jsxgraph/jsxgraph/blob/054db0a8684be2aed6e084dacd58838fc978e8fb/src/index.d.ts#L609-L619>

Consequence: constraint coordinates, visibility, bounding boxes, TeX node
positions, SVG and diagnostics live in revision-bound derived state. They never
overwrite source IR. Canvas drag emits a minimal patch only for an explicit
writable anchor; reparse, semantic lowering and exact compilation then reconcile
the derived state. Unsatisfied constraints remain represented and diagnosable.

Research note: the long-form Tavily research endpoint returned a connector
transport error in this checkpoint. Targeted Tavily search and Exa fetches for
the primary sources above succeeded; the failure is recorded rather than being
presented as completed Tavily deep research.

## 3. Current codebase audit

### 3.1 Closed in this checkpoint

1. Added `tikz-option-sequence/v1` as a lossless ordered option projection.
   It preserves duplicates, raw segments, key/value ranges, nested delimiters,
   comments/quotes/math guards, and fails closed for unbalanced lists.
2. Removed direct comma splitting from the style patcher and interactive style
   resolver. Targeted style edits now preserve unrelated nested mini-languages
   and option order.
3. Projected ordered option presentation metadata into `GeometryStyle`, and
   exposed styles in bounded/focus-prioritized AI context.
4. Restored `managedSyntaxKind` through the AI proposal context, API boundary,
   server re-attestation, and client revalidation. This repairs the precondition
   chain for replacing canonical managed constructions.
5. Added regression specifications for nested options, duplicates, fail-closed
   parsing, style preservation, renderer consumption, and AI visibility.
6. Added a standard-catcode interactive projection for `%` comments while
   retaining exact raw bytes. Contiguous post-comment options remain patchable;
   macro/catcode-sensitive cases remain explicitly non-authoritative.
7. Aligned interactive rendering with Inspector semantics for `draw`,
   `draw=<color>`, `color=<color>`, bare `fill`, and `fill=none`.
8. Bounded provider-facing style context with a 24k total JSON character budget,
   at most 64 styles/24 ordered entries per style, bounded key/value text, and
   explicit truncation markers. The API also rechecks the server-attested
   context against the global 128k limit. Exact bytes remain available only
   through focused source bindings.
9. Added a revision-local `managed-presentation/v1` hydrator/merge vertical slice
   for primitive segment and circle writer slots. Segment styles and circle
   presentation options can survive a semantic recompile; the writer-owned
   `circle through` key is replaced from the next plan. Coordinate-point writers
   remain canonical-only because they do not yet expose a real option-site ABI.
10. The managed plan codec and typed recompiler now accept only presentation
    divergence that proves: one stable writer slot, exact source shape outside
    the registered option site, unchanged managed envelope except fingerprint,
    ordered canonical option ownership, and a presentation-safe option allowlist.
    Transform keys, executable handlers, unknown PGF keys, duplicate semantic
    options, and divergence outside the body return typed
    `presentation-conflict`/`non-canonical-source` failures.
11. Merged blocks are resealed, parsed, decoded through the same presentation
    proof, checked for document reference regressions, and emitted as one atomic
    whole-block source patch. AI context reports whether the prior plan is exact
    canonical source or a lossless presentation projection.
12. Every managed replacement now carries writer ID/revision, stable slot IDs,
    and prior-slot semantic fingerprints through server-attested AI bindings and
    proposal CAS. Non-canonical blocks additionally require exact body and
    attachment fingerprints. The trusted recompiler validates both layers and
    checks attachment conservation after decoding output.
13. Added `managed-construction-recompile-proof/v1` at the transaction boundary.
    Broker independently decodes current/replacement blocks and verifies plan
    kind, concrete syntax kind, writer ABI, attachment fingerprint, slot identity,
    and opaque attachment conservation. Typed creation has a separate
    `managed-construction-create-proof/v1`; before/after block multisets prevent
    raw AI insertion from manufacturing a managed block. Broker also recompiles
    the decoded create plan and requires the exact trusted insertion patch, so a
    create cannot delete unrelated source, move outside the body insertion site,
    or smuggle sibling raw TikZ statements. The transaction declares an explicit
    create/replace mode, permits exactly one operation and one patch, and requires
    exactly the matching create or recompile proof.
    Request metadata can no longer relabel an AI transaction as external/repair
    to bypass managed-construction policy.
14. The browser now compares the server-attested transaction with its local
    writer result and commits the server transaction only when security-critical
    basis, operations, preconditions, plugin digest, and merge proof match. This
    fails closed during an ECS/CDN rolling-version mismatch instead of silently
    double-compiling with a different writer.
15. Added the first persistent schema-v3 writer-envelope milestone without
    changing the active schema-v2 default. Writer artifacts now expose stable
    slot roles plus an ordered artifact fingerprint. The independent v3 reader
    preserves UTF-16 source ranges, rejects nested/duplicate/unknown/malformed
    markers, caps marker work, detects opaque bytes outside slots, and always
    remains read-only. A separate artifact attestor binds writer ID/revision,
    plan fingerprint, ordered slot IDs/roles and slot semantic fingerprints but
    still does not grant a write capability. At that checkpoint the detached
    serializer was migration-only; item 20 records its later narrow activation.
16. Added `geometry-doc/v1` as the current-revision read-model envelope over
    semantic truth, construction truth, rendering truths and the Geometry
    source map. Its factory rejects cross-revision/cross-plugin lane mixtures.
    `useTikzEngine` now exposes this one current projection while retaining the
    legacy Scene and prior truth/source-map fields only as migration adapters.
    GeometryDoc owns no source or mutation state; writes continue through the
    transaction Broker.
17. Migrated the first managed Inspector write to the common transaction path.
    A style intent now compiles to `inspector-style-proposal/v1` with exact
    source basis, binding IDs, writer ID/revision, ordered slot IDs/roles and
    slot fingerprints. The proposal compiler accepts the current GeometryDoc,
    not a caller-assembled basis, and issues revision-local binding capability
    attestations only for bindings whose source snapshot, managed owner, range,
    non-writable status and `managed-recompile-only` policy all match the target
    block. Projector and Broker share one deterministic managed-binding ID ABI;
    Broker rebuilds the allowed block/record identities from the current source.
    Broker requires one non-empty whole-block patch,
    independently decodes current and replacement plans, proves semantic-plan
    and writer-artifact equality, and proves the inner delta replaces exactly
    the registered command option site (or inserts one at the command boundary).
    A self-resealed replacement of the entire TikZ body is rejected even if it
    decodes to the same semantic plan. The outer replacement may change only the
    presentation body plus content fingerprint and must preserve opaque
    presentation slots. Raw Canvas/style whole-block replacements no longer
    inherit trust merely from having parseable managed metadata; deletion
    remains a distinct empty-patch policy.
18. Removed the AI client's duplicate semantic reprojection. AI context now
    consumes the same current-only GeometryDoc exposed to Canvas and Inspector,
    including its attested source map. The legacy scene manifest uses the same
    synchronous FNV source identity as GeometryDoc, so AI proposal CAS, Code and
    Canvas no longer disagree solely because one browser path chose SHA-256.
19. Added the first geometry-changing Canvas transaction over the same boundary.
    Dragging a writer-owned primitive point now resolves the current managed
    owner from GeometryDoc, changes a typed `ConstructionPlan` point position,
    and invokes the trusted presentation-aware whole-block recompiler. The
    resulting `canvas-point-move-proposal/v1` carries document/kernel/plugin
    basis, the shared managed-block capability ABI, writer proof, stable entity
    record identity, selected semantic/source-stable identity and a canonicalized
    numeric target. The engine permits raw coordinate fallback only after the
    current GeometryDoc positively identifies the selected point binding as
    direct-writable; stale, missing or read-only/unknown bindings fail closed.
    Broker independently
    decodes both plans and reconstructs the only admissible next plan; it rejects
    any replacement that changes data outside that one point position. Managed
    points therefore no longer fall through to a raw body patch, while ordinary
    source-authored free points retain the existing minimal coordinate patch.
20. Activated the first schema-v3 write vertical slice without changing the
    global schema-v2 alias. New canonical primitive segment/circle creations
    from AI and Canvas now use persistent writer slots; point and all multi-slot
    constructions remain schema-v2. The v3 reader binds every header identity
    field and attached content fingerprint to the parsed block, while only the
    trusted writer can grant a write capability after serialize -> reparse ->
    envelope -> artifact self-validation. The codec double-reads v2/v3 and
    accepts v3 presentation divergence only inside the one attested slot.
    Recompile carries typed option attachments through that slot, reserializes
    and independently decodes the replacement; it does not downgrade v3 to v2.
    Inspector and Broker now measure style edits relative to the v3 slot rather
    than treating slot markers as editable presentation. Unsupported point or
    multi-slot v3 input fails closed instead of falling back to the v2 writer.
21. Replaced raw Canvas deletion commits with `canvas-delete-proposal/v1`.
    Block/cascade deletion now binds the current GeometryDoc basis, exact empty
    source patches, affected source-map IDs and every touched managed block's
    deterministic block binding, range and content fingerprint. Broker rejects
    raw Canvas whole-block deletion and now reparses the current source,
    reconstructs the current GeometryDoc/source map, reruns the dependency plan
    from the attested root IDs, and requires its canonical patches, closure and
    managed capabilities to equal the client proposal. A self-hashed proof can
    therefore no longer delete an arbitrary ordinary source range. Broker still
    runs the document-level managed-reference check after the candidate source
    is produced. Deletion currently fails closed for partial/invalid projections
    because opaque TikZ references are not yet part of the dependency graph.
    At this checkpoint the dependency algorithm still consumed legacy Scene on
    both sides; item 27 records its later replacement with GeometryDoc closure
    plus an exact compatibility-patcher equivalence gate.
22. Closed two capability-boundary regressions found by independent review.
    Inspector proposals now require the selection to contain the managed block
    binding but issue only that least-privilege block capability; incidental
    direct CST bindings no longer make a valid UI style edit fail Broker
    allowlisting. GeometryDoc projection now advertises
    `managed-recompile-only` through one policy function only after unique ID,
    metadata/integrity and the full managed decoder succeed (including v3
    envelope/artifact/opaque checks); rejected blocks expose an explicit
    `managed-read-only:<reason>` policy. Broker also requires replacement
    schema equality, so a valid v3 construction cannot be downgraded to v2 by a
    forged otherwise-equivalent recompile patch.
23. Made semantic projection identity and managed capability evaluation safe for
    editor hot paths and ECS/CDN rolling releases. Each managed block is decoded
    once per GeometryDoc projection and every direct, named-path, block, record
    and AI-summary binding reads the same cached write policy. The plugin-set
    digest now includes semantic-adapter `1.17.0`, the v3 envelope schema, the
    construction codec ABI and `construction-plan-footprint/v1`; browser, server
    and Broker import that one digest
    instead of rebuilding an adapter-only string. Old cached clients therefore
    fail the plugin CAS guard when writer-slot or decoder semantics differ.
24. Replaced Canvas creation's generic source-patch commit with
    `canvas-construction-batch-proposal/v1`. One gesture now carries ordered
    owned-point plans, the final plan, and typed raw-circle adoption intents.
    GeometryDoc exposes an explicit `create-managed-construction-batch`
    tikzpicture insertion capability with a revision/plugin-bound fingerprint.
    The proposal emits one atomic original-coordinate multi-patch transaction;
    it no longer collapses adoption plus insertion into an opaque minimal span.
    Broker diffs all newly created managed blocks, rejects every untyped Canvas
    managed-block insertion, decodes v2/v3 plan blocks, reprojects the current
    GeometryDoc, recompiles each plan/adoption with trusted writers, and requires
    exact patches and proof equality before one revision commit. Point-owned
    inputs remain v2, new segment/circle plans remain v3, and source-adopted v2
    circles stay non-upgradable/read-only. Batch size and source byte limits are
    enforced before request fingerprinting and canonical replay. Each plan proof
    now carries a JSON-safe compact canonical plan and the Broker independently
    validates its closed field set, ConstructionPlan grammar, writer-safe surface,
    writer slots and semantic fingerprints. Reversible plan kinds must additionally
    decode from the emitted block to the identical compact plan. The three current
    circle-parameterized exceptions (`point-on-circle`, `tangent-at-point`, and
    `radical-axis`) cannot be recovered from schema-v2/v3 records without guessing,
    so they use an exact catalog semantic-footprint check followed by trusted-writer
    replay instead. Their circle IDs and parameterizations are also rebound to
    either the current valid managed circle record or a same-transaction adoption
    capability; center/through/radius and evaluated snapshots must agree with the
    current GeometryDoc points. A correct managed ID can therefore no longer carry
    a forged circle definition into the writer. Canvas transactions declared as
    style edits remain Canvas-origin for managed-directive authorization and
    cannot bypass the typed creation gate.
25. Closed the semantic-record surface for every current ConstructionPlan kind,
    not only the three circle-parameterized exceptions. A shared
    `construction-plan-footprint/v1` registry defines the exact ordered inputs,
    entities, constraints, relations and outputs for all 19 construction kinds,
    including variable-arity polyline and polygon primitives. Catalog preview
    and commit assert this registry; Canvas and AI proposals validate it; and
    Broker canonical replay validates it again against the current source.
    Extra otherwise-valid records, duplicate semantic roles and unused
    dependencies therefore cannot enter a trusted writer artifact. Canvas plan
    inputs are also capability-bound: every external reference must resolve to
    the current GeometryDoc, an earlier owned point in the same batch, or a
    same-batch raw-source adoption. Adapter `1.17.0` includes the footprint ABI
    in the shared plugin-set digest so stale ECS/CDN clients fail the CAS guard
    rather than silently using a different construction contract.
26. Separated replayable GeometryDoc identity from UI-only continuity identity.
    The engine now projects GeometryDoc from a pure source analysis while the
    `EntityIdentityRegistry` may reconcile a separate legacy Scene for visual
    continuity. RenderingTruth point hit-testing carries canonical entity,
    binding, source-range and point-name provenance; point selection and drag
    fallback therefore never submit a runtime `tz_*` ID to the Broker. AI focus
    also includes the current Inspector semantic entity, so selecting a raw
    source circle authorizes that circle rather than only its display refs.
27. Moved Canvas deletion authority to GeometryDoc while retaining the old
    source patcher as a fail-closed compatibility adapter. Canvas and Broker now
    resolve semantic entity roots, derive downstream closure from IR relations,
    entity references and point-on-circle constraints, map owners through the
    authoritative source map, and then require the legacy patcher to reproduce
    exactly the same removed statement set. A mismatch rejects the entire
    transaction. Drag-preview source ranges likewise come from the current
    GeometrySourceMap and are never reconstructed from Scene stable IDs.

These changes do not claim full pgfkeys execution. They establish a lossless
static boundary from which plugins can interpret known keys without destroying
unknown syntax.

### 3.2 Remaining P0 breakpoints

1. **Persistent schema-v3 write ABI is only partially active.** New canonical
   primitive segment/circle creation, decode, style merge and typed recompile
   use v3, while the global/default alias intentionally remains schema-v2.
   Point slots, multi-slot attachments, existing-v2 migration, comments and
   richer attachment kinds still require explicit contracts before the default
   changes. Unsupported or opaque presentation remains read-only/conflicted.
2. **The Broker is not yet universal.** The runtime still privileges source
   patches and plan replacement rather than accepting the same typed semantic
   mutations from AI, Canvas, and Inspector.
3. **Canvas still partly depends on legacy Scene.** A basis-checked GeometryDoc
   read envelope is exposed; RenderingTruth now owns normal point/element hit
   identity, managed primitive-point commit and all Canvas deletion commits use
   typed GeometryDoc transactions, and delete dependency authority is semantic.
   Scene remains only as the deletion source-patch cross-check, drag-preview
   coordinate projection, construction preview point lookup, ordinary
   free/derived point solving, and exact unsupported-syntax fallback renderer.
   These remaining adapters must migrate without weakening the current
   GeometryDoc/Broker equivalence checks; ordinary free-point edits retain only
   their narrowly scoped direct coordinate patch.
4. **Source maps need multi-range slots.** Macros, generated entities, labels,
   path fragments, and writer-owned presentation require one semantic owner to
   bind several non-contiguous source ranges.
5. **Repair remains an unsafe conceptual exception.** Whole-document AI repair
   must be replaced by typed diagnostic-to-mutation proposals with the same
   opaque, capability, and basis guards as ordinary edits.
6. **Direct Code edits need a coordinator.** A keyboard edit inside a v3 slot
   currently preserves the user's bytes but detaches the content fingerprint,
   intentionally making the block read-only. A future Code Edit Coordinator
   must atomically reseal proven style-only slot edits or compile semantic edits
   through the same plan transaction; unknown edits must remain lossless and
   explicitly detached rather than being guessed.

## 4. Optimized implementation order

### P0-A: schema-v3 managed writer vertical slice

Complete segment and circle first, then introduce a real point presentation
writer instead of advertising options on `\\coordinate`:

1. `plan-core` with grammar-validated semantic values;
2. stable writer slots independent of source offsets;
3. `ManagedPresentationIR` containing ordered option sequences, comments,
   whitespace/line endings, label attachments, and opaque attachments;
4. hydrate -> mutate -> write -> merge -> reparse -> reproject equivalence;
5. typed `presentation-conflict` when a changed semantic slot overlaps opaque
   source that cannot be safely merged.

This vertical slice must be used by AI and Canvas before more construction kinds
are migrated.

### P0-B: one semantic Broker path

Promote a single envelope:

```ts
type GeometryMutationEnvelope = {
  schema: 'geometry-mutation/v1';
  origin: 'code' | 'ai' | 'canvas' | 'inspector' | 'solver';
  basis: GeometryRevisionBasis & {
    kernelHash: string;
    pluginSetDigest: string;
  };
  ownerId: string;
  capabilityId: string;
  operation: GeometryMutation;
  idempotencyKey: string;
};
```

The Broker validates, obtains a writer artifact, performs a presentation-safe
merge, emits a minimal CodeMirror transaction, and accepts success only after
reparse/reprojection equivalence. No surface writes a Scene or source string
directly.

### P0-C: make GeometryDoc the Canvas runtime

Renderer, hit-test, selection, delete impact, dependency closure, AI focus, and
tool previews must consume stable semantic IDs from one GeometryDoc projection.
Legacy Scene becomes a temporary adapter and then read-only compatibility code.

### P1-A: typed construction-intent compiler

Exact semantic-footprint validation is now shared by Catalog, Canvas, AI and
Broker, but an LLM should not be responsible for reproducing implementation
specific record IDs, roles and relation arrays. Introduce a smaller typed intent
surface such as `{toolId, selectedBindingIds, requestedNames, parameters}`.
The server-side catalog compiler must resolve those bindings against the current
GeometryDoc, allocate IDs, construct the canonical plan, assert its footprint,
and produce the trusted writer artifact. Broker then rebuilds and replays the
same intent against the current revision before commit. Full ConstructionPlan
input remains an internal/replay ABI, not the preferred AI authoring protocol.

Implementation checkpoint (2026-08-10): `construction-intent/v1` is now the
public, create-only AI authoring protocol. It is a closed runtime shape carrying
the complete revision/kernel/projection/plugin/catalog basis, a revision-bound
document insertion capability fingerprint, a trusted Catalog `toolId`, ordered
input binding IDs, declared name requests, and a bounded parameter object. The
AI context publishes the Catalog digest plus per-tool arity/kind/parameter
contracts. Client and server lower the intent through the shared Catalog, but
the final Broker does not trust that lowering: it reprojects the current source,
resolves the binding IDs again, recompiles the intent, compares the canonical
plan, regenerates the writer patch, and verifies the writer proof before commit.
The authorization set is not read back from the intent: the host passes a
separate authorized-binding set, create capability fingerprint and
`construction-authorization-scope/v1` fingerprint to the Broker. The intent
must match that independent evidence, and Catalog compilation checks every
selected binding against it.

The compatibility `construction-plan-proposal/v1` lane remains only for replacing
an already canonical managed construction. Direct plan-based creation is now
rejected. Intent/v1 now supports directly writable raw source circles through
an atomic Broker-derived adoption batch. The intent names only the authorized
raw-circle binding; the trusted compiler derives its current source range,
verbatim slice, typed center-through/center-radius definition, managed identity
and dependent Catalog plan. Broker independently rebuilds the GeometryDoc and
requires both the generic adoption proof and the closed intent replay to produce
the exact same ordered patches. Calculated, ambiguous, degenerate, opaque or
stale circles remain fail-closed rather than being assigned guessed semantics.

Tool availability is capability-derived rather than a static menu. Circle input
capacity counts distinct, authorized semantic circle entity IDs whose binding is
either an authoritative managed source record or one directly writable raw
statement with a typed circle definition. The containing managed block binding
is not counted a second time. Consequently one circle can expose one-circle tools
such as point-on-circle and tangent-at-point, while radical-axis is exposed only
when two distinct usable circles are in the authorized closure. Each
Catalog tool also carries an explicit `semanticRevision`; that revision is part
of the Catalog digest so a semantic implementation change invalidates stale
intent proofs even when the public tool ID is unchanged.

Adapter `1.17.0` also derives `kernelHash` and `projectionHash` inside the trusted
projection boundary. The semantic hash covers semantic entities, constraints,
relations, styles and extensions; the projection hash covers current source
bindings, opaque preservation and interactive render primitives. The API
recomputes both and rejects client-provided semantic contexts whose identities do
not match. These values are no longer decorative caller-supplied labels. The
adapter canonicalizes point and element IDs from source names/statement slots
before building GeometryDoc, so UI-only `EntityIdentityRegistry` UUIDs cannot
enter the kernel/projection hashes or binding protocol. The Studio may retain
those UUIDs for legacy selection continuity, but the Broker-replayable semantic
lane is now a pure function of source, revision and plugin set.

#### 2026-08-10 Canvas write and deletion closure checkpoint

- Canvas writes no longer inherit authority from an origin string. Raw
  `canvas` and `style` source patches are rejected at the Broker unless they
  carry an allow-listed typed proposal whose capability is rebuilt against the
  current source revision.
- Free-point moves, circle-parameter drags and solver-driven upstream point
  batches share `canvas-point-move-proposal/v1`. The Broker re-analyzes the
  current source, resolves direct bindings through GeometryDoc, rechecks exact
  parameter/coordinate ranges and regenerates every minimal patch. A derived
  drag also carries the canonical derived entity and its GeometryDoc-computed
  writable ancestor set; a patch to an unrelated free point is rejected even
  when that point has an otherwise valid direct source binding.
- Direct Inspector edits use `inspector-direct-proposal/v1`. The patch must stay
  inside one selected writable entity binding; Broker replay compares semantic
  payloads while deliberately removing only an explicit allow-list of
  projection-only source-location fields. Unknown `range`-like fields remain
  semantic by default instead of being silently ignored. Style
  edits may change only the selected style/presentation fields, while semantic
  edits may change only the selected entity payload.
- Delete roots, dependency closure and owned peers now come from GeometryDoc.
  `depends-on` uses the Catalog ABI `from = dependent`, `to = dependency`.
  Constraint/relation participants are associations, not source owners: only
  explicit entity targets may own deletable source. CST statements only map the
  proven entity closure to ranges. If a range expands to a whole managed block,
  every entity explicitly owned by that block is folded back into the closure
  and downstream dependencies are recomputed before proof generation.

#### 2026-08-10 raw-circle adoption research delta

- The [official path syntax](https://tikz.dev/tikz-paths) documents both the
  legacy `circle (radius)` form and the key-based radius form. Equivalent
  geometry therefore cannot be used as a source identity; adoption remains
  anchored to the current CST/source binding and its verbatim fingerprint.
- The [official intersections documentation](https://tikz.dev/tikz-coordinates)
  distinguishes scoped `name path` identity from a visual path and explains
  that the association is established only after construction. Math GeoHub
  likewise keeps revision-local raw path identity separate from durable managed
  construction identity.
- TikZ Editor's pinned
  [architecture](https://github.com/DominikPeters/tikz-editor/blob/da890d1e834fc69edae3de55308d037c95a7fa71/DEVELOPMENT.md)
  uses lossless parse, semantic evaluation and SVG layers, but its pinned
  [stale-edit analysis](https://github.com/DominikPeters/tikz-editor/blob/d9eb9ca666ee1b54b588311d30b86ec692dea8f8/design/edit-staleness.md)
  shows positional scene IDs can silently retarget after asynchronous source
  edits. This confirms the Broker requirement: revision/hash/range/verbatim
  preconditions are correctness inputs, not optimization hints.
- TikZiT explicitly supports only a TikZ subset and asks users to refresh the
  graph from source after manual edits. Its experience reinforces the decision
  not to present source preservation as universal interactive editability.

Tavily returned the official PGF/TikZ sources above; Exa located the current
TikZ Editor/TikZiT/Penrose implementations. The follow-up Tavily research call
failed at the MCP transport and is recorded as incomplete rather than treated
as evidence.

### P1-B: official inventory and plugin activation

Continue the pinned PGF/TikZ registry as an independent build pipeline:

- deterministic manifest with scanned/unrecognized/dynamic counts;
- immutable content-addressed shards for CDN;
- server-side query index and bounded client/AI slices;
- plugin coordinator with parse/semantic/writer/render/hit-test/AI/exact-policy
  hooks and a computed plugin-set digest.

Registry breadth must not block P0 source correctness, and a registry entry must
report preservation, inventory, semantics, interaction, and exact execution as
separate lanes.

## 5. Gate for claiming triad IO alignment

The architecture is aligned only when the same operation (for example move a
point on a circle, change a segment style, or delete a dependent intersection)
passes all three paths:

1. Code edit -> source transaction -> GeometryDoc -> Canvas/AI;
2. AI typed mutation -> Broker -> minimal source transaction -> Canvas;
3. Canvas typed intent -> Broker -> minimal source transaction -> Code/AI.

All three must produce equivalent kernel hashes, preserve untouched bytes, retain
opaque syntax, keep ordered PGF dispatch, and either preserve presentation or
return a typed conflict. Exact TeX output is separately attested and is not used
to overwrite the interactive or semantic truth.

## 6. Verification boundary

No project tests, builds, lint, typecheck, TeX compilation, Docker, or browser
automation were run for this checkpoint. Regression files are specifications for
the user-owned test pass. Read-only diff and structural inspections are allowed
and recorded separately from runtime acceptance.
