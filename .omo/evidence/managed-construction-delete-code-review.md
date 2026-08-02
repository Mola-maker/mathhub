# Managed construction deletion architecture review

Date: 2026-08-01

Scope: read-only review of the current managed-construction deletion path, with
special attention to complete quadrilateral internal entities. No tests, build,
lint, typecheck, browser, TeX compiler, or Docker command was run.

## Goal and success criteria

Determine what happens when a user deletes one selected subentity of a managed
composite, and choose the smallest safe architecture boundary between typed
subentity closure deletion and atomic whole-block deletion.

Success requires:

- source remains the sole durable truth;
- no managed metadata/body/header drift is possible;
- deletion is revision-guarded and atomic;
- destructive scope is accurately disclosed to the user;
- fine-grained deletion is not claimed before a typed structural recompiler
  can rewrite every semantic and source representation together.

## Skill-perspective check

The requested `remove-ai-slops` and `programming` skills were not present in the
available skill catalog or local skill search, so they could not be loaded.
Their documented review criteria were applied manually. The reviewed deletion
production path does not add untyped escape hatches, implementation-mirroring
tests, tautological tests, or goal-irrelevant parsing/normalization. The absence
of focused behavior tests is recorded below rather than treated as evidence of
success.

## Current behavior

For a valid complete-quadrilateral internal line/point/diagonal that resolves to
a source statement:

1. `deleteSelection()` defaults to and is invoked with `cascade`
   (`components/tikz/use-tikz-engine.ts:685`,
   `components/tikz/tikz-style-panel.tsx:1043`).
2. The selected source stable ID and statement index are passed to
   `planDeletion()` (`components/tikz/use-tikz-engine.ts:691-740`).
3. If that statement overlaps a managed block body, every statement in that
   block becomes an atomic source root
   (`lib/tikz/authoring/delete-transaction.ts:898-929`).
4. Cascade mode also traverses every descendant, including statements outside
   the managed block (`lib/tikz/authoring/delete-transaction.ts:929-965`).
5. Statement patches touching the block are replaced by one deletion of the
   complete `block.range`, including header, semantic records, TikZ body and end
   marker (`lib/tikz/authoring/delete-transaction.ts:146-172`,
   `lib/tikz/authoring/delete-transaction.ts:991-1005`).
6. The transaction broker accepts a Canvas-origin mutation inside a managed
   construction only when it replaces the complete block; an empty replacement
   is the explicit atomic delete case
   (`lib/tikz/transactions/broker.ts:119-171`). The commit is guarded by expected
   revision and exact source-slice preconditions in `commitPatches()`.

Therefore the exact behavior is **delete the whole managed block plus all
source-graph descendants**, not merely delete the selected subentity and not
necessarily only delete the block.

## Findings

### CRITICAL

None.

### HIGH

#### H1 - Managed deletion UI hides block-external cascade scope

Files:

- `components/tikz/tikz-style-panel.tsx:1043-1053`
- `components/tikz/use-tikz-engine.ts:685-750`
- `lib/tikz/authoring/delete-transaction.ts:929-965`

The managed button calls `deleteSelection('cascade')`, while its label and
success message say only `删除整个受管构造` / `已原子删除受管构造`. Cascade expands
through all descendants after making the whole managed block atomic. A
user-authored statement outside the block that consumes `X1`, `X2`, or another
managed output can therefore be deleted without the managed-specific UI saying
that it is also in scope. The existing browser artifact verifies a scenario
without an external downstream consumer, so it does not disprove this risk.

This is a destructive-scope correctness issue, not cosmetic copy. Smallest
safe fix: make the primary managed action use `block` mode and refuse when
external descendants exist; offer a separately named `删除整个受管构造及下游`
action only after showing the planned external descendant count/list. Both
actions may still compile to atomic whole-block patches.

### MEDIUM

#### M1 - No focused regression coverage for managed atomic and external-cascade boundaries

Repository search found no test referencing `planDeletion`,
`expandManagedConstructionDeletions`, managed delete UI copy, or
`deleteSelection`. The manual browser artifact at
`.omo/evidence/complete-quadrilateral-browser-verification.md` covers one valid
complete quadrilateral and confirms atomic deletion, but does not cover:

- an external statement depending on a managed output;
- `block` refusal versus explicit `cascade`;
- duplicate managed IDs;
- detached/invalid managed metadata;
- selection of each internal entity class (derived point, line, diagonal).

The product owner currently owns test execution, so no commands were run. The
missing behavior-level cases should still be added before this boundary is
declared complete; avoid snapshot-only or implementation-constant assertions.

#### M2 - UI managed-delete classification and planner classification use different authorities

Files:

- `components/tikz/tikz-style-panel.tsx:924-927`
- `lib/tikz/authoring/selection-resolution.ts:305-328`
- `lib/tikz/authoring/delete-transaction.ts:175-190`

The UI shows managed-specific deletion only when Inspector write capability is
exactly `managed-recompile`. The deletion planner independently detects managed
blocks from source ranges. A duplicate-ID or otherwise read-only managed block
can therefore be presented as ordinary `删除对象及下游` while the planner still
expands the patch to the whole source block. Managed deletion policy should be
derived from an explicit owner-block resolution, independent of whether style
writeback is allowed.

### LOW

None.

## Why typed subentity deletion is not the smallest safe rule now

- Managed record bindings point at the entire block range rather than a unique
  TikZ-body statement range (`lib/tikz/ir/tikz-adapter.ts:1348-1381`). There is
  no lossless record-to-generated-statement ownership map for structural edits.
- The only recompiler is explicitly style-only. It changes a body slice and
  renews the fingerprint while preserving metadata
  (`lib/tikz/authoring/managed-construction-recompile.ts:12-116`).
- Complete quadrilateral is one holistic typed plan: two intersection outputs,
  four lines, a diagonal, one complete-quadrilateral constraint, dependency
  relations and generated body statements
  (`lib/tikz/authoring/construction-catalog.ts:1624-1710`,
  `lib/tikz/authoring/construction-ir.ts:1011-1029`). Removing one internal line
  has no currently defined valid residual `complete-quadrilateral` plan.

Fine-grained deletion should only be enabled after a typed structural edit plan
can atomically rewrite entity/constraint/relation/output closure, header
inputs/outputs, generated TikZ statements and content fingerprint, then
re-project and validate the resulting construction. Until then, **whole managed
block is the correct minimal deletion unit**.

## Positive architecture evidence

- The atomic block range includes directive comments, records, TikZ body and
  end marker, so successful deletion cannot leave stale managed metadata.
- Canvas-origin local patches inside managed blocks are rejected by the broker;
  only trusted whole-block replacement/deletion crosses the boundary.
- The complete-quadrilateral catalog now records the four lines and diagonal and
  expresses line -> endpoint, intersection -> line, and diagonal -> intersection
  dependencies, matching the generated visible geometry.
- The architecture draft states the same whole-block rule and explicitly gates
  fine-grained deletion on a typed structural recompiler.

## Decision

- `codeQualityStatus`: **BLOCK**
- `recommendation`: **REQUEST_CHANGES**
- `blockers`:
  1. Do not label a `cascade` operation as only deleting the managed block.
     Separate safe `block` deletion from explicitly previewed block-plus-downstream
     cascade, or accurately disclose and confirm the external descendant scope.

