# Typed Preview IR — final independent re-review

Date: 2026-08-01  
Outcome: **PASS**

- `codeQualityStatus`: **WATCH**
- `recommendation`: **APPROVE**
- `reportPath`: `.omo/evidence/typed-preview-ir-code-review.md`
- `blockers`: **none**

## Review boundary

Reviewed the current snapshots of:

- `lib/tikz/authoring/preview-ir.ts`
- `lib/tikz/render/tools.ts`
- `components/tikz/tikz-canvas.tsx`
- `app/tikz-studio.css`
- the shared decoration implementation in
  `lib/tikz/render/svg-decoration-primitives.tsx`
- `.omo/evidence/typed-preview-ir-code-evidence.md`

Per the product-owner instruction, I did **not** run tests, build, lint,
typecheck, browser automation, TeX, Docker, or compiler commands. This is a
static code review; runtime/product acceptance remains with the owner.

`omo ulw-loop status --json` previously returned a shell syntax error, so the
requested fallback report path is used.

## Skill-perspective check

The `remove-ai-slops` and `programming` skills are not present in the available
skill catalog, so they could not be loaded. I applied the reviewer-prompt
criteria directly.

- No deletion-only, tautological, implementation-constant-mirroring, or brittle
  prompt tests were added. No focused Preview IR tests currently exist.
- No `any`, broad cast-based escape hatch, source/history/network write, random
  ID, clock dependency, or alternate source parser was introduced in Preview
  IR.
- The earlier duplicate allocator and pointer-move managed-source parse were
  removed. The current diff does not violate either skill perspective at a
  severity that should block approval.

## CRITICAL

None.

## HIGH

None.

## MEDIUM

None.

## LOW

### 1. First-hover point previews intentionally use an ephemeral `preview-` plan namespace

Before authoring state exists, `draftPreviewPlan()` calls the allocator with
`previewOnly=true`, prefixing the construction ID with `preview-`
(`lib/tikz/render/tools.ts:210-245`, `552-572`). This ID is deterministic across
pointer moves, never consumes persistent allocation, and is explicitly
documented in the evidence. It differs from the immediate committed point plan
ID, so it should be described as stable ephemeral identity rather than literal
preview/commit identity equality.

### 2. Near-zero but non-identical angle arms are renderer-rejected rather than IR-rejected

Preview IR rejects non-finite points and exact vertex/arm coincidence
(`lib/tikz/authoring/preview-ir.ts:299-319`). The screen-space renderer also
rejects a computed arc radius at or below `1e-6`
(`components/tikz/tikz-canvas.tsx:1020-1041`). Thus undefined zero-length arms
fail closed; an extremely short but non-identical arm can retain IR status
`valid` while producing no arc. This is not reachable through ordinary point
selection at the current hit tolerance, but a future source-driven Preview IR
caller should use a shared scale-aware degeneracy policy.

### 3. `unsupported-entity-kind` remains declared but unused

`PreviewDiagnosticCode` includes `unsupported-entity-kind`, but the projector
does not emit it (`lib/tikz/authoring/preview-ir.ts:58-63`). Remove the unused
code or implement the corresponding entity/primitive-kind consistency check.

### 4. SVG marker ID is fixed rather than canvas-instance scoped

Every active typed preview defines `id="tz-construction-preview-arrow"`
(`components/tikz/tikz-canvas.tsx:798-812`). It is safe for the current one-SVG
Studio workspace, but multiple simultaneously mounted TikZ canvases could
produce duplicate document IDs. A `useId()`-derived marker identifier would
remove this future ambiguity.

### 5. Focused owner-run regression coverage is still absent

No test/spec file references `createConstructionPreviewIR`, the typed preview
renderer, or `data-preview-status`. The eventual owner-run suite should cover
every primitive, opposite-corner rectangle ordering, finite/NaN/Infinity and
degenerate-angle rejection, stable IDs, managed-reference-only collisions,
unsupported derived fallback, identical preview/commit hit resolution, and the
non-mutation boundary.

## Verification of the two final blockers

### Ordinary angle is now a finite committed-semantics angle mark — PASS

- The Preview IR resolves the three semantic point references, rejects missing
  or non-finite inputs, and rejects either arm whose endpoint coincides with the
  vertex. Invalid plans emit `invalid-geometry` and no typed geometry
  (`lib/tikz/authoring/preview-ir.ts:299-319`).
- The Canvas no longer paints A-V-B as two full rays. `previewAngleMarkPath()`
  converts the same `[from, vertex, to]` ordering to screen space, limits the
  radius to `min(16 px, 25% of each arm)`, rejects a non-positive finite extent,
  and calls the established `angleMarkPath()` implementation
  (`components/tikz/tikz-canvas.tsx:976-987`, `1020-1041`).
- `angleMarkPath()` computes the finite minor-arc sweep from normalized rays and
  emits a bounded SVG arc (`lib/tikz/render/svg-decoration-primitives.tsx:72-84`,
  `105-140`, `143-164`). The typed angle class has explicit no-fill/accent-stroke
  behavior (`app/tikz-studio.css:1493-1499`).

This matches the semantic boundary used by the committed angle primitive: the
ConstructionPlan retains the defining points, while Canvas renders only the
finite angle decoration rather than inventing new source geometry.

### Preview and commit now use the same point/circle input contract — PASS

- Shared constants define point tolerance as 12 px and circle tolerance as
  18 px (`lib/tikz/render/tools.ts:49-55`).
- `authoringAnchor()` uses those constants with `hitTestPointHandle()` and
  `hitTestCircle()` (`lib/tikz/render/tools.ts:458-524`).
- `constructionPreview()` uses the same functions, context, local screen point,
  and constants (`lib/tikz/render/tools.ts:600-629`).
- For circles, both lanes derive the selected stable circle reference and
  pointer angle from the same hit result. For point inputs, both lanes choose
  the same existing point or the same deterministic next free-point name.

The former 12–18 px point and 18–24 px circle mismatch annuli are gone. No
same-location plan/entity ID or geometry drift remains in the current authoring
input path.

## Other previously reported findings remain closed

### Typed geometry visual contract — PASS

Typed paths, circles, points, labels, polygons, rectangles, angle marks,
right-angle marks, and arrowheads have explicit scoped fill/stroke/font rules
(`app/tikz-studio.css:1455-1509`). No primitive relies on SVG's unsafe default
black fill.

### Primitive semantics and explicit degradation — PASS

- vector/ray receive an explicit arrow marker;
- ordinary angle uses a finite arc;
- right-angle uses a distinct bounded corner mark;
- line/ray remain finite phase-1 placeholders, with an explicit
  `finite-extent-fallback` diagnostic in Preview IR
  (`lib/tikz/authoring/preview-ir.ts:180-205`;
  `components/tikz/tikz-canvas.tsx:916-1008`).

### Pointer-move cache, shared allocator, and managed references — PASS

Managed construction IDs and every colon-delimited prefix of qualified managed
references are captured once when a revision-bound authoring gesture begins
(`lib/tikz/render/tools.ts:189-203`, `1035-1051`). Pointer moves reuse that
snapshot; commit reparses only for the adoption/integrity transaction.

Preview-after-first-anchor and commit use the same local
`constructionAllocators()` helper and point-name set. Reference-only IDs remain
reserved for commit, local allocator consumption has no persistent side effect,
and raw-circle adoption consumes only its separate `source-circle*` prefix. No
managed-reference miss or adoption-induced dependent-plan ID drift was found.

### Preview status, fallback, and drag separation — PASS

Canvas derives `is-valid`, `is-invalid`, or `is-unsupported` and
`data-preview-status` from Preview IR status; invalid/unsupported geometry keeps
the generic fallback. Creation writes only ephemeral `ConstructionPreview`
state. Non-null `previewPatch` calls remain isolated to drag-derived source
previews, so no drag regression or source/history/network write was found.

## Final recommendation

**APPROVE.** The two remaining HIGH findings are closed, no new blocking
correctness or scope issue was found, and the typed Preview IR now satisfies the
requested static architecture contract. Status remains WATCH only because the
owner has not yet run focused automated or browser regression coverage.
