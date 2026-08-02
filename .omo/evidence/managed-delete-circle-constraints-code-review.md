# Source-circle adoption and radical-axis code review

Date: 2026-08-01

## Review scope and verification boundary

Statically reviewed the latest construction-ID reservation, raw-circle adoption
range guard, prospective transaction validation, managed adapter resolution,
and radical-axis evaluated-geometry preconditions. Product code was not
modified. No tests, build, lint, typecheck, browser, Docker, or TeX command was
run, per request.

The requested `remove-ai-slops` and `programming` skills are not available in
the current catalog, so their criteria were applied manually. The new guards
are required transaction-boundary logic rather than unnecessary parsing. No
tautological, deletion-only, implementation-mirroring, or brittle prompt test
was added. Focused behavioral regression tests remain absent.

The executor's browser observations were treated as untrusted supporting
evidence only. No notepad or bounded full-diff artifact was provided, so the
live files were inspected directly. This report remains at the fallback path
because the installed Windows `omo` command shim previously could not return
ULW status.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M1. The adoption, orphan-reference and radical-axis guards lack focused regression tests

A repository search found no focused tests for `compileSourceCircleAdoption`,
orphaned managed-ID reservation, detached-block overlap refusal, prospective
adoption-block validation, `source-circle-2`, or evaluated-center radical-axis
rejection. The reported browser scenarios cover two important cases but do not
replace durable transaction/IR regression coverage.

Behavioral tests should cover two-circle atomic adoption; orphan references
preventing ID reuse; detached/invalid source ranges leaving source unchanged;
every prospective adoption being unique and fingerprint-valid; dependent plans
containing only `managed:` references; and exact/near-concentric rejection.
Tests should inspect broker transactions, parsed records, and resolved IR rather
than mirror serialization constants.

#### M2. Radical-axis evaluated snapshots are runtime-required but type-optional and caller-trusted

`CircleConstructionReference` declares `evaluatedCenter` and
`evaluatedRadius` optional (`lib/tikz/authoring/construction-ir.ts:258-268`),
while radical-axis validation requires both and rejects missing/non-finite
values (`lib/tikz/authoring/construction-ir.ts:823-905`). The current production
caller is safe: `radicalAxisPlan` fills snapshots directly from the clicked
circle anchors, and `compileConstructionPlan` is only called from the canvas
Broker. The base revision check prevents those evaluated values becoming stale
before commit.

Still, the type contract permits a future AI/import adapter to omit or fabricate
snapshots and discover the mismatch only at runtime. A dedicated radical-axis
circle-reference subtype with required evaluated fields, or a Broker-side
geometry precondition derived from authoritative Scene/IR, would make the
boundary explicit.

#### M3. Structural DoF diagnostics remain heuristic for derived circle constructions

The diagnostics count points and circles independently and subtract fixed
constraint weights, so derived centers and circles can be counted twice. The
output is explicitly labeled `structural-planning-only`; it must not be
presented as exact solver feasibility.

### LOW

None.

## Positive verification

- The prior cross-revision source-circle takeover is closed for the current
  production flow. Construction IR persists only `managed:` references, and
  the adapter does not establish raw `source:circle:` aliases.
- `nextConstructionId` now refuses a candidate when either a current managed
  block owns it or `baseCode` still contains `managed:<candidate>:`
  (`lib/tikz/render/tools.ts:588-613`). A dependent orphan therefore reserves
  `source-circle`; the next adoption receives `source-circle-2` instead of
  silently satisfying the old reference. The substring check is conservative
  but safe for generated TikZ-safe IDs.
- Before adopting a raw circle, `commitAuthoring` rejects any overlap between
  its exact statement range and every parsed managed block range
  (`lib/tikz/render/tools.ts:639-659`). This covers detached and invalid blocks
  as well as valid ones and closes the previously found nested re-adoption path.
- Malformed directive boundaries are also protected independently of the block
  parser. `sourceRangeOverlapsManagedDirectiveRegion` pairs nested begin/end
  lines with a stack, protects a stray end line, and protects every unmatched
  begin through EOF (`lib/tikz/render/tools.ts:572-597`). The guard runs before
  adoption ID allocation or patch creation (`lib/tikz/render/tools.ts:666-700`),
  so a rejected orphan/detached scenario leaves source unchanged and cannot add
  a nested begin marker.
- Adoption replacement(s) and the dependent plan remain one prospective source
  transaction. Each expected adoption ID must occur exactly once and its block
  must have valid metadata and fingerprint integrity; the dependent block must
  also be valid before the Broker applies the single minimal patch
  (`lib/tikz/render/tools.ts:756-800`).
- `compileSourceCircleAdoption` preserves the current source statement exactly,
  emits schema-v2 typed circle metadata, and fingerprints both metadata and
  body. Adapter reconciliation is limited to the block's `tikzBodyRange` and a
  unique typed definition key; body edits detach the record and remove its
  managed alias.
- Radical-axis catalog plans now snapshot both evaluated centers and radii from
  the selected circle anchors
  (`lib/tikz/authoring/construction-catalog.ts:1142-1207`). Runtime Construction
  IR validation requires finite positive snapshots and rejects center distance
  at or below a radius-scaled tolerance before the writer can divide by center
  distance squared (`lib/tikz/authoring/construction-ir.ts:823-905`). Distinct
  names at identical coordinates are therefore rejected.
- Radical-axis schema-v2 records require two distinct circle references, and
  the adapter maps them to explicit `first-circle` / `second-circle` roles.
- `compileConstructionPlanLines` remains removed; repository-wide search found
  no reference.

## Decision

- Static gate result: **PASS**
- `codeQualityStatus`: **WATCH**
- `recommendation`: **APPROVE**

### Blockers

None.
