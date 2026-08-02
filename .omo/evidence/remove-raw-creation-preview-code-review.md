# Remove raw creation preview — code review

Date: 2026-08-01

## Verdict

- **Result:** PASS
- **codeQualityStatus:** WATCH
- **recommendation:** APPROVE
- **blockers:** None
- **reportPath:** `.omo/evidence/remove-raw-creation-preview-code-review.md`

`omo ulw-loop status --json` was unavailable in this workspace (`The syntax of the command is incorrect`), so this report uses the requested fallback evidence path.

## Scope and review boundary

Reviewed only:

- `lib/tikz/render/tools.ts`
- `components/tikz/tikz-canvas.tsx`
- `lib/tikz/authoring/source-builder.ts`

This was a read-only static review of the current worktree. Per product-owner instructions, no tests, build, lint, typecheck, browser automation, TeX compilation, Docker, or network calls were run.

The `remove-ai-slops` and `programming` skills were not present in the available skill catalog, and no matching local `SKILL.md` was found. I therefore applied the criteria stated in the reviewer prompt directly. The diff does not add implementation-mirroring tests, tautological removal tests, untyped escape hatches, brittle prompt assertions, or an unnecessary preview parsing/normalization layer. One non-blocking legacy production export is noted below.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

1. **The legacy raw builder remains exported for compatibility tests.** `authoringLines` is explicitly deprecated and has no production call site, but it remains in the production module solely for `source-builder.test.ts` (`lib/tikz/authoring/source-builder.ts:87-117`). This does not reintroduce the preview path and is not a correctness blocker, but it leaves a small obsolete API surface that should be removed together with the fixture when those tests are migrated to `ConstructionPlan` compilation.

2. **Verification is static only.** The lifecycle and write boundaries are clear in code, but pointer-cancel, tool-switch, step-back, and commit behavior were not exercised dynamically because the product owner prohibited test/browser execution for this review. This is an evidence limitation, not a code defect.

## Verified behavior

### Raw creation source preview and legacy reparse are removed

- `constructionPreview` computes only hit-test-derived overlay data and calls `setConstructionPreview` (`lib/tikz/render/tools.ts:455-538`). It does not construct TikZ source, call `previewPatch` with non-null source, invoke `analyze`, or write document state.
- The only non-null `previewPatch` calls are in the drag paths: derived drag (`lib/tikz/render/tools.ts:335-337`), free-point drag (`lib/tikz/render/tools.ts:1151-1154`), and path-constrained drag (`lib/tikz/render/tools.ts:1176-1187`).
- Canvas source analysis is now explicitly keyed to `dragPreviewCode` (`components/tikz/tikz-canvas.tsx:135-167`). Creation preview state is separate and rendered directly as an SVG overlay (`components/tikz/tikz-canvas.tsx:653-659`, `components/tikz/tikz-canvas.tsx:763-840`).
- Runtime search found no `previewAuthoring` use and no `authoringLines` use in `tools.ts`. `authoringLines` is referenced only by its compatibility test.

### Drag preview remains intact

- `ToolContext.previewPatch` remains documented as the drag-only source-preview lane (`lib/tikz/render/tools.ts:87-89`).
- Drag computation continues to create preview source and clears it through `clearDrag` (`lib/tikz/render/tools.ts:286-305`, `lib/tikz/render/tools.ts:308-367`, `lib/tikz/render/tools.ts:1143-1211`).
- `tikz-canvas.tsx` retains the legacy Scene projection only when `dragPreviewAnalysis` exists; normal/creation rendering stays on the current semantic projection (`components/tikz/tikz-canvas.tsx:152-167`).

### Preview state is cleared at lifecycle boundaries

- General cancellation clears drag state, authoring state, pan state, source preview, construction overlay, and status (`lib/tikz/render/tools.ts:183-193`).
- Creation pointer-down clears any drag source preview and prior construction overlay before using persistent source (`lib/tikz/render/tools.ts:897-921`).
- Commit clears the source preview at entry and clears both authoring/preview states on all handled rejection paths and normal exit (`lib/tikz/render/tools.ts:568-576`, `lib/tikz/render/tools.ts:735-759`, `lib/tikz/render/tools.ts:776-785`, `lib/tikz/render/tools.ts:849-851`).
- Explicit finish clears `previewPatch`; step-back clears both preview lanes; empty step-back delegates to cancellation (`lib/tikz/render/tools.ts:1006-1032`).
- Active-tool or source changes cancel the session and clear both React preview states (`components/tikz/tikz-canvas.tsx:280-285`).

### No pre-commit source/history/network write

- Creation pointer movement and partial anchor selection only mutate ephemeral session anchors/status and replace the React overlay snapshot (`lib/tikz/render/tools.ts:897-1002`).
- `applySourcePatches` is called only at drag commit (`lib/tikz/render/tools.ts:291-299`) and construction commit after plan compilation plus managed-block integrity checks (`lib/tikz/render/tools.ts:761-805`). There is no creation-time network/solver call before that commit boundary.
- The construction transaction keeps the existing expected-revision guard (`lib/tikz/render/tools.ts:801-805`), so stale authoring sessions cannot write over a newer document revision.

## Regression and maintainability assessment

The change is narrowly aligned with the source-as-truth boundary: creation feedback is now ephemeral render state, while drag remains the only temporary source-derived preview lane. The architecture avoids a second parsed Scene for creation and does not introduce an alternate persistence path. No blocking stale-state path was found in the inspected code.
