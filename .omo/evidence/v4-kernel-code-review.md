# V4 Geometry Kernel code review

Date: 2026-07-29  
Review mode: read-only static inspection

## Review result

- `codeQualityStatus`: **BLOCK**
- `recommendation`: **REQUEST_CHANGES**
- `reportPath`: `E:\Portaitsweb\math_geohub\.omo\evidence\v4-kernel-code-review.md`

No product code was changed. Per the explicit task restriction, no test, build,
lint, TypeScript typecheck, TeX compiler, browser, or Docker command was run.
The target files under `lib/tikz/authoring` and `lib/tikz/ir` are untracked in
the current worktree, so Git cannot provide a baseline diff for them; this
review inspected their complete current contents.

The `remove-ai-slops` and `programming` skill perspectives were loaded and
applied. The diff violates both perspectives: several production modules are
1,000–1,700 lines, the runtime assertion does not validate the type it asserts,
strict-TypeScript escape holes remain, and the new construction/reconciliation
paths have no focused behavioral tests. No deletion-only, tautological, or
constant-mirroring test was found in the reviewed construction work because
there are no focused tests for it.

## CRITICAL

None.

## HIGH

### H1 — Strict TypeScript cannot safely narrow three readonly array unions

Files:

- `lib/tikz/authoring/construction-ir.ts:65-67,696-698`
- `lib/tikz/ir/tikz-adapter.ts:647-655`
- `lib/tikz/ir/ai-patch-proposal.ts:186-190`

`Array.isArray()` narrows to mutable `any[]`; it does not eliminate a
`readonly [number, number]` or `readonly AiPatchBindingContext[]` constituent
from the false branch under strict TypeScript. Consequently:

- `point.x` / `point.y` can still be a readonly tuple at
  `construction-ir.ts:697`;
- `record.position.x` / `.y` can still be a readonly tuple at
  `tikz-adapter.ts:655`;
- `return bindings` can still be a readonly array where a `ReadonlyMap` is
  required at `ai-patch-proposal.ts:189`.

This is a source-level compile blocker even though typecheck was not run.

Minimal fix: use explicit discriminators/type guards that accept readonly
arrays, for example an object-coordinate guard and a `bindings instanceof Map`
or map-like guard. Add strict typecheck evidence before approval.

### H2 — `assertConstructionPlan` asserts substantially more than it validates

Files:

- `lib/tikz/authoring/construction-ir.ts:429-480`
- `lib/tikz/authoring/construction-ir.ts:668-689`
- `lib/tikz/authoring/construction-ir.ts:776-777`
- `lib/tikz/authoring/construction-ir.ts:853-863`
- `lib/tikz/authoring/construction-ir.ts:1097-1117`
- `lib/tikz/semantics/managed-construction.ts:482-499`

`validateBase()` only checks that `entities`, `constraints`, and `relations`
are arrays. It does not validate any record in those arrays. Output records
also never validate `recordType` or the `kind` union. Nevertheless
`assertConstructionPlan()` claims the unknown value is a complete
`ConstructionPlan`, after which the compiler serializes every record as trusted
managed metadata.

The source boundary is also not grammar-safe:

- label text is interpolated directly into a node body at
  `construction-ir.ts:777`;
- `TikzCalcScalar` strings are accepted without a safe scalar grammar and are
  interpolated into calc expressions at `construction-ir.ts:856-862`.

Malformed records can therefore survive the asserted boundary, produce invalid
managed metadata, or inject arbitrary TikZ through a supposedly typed writer.
The evidence claim in
`.omo/evidence/construction-ir-20260729.md` that malformed plans are rejected is
not supported by the implementation.

Minimal fix: parse/validate every discriminated record, including all required
fields, finite values, tuple cardinalities, IDs, references, and output kinds.
Represent TeX label content explicitly or escape plain text. Replace raw string
scalars with a parsed PGF-math scalar type, reserving arbitrary source for the
already explicit unsafe opaque path.

### H3 — Semantic overlay and Rendering Truth describe mutually inconsistent geometry

Files:

- `lib/tikz/ir/tikz-adapter.ts:418-458`
- `lib/tikz/ir/tikz-adapter.ts:707-715`
- `lib/tikz/ir/tikz-adapter.ts:1312-1338`
- `lib/tikz/ir/tikz-adapter.ts:1219-1251`
- `lib/tikz/ir/tikz-adapter.ts:1440-1458`
- `components/tikz/tikz-canvas.tsx:381-382`
- `lib/tikz/render/svg-renderer.tsx:283-310`

There are three concrete contradictions:

1. Line/ray matching normalizes calc references only for the lookup key.
   The reconciled entity keeps the source projection's raw references
   (`A,B,A,B` for a line and `A,A,B` for a ray). `renderGeometry()` then emits
   those raw lists as `through`, so a semantic `line`/`ray` does not have the
   promised two defining references.
2. `dimensionOf()` marks drawn polygon/rectangle boundaries as dimension 2 and
   angle/right-angle marks as dimension 0. The source projection correctly
   treats these rendered curves as dimension 1. Reconciliation overwrites the
   correct value with the contradictory managed value.
3. The object named `RenderingTruth` is not the actual interactive canvas
   truth. It contains only `scene.elements`, while the renderer also draws all
   public point handles. The live canvas still consumes `Scene` directly and
   ignores `geometryTruth.rendering`.

This breaks the central Code ↔ Semantic IR ↔ Canvas identity contract: AI/source
maps can observe a different kind, dimension, defining reference list, and
primitive set from the canvas.

Minimal fix: make managed reconciliation carry authoritative normalized
geometry (`from`/`to` exactly once), keep boundary/mark entities dimension 1
unless a distinct filled-region entity is modeled, and generate/consume
interactive Rendering Truth from the reconciled entities. Either include point
handle primitives or explicitly split base-render and interaction-overlay
truths; do not label an elements-only snapshot as the complete interactive SVG.

### H4 — AI write authorization can cross the half-open binding boundary

Files:

- `lib/tikz/ir/ai-patch-proposal.ts:186-190`
- `lib/tikz/ir/ai-patch-proposal.ts:214-225`
- `lib/tikz/ir/ai-patch-proposal.ts:514-532`
- `lib/tikz/ir/ai-context.ts:276-315`

An insertion at `binding.range.end` is accepted with `<=`, although the binding
range is documented as half-open. The validator checks only the operation's
declared binding and never checks whether the same range intersects another
non-writable/opaque/nested binding. Duplicate binding IDs are also silently
collapsed by `new Map`.

The trusted AI context worsens this boundary: every exported source binding is
hard-coded to `opaque: false` at `ai-context.ts:293`; the separately exported
opaque-node ranges are not used when authorizing binding IDs.

An AI operation can therefore be authorized against a writable outer or
adjacent binding while inserting into, or replacing across, syntax that the
construction lane considers opaque or managed.

Minimal fix: reject duplicate binding identities, use explicit zero-width
insertion-slot bindings, enforce half-open containment for ordinary bindings,
and reject every operation intersecting any non-writable or opaque binding/node.
Add boundary, nested-binding, and opaque-overlap integration tests.

## MEDIUM

### M1 — Two-corner rectangle writes correct coordinates but records the wrong edge semantics

Files:

- `lib/tikz/authoring/construction-catalog.ts:263-278`
- `lib/tikz/authoring/construction-catalog.ts:672-747`
- `lib/tikz/authoring/construction-catalog.ts:444-452`
- `lib/tikz/authoring/construction-ir.ts:825-835`
- `components/tikz/tikz-canvas.tsx:509-537`

The two-corner formula is correct:

- second corner = `(opposite.x, first.y)`;
- fourth corner = `(first.x, opposite.y)`;
- the final path is closed in the expected order.

However, all four rectangle edges are recorded with `kind: 'line'`, which means
infinite lines, even though the visual entity contains four finite segments.
The generic construction preview also shows only the diagonal from the first
corner to the pointer instead of a rectangle.

Minimal fix: record the edges as segments (constraints may reference their
supporting lines explicitly) and add a rectangle-specific four-edge preview.

### M2 — “Single production primitive factory” still has two rectangle representations

Files:

- `lib/tikz/authoring/construction-catalog.ts:476-489`
- `lib/tikz/authoring/construction-catalog.ts:623-669`
- `lib/tikz/authoring/construction-catalog.ts:672-747`

`createPrimitiveConstructionPlan('rectangle')` emits a `primitive/rectangle`
plan, while the canvas rectangle spec bypasses it and emits
`rectangle-by-opposite-corners` with a polygon plus two derived points. These
produce different plan kinds, entity sets, output sets, and TikZ bodies for the
same user-visible primitive.

Minimal fix: make the public factory request a discriminated rectangle mode or
remove rectangle from the generic factory; retain one canonical semantic
representation.

### M3 — Incremental invalidation does not treat presence/absence of `sourceId` as an identity change

File:

- `lib/tikz/ir/invalidation.ts:454-467`

Basis mismatch is reported only when both source IDs are defined and unequal.
Changing from an undefined source identity to a defined one, or the reverse,
can still proceed incrementally across incomparable source lanes.

Minimal fix: compare `previousBasis.sourceId !== currentBasis.sourceId`
directly, or explicitly normalize both to the same derived source identity.

### M4 — Constraint duplicate detection discards argument roles and ordering

File:

- `lib/tikz/solver/constraint-diagnostics.ts:90-108`

The duplicate signature sorts only entity IDs and appends parameters. It omits
argument roles/order, `strength`, and `enabled`. Directional/role-sensitive
constraints using the same entity set can be falsely diagnosed as duplicates
and excluded from the DoF reduction.

Minimal fix: canonicalize the full ordered role/value/expression argument list;
normalize only constraint kinds whose symmetry is explicitly known.

### M5 — No focused regression coverage for the new construction and reconciliation paths

Relevant files:

- `lib/tikz/authoring/construction-catalog.ts`
- `lib/tikz/authoring/construction-ir.ts`
- `lib/tikz/render/tools.ts`
- `lib/tikz/ir/tikz-adapter.ts`

Repository search found no tests for `createPrimitiveConstructionPlan`,
two-corner rectangle plans, owned anchor managed blocks, atomic bundle commit,
managed kind/dimension overlays, line/ray normalized references, or point
Rendering Truth. Existing source-builder tests exercise the old direct-string
path, not the new managed protocol. The static evidence documents predate the
latest factory/rectangle/overlay changes and cannot establish their behavior.

Minimal fix: add behavior-level tests for all primitive kinds, mixed
existing/new anchors, all-new anchors, commit conflict atomicity, rectangle
drag preview, managed reparse/reconciliation, source-map identities, and actual
Rendering Truth primitives. Avoid snapshot-only or implementation-constant
tests.

### M6 — Core modules are well beyond the project skill's maintainability boundary

Current line counts:

- `construction-catalog.ts`: 1,717
- `construction-ir.ts`: 1,145
- `render/tools.ts`: 1,012
- `ir/tikz-adapter.ts`: 1,468
- `ir/ai-patch-proposal.ts`: 747
- `ir/invalidation.ts`: 756

This is a `remove-ai-slops` and `programming` perspective violation. Registry
data, validation, writer plugins, reconciliation, rendering projection, and
interaction state are co-located, which is already hiding the contradictions
reported above.

Minimal fix: split by stable responsibility (plan schema/validation, primitive
registry, TikZ writers, managed reconciliation, Rendering Truth adapter,
authoring session/commit) without adding pass-through abstractions.

## LOW

### L1 — DoF diagnostics are formatted as dense multi-statement lines

File:

- `lib/tikz/solver/constraint-diagnostics.ts:46-145`

Several unrelated operations are compressed onto single lines. This is not a
runtime defect, but it makes a heuristic module harder to review and increases
the chance of missing role/order errors such as M4.

Minimal fix: format one operation per line and extract only named canonicalizers
that encode real domain rules.

## Verified positive behavior

The following concerns from earlier reviews are corrected in the current files:

- `commitAuthoring()` compiles each newly owned anchor as a managed point block,
  compiles the main plan, concatenates the blocks, and submits one
  revision-guarded source patch (`render/tools.ts:493-551`). A failed commit
  cannot leave only the anchor blocks behind.
- The point tool avoids creating a duplicate owned-input plan
  (`render/tools.ts:509-517`).
- The rectangle UI now requires two opposite corners and rejects coincident
  corners (`construction-catalog.ts:263-278`).
- Angle and right-angle writers use `A--B--C` without the previous invalid
  parentheses (`construction-ir.ts:778-781`).
- Tangent direction now uses center-to-touch rather than the arbitrary radius
  seed (`construction-ir.ts:916-924`).
- AI proposal compilation now lowers semantic scope to source-only read/write
  sets and source-slice preconditions accepted by the Studio broker
  (`ai-patch-proposal.ts:643-709`).

## Blockers before approval

1. Remove the strict-TypeScript readonly-array narrowing failures.
2. Make `assertConstructionPlan` validate the complete asserted schema and
   close raw label/scalar source injection.
3. Reconcile kind, dimension, normalized references, and actual interactive
   primitives so Semantic/Rendering Truth matches the canvas.
4. Close AI binding-end, nested-binding, duplicate-binding, and opaque-overlap
   authorization holes.
5. Add focused behavior tests/evidence for primitive factories, atomic owned
   anchor commits, two-corner rectangles, semantic overlays, and Rendering
   Truth before claiming this architecture complete.
