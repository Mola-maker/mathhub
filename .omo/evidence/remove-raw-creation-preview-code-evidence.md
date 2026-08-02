# Raw creation preview removal — static code evidence

Date: 2026-08-01

## Production call-site scan

Invocation:

```powershell
Select-String -Path lib/tikz/render/tools.ts -Pattern 'previewAuthoring|authoringLines'
```

Observable: no matches. `previewAuthoring` and the `authoringLines` import/calls are absent from the runtime tool module. The only remaining `authoringLines` reference is the legacy compatibility export in `lib/tikz/authoring/source-builder.ts`, imported by `lib/tikz/authoring/source-builder.test.ts`; the export is marked `@deprecated` and test-only.

## Lifecycle cleanup scan

Invocation:

```powershell
Select-String -Path lib/tikz/render/tools.ts -Pattern 'previewPatch\\?\\.\\(null\\)'
```

Observable cleanup points in the current file:

- cancellation/session cleanup: line 190
- drag cleanup: line 288
- rejected/unsolved drag preview: line 345
- creation commit entry: line 571
- creation commit exit: line 850
- creation-tool pointer-down/start: line 900
- explicit finish: line 1009
- step-back: line 1025

Creation pointer-down also clears `setConstructionPreview(null)` before anchor processing. Creation pointer-move only updates the immutable `ConstructionPreview` overlay; source remains unchanged until the existing `commitAuthoring` transaction. Drag-derived previews still use `previewPatch` and were intentionally retained.

## Canvas naming evidence

Invocation:

```powershell
Select-String -Path components/tikz/tikz-canvas.tsx -Pattern 'dragPreviewCode|dragPreviewAnalysis|Source previews|Drag-derived'
```

Observable: source-preview state is named `dragPreviewCode`/`dragPreviewAnalysis`; comments identify it as drag-derived and explicitly keep creation previews in the immutable ConstructionPreview overlay.

## Compatibility boundary

Final creation writes still use `ConstructionPlan`/`compileConstructionPlan`, existing managed circle adoption, minimal CodeMirror/Broker patches, and managed-block validation. `authoringLines` remains solely for the existing source-builder fixture until that test is retired.

No automated tests, build, lint, typecheck, TeX compiler, or Docker commands were run per product-owner instructions.
