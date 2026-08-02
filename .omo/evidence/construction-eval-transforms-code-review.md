# Construction evaluator transform tranche - code-quality review

Date: 2026-08-01

## Decision

- **Verdict:** PASS
- **codeQualityStatus:** WATCH
- **recommendation:** APPROVE
- **reportPath:** `.omo/evidence/construction-eval-transforms-code-review.md`
- **blockers:** none

No CRITICAL or HIGH finding remains. The five requested evaluator branches match the current writer formulas and catalog entity contracts after the repairs made during review. The inversion writer's dashed guide is now represented end-to-end as a typed segment with one deterministic semantic identity.

## Review boundary and snapshot

The scoped authoring files are untracked, so Git cannot provide a versioned baseline or meaningful full diff. I reviewed the complete current snapshots and their relevant catalog, structural-validator, writer, managed-adapter, Preview IR, research, and evidence consumers. The worktree is heavily dirty; unrelated user changes were not touched.

- `lib/tikz/authoring/construction-eval.ts`: `0FE78085F5CDAC1B361F6A1F1F2E7C998B222D24FD91A7A2DD2DBF8D31BCB711`
- `lib/tikz/authoring/preview-ir.ts`: `68FD17FDC602B2B922E384812820BDDF02F24E0AFC8207D39B0819190F229E8E`
- `lib/tikz/authoring/construction-ir.ts`: `17D9FB88919244C1CB93F4F7E2AE53F2786DADDB1008FB09F13B083B3BDAFF6C`
- `lib/tikz/authoring/construction-catalog.ts`: `9F07D609890B58ADD732E2C1C04D7FB7E972709E15A08296104043B55AAC417C`
- `lib/tikz/ir/tikz-adapter.ts`: `517FBFFE09BC99BD1F5A739CA872179C2CA45DEF16913E21C47CEF46E0582AF7`
- `docs/superpowers/research/2026-08-01-tikz-constraint-solver-architecture.md`: `4DE1C3A853FA6FFD87433972DA290D7AE90AABE0E99075CEC24F0DFB27359E8C`

`omo ulw-loop status --json` was attempted through the installed Node entrypoint and returned `ULW_LOOP_PLAN_MISSING`; therefore the requested fallback report path is used. No goal-specific notepad was supplied or discovered.

Per the explicit task and repository rules, I did **not** run tests, build, lint, typecheck, browser, TeX, Docker, compiler, or other execution gates. PASS is a static code-review verdict, not runtime or domain certification.

## Skill-perspective check

The local `remove-ai-slops` and `programming` skills were consulted in full before judging tests and maintainability. The programming skill's TypeScript README, type-pattern, and data-modeling references were also consulted.

- **remove-ai-slops:** ran. No deletion-only, removal-only, tautological, prompt-string, or implementation-constant-mirroring test was added; in fact, no direct evaluator/Preview IR test exists. No unnecessary production extraction, parsing, normalization, or dependency was introduced for these transforms. Violations: missing behavioral coverage, duplicated variant routing/result aliases, and oversized production modules.
- **programming:** ran. Positive findings: closed plan variants, readonly output types, typed diagnostics, no `any`, pure boundary-neutral formulas, and fail-closed invalid geometry. Violations: missing direct behavioral tests, modules well above the 250-pure-LOC ceiling, repeated kind-routing tables, a non-null assertion at `construction-eval.ts:730`, and existing tuple assertions in Preview IR.

These violations are MEDIUM maintainability/test-confidence findings under the reviewer severity policy. Neither skill perspective identifies a remaining correctness blocker.

## Findings by severity

### CRITICAL

None.

### HIGH

None remaining.

Resolved during review:

1. Point reflection, +90-degree rotation, and homothety no longer reject their mathematically valid fixed point. The evaluator contains no coordinate-coincidence guard (`construction-eval.ts:441-490`); the catalog no longer pre-rejects fixed point reflection (`construction-catalog.ts:1485-1497`); and structural validation now checks only their references (`construction-ir.ts:1345-1347`).
2. Inversion's writer-only dashed segment was promoted into the typed contract: `guide` is part of the plan (`construction-ir.ts:456-463`), catalog entity/output graph (`construction-catalog.ts:1562-1635`), directive outputs (`construction-ir.ts:1913`), evaluator segment registration and visible ordering (`construction-eval.ts:493-519`, `:701-702`), Preview IR mapping (`preview-ir.ts:375-419`), and adapter fallback roles (`tikz-adapter.ts:355-357`).
3. A transient union-narrowing error that accessed `guide` on non-inversion plans was removed by giving `inversion-point` its own `visibleNames()` case (`construction-eval.ts:697-704`).
4. The inversion guide can no longer shadow an input reference: it is allocated through the revision-bound `nextName` namespace (`construction-catalog.ts:1562-1568`), and structural validation rejects any entity id/name that collides with an input reference (`construction-ir.ts:931-968`). This matches the adapter's local-alias-first resolution order (`tikz-adapter.ts:850-872`).

### MEDIUM

#### M1. Degeneracy status is not strictly scale-equivariant and uses a different threshold from the catalog

`isZeroDirection()` has an absolute `1e-9` floor through `max(1, |dx|, |dy|)` (`construction-eval.ts:168-173`). Uniformly shrinking a nonzero reflection axis or inversion source/radius vector below that floor changes the result from `valid` to `invalid`, even though the construction was only rescaled. The closed-form coordinate formulas are scale-equivariant whenever accepted; status is not.

The catalog independently rejects reference lengths at `1e-8`, including inversion (`construction-catalog.ts:145-148`, `:1557-1560`). Thus catalog admission and standalone evaluator admission disagree in the `1e-9 .. 1e-8` band. This does not break ordinary-coordinate formula correctness, but it prevents an unconditional scale-invariance claim and creates two precision policies for the same semantic operation.

Follow-up: define one explicit scene/viewport precision policy used by catalog validation and evaluation, then cover equivalent constructions on both sides of the threshold.

#### M2. The new observable behavior has no direct regression tests

No test/spec imports `evaluateConstructionPlan` or `createConstructionPreviewIR`. Consequently no automated artifact locks the five formulas, fixed-point cases, degeneracy statuses, immutable results, entity IDs/order, or preview/writer visible-output parity. This is false-confidence risk, especially because multiple real contract mismatches were found and repaired during static review.

Useful future tests should assert observable behavior rather than mirror constants: translated/rescaled equivalents; +90 degrees from `(1,0)` around the origin producing `(0,1)`; oblique-axis projection and reflection; fixed-point transforms; inversion `|OP| * |OP'| = R^2`; zero source/radius diagnostics; exact entity IDs and geometry order; input non-mutation and frozen results; and inversion guide parity between plan, preview, and writer.

#### M3. Evaluator/preview routing remains oversized and synchronization-prone

`construction-eval.ts` is 827 physical lines and `preview-ir.ts` is 438. Supported kinds are repeated across the evaluator switch, `visibleNames()`, and the Preview IR capability set/mapping. `ConstructionEvaluationResult` also carries duplicate aliases (`points`/`evaluatedPoints`, `entities`/`evaluatedEntities`), while `buildResult()` uses the unnecessary `entity.geometry!` assertion (`construction-eval.ts:77-89`, `:679-752`; `preview-ir.ts:79-93`, `:375-419`).

This is maintainability burden rather than a demonstrated remaining transform failure. A later responsibility-based split and one typed output/capability contract would reduce drift; avoid adding another parallel routing table.

### LOW

#### L1. Raw Tavily/Exa execution provenance is not persisted

The research document records that broad Tavily transport failed and that a Tavily retry plus Exa returned usable evidence (`docs/superpowers/research/2026-08-01-tikz-constraint-solver-architecture.md:214-218`). Its maintained-source links and conclusions are substantive and align with the implementation (`:220-242`), and the handoff record reports the same tool outcomes. However, no raw query response/transcript artifact path was saved, so this review cannot independently prove the named tool calls or their exact temporal order.

This is reported as WATCH rather than a code blocker: the persisted direct-source research is auditable and the code does not depend on an unverified secondary claim. Future research runs should save raw query-result artifacts or phrase provenance as a handoff assertion. Formula-critical mutable documentation/repository-root links should also be replaced with SHA-pinned upstream source links.

## Five-kind contract matrix

| Plan kind | Formula/orientation | Translation and scale behavior | Exact semantic output geometry | Verdict |
| --- | --- | --- | --- | --- |
| `reflect-point` | `2C-P`, matching writer interpolation | Translation-equivariant and uniformly scale-equivariant; `P=C` is valid | catalog result point with its exact entity ID | PASS |
| `reflect-line` | `H=A+dot(P-A,B-A)/|B-A|^2*(B-A)`, then `2H-P`; matches writer projection/reflection | Translation-equivariant and scales correctly above the axis threshold | `foot`, then `result`, with exact catalog point IDs | PASS with M1 caveat |
| `rotate-90` | `C+(-dy,dx)`; positive 90 degrees is counterclockwise and matches the writer | Translation/scale-equivariant; `P=C` remains valid | exact catalog result point/ID | PASS |
| `homothety-2` | `C+2(P-C)`; matches writer | Translation/scale-equivariant; `P=C` remains valid | exact catalog result point/ID | PASS |
| `inversion-point` | `C+(P-C)*|R-C|^2/|P-C|^2`; factor and finite/zero guards are correct | Translation-equivariant and scales correctly above the absolute guards | result point followed by the finite source-to-inverse guide segment, both with catalog IDs | PASS with M1 caveat |

## Immutability, status, and TypeScript inspection

- Result objects, entity/geometry arrays, diagnostic arrays/records, points, and geometry coordinates are frozen before publication (`construction-eval.ts:92-161`, `:710-752`). The custom `ReadonlyMap` wrapper exposes no mutator, and source points are copied before evaluation. **PASS by static inspection.**
- Preview IR copies evaluator coordinates, freezes all published geometry/diagnostics, and deterministically derives `unsupported`, `invalid`, or `valid` (`preview-ir.ts:132-174`, `:375-435`). **PASS by static inspection.**
- No likely concrete TypeScript error remains in the five branches. The earlier `plan.guide` narrowing defect is fixed. The non-null/tuple assertions noted in M3 violate the strict programming perspective but are not evidence of compilation failure. Because typecheck was prohibited, compilation remains **unverified**, not passed.

## Final recommendation

Approve this tranche for static code quality with WATCH items M1-M3 and L1 carried forward. The repaired code closes formula, orientation, degeneracy, semantic identity, visible geometry, immutability, and status requirements for the five requested kinds. Runtime/compiler/browser/exact-TeX validation remains explicitly outside this review.
