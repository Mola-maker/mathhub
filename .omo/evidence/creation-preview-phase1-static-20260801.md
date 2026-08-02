# TikZ Studio creation-preview Phase 1 static evidence

Date: 2026-08-01

## Scope

The creation-preview lane was changed to keep source immutable until the existing ConstructionPlan commit path runs. Drag-derived source previews remain supported.

## Invocation and observables

PowerShell static scan:

```powershell
Select-String -Path lib/tikz/render/tools.ts -Pattern 'previewAuthoring|authoringLines'
```

Observable result: no matches in `lib/tikz/render/tools.ts`; creation no longer calls a raw-TikZ preview writer or reparses a preview Scene.

PowerShell lifecycle scan:

```powershell
Select-String -Path lib/tikz/render/tools.ts -Pattern 'previewPatch\\?\\.\\(null\\)'
```

Observable result: the null clear is present at cancellation/drag cleanup, commit entry and exit, creation-tool start, explicit finish, and step-back. Creation pointer-down now clears the patch lane before selecting an anchor, and the immutable `setConstructionPreview` overlay remains the only creation preview writer.

PowerShell canvas naming scan:

```powershell
Select-String -Path components/tikz/tikz-canvas.tsx -Pattern 'dragPreviewCode|dragPreviewAnalysis|Source previews|Drag-derived'
```

Observable result: the source-preview state is explicitly named `dragPreviewCode`/`dragPreviewAnalysis`; comments state that creation previews use `ConstructionPreview` and never enter the legacy Scene preview path.

## Compatibility notes

- Final creation writes still use `ConstructionPlan`/`compileConstructionPlan`, existing circle adoption, Broker transactions, and managed-block validation.
- `authoringLines` remains exported only because `source-builder.test.ts` still imports the fixture. It is marked legacy/test-only and deprecated; there are no runtime references.
- Drag source previews are intentionally unchanged and continue to use `previewPatch`/`analyze` until their revision-bound truth set migration.

Automated tests, builds, lint, typecheck, TeX, and Docker were not run per product-owner instructions.
