# Selection Resolution / RenderPrimitive Code Review

## Review scope

- Goal: review the current uncommitted selection-resolution, engine, inspector, RenderPrimitive renderer/hit-test, and deletion integration.
- Primary files:
  - `lib/tikz/authoring/selection-resolution.ts`
  - `components/tikz/use-tikz-engine.ts`
  - `components/tikz/tikz-style-panel.tsx`
  - `components/tikz/tikz-canvas.tsx`
  - `lib/tikz/render/render-primitive-decoder.ts`
  - `lib/tikz/render/render-primitive-hit-test.ts`
  - `lib/tikz/render/render-primitive-svg.tsx`
  - `lib/tikz/render/line-clip.ts`
  - `lib/tikz/render/tools.ts`
  - `lib/tikz/ir/tikz-adapter.ts`
- Constraints observed: no tests, build, lint, typecheck, compiler, or Docker commands were run.
- ULW evidence lookup: `omo ulw-loop status --json` failed on this Windows checkout with `The syntax of the command is incorrect`; no `.omo/evidence/ulw` attempt directory was present, so this report uses the required fallback path.
- Skill-perspective check: `remove-ai-slops` and `programming` were not available in the session skill catalog. Their stated criteria were applied manually. No blocking violation remains. The `programming` perspective still identifies a non-blocking boundary-hardening issue because parsed IDs are directly concatenated into binding IDs, and the `remove-ai-slops` perspective still identifies stale/insufficient tests that do not substantiate the new boundary. No deletion-only, tautological, or needless implementation-mirroring production abstraction was added. Test/typecheck commands were not run because they remain explicitly prohibited.

## Status

- `codeQualityStatus`: **CLEAR**
- `recommendation`: **APPROVE**

## Third re-review — final static disposition

Review date: 2026-07-30. This section supersedes Second re-review HIGH C and MEDIUM M1. No CRITICAL or HIGH finding remains in the requested slice.

### Verified fixes

- Duplicate managed construction IDs are counted document-wide before semantic projection (`lib/tikz/ir/tikz-adapter.ts:525-535`, `1561-1569`). Every duplicate block is excluded from managed semantic/record projection (`lib/tikz/ir/tikz-adapter.ts:609-617`), receives a range-namespaced block binding and the explicit `ambiguous-managed-id-read-only` policy (`lib/tikz/ir/tikz-adapter.ts:537-543`, `1311-1347`), and exposes an error diagnostic plus AI-facing `idAmbiguous`/`writePolicy` state (`lib/tikz/ir/tikz-adapter.ts:1062-1088`, `1091-1143`).
- Scene/CST and named-path bindings inside an ambiguous block remain non-writable and carry the same ambiguity policy (`lib/tikz/ir/tikz-adapter.ts:1194-1247`, `1250-1294`). This prevents the ordinary parsed TikZ lane from bypassing managed-ID quarantine.
- The managed style recompiler now filters all matching blocks and rejects every non-unique construction ID before considering a body patch (`lib/tikz/authoring/managed-construction-recompile.ts:22-40`). The previous wrong-first-block write path is closed.
- Output record bindings are now registered as extra bindings on their resolved entities (`lib/tikz/ir/tikz-adapter.ts:588-594`, `992-1004`) and are merged into both source-matched and semantic-only entity bindings (`lib/tikz/ir/tikz-adapter.ts:1570-1627`). Render primitives inherit those entity bindings through the already-reviewed RenderPrimitive projection.
- The supplied browser report exists at `.omo/evidence/selection-resolution-browser-verification.md` and records two consecutive whole-block managed style recompiles with unchanged entity/RenderPrimitive IDs, record binding visibility, ordinary relation direction, and a fresh local load. This reviewer inspected the artifact but did not rerun the browser scenario.

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M3. Parsed external IDs are still concatenated into binding IDs without collision-safe encoding

`managedBlockBindingId` and `managedRecordBindingId` build structural identities by concatenating raw construction/record IDs with colon-delimited markers (`lib/tikz/ir/tikz-adapter.ts:537-552`). Generated plans validate TikZ-safe names, but the lossless managed parser accepts any non-whitespace header ID and any non-empty JSON record ID (`lib/tikz/semantics/managed-construction.ts:84-115`, `130-134`, `417-456`). Carefully chosen distinct external IDs can therefore produce the same binding string.

The repaired duplicate-ID path and ordinary stable entity binding make this fail closed for current visual Inspector writes, so this is no longer a release blocker. It remains unnecessary identity ambiguity at an input boundary. Encode each component injectively (for example, length-prefix/JSON tuple/hash with canonical source components), or validate imported IDs against the same safe-name contract before issuing writable managed bindings.

#### M4. Automated boundary coverage remains absent

No focused tests cover duplicate construction quarantine, recompiler non-unique rejection, output-binding propagation, unique/tied recovery, or whole-block stable identity. Existing identity tests still cover only prefix edits and point rename, while the style-panel fixture remains stale (`lib/tikz/document/entity-identity.test.ts:19-47`, `components/tikz/tikz-style-panel.test.tsx:7-38`). This is recorded as a maintenance/evidence weakness, not a blocker, because the user explicitly retained test execution and the supplied browser artifact covers the primary happy path.

### LOW

- The previously recorded angle/right-angle renderer versus hit-test geometry mismatch remains outside these fixes.
- Consider incrementing `TIKZ_SEMANTIC_ADAPTER_VERSION` before release so cached/pending artifacts cannot treat the changed binding and ambiguity semantics as the same plugin contract (`lib/tikz/ir/tikz-adapter.ts:33-36`).

### Third re-review blockers

None.

## Second re-review — current disposition

Review date: 2026-07-30. This section supersedes the preceding re-review's HIGH A and HIGH B findings, but one new HIGH correctness issue remains.

### Verified fixes

- Previous HIGH A is **resolved for a document with unique managed construction IDs**. Element semantic identity now excludes statement spelling and style while retaining kind, statement-local ordinal, topology and refs (`lib/tikz/document/entity-identity.ts:58-99`). Selection recovery admits only bindings with exactly one entity target, rejects a tied best candidate, prefers the recovered current primitive's entity, and no longer reuses an unrevisioned old entity/statement range (`lib/tikz/authoring/selection-resolution.ts:212-244`, `373-413`).
- Previous HIGH B is **resolved**. `construction-dependency` now partitions participants using the IR `inputs`/`outputs` counts: outputs receive input ancestors, inputs receive output descendants, and peer inputs are not classified as ancestors (`components/tikz/tikz-style-panel.tsx:722-763`). Ordinary `depends-on` still handles both canonical `dependent`/`dependency` and compatibility `from`/`to` roles (`components/tikz/tikz-style-panel.tsx:764-787`).
- Managed entity, constraint and relation records receive record-level binding IDs and those IDs are propagated through the corresponding IR records (`lib/tikz/ir/tikz-adapter.ts:769-833`, `836-946`). Render primitives now inherit an entity's current source bindings (`lib/tikz/ir/tikz-adapter.ts:1393-1416`).

### CRITICAL

None.

### HIGH C. “Unique” managed record bindings are not document-unique, so selecting one duplicated construction can rewrite another

`parseManagedConstructionBlocks` accepts every block independently and never rejects or quarantines a duplicate construction `id` (`lib/tikz/semantics/managed-construction.ts:544-656`). The new record identity is only the string concatenation of construction ID, record type and record ID (`lib/tikz/ir/tikz-adapter.ts:525-530`), and the projection stores targets in maps keyed by those values (`lib/tikz/ir/tikz-adapter.ts:557-564`, `769-779`, `968`). Two pasted/imported managed blocks with the same header ID therefore emit duplicate block binding IDs and duplicate record binding IDs; later entries overwrite earlier target-map entries, while `managedBindingsOf` still emits duplicate binding records.

This is not only a diagnostic-quality concern. The Inspector reduces the selected record bindings back to `managedConstructionId`, then the recompiler locates the block with `.find(candidate.id === constructionId)` (`lib/tikz/authoring/managed-construction-recompile.ts:22-29`; caller at `components/tikz/use-tikz-engine.ts:571-580`). Selecting a style in the second duplicate block can consequently rewrite and reseal the first block. It also invalidates the premise used by `primitiveByUniqueSourceBinding`: `targets.length === 1` does not make a binding unique if the binding ID itself occurs more than once in construction truth.

The application allocator normally creates document-unique IDs, but this editor accepts user/AI-authored and pasted source, so generated-source discipline is not a sufficient boundary contract. Required fix: enforce document-wide managed construction ID uniqueness before projecting writable bindings (duplicate blocks should be diagnostic/read-only), and make binding IDs collision-safe for parsed external record IDs. The recompiler must resolve one attested source range/block identity, not use first-match lookup by an unchecked ID.

### MEDIUM

#### M1. Output record bindings target an entity but are not propagated to that entity or its RenderPrimitive

The output branch creates a record binding target (`lib/tikz/ir/tikz-adapter.ts:954-965`), but unlike the entity branch it does not append that binding ID to the referenced entity overlay/source bindings (`lib/tikz/ir/tikz-adapter.ts:782-821`). Since RenderPrimitive bindings are copied from `entity.sourceBindingIds` (`lib/tikz/ir/tikz-adapter.ts:1398-1406`), the output-record binding is absent from the corresponding selectable primitive. Current catalog outputs generally also have an entity record, so entity-record recovery still works, but the stated “each output record is attached to the corresponding entity/RenderPrimitive” contract is not implemented.

Required fix: either propagate output binding IDs into the resolved entity/primitive or narrow and document the contract so output bindings are construction-only reverse references rather than selectable identity bindings.

#### M2. Static test evidence still does not cover the repaired boundary

`lib/tikz/document/entity-identity.test.ts:19-47` covers prefix edits and a point rename only; it does not cover the whole-managed-block replacement that motivated the identity change. There is no focused selection-resolution test for unique/tied binding recovery, stale-range refusal, duplicate construction identity, or current-primitive precedence. The existing style-panel fixtures and copy assertions remain stale (`components/tikz/tikz-style-panel.test.tsx:7-38`). Under the manual `remove-ai-slops`/`programming` pass, these tests are not useful evidence for the new boundary.

The parent report stated that browser verification proved stable IDs across two recompiles, but supplied no evidence artifact path for independent review. No browser or automated validation was run by this reviewer.

### LOW

- The previously recorded angle/right-angle renderer versus hit-test geometry mismatch remains outside these fixes.

### Second re-review blockers

1. Reject/quarantine duplicate document-level managed construction IDs before producing writable block/record bindings, and recompile by one attested block/range rather than unchecked first ID match.
2. Provide the claimed browser evidence artifact path, or withdraw that claim from completion evidence. This does not replace the static correctness fix above.

## Re-review — current findings

Review date: 2026-07-30. This section supersedes the initial HIGH #1/#2 and MEDIUM #3/#5 status below.

### Fix-status matrix

- Initial HIGH #1, managed write policy: **partially resolved**. Binding writability, basis/hash attestation, direct/read-only/managed-recompile capability, and semantic-property refusal are now implemented (`lib/tikz/authoring/selection-resolution.ts:196-295`, `components/tikz/use-tikz-engine.ts:523-600`). Managed style changes renew the fingerprint atomically, but the chosen whole-block patch introduces the new HIGH selection-recovery defect below.
- Initial HIGH #2, ordinary `depends-on`: **resolved for `dependent`/`dependency` and `from`/`to` roles** (`components/tikz/tikz-style-panel.tsx:722-755`). Managed `construction-dependency` direction remains unresolved, as described below.
- Initial MEDIUM #3, statement revision attestation: **resolved**. The engine supplies the semantic statement revision and a current document/epoch/revision/source-hash basis, and statement lookup is disabled unless the revisions match (`components/tikz/use-tikz-engine.ts:288-311`, `lib/tikz/authoring/selection-resolution.ts:196-210`, `390-394`).
- Initial MEDIUM #5, renderer identity selection: **resolved for a single resolved target**. Primitive/entity IDs are passed to the committed renderer and take precedence over statement/ref fallback (`components/tikz/tikz-canvas.tsx:503-522`, `lib/tikz/render/render-primitive-svg.tsx:15-39`, `315-398`).

### HIGH A. Whole-block managed style rewrite can recover and normalize selection to the wrong primitive

`managedStyleRecompilePatches` correctly recomputes the fingerprint, but returns one patch replacing the entire managed block (`lib/tikz/authoring/managed-construction-recompile.ts:53-110`). `EntityIdentityRegistry` includes the full statement text in an element's semantic key, so the selected element loses its exact identity match after a style change (`lib/tikz/document/entity-identity.ts:58-83`, `116-124`). Mapping an old statement range through an enclosing whole-block replacement collapses that range to the replacement block bounds (`lib/tikz/document/entity-identity.ts:22-50`); for realistic blocks with more than 128 characters outside the selected statement, the nearest-identity fallback is rejected (`lib/tikz/document/entity-identity.ts:126-140`). The modified element can therefore receive a new stable/render ID.

The resolver then falls back to any primitive that shares one of the target's source bindings (`lib/tikz/authoring/selection-resolution.ts:334-350`). Every primitive in the construction shares `binding:managed:<block-id>`, so `.find` can select the first primitive in the block rather than the previously selected one. It also gives the stale target semantic ID precedence over the recovered primitive ID (`lib/tikz/authoring/selection-resolution.ts:353-361`). The normalization effect persists that guessed primitive/stable/range back into the selection target (`components/tikz/use-tikz-engine.ts:312-378`), and deletion consumes the normalized stable ID/statement (`components/tikz/use-tikz-engine.ts:685-713`). A style edit can therefore leave the Inspector pointing at, and later delete, a different construction element.

Required fix: keep the transaction atomic but commit two non-overlapping minimal patches (the original body style patch and the fingerprint field patch), so identity range mapping remains local. Independently, selection recovery must use a unique per-record/per-entity identity; a block-wide managed binding must never be accepted as a unique primitive match. When a prior semantic ID no longer exists, prefer the uniquely recovered primitive entity ID rather than retaining the stale ID.

### HIGH B. Managed `construction-dependency` still reports input/output direction incorrectly

The ordinary `depends-on` role mismatch is fixed. However, managed construction relations use kind `construction-dependency` and concatenate named input roles followed by output roles (`lib/tikz/ir/tikz-adapter.ts:376-391`, `613-628`). `RelationsPanel` only applies directed logic when `kind === 'depends-on'`; every managed relation still falls through to the generic branch that puts all other participants in `ancestors` (`components/tikz/tikz-style-panel.tsx:740-761`).

For a midpoint construction, selecting an input point consequently reports the output midpoint as upstream, and can also report peer inputs as upstream. This remains false Geometry IR interpretation for the project's principal managed construction path.

Required fix: encode or derive explicit input/output participant direction for `construction-dependency`. Selecting an output should show inputs upstream; selecting an input should show outputs downstream, while peer inputs should not be classified as ancestors.

### Re-review blockers

1. Replace ambiguous whole-block managed selection recovery with minimal atomic patches and unique identity matching.
2. Correct managed `construction-dependency` input/output direction in RelationsPanel.

## Initial review snapshot

The findings below preserve the first-pass evidence. Initial HIGH #1, ordinary portion of HIGH #2, MEDIUM #3, and MEDIUM #5 have the updated status recorded in the re-review matrix above.

## CRITICAL

None.

## HIGH

### 1. Inspector writes through bindings explicitly marked non-writable

The adapter marks every source binding inside a managed `@mathgeo` construction as `writable: false` with `writePolicy: 'managed-recompile-only'` (`lib/tikz/ir/tikz-adapter.ts:1089-1114`, `1162-1203`). `resolveInspectorSelection` only returns binding IDs, not the resolved `ConstructionBinding` records or a derived write capability (`lib/tikz/authoring/selection-resolution.ts:265-273`). The coordinate, label, anchor, style, and raw-options editors then call `applySourcePatch` directly whenever the global projection gate is writable (`components/tikz/tikz-style-panel.tsx:126-139`, `190-235`, `359-389`, `420-440`).

This permits a user to select generated TikZ inside a managed construction and mutate its body without recompiling/updating the managed semantic record and content fingerprint. The next projection classifies the metadata as detached and drops authoritative managed records (`lib/tikz/semantics/managed-construction.ts:600-625`, `lib/tikz/ir/tikz-adapter.ts:570-587`). It therefore breaks the construction/semantic identity that the new selection layer is meant to protect.

Required fix: resolve `sourceBindingIds` against the current construction truth, attest their document/epoch/revision/range, and expose an explicit write plan/capability. Direct property patches must be disabled for any non-writable or `managed-recompile-only` binding; managed edits must go through the managed construction transaction/recompiler.

### 2. RelationsPanel interprets ordinary Geometry IR dependency roles incorrectly

The normal TikZ adapter emits `depends-on` relations with participant roles `dependent` and `dependency` (`lib/tikz/ir/tikz-adapter.ts:164-179`). `RelationsPanel` only applies directed ancestor/descendant logic to roles named `from` and `to` (`components/tikz/tikz-style-panel.tsx:650-677`). The ordinary relations therefore fall through to the generic branch, which adds every other participant to `ancestors` (`components/tikz/tikz-style-panel.tsx:678-683`).

For example, if `M` depends on `A`, selecting `A` reports `M` as an upstream ancestor instead of a downstream descendant. Because a semantic entity and IR are present, the correct legacy Scene fallback is never used (`components/tikz/tikz-style-panel.tsx:641-698`). This makes the Inspector's Geometry IR view semantically false and can mislead users about cascade deletion and construction direction.

Required fix: define one canonical direction/role contract for dependency relations and consume it consistently. The panel should also handle managed `construction-dependency` input/output roles rather than treating every participant as upstream.

## MEDIUM

### 3. Statement range validation is not actually revision-attested

`resolveInspectorSelection` rejects stale `GeometryTruthSet` records by comparing the truth revision with `sourceRevision`, but `statements` carries no basis/revision (`lib/tikz/authoring/selection-resolution.ts:176-195`). `useTikzEngine` passes `semanticProjection?.stmts`, which may be the last usable stale projection, while passing the current document revision (`components/tikz/use-tikz-engine.ts:263-275`). `statementResolution` can then exact-match a stale target range against a stale statement and set `statementRangeValidated: true` (`lib/tikz/authoring/selection-resolution.ts:95-145`).

The current panel's global `interactiveWritebackSafe` guard prevents an immediate bad write in the stale-parse case, so this is not elevated to HIGH. However, the public resolution object falsely claims a same-revision source proof and is unsafe for future callers.

Required fix: pass the statement projection basis/revision into the resolver and require document ID, epoch, revision, source ID/hash, plus the exact range/slice proof before setting `statementRangeValidated`.

### 4. Multi-selection is a label/ref fallback, not a resolved semantic selection

For more than one target, `emptyResolution('multiple')` discards every semantic entity, render primitive, source binding, source range, and statement (`lib/tikz/authoring/selection-resolution.ts:154-173`, `186-190`). `RelationsPanel` then falls back to treating the union of display refs as Scene point names (`components/tikz/tikz-style-panel.tsx:699-737`). A multi-selection of lines/circles therefore reports relationships for their referenced points, not for the selected entities. Canvas selection also always replaces the target array and has no Shift/Ctrl additive path (`lib/tikz/render/tools.ts:835-909`).

Required fix: model multi-selection as a revision-bound array of per-target resolutions and derive common/mixed Inspector properties from those records. Add explicit additive/toggle selection behavior if multi-selection is part of the intended UI.

### 5. RenderPrimitive identity is resolved but not used to paint selection

The hit-test captures `renderPrimitiveId` and `semanticEntityId`, and the inspector retains them (`components/tikz/tikz-canvas.tsx:318-339`, `lib/tikz/authoring/selection-resolution.ts:211-232`). The renderer receives only display refs plus `selectedStmtIndex` (`components/tikz/tikz-canvas.tsx:503-512`). `primitiveSelected` consequently selects every primitive sharing that statement before considering refs (`lib/tikz/render/render-primitive-svg.tsx:15-30`).

For a TikZ path statement that projects to multiple render primitives, clicking one primitive visually selects all of them even though the inspector resolves one primitive/entity. This makes the new identity separation observable only in metadata, not in Canvas behavior.

Required fix: pass selected semantic entity/render primitive IDs to the renderer and make them primary. Statement-level highlighting should be an explicit source-granularity overlay, not the sole committed-geometry selection state.

### 6. Existing tests neither cover the new boundary nor remain valid fixtures

There are no tests for `resolveInspectorSelection`, RenderPrimitive decoding/clipping/hit-testing, managed-binding write refusal, multi-selection, or IR relation direction. In addition, `components/tikz/tikz-style-panel.test.tsx:8-16` and `23-31` still pass partial engine objects without `selection`, `selectionTargets`, `inspectorSelection`, projection state, or deletion functions. The component unconditionally reads `engine.selection.length` and `engine.selectionTargets.length` (`components/tikz/tikz-style-panel.tsx:834-840`, `921-963`), so these fixtures cannot exercise the current component and are statically inconsistent with `TikzEngine`.

The assertions also expect superseded copy and only mirror one generated patch shape (`components/tikz/tikz-style-panel.test.tsx:17`, `33-38`), providing false confidence rather than coverage of the new selection contract.

Required fix: replace partial ad-hoc engine literals with a typed fixture builder and add boundary-focused tests for current/stale basis, exact/mismatched ranges, managed binding writability, single/multiple entity selection, relation direction, primitive identity, clipping, and source-safe deletion.

## LOW

### 7. Angle/right-angle hit testing does not match the rendered path

The renderer draws an angle arc over only the actual angular span and a right-angle mark as two 12-pixel segments (`lib/tikz/render/svg-decoration-primitives.tsx:54-102`). Hit testing instead treats both as the full circle at radius 16 (`lib/tikz/render/render-primitive-hit-test.ts:132-134`). It creates false-positive selectable regions and misses parts of the right-angle glyph.

Required fix: share explicit angle/right-angle geometry between renderer and hit tester, just as line/ray clipping is already shared.

## Blockers

Superseded by **Re-review blockers** above.

## Evidence boundary

This is a static review only. No automated or browser validation was claimed. The worktree is very large and dirty; findings are limited to the requested selection/Inspector/RenderPrimitive slice.
