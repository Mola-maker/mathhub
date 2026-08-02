# AI - Canvas - Code bidirectional IO review (2026-08-01)

## Scope and verification boundary

- Read-only audit of the current AI comprehension/context/proposal path, Canvas `ConstructionPlan`/Preview IR path, CodeMirror/`StudioDocument` source transaction path, and managed-construction bindings.
- No product source file was changed. This evidence file is the only file written by this review.
- Per project rule, no test, build, lint, typecheck, compiler, Docker, or browser command was run.

## Executive finding

The current architecture already has one correct persistence invariant: **TikZ source is the only writable document and every accepted Canvas/AI write eventually reaches `StudioDocument`, which dispatches a CodeMirror transaction when the editor is attached** (`lib/tikz/document/studio-document.ts:188-227`; editor feedback returns through `components/tikz/tikz-code-panel.tsx:156-175`).

The three lanes are not yet fully symmetric:

1. **Code -> Kernel/Canvas is real:** CodeMirror records exact UTF-16 changes, commits them to `StudioDocument`, and the engine reprojects revision-bound truth.
2. **Canvas -> Code is typed for creation:** Canvas builds one immutable `ConstructionPlan`, derives Preview IR from that plan, compiles it to a fingerprinted managed block, and commits the source patch (`lib/tikz/authoring/preview-ir.ts:13-19,178-186`; `lib/tikz/render/tools.ts:861-897,924-968`).
3. **AI -> Code is source-patch-only:** AI receives semantic/context truth, but its only write contract is `ai-patch-proposal/v1`, which lowers raw insert/replace/delete ranges to `source-patch` (`lib/tikz/ir/ai-patch-proposal.ts:13-20,651-709`; `components/tikz-studio.tsx:545-620`). It cannot currently emit the same typed `ConstructionPlan` that Canvas previews and commits.

Therefore the read/comprehension side is substantially aligned, while the write side is only aligned at the final source transaction, not at the semantic command/plan layer.

## What is already sound

### Revision-bound comprehension

- The AI context contains revision/hash/source identity, semantic projection status, entities, constraints, relations, focus closure, source bindings, opaque barriers, and managed-construction summaries (`lib/tikz/ir/ai-context.ts:32-112,340-427`).
- Managed source records are projected into semantic entities/constraints/relations, and managed summaries include plan kind, typed input/output roles, status and issue codes (`lib/tikz/ir/tikz-adapter.ts:1348-1414,1959-1983`). This is enough for AI to *understand* most currently managed construction truth without treating TikZ text as the semantic model.
- The context derives `authorizedBindingIds` from a trusted focus closure plus writable bindings (`lib/tikz/ir/ai-context.ts:256-320`). The proposal validator enforces basis equality, closed binding scope, exact range containment, CAS guards, non-overlap, insertion policy, `writable=true`, and `opaque=false` (`lib/tikz/ir/ai-patch-proposal.ts:387-620`).
- The broker adds the final revision, epoch, source hash, kernel hash, plugin digest, exact read/write-set, expected-text, managed-block, idempotency and CodeMirror-backed commit checks (`lib/tikz/transactions/broker.ts:290-378,380-520`).

### Canvas plan/preview/commit identity

- `ConstructionPlan` is renderer/source-language neutral and already covers primitive and advanced competition constructions (`lib/tikz/authoring/construction-ir.ts:18-57,341-518`).
- `validateConstructionPlan` checks base shape, kind definition and reference closure before compilation (`lib/tikz/authoring/construction-ir.ts:1577-1599`).
- `compileConstructionPlan` is the trusted TikZ writer: it rejects unsafe opaque hints by default, generates semantic records, fingerprints metadata plus TikZ body, and returns one managed block (`lib/tikz/authoring/construction-ir.ts:2056-2108`; fingerprint/serialization at `lib/tikz/semantics/managed-construction.ts:1145-1199`).
- Preview IR deliberately consumes that same immutable plan and does not parse or mutate source (`lib/tikz/authoring/preview-ir.ts:13-19,178-186`).

### CodeMirror remains the document boundary

- External commits call `StudioDocument.applyPatches`; when CodeMirror is mounted, it dispatches the exact patch plus origin/transaction metadata to the editor (`lib/tikz/document/studio-document.ts:188-227`).
- The editor listener sends the actual CodeMirror change set, origin, CST and metadata back into `StudioDocument` (`components/tikz/tikz-code-panel.tsx:156-175`). This avoids a second independently writable React/Canvas document.

## Root cause of managed `writable:false`

`writable:false` is intentional and correct for the current **raw source patch** capability; it is not evidence that managed objects should remain permanently uneditable.

1. Raw statement and named-path bindings become non-writable whenever their source range is owned by a managed block (`lib/tikz/ir/tikz-adapter.ts:1476-1503,1507-1550`).
2. Both whole managed-block bindings and per-record semantic bindings are always `writable:false`, and advertise `writePolicy: managed-recompile-only` (`lib/tikz/ir/tikz-adapter.ts:1554-1641`). Per-record bindings currently point to the same whole-block range, so they are semantic selectors, not safe byte ranges.
3. Selection resolution correctly turns a coherent set of those bindings into `mode: managed-recompile`, not `direct` (`lib/tikz/authoring/selection-resolution.ts:287-327`).
4. The only implemented managed recompiler is style-only. Geometry/label changes are explicitly deferred because semantic records and body must change atomically (`lib/tikz/authoring/managed-construction-recompile.ts:14-25`; `components/tikz/use-tikz-engine.ts:523-593`).
5. AI proposal validation requires the selected binding itself to be `writable=true` (`lib/tikz/ir/ai-patch-proposal.ts:522-533`), so managed bindings can never enter the current AI write set.
6. The broker already permits a whole managed block replacement when the replacement parses as exactly one same-ID, metadata-valid, integrity-valid block (`lib/tikz/transactions/broker.ts:157-177,188-210`). What is missing is the typed plan compiler that produces such a replacement for AI/Canvas semantic edits.

**Conclusion:** do not flip managed bindings to `writable:true`. That would incorrectly authorize arbitrary byte edits over fingerprinted metadata/body. Add a capability distinct from raw writability.

## Safe binding granularity

Use two orthogonal fields in the AI/kernel context:

- `rawWritable: boolean` (the current `writable` meaning; retain for compatibility).
- `writeCapabilities: readonly ManagedWriteCapability[]` where capability is derived by trusted projection, never supplied as authority by the model.

Safe values now:

| Binding | Raw patch | Typed capability safe now | Preconditions |
|---|---:|---|---|
| Ordinary non-managed statement/CST binding | yes | `source-patch` | current revision/hash/range/CAS; no opaque barrier |
| `binding:document:tikzpicture-body-end` | insertion only | `create-managed-construction` | current insertion policy; unique construction ID; validated plan; generated block reparses valid |
| Whole managed block | no | `replace-managed-construction` | unique ID; schema v2; metadata and integrity valid; same construction ID; full-block CAS/fingerprint; locally compiled replacement |
| Managed record binding | no | read/selection only in this tranche | record bindings share the whole block byte range and there is no records-to-plan hydrator/mutation registry yet |
| Managed TikZ body style target | no raw AI patch | `recompile-style` only | reuse the existing style whitelist/reseal path; do not expose arbitrary body text |
| Ambiguous, detached, invalid, unsupported, opaque/scope-barrier binding | no | none | fail closed |

The key is that “field-level semantic target” and “byte-range write authority” are different things. Per-record bindings can identify AI intent, but the trusted compiler must own the only full-block source replacement.

## Minimum typed command envelope safe to implement in this tranche

Add a small `construction-plan-proposal/v1` (or equivalently named `construction-plan-patch/v1`) alongside, not inside, the raw `ai-patch-proposal/v1` protocol:

```ts
interface ConstructionPlanProposalV1 {
  schemaVersion: 'construction-plan-proposal/v1';
  proposalId: string;
  idempotencyKey: string;
  basis: AiPatchProposalBasis;
  readBindingIds: readonly string[];
  operations: readonly (
    | {
        operationId: string;
        kind: 'create-managed-construction';
        bindingId: 'binding:document:tikzpicture-body-end';
        insertionPolicy: 'tikzpicture-body' | 'full-document';
        plan: ConstructionPlan;
      }
    | {
        operationId: string;
        kind: 'replace-managed-construction';
        bindingId: string;
        constructionId: string;
        expectedContentFingerprint: string;
        plan: ConstructionPlan;
      }
  )[];
}
```

Keep this MVP deliberately coarse: creation or complete managed-plan replacement, never arbitrary JSON Pointer mutations and never AI-authored TikZ body text.

### Trusted compiler/lowering rules

1. Recompute/lookup the binding from the current source projection; do not trust client/model `writable` or capability flags.
2. Check the same document/epoch/revision/sourceHash/kernelHash/plugin digest/idempotency guards used by the current AI patch path.
3. Require `validateConstructionPlan(plan)` to pass and reject any `sourceWriterHint` for AI-origin plans, including even the opt-in opaque escape hatch.
4. Resolve every plan input against the current focus/read closure. New plan-owned entity IDs may only be referenced after declaration inside that plan.
5. Create: require the trusted document insertion binding and a construction ID absent from all managed blocks.
6. Replace: require exactly one matching valid/attached block, `plan.id === constructionId`, exact content fingerprint and full source range. Preserve the ID so broker whole-block validation remains effective.
7. Run `createConstructionPreviewIR(plan, currentPointSnapshot)` and reject `invalid`/`unsupported` before offering preview. This gives AI and Canvas the same visible semantics.
8. Run local `compileConstructionPlan(plan)`, parse the generated text, and require exactly one same-ID valid/integrity-valid managed block.
9. Lower to exactly one `source-patch` at the insertion point or whole block range, with exact expected source text. Commit through `TikzTransactionBroker`, hence through `StudioDocument` and CodeMirror.
10. Reproject after commit and require the expected managed construction ID and outputs to bind; otherwise report a diagnostic rather than inventing Canvas state.

This command compiler should be called by both AI and Canvas. Canvas currently performs the equivalent compilation directly in `lib/tikz/render/tools.ts:861-968`; moving that lowering behind one shared compiler is the smallest step that makes AI/Canvas/Code share the same semantic write lane.

## Existing IO abstraction gap

`geometry-io/v1` already defines AI/Canvas/source envelopes, but only offers generic intent, projection request and `GeometryTransactionRequest` payloads (`lib/tikz/ir/io.ts:20-128`). Repository references show these envelope types are not used by the active Studio routes/components; they are only mentioned by the optional plugin interface (`lib/tikz/ir/plugin.ts:26-51`). Likewise, the transaction schema declares add/update/remove/relate/constrain operations (`lib/tikz/ir/transactions.ts:112-172`), but the active broker rejects every operation that has not already been lowered to `source-patch` (`lib/tikz/transactions/broker.ts:422-430`).

For this tranche, extend `AiInputPayload` and `CanvasInputPayload` with the same typed construction proposal and route both through one `ConstructionPlanCommandCompiler`. Do not attempt a broad event bus/runtime rewrite first.

## Server/client authority note

The ECS API recomputes the source digest, but it currently accepts client-supplied semantic-kernel binding ranges and writable flags after shape checks (`app/api/tikz/route.ts:234-278,330-367,387-435`). The browser then compiles the returned proposal again against its genuine in-memory kernel before committing (`components/tikz-studio.tsx:545-620`), so the current API response is a proposal, not server-side document authority.

If the ECS service later becomes an authoritative transaction issuer or persists collaborative sessions, it must reproject bindings/capabilities from the submitted source snapshot server-side. The typed plan compiler must not authorize a managed replacement using client-supplied `writeCapabilities` alone.

## Capabilities that must be deferred

1. **Arbitrary field-level managed record patching.** There is no general `ManagedConstructionBlock -> ConstructionPlan` hydrator, and records do not by themselves constitute a stable writer AST for every plan kind. Implement per-kind hydrate/mutate/validate handlers before enabling record JSON Pointer edits.
2. **Renaming outputs/inputs across constructions.** This needs document-wide persistent-reference rewrite, collision handling, dependency closure and provenance migration, not one block replacement.
3. **Dragging or assigning a derived output directly.** The solver must patch upstream drivers; freezing a derived coordinate would violate source/constraint truth.
4. **Editing opaque/macros/full PGF execution as Canvas semantics.** Preserve exact source and compile it in the exact TeX lane; only promote a construct after a plugin supplies syntax, semantic, preview, hit-test and reverse-write behavior.
5. **Generic semantic `add/update/remove/relate/constrain` broker execution.** Those operations need plugin-owned lowering and conflict/precondition semantics. The current source broker correctly refuses them until lowered.
6. **Treating `geometry-io/v1` declarations as a functioning mediator.** A concrete coordinator/command compiler and runtime integration are still required.

## Recommended implementation order

1. Add typed binding capabilities without changing existing `writable` values.
2. Implement `construction-plan-proposal/v1` create + whole-block replace compiler with the rules above.
3. Make Canvas creation and AI creation/modification call that same compiler; keep raw AI patch for ordinary unmanaged source and repairs only.
4. Add typed proposal/preview/result variants to `geometry-io/v1` and wire the active Studio path, not only plugin types.
5. Add per-kind plan hydration and whitelisted mutation handlers, then progressively expose record-level capabilities.
6. Only after the typed command lane is stable, add collaborative/event-sourced persistence or a broader semantic transaction coordinator.

## Review verdict

**WATCH / architecture-safe foundation, incomplete three-way write symmetry.**

- Keep source-as-truth, Preview IR, managed fingerprints, revision/hash guards and CodeMirror transaction dispatch.
- Do not change managed `writable:false` to true.
- The highest-value safe next change is one typed, plan-level create/replace command compiler shared by AI and Canvas, lowered atomically to the existing source broker.
