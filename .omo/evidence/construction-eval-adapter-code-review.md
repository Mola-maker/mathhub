# Construction evaluator adapter code review

## Decision

- **Review verdict:** PASS
- **codeQualityStatus:** WATCH
- **recommendation:** APPROVE
- **Review mode:** read-only source/diff inspection. Per the task constraint, I did **not** run tests, build, lint, typecheck, browser, TeX, or Docker.
- **Reviewed surface:** `lib/tikz/authoring/construction-eval.ts`, `lib/tikz/authoring/preview-ir.ts`, `lib/tikz/render/tools.ts`, the current `construction-ir.ts` / `construction-catalog.ts` contracts, and the directly relevant `lib/tikz/render/tools.test.ts` fixture.

## Findings

### CRITICAL

None.

### HIGH

None remain after the repair review.

Resolved HIGH items:

1. Parallel/perpendicular evaluation now discovers the output line through the typed line entity's exact `from` / `to` references (`lib/tikz/authoring/construction-eval.ts:245-255`, `:347-386`) and uses the entity name in `visibleNames()` (`:564-585`). The catalog's output-line entities match that contract (`lib/tikz/authoring/construction-catalog.ts:1282-1288`, `:1360-1367`), so `entityIdForName()` supplies the same stable record ID used by the committed construction.
2. All four `ImmutableReadonlyMap` iterator methods now return `MapIterator` (`lib/tikz/authoring/construction-eval.ts:113-126`), matching the installed TypeScript 5.9 `ReadonlyMap` contract.
3. Both modified `ToolContext` fixtures now set `session: createToolInteractionSession()` (`lib/tikz/render/tools.test.ts:34-56`, `:76-88`).

### MEDIUM

1. **The new evaluator/adapter behavior has no direct regression coverage.**

   No reviewed test imports `evaluateConstructionPlan` or `createConstructionPreviewIR`. `tools.test.ts` only covers select-tool dragging (`lib/tikz/render/tools.test.ts:30-94`), not scene snapshot overlay, the eight derived plan kinds, tangent `plan.touch` aliasing, diagnostic/status propagation, unsupported fail-closed behavior, deterministic preview/commit IDs, or the authoring pointer-move boundary.

2. **Pointer-move preview broadly swallows evaluator/plan defects and still reports the outer preview as valid.**

   `constructionPreview()` catches every thrown value without narrowing or surfacing a diagnostic (`lib/tikz/render/tools.ts:703-712`), while `valid` was already computed as true (`:695-704`). Incomplete draft cardinality is an expected case, but the broad catch also hides programming errors and contract drift. This violates both the programming error-handling perspective and the remove-ai-slops over-defensive/broad-catch perspective.

3. **The adapter additions are oversized and duplicate result surface.**

   Approximate nonblank/non-comment counts are 608 lines for `construction-eval.ts`, 395 for `preview-ir.ts`, and 1,374 for `tools.ts`; each exceeds the consulted skills' 250-line review ceiling. `ConstructionEvaluationResult` also exposes duplicate aliases (`points` / `evaluatedPoints`, `entities` / `evaluatedEntities`, `lib/tikz/authoring/construction-eval.ts:72-84`) and repeats the supported-kind list in both evaluator and preview adapter. This is maintainability debt, not the immediate correctness blocker.

### LOW

1. **The preview adapter uses avoidable type assertions and carries an unused diagnostic variant.**

   Tuple/array reconstruction uses assertions at `lib/tikz/authoring/preview-ir.ts:153`, `:163`, `:272`, and `:330`; `unsupported-entity-kind` is declared at `:64` but no reviewed branch emits it. These violate the strict programming perspective but do not independently break the requested flow.

## Acceptance-criteria audit

| Criterion | Result | Evidence |
| --- | --- | --- |
| Scene point snapshot merged before anchors | PASS by inspection | `tools.ts:590-602` first copies every finite `context.scene.points` position, then overlays every current anchor by name. |
| Tangent pointer circle anchor aliases exactly `plan.touch` | PASS by inspection | Projected circle candidate is formed at `tools.ts:649-660`; after plan construction, the same circle-anchor position is written under `plan.touch` at `:603-614`. Catalog allocates that touch identity at `construction-catalog.ts:990-1055`. |
| Supported derived plans map point/line/circle evaluator geometry to PreviewGeometry with stable IDs/status/diagnostics | PASS by inspection | The eight-kind gate matches the evaluator cases (`preview-ir.ts:79-88`; `construction-eval.ts:653-677`). Point/line/circle IDs come from plan entity IDs (`construction-eval.ts:237-290`, `:587-629`) and mapping/status/diagnostics are preserved at `preview-ir.ts:370-405` and `:415-423`. Parallel/perpendicular line names are now resolved through their exact from/to entity contract (`construction-eval.ts:245-255`, `:347-386`). |
| Unsupported plans remain fail-closed | PASS by inspection | Evaluator returns empty entities/geometries plus an error diagnostic and `unsupported` status (`construction-eval.ts:526-552`). Preview adapter emits no geometry and an `unsupported-plan-kind` error for other plan kinds (`preview-ir.ts:406-423`). |
| No source parse/compile/write on authoring pointer move | PASS by inspection | Creation `onPointerMove` only invokes `constructionPreview` (`tools.ts:1160-1165`), which hit-tests, constructs an in-memory draft plan, and evaluates preview IR (`:619-727`). Source parsing is on gesture start/commit (`:198-214`, `:775`), compilation and writes are commit-only (`:887-889`, `:924-968`). |
| No preview/commit ID or hit drift | PASS by inspection | Preview and click use the same point/circle hit functions and tolerances; deterministic allocators are revision-bound; evaluator geometry IDs are the matched entity IDs. No concrete drift remains. Direct parity coverage is still recommended. |
| Likely TypeScript errors | PASS by inspection | The three concrete risks from the first review are repaired: no missing `plan.line` access remains, map iterators use `MapIterator`, and both test contexts have sessions. No typecheck was run by instruction. |

## Skill-perspective check

- **remove-ai-slops:** re-consulted before judging tests/maintainability. The reviewed tests contain no deletion-only, requested-removal-only, tautological, or implementation-constant-mirroring additions. The main test issue is missing behavioral coverage. Remaining production concerns are broad catch-and-swallow, needless map wrapper/result aliases, duplicated kind routing, and oversized modules.
- **programming:** re-consulted together with its TypeScript reference. No blocking static-contract violation remains by inspection. Remaining violations are the broad catch without narrowing/rethrow, avoidable assertions/non-null assumptions, no direct tests for new behavior, and modules above the review ceiling.

## Blockers required before approval

None.

WATCH follow-ups: add direct behavioral coverage for all eight evaluator kinds and adapter parity; narrow the broad pointer-preview catch; and plan responsibility-based splits for the oversized adapter/tool modules.

## Evidence limitations

No executor test/build/typecheck artifact or notepad path was supplied with the review request. The findings above are grounded in the current workspace source and diff only; all execution gates remain unverified by explicit instruction.
