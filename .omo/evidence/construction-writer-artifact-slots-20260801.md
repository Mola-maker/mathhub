# Construction writer artifact slots — static implementation evidence

Date: 2026-08-02
Scope: `lib/tikz/authoring/construction-ir.ts` only.
Verification boundary: repository policy and task instruction prohibited tests,
build, lint, typecheck, TeX, Docker, and browser runs. Evidence below is direct
source inspection with `rg`/PowerShell plus `git diff --check` only.

## 1. Stable writer artifact ABI

Scenario: inspect the public precursor API without enabling schema-v3 output.

Invocation:

```powershell
rg -n "CONSTRUCTION_WRITER_ID|CONSTRUCTION_WRITER_REVISION|interface ConstructionWriterSlot|interface ConstructionWriterArtifact|compileConstructionWriterArtifact" lib/tikz/authoring/construction-ir.ts
```

Binary observable:

- `CONSTRUCTION_WRITER_ID` is the literal
  `mathgeo/tikz-construction-writer`.
- `CONSTRUCTION_WRITER_REVISION` is the literal `1`.
- Both requested interfaces and `compileConstructionWriterArtifact()` are
  exported.
- Every slot exposes `id`, `kind`, semantic `owners`,
  `semanticFingerprint`, `canonicalSource`, and declared `optionSites`.

Captured artifact: this file.

## 2. All 19 plan kinds and all 12 primitive kinds are explicit

Scenario: count only top-level switch cases inside
`compileConstructionWriterArtifact()`, then count the primitive lowering switch.

Invocation:

```powershell
$path='lib/tikz/authoring/construction-ir.ts'
# Select the compileConstructionWriterArtifact -> planDirectiveInputs range and
# count lines matching: ^    case '([^']+)'
# Select the primitiveSource -> directive range and use the same count.
```

Binary observable:

```text
PLAN_KIND_CASE_COUNT=19
PLAN_KIND_CASES=primitive,rectangle-by-opposite-corners,midpoint,perpendicular-foot,point-on-circle,parallel-line,perpendicular-line,perpendicular-bisector,angle-bisector,circumcircle,tangent-at-point,reflect-point,reflect-line,rotate-90,homothety-2,inversion-point,radical-axis,cyclic-quadrilateral,complete-quadrilateral
PRIMITIVE_KIND_CASE_COUNT=12
PRIMITIVE_KIND_CASES=point,segment,vector,line,ray,polyline,polygon,rectangle,circle,label,angle,right-angle
WRITER_SLOT_CALL_COUNT=51
```

The per-plan statement-slot counts captured from the same range are:

```text
primitive=1 (one statement for each of 12 primitive roles)
rectangle-by-opposite-corners=3
midpoint=1
perpendicular-foot=1
point-on-circle=1
parallel-line=2
perpendicular-line=2
perpendicular-bisector=3
angle-bisector=2
circumcircle=6
tangent-at-point=3
reflect-point=1
reflect-line=2
rotate-90=1
homothety-2=1
inversion-point=2
radical-axis=3
cyclic-quadrilateral=9
complete-quadrilateral=7
```

Every repeated helper/side has an explicit semantic role such as
`circumcenter-midpoint-ab-definition`, `side-ab-render`, or
`first-opposite-intersection-definition`; no role or slot ID is generated from
a line number, array index, coordinate, or source string. Slot IDs combine the
stable construction identity, plan kind, and explicit role. Owners resolve to
stable entity record IDs, with semantic entity names only as a fail-closed
fallback for a validated plan.

Captured artifact: this file.

## 3. Schema-v2 body byte path is retained

Scenario: inspect the only body handoff in `compileConstructionPlan()` and the
unchanged schema-v2 directive call.

Invocation:

```powershell
rg -n "const artifact = compileConstructionWriterArtifact|artifact\.slots\.map|hint\?\.mode === 'replace'|directive\(" lib/tikz/authoring/construction-ir.ts
rg -n "writerBody\(" lib/tikz/authoring/construction-ir.ts
```

Binary observable:

- The generated body is exactly
  `artifact.slots.map((slot) => slot.canonicalSource)`.
- Slot order is the former writer body statement order, and each
  `canonicalSource` reuses the former source expression/text without markers.
- `directive()` still receives the same `body` array and therefore still emits
  the same header, record order, body order/text, end marker, and existing v2
  content fingerprint.
- The obsolete `writerBody()` call has zero matches.
- Legacy opaque `replace` returns `hint.lines`; legacy opaque `append` appends
  after generated canonical sources, preserving the previous double-opt-in
  byte path.

Captured artifact: this file.

## 4. Source-neutral semantic fingerprint domain

Scenario: inspect the fingerprint material and excluded plan fields.

Invocation:

```powershell
rg -n "canonicalWriterPlanCore|selection: _selection|sourceWriterHint: _sourceWriterHint|status: _status|mathgeo/tikz-construction-writer-slot/v1|planCore:|slot: slotIdentity|hashSource" lib/tikz/authoring/construction-ir.ts
```

Binary observable:

- Canonical JSON recursively sorts object keys and preserves semantic array
  order.
- `selection`, `status`, and `sourceWriterHint` are destructured out before
  hashing.
- The deterministic `fnv1a64-utf8` repository hash receives a domain-separated
  canonical payload containing writer ABI, canonical plan core, and slot
  identity only.
- `canonicalSource` is not fingerprint input. A conservative change anywhere
  else in the canonical plan core invalidates the plan's slots.

Captured artifact: this file.

## 5. Opaque hint and schema-v3 remain gated

Scenario: prove opaque lines are not artifact slots and no v3 serialization or
slot marker was added.

Invocation:

```powershell
rg -n "allowUnsafeOpaque|opaque writer hint requires|artifact\.slots\.map|hint\?\.mode === 'replace'" lib/tikz/authoring/construction-ir.ts
rg -n "schema=3|@mathgeo slot-(begin|end)|MANAGED_CONSTRUCTION_SCHEMA_V3" lib/tikz/authoring/construction-ir.ts
```

Binary observable:

- The first command shows the existing `allowUnsafeOpaque=true` gate and the
  legacy merge after stable artifact compilation.
- The second command returned no matches (`NONE`).
- `compileConstructionWriterArtifact()` documents and implements exclusion of
  opaque hint lines; they receive no stable slot ID or semantic fingerprint.

Captured artifact: this file.

## 6. Whitespace and scope check

Scenario: run diff whitespace validation against the untracked target file and
inspect the scoped worktree status.

Invocation:

```powershell
git -c core.autocrlf=false -c core.safecrlf=false diff --no-index --check -- /dev/null lib/tikz/authoring/construction-ir.ts
git status --short -- lib/tikz/authoring/construction-ir.ts .omo/evidence/construction-writer-artifact-slots-20260801.md
```

Binary observable:

```text
DIFF_CHECK_EXIT=1
DIFF_CHECK_DIAGNOSTIC_COUNT=0
```

Exit `1` is the expected `--no-index` result because the file differs from
`/dev/null`; zero diagnostics is the binary whitespace-clean result. Only the
assigned implementation file and this evidence artifact are in this task's
write scope.
