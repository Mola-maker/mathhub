# Typed ConstructionPlan preview IR — code evidence

Date: 2026-08-01

This artifact records the Phase 1 implementation boundary. Per the product-owner
instruction, no tests, build, lint, typecheck, browser, TeX, or Docker commands
were run for this change.

## Changed paths

- `lib/tikz/authoring/preview-ir.ts`
  - Adds a pure, renderer/source-independent `ConstructionPreviewIR`.
  - Carries immutable `planId`, `planKind`, typed geometry, and typed diagnostics.
  - Projects every primitive definition (`point`, `segment`, `vector`, `line`,
    `ray`, `polyline`, `polygon`, `rectangle`, `circle`, `label`, `angle`, and
    `right-angle`) from the plan plus a reference-to-point map.
  - Projects `rectangle-by-opposite-corners` using the same axis-aligned
    corner semantics as its plan writer.
  - Fails closed for derived plans with `unsupported-plan-kind`; it never
    reparses TikZ or fabricates derived solver results.
  - Emits `finite-extent-fallback` for line/ray preview geometry because Phase
    1 renders their two defining points as a finite segment.

- `lib/tikz/render/tools.ts`
  - Adds a deterministic, side-effect-free draft allocator for preview names
    and construction ids. The allocator is local to each pointer move and does
    not write source/history/network state.
  - Authoring state snapshots managed construction ids/reference markers once
    per source revision; first-hover previews use a `preview-` construction id
    namespace without parsing persistent managed blocks on every pointer move.
  - Preview and commit now use the same local point/construction allocator
    helper, keeping collision behavior aligned while preserving source truth.
  - The commit path no longer retains a second inline allocator; both lanes
    resolve names and construction identities through `constructionAllocators`.
  - Calls the same catalog `spec.plan` or
    `createPrimitiveConstructionPlan` used by commit, then evaluates it through
    `createConstructionPreviewIR`.
  - Stores the resulting IR on `ConstructionPreview`; incomplete, invalid, or
    unsupported plans leave the existing anchor/path overlay available.
  - Commit and drag preview paths remain unchanged.

- `components/tikz/tikz-canvas.tsx`
  - Renders typed preview geometry directly inside `ConstructionPreviewSvg`.
  - Keeps anchor indices, candidate marker, and the generic animated path as a
    fallback when typed IR is absent or has no geometry.
  - Adds deterministic SVG arrow markers for vector/ray previews and keeps
    line previews as finite placeholders according to their IR diagnostic.
  - Renders ordinary angle previews as finite SVG arc marks centered at the
    vertex (using the shared decoration primitive); the two defining rays are
    not painted as the preview geometry.
  - Draws a distinct right-angle square marker instead of treating a
    right-angle as an ordinary angle polyline.
  - Exposes `data-preview-status` and `is-valid`/`is-invalid`/`is-unsupported`
    overlay classes. Unsupported preview rendering is surfaced separately from
    a construction validation failure.
  - Does not alter the interactive RenderPrimitive truth set or exact TeX lane.

- `app/tikz-studio.css`
  - Gives typed preview geometry an explicit visible style contract: paths,
    circles, rectangles, polygons, and right-angle marks have accent stroke
    and no default black fill; points and labels have explicit fill/font rules;
    vector/ray arrowheads inherit the preview color.
  - Uses the warning accent for `is-unsupported`, keeping it visually distinct
    from invalid construction diagnostics.

## Semantic interaction guardrails

- `preview-ir.ts` rejects primitive angle/right-angle plans with a repeated
  vertex arm as `invalid-geometry`, so a degenerate plan cannot render a
  misleading mark.
- `tools.ts` exports one point-hit tolerance (12px) and one circle-hit
  tolerance (18px); both authoring commit and construction preview use these
  same constants, removing the previous preview/commit hit-test drift.

## Determinism / safety boundary

Preview ids derive only from the catalog plan id/entity id and local point-name
sets; no random, UUID, clock, source patches, history writes, or network calls
are used. Persistent document allocation remains exclusively in commit.
