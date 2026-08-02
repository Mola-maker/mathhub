# Typed AI ConstructionPlan lane - independent static review

Review snapshot: 2026-08-02 (the requested evidence filename is retained).

## Decision

- **Verdict: PASS (static review of the typed AI ConstructionPlan lane)**
- **Scope:** `ai-construction-plan-proposal.ts`, `construction-ir.ts`, `managed-construction-recompile.ts`, `ai-context.ts`, `tikz-adapter.ts`, `/api/tikz/route.ts`, `tikz-studio.tsx`, `extract-ai-patch.ts`, the TikZ system prompt, and the final source Broker boundary.
- **Reason:** Broker provenance, server-side binding reconstruction, managed-status capability gating, client/server focus alignment, parser-owned insertion authority, operation/CAS shape validation, external-input read-scope checks, derived-plan evaluator preflight, managed document-reference closure, primitive/rectangle Preview IR validation and actual-writer namespace ownership are all present in the reviewed snapshot. The original `primitive.name` / `result` / `second` / `fourth` shadowing class is closed: the guard now trusted-compiles the plan, analyzes the emitted definitions, rejects duplicates, enforces bidirectional writer-coordinate/semantic-point agreement, and collision-checks the actual writer symbols. Its only private-coordinate exception is now correctly limited to the two plan kinds that call `circumcenterBody`. Raw-circle input resolution and canonical replacement codecs remain fail-closed functional WATCH items, not authority bypasses.
- **Runtime boundary:** no test, build, lint, typecheck, browser, TeX/compiler, or Docker command was run. This is static review only.
- **Worktree boundary:** no product source was changed. This report is the only file owned by this review.

Snapshot SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `lib/tikz/ir/ai-construction-plan-proposal.ts` | `D1FFDE9449F1F1CB6C16D74F8E1FE1F9B5B1222160D30A98BCFFF81AA90A73D0` |
| `lib/tikz/authoring/managed-construction-recompile.ts` | `A4E61F6320AB2378B372B872B2A6FB316EE45A83CD3CCD24E6EC640F3565A01F` |
| `lib/tikz/ir/ai-context.ts` | `D112EBC630FB0BD8547950FE38A10912B98E2D9985782C9DE727366880082386` |
| `lib/tikz/ir/tikz-adapter.ts` | `372AB38192E90E07FC7F1441F65B1EDBBCCDE5868C00F59B17FDC8F9454F1A31` |
| `app/api/tikz/route.ts` | `B8F25EB750817C8932BC5279B482CF49064E8A0260180E9D535E38E14CA2A51B` |
| `components/tikz-studio.tsx` | `1A6615D0A6DE285C647A48AEA09AE126C290856C2EDBC510423D0934DB128D2A` |
| `lib/tikz/server/extract-ai-patch.ts` | `0F5801671A9089A35A7E4DF9C74C434DB0881B2655A1FCAA4F2A46C7D7DF03ED` |
| `lib/tikz/prompt/tikz-system-prompt.ts` | `C615034D72FDD2A7BB1E0427B1192AB7CC072EB0821DCA509C9053437673ECD3` |
| `lib/tikz/transactions/broker.ts` | `F792EE5A38B2DE4D1466667E2509EDABDFFAFAE6753E705C1CCAC8883D0D8389` |
| `lib/tikz/authoring/source-builder.ts` | `EE3B43B323B4683227B066852B362E75EC8BD5177D10C51DB178E1465FC4919E` |
| `lib/tikz/document/tikz-envelope.ts` | `D984C27786065EAA9F39EF6B7D51E672B5D272FA6044786DB6F16AE9A00C00F5` |
| `lib/tikz/authoring/construction-ir.ts` | `1100EC533C675B738552CEEE5FD7DB29B01D4F12C49C1A10CE1DAF2EE53334E4` |

## What passes by static inspection

### Basis, range, fingerprint and CAS

- Typed proposals compare document ID, epoch, revision, source hash/source ID, hash algorithm, kernel hash and plugin-set digest exactly (`lib/tikz/ir/ai-construction-plan-proposal.ts:110-118,419-427`).
- Existing managed replacement checks exact block range, content fingerprint, plan kind, stable construction ID, externally referenced entity identity, and canonical previous-plan reproduction before compiling the replacement (`lib/tikz/authoring/managed-construction-recompile.ts:169-220`). The replacement must reparse as exactly one complete same-ID, same-kind, metadata-valid and integrity-valid block and must not introduce a new document-level managed-reference error (`:221-245`). This is a correct fail-closed identity/style/presentation-loss guard; do not weaken it.
- The generated transaction carries expected revision, source hash, optional kernel/plugin identities, exact read/write source range and source-slice equality (`lib/tikz/ir/ai-construction-plan-proposal.ts:633-680`).
- The client recompiles the returned proposal against its in-memory basis/bindings, applies it to the captured `baseCode`, analyzes the candidate, and commits with captured source/hash/plugin evidence (`components/tikz-studio.tsx:545-630`). The Broker then checks epoch, revision, whole-source identity, optional kernel/plugin identities, exact read/write sets, slice CAS and idempotency (`lib/tikz/transactions/broker.ts:315-575`). A user edit while the stream is open therefore fails closed.

### Raw managed bindings remain read-only in the normal projection

- Ordinary scene/named-path bindings that overlap a managed block are `writable:false` (`lib/tikz/ir/tikz-adapter.ts:1480-1507,1517-1555`).
- Whole managed block and managed-record bindings are also `writable:false`; semantic replacement is represented separately as `writePolicy: managed-recompile-only` (`:1558-1646`). This is the correct model and must not be replaced by setting managed bindings writable.
- `compileAiConstructionPlanProposal()` accepts only a runtime-validated typed `ConstructionPlan`, invokes the trusted writer, and never accepts caller-authored TikZ body text (`lib/tikz/ir/ai-construction-plan-proposal.ts:406-478,569-620`). The writer's unsafe opaque hint remains rejected by the default `compileConstructionPlan()` boundary.

### Dispatch, extraction and syntax lowering

- Extraction accepts only fenced JSON whose top-level schema is either raw-patch v1 or typed-plan v1 (`lib/tikz/server/extract-ai-patch.ts:17-41`). Dispatch keeps the two compilers separate (`lib/tikz/ir/ai-construction-plan-proposal.ts:683-702`).
- Typed create/replace lowers through the same `compileConstructionPlan()` writer as Canvas; replacement reparses the entire generated managed block, and the API analyzes and reprojects the whole candidate Geometry Truth before emitting it (`lib/tikz/authoring/managed-construction-recompile.ts:221-239`; `app/api/tikz/route.ts:141-179`). This is the correct syntax-alignment direction.

## Resolved during this review snapshot

### R1 - Broker now separates raw AI from typed managed replacement

The Broker changed while this review was being written. The latest snapshot passes the full request into `managedPatchConflict()` and, for AI origin, requires `proposalSchemaVersion === 'construction-plan-proposal/v1'` plus a non-empty exact whole-block replacement (`lib/tikz/transactions/broker.ts:182-210,505-517`). Partial AI touches remain rejected (`:212-221`). Because both proposal compilers overwrite `proposalSchemaVersion` after model metadata, a raw `ai-patch-proposal/v1` cannot select typed provenance through the active lowering path.

**Static result:** the original whole-block raw replacement/deletion blocker is closed for the intended compiler -> Broker path. Keep this provenance check and add owner-run regression coverage later; a future managed deletion operation still needs a distinct typed command and dependency policy.

### R2 - The route now rebuilds source bindings and semantic capabilities on the server

The route now analyzes the verified source, reprojects Geometry Truth and builds a new server context before extracting binding authority (`app/api/tikz/route.ts:413-448`). Binding ranges, raw writability, entity ownership and managed write capabilities used by proposal compilation then come from `serverContext`, not the submitted binding objects (`:448-570`). This closes the previous forged raw-binding/server-capability blocker.

### R3 - Invalid/detached managed blocks no longer advertise replace capability

`buildGeometryAiContext()` now requires managed metadata and integrity to both be `valid` before publishing `replace-managed-construction` (`lib/tikz/ir/ai-context.ts:293-315`). The server rebuilt context therefore carries no replacement capability for a detached/invalid block, so the route's attestation scan no longer makes such a read-only block poison the complete request.

The managed summary's descriptive `writePolicy` still says `managed-recompile-only` for some unique invalid blocks (`lib/tikz/ir/tikz-adapter.ts:1390-1417`), while its source binding has no actual capability. This wording mismatch is WATCH only; authority is now the empty `writeCapabilities` array.

### R4 - Client/server focus profile now matches on the active route

The server rebuild now uses the browser's `maxEntities:220`, `maxConstraints:160`, `maxRelations:280`, `maxBindings:220`, `maxOpaqueNodes:96` and `focusDepth:3` profile (`app/api/tikz/route.ts:413-438`; browser at `components/tikz-studio.tsx:476-487`). The exact closure/authorized-scope comparison therefore no longer deterministically rejects depth-3 contexts. Exporting one versioned shared profile instead of duplicating literals remains a drift-prevention WATCH item.

### R5 - Creation binding and lowering now share a parser-owned single-envelope target

Both the lowering and authoritative binding now use `tikzPictureBodyEndOffset()` (`lib/tikz/authoring/source-builder.ts:120-145`; `lib/tikz/ir/tikz-adapter.ts:1650-1682`). The helper rejects parser errors and any source whose parsed `EndTikz` count is not exactly one (`lib/tikz/document/tikz-envelope.ts:8-25`). The nullable adapter guard is now explicit, and whitespace-only source advertises the same full `[0,source.length]` range emitted by typed lowering (`tikz-adapter.ts:1654-1671`; `source-builder.ts:124-134`). This closes the range/nullable/multiple-end mismatch.

Whitespace-only creation still replaces trivia rather than preserving it byte-for-byte. Because the advertised binding and CAS now cover that exact full range, this is no longer an authority/range bug, but it remains a source-fidelity WATCH against the project's untouched-byte preference. A later refinement can insert the complete environment while retaining leading/trailing trivia.

### R6 - Operation discriminant, identity and replacement CAS shape are now runtime-checked

The typed boundary now requires non-empty `operationId`, `bindingId` and `sourceId`, accepts only the two exact operation discriminants, and validates the replacement identity, fingerprint and integer half-open range before casting to the TypeScript union (`lib/tikz/ir/ai-construction-plan-proposal.ts:152-176,406-478`). Plan and previous-plan bodies are then passed through the full `validateConstructionPlan()` runtime validator (`:455-470`). The earlier missing-operation-ID/runtime-cast blocker is closed.

### R7 - Plan inputs are now checked against source existence/read scope and supported derived plans are evaluated

For every declared plan input, the compiler now derives a trusted source range and requires one of the proposal's authorized read bindings to cover that range (`lib/tikz/ir/ai-construction-plan-proposal.ts:179-221,480-493`). The supported derived-plan set is explicit (`:349-366`), and those plans must produce a finite source snapshot and return evaluator status `valid` before lowering (`:368-385,540-568`). This closes the prior ability to satisfy reference closure only by inventing an off-scope input and adds source-neutral degeneracy checks for the listed derived kinds.

### R8 - Candidate creation/replacement now has a document-level managed-reference closure gate

After trusted lowering, the compiler builds the exact candidate source and rejects any newly introduced managed-reference issue (`lib/tikz/ir/ai-construction-plan-proposal.ts:388-399,622-631`). Replacement also retains the recompiler's referenced-entity identity guard and post-reparse document check (`lib/tikz/authoring/managed-construction-recompile.ts:114-158,200-239`). This closes dangling, ambiguous and incompatible `managed:*` dependencies across managed blocks.

### R9 - Primitive and rectangle plans now run the shared Canvas Preview IR validity gate

The typed lane now calls `createConstructionPreviewIR()` for `primitive` and `rectangle-by-opposite-corners`, using the same finite source/inline-point snapshot as the Canvas preview path, and rejects every status other than `valid` (`lib/tikz/ir/ai-construction-plan-proposal.ts:368-385,508-539`). Supported derived kinds continue through the source-neutral evaluator (`:349-366,540-568`). This closes the previously reported zero-length segment, zero-radius circle and collapsed-rectangle gap for a structurally coherent plan.

### R10 - Actual trusted-writer definitions now own the namespace check

`planNamespaceConflictError()` now compiles the typed plan through `compileConstructionPlan()` inside a fail-closed exception boundary, wraps and analyzes the trusted output, collects real coordinate/let-coordinate/intersection and named-path definitions, and rejects duplicate definitions (`lib/tikz/ir/ai-construction-plan-proposal.ts:224-268`). It then requires every emitted coordinate to be represented by a semantic point entity and every semantic point entity to have a matching emitted coordinate (`:269-297`). Finally, it subtracts only the CAS-attested replacement block from the external namespace and checks both model-level records/outputs and the actual writer coordinate/named-path symbols (`:299-346`).

This closes the concrete `primitive.name`, `result`, rectangle `second`/`fourth`, and analogous per-kind writer-field shadowing bypasses: changing such a field now either creates an undeclared writer coordinate, leaves a semantic point without a writer coordinate, creates a duplicate, or places the actual emitted symbol in the collision set.

The four compiler-private coordinates are accepted only when `plan.kind` is `circumcircle` or `cyclic-quadrilateral` (`ai-construction-plan-proposal.ts:274-283`). Those are exactly the two writer branches that call `circumcenterBody()` (`lib/tikz/authoring/construction-ir.ts:1838-1847,1951-1965`), whose complete private set is `mg-${seed}-{m1,m2,q1,q2}` (`:1673-1684`). The other 17 plan kinds receive an empty exception set, so the ordinary-primitive private-name bypass is closed. A semantic point that tries to claim one of the four private names is also rejected by the reverse check (`ai-construction-plan-proposal.ts:291-297`), while all four actual helper symbols remain included in the external collision set (`:334-343`).

Static inspection of all 19 `ConstructionPlan` writer branches found no normal catalog-plan false positive from this invariant: primitive point, rectangle, midpoint/foot, point-on-circle, parallel/perpendicular lines and bisectors, circumcircle/tangent, reflections/transforms/inversion, radical axis, cyclic quadrilateral and complete quadrilateral all emit either declared point coordinates or the exact four kind-scoped circumcenter helpers (`construction-ir.ts:1687-1715,1754-1987`). Non-point primitives emit no coordinate and therefore pass with no declared point entity only when their normal semantic records are coherent.

**Static result:** the sole remaining HIGH from the prior review is closed.

## Remaining blockers

None found by static inspection in the scoped typed AI ConstructionPlan lane.

## Safe-but-incomplete items: keep read-only or WATCH

### W1 - Canonical `previousPlan` guard is correct, but the AI context does not supply a canonical plan or ConstructionPlan schema

The managed summary exposes kind, inputs/outputs, record IDs, source range, content fingerprint and raw semantic records (`lib/tikz/ir/tikz-adapter.ts:1348-1417`). It does not expose a trusted canonical `ConstructionPlan` or a versioned plan schema/capability description. The prompt merely asks the model for “one complete validated ConstructionPlan” and, for replacement, a `previousPlan` (`lib/tikz/prompt/tikz-system-prompt.ts:107-116`). The model is therefore required to reverse-engineer private TypeScript shapes and reconstruct a byte-canonical previous plan from records/source. Many replies will fail closed at the correct style-loss guard.

This is **not a safety vulnerability** because the current canonical comparison rejects guesses. It is a functional false-capability: do not advertise `replace-managed-construction` until the trusted side can provide/derive the canonical previous plan. The safe minimum is typed creation only plus explicit read-only replacement diagnostics.

Follow-up architecture:

1. Add a per-kind managed-plan codec/registry that decodes canonical schema-v2 records to a trusted plan; the proposal should carry only the next typed intent/plan, not ask the model to attest the current plan.
2. Publish a compact versioned ConstructionPlan JSON schema/capability manifest in AI context so create output is executable rather than prompt guesswork.
3. Keep styled/diverged schema-v2 blocks read-only. Schema-v3 Presentation IR/style round-trip is a later WATCH item; never relax the current byte-canonical guard to ship replacement sooner.

### W2 - Extractor returns the first schema-looking fence, not the first fully valid proposal

`extractAiPatchProposal()` returns the first parsed object whose top-level schema guard matches (`lib/tikz/server/extract-ai-patch.ts:26-41`). A malformed illustrative block placed before a valid proposal causes compilation to stop on the malformed first block. The prompt requires exactly one fence, so this is fail-closed and not a safety blocker. Prefer enforcing exactly one recognized proposal fence or returning all recognized candidates and rejecting ambiguity.

### W3 - Focused replacement context can be truncated away independently of bindings

Bindings are focus-prioritized before truncation (`lib/tikz/ir/ai-context.ts:263-274`), while managed summaries are independently truncated in original order (`:279-282`). In a large document, a focused managed binding can advertise replacement while its corresponding semantic-record summary is absent. Prioritize managed summaries by authorized/focused construction ID and expose an explicit omitted-target diagnostic.

### W4 - The trusted plan-input resolver does not recognize raw circle identities

This is fail-closed rather than an unsafe write, but it breaks Canvas/AI feature parity. Canvas plans use a raw circle element's `stableId` as the declared input for `point-on-circle`, `tangent-at-point` and `radical-axis` (`lib/tikz/authoring/construction-catalog.ts:391-440,1022-1058,1209-1269`). The AI resolver recognizes only scene point names and `managed:<block>:<entity>` targets (`lib/tikz/ir/ai-construction-plan-proposal.ts:195-218`); it never indexes `analysis.scene.elements` circle stable IDs. A legitimate AI plan over an authorized raw-circle binding is therefore rejected as absent.

Extend the trusted resolver to return a typed semantic witness, not only a range: point witnesses carry a finite position, circle witnesses carry center/radius plus the owning source binding, and managed witnesses carry record kind/name/provenance. Then both read-scope validation and Preview IR can consume the same resolved dependency graph.

## Three-lane IO matrix

| Direction | Static status | Evidence |
| --- | --- | --- |
| Code -> IR/AI | PASS authority; WATCH wording | adapter projects managed summaries/bindings and replacement capability now requires valid metadata/integrity; descriptive summary policy can still be clearer |
| Code -> Canvas | PASS for the existing interactive projection | source remains the persistent truth; no second writable plan state was introduced |
| Canvas/typed Plan -> Code | PASS foundation | shared writer -> managed block -> source Broker -> `StudioDocument`/CodeMirror |
| AI typed Plan -> Code | PASS authority; WATCH functionality | actual trusted-writer definitions are checked bidirectionally against semantic points and collision-checked outside the owned replacement block; W1/W4 remain fail-closed functional gaps |
| AI raw patch -> managed Code | PASS by static active-path inspection | normal managed bindings are read-only and Broker now requires typed proposal provenance for a non-empty whole-block AI replacement |
| Typed Plan -> Canvas preview | PASS for primitive/rectangle and listed derived plans; WATCH point-on-circle | primitive/rectangle now run shared Preview IR and listed derived plans run the evaluator; point-on-circle remains unsupported |
| Exact TikZ syntax | PASS direction, runtime unverified | typed plan uses the shared writer and replacement reparses atomically; no compiler/test gate was run |

## Required closure order

1. **Retain R1-R10:** typed Broker provenance, server-rebuilt authority, valid/attached capability gating, shared focus profile, parser-owned insertion, operation/CAS shape, input read-scope checks, evaluator/Preview IR, managed reference closure, and trusted-writer definition ownership with kind-scoped private helpers.
2. **Typed raw-circle resolver (W4):** resolve authorized circle stable IDs to source ranges plus finite circle geometry so circle constructions work in both lanes.
3. **Then enable replacement codecs (W1):** canonical schema-v2 decode first; schema-v3 presentation preservation later. Until then, keep replacement explicitly read-only rather than weakening the style-loss guard.

## Final verdict

**PASS for the scoped static review.** The typed lane now derives its namespace write set from the actual trusted writer output, rejects duplicate definitions, enforces coordinate/semantic-point agreement in both directions, and keeps the four circumcenter helpers private only for the two plan kinds that emit them. The previously demonstrated `primitive.name`, `result`, `second` and `fourth` representation-skew bypasses are closed, and no normal catalog-plan false positive was found across the 19 writer kinds by static inspection. Raw-circle support and canonical replacement/schema-v3 presentation remain fail-closed WATCH items. Runtime behavior is deliberately unverified because the owner prohibited tests, build, lint, typecheck, TeX/compiler, Docker and browser execution.
