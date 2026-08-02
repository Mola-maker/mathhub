# Typed ConstructionPlan Preview IR — local browser verification

Date: 2026-08-01

Environment: local Next.js dev server at `http://localhost:3000/tikz`; in-app browser. No Docker, test suite, build, lint, typecheck, or TeX command was run.

Source stayed fixed at three free points `A`, `B`, `C` for every preview scenario.

## Typed primitive projection

- `线段`: after selecting `A` and moving to `B`, the overlay contained exactly one `[data-preview-geometry="segment"]` and one `[data-tool-preview]`.
- `矩形`: after selecting `A` and moving to `B`, the overlay contained exactly one `[data-preview-geometry="rectangle"]`.
- `圆`: after selecting center `A` and moving to `B`, the overlay contained exactly one `[data-preview-geometry="circle"]`.
- In all three cases the editor remained the original five lines, the scene stayed `3 点 · 0 图元`, and no managed block was written.

## Unsupported derived plan fails closed

- `平行线`: after selecting `C`, `A`, then hovering `B`, the draft plan was complete but its derived numeric geometry is intentionally unsupported in Preview IR phase 1.
- The overlay contained zero `[data-preview-geometry]`, one generic `.tz-construction-preview__path`, and one `[data-tool-preview]`.
- Source again stayed unchanged, demonstrating fallback rather than invented or TikZ-reparsed geometry.

This confirms that primitive/rectangle previews project the same typed ConstructionPlan used by commit, while unsupported derived plans remain source-neutral and fail closed to the generic overlay.
