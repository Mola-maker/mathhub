# Constraint DoF registry — code quality review

Date: 2026-08-01

## Decision

- Result: **PASS**
- `codeQualityStatus`: **WATCH**
- `recommendation`: **APPROVE**
- `blockers`: **None**
- Reviewed file: `lib/tikz/solver/constraint-diagnostics.ts`
- Snapshot SHA-256: `B1007C47E602F923A7F192F7B705C6818FB614B17D1E1262A91D97273EA7D80E`
- Execution boundary: no tests, build, lint, typecheck, browser, TeX, or Docker commands were run, per the product-owner restriction.

## Scope and correctness

The seven added structural weights match the current discriminated `ConstructionConstraint` union:

| Constraint kind | Union location | Registry location | Reviewed structural reduction |
| --- | --- | --- | --- |
| `point-reflection` | `construction-ir.ts:122-126` | `constraint-diagnostics.ts:61` | 2: the reflected point is fixed by two scalar coordinate equations |
| `line-reflection` | `construction-ir.ts:130-136` | `constraint-diagnostics.ts:62-64` | 4: projection foot plus reflected point contribute four derived coordinates |
| `rotation` | `construction-ir.ts:140-145` | `constraint-diagnostics.ts:65` | 2: a fixed-angle image point is determined in two coordinates |
| `homothety` | `construction-ir.ts:149-154` | `constraint-diagnostics.ts:66` | 2: a fixed-scale image point is determined in two coordinates |
| `radical-axis` | `construction-ir.ts:233-238` | `constraint-diagnostics.ts:67-69` | 2: equal-power incidence plus axis direction is a conservative structural count |
| `line-intersection` | `construction-ir.ts:243-248` | `constraint-diagnostics.ts:70-72` | 2: one incidence equation for each parent line; `domain` is discrete |
| `line-circle-other-intersection` | `construction-ir.ts:253-260` | `constraint-diagnostics.ts:73-75` | 2: line plus circle incidence; the excluded-known-point selector is discrete |

No spelling mismatch, missing targeted variant, or extra targeted registry key was found. The open `GeometryConstraint.kind: string` projection also carries these exact strings in `tikz-adapter.ts:1093-1112`.

The file consistently labels the result as planning-only: `ConstraintDiagnostic.structural` explicitly disclaims numerical residual/convergence (`constraint-diagnostics.ts:18-24`), the report mode is `structural-planning-only` (`42-43`), the registry comment disclaims evaluated residuals/rank (`58-60`), and the function returns that mode (`168`). Nothing in the added comments claims numerical solver correctness.

## Findings by severity

### CRITICAL

None.

### HIGH

None.

### MEDIUM

1. **The new registry behavior has no focused regression coverage.**

   A repository search found no test or spec referencing `diagnoseConstraintStructure`, `constraintDiagnosticsMode`, or `estimatedDof`. Consequently, there is no executable guard that these seven kinds avoid the `unknown` diagnostic or reduce a component by the intended structural weight. This is not a correctness failure in the inspected snapshot, and tests are explicitly owner-run, but it leaves future registry drift undetected.

### LOW

1. **The radical-axis comment mentions a branch selector that its union variant does not have.**

   `constraint-diagnostics.ts:67-68` says “The branch selector and helper point…”, while `ConstructionConstraint`'s `radical-axis` variant only carries `line`, `point`, `circle1`, and `circle2` (`construction-ir.ts:230-238`). The helper direction exists in the construction plan, but there is no radical-axis branch selector. The weight remains plausible; this is a misleading copy/paste phrase, not a runtime defect.

2. **Current union/registry consistency is manually maintained rather than compiler-enforced.**

   `constraintDof` is declared as `Record<string, number>` (`constraint-diagnostics.ts:49`), so adding or renaming a closed construction constraint cannot force a corresponding registry decision. This is compatible with the intentionally open `GeometryConstraint.kind` vocabulary and is not a blocker, but it weakens the TypeScript proof for the closed authoring union.

## Remove-AI-slops and programming skill perspectives

- `remove-ai-slops`: **consulted** from the installed OMO skill. No deletion-only, tautological, constant-mirroring, brittle prompt, or requested-removal tests exist in this scope. No needless extraction, parsing, normalization, abstraction, oversized module, or performance-equivalence issue was introduced. The irrelevant `branch selector` wording is the only localized comment-slop finding; absent behavior coverage is recorded above.
- `programming`: **consulted**, including its TypeScript README and type-pattern guidance. The additions use exact literal spellings and add no `any`, type assertion, non-null assertion, parsing boundary, or nested variant chain. The sole TypeScript-proof weakness is the existing open-string registry, which cannot enforce synchronization with the closed `ConstructionConstraint` union.

## Evidence assessment

- The target file is untracked, so a versioned Git diff was unavailable; this review covers the exact SHA-256 snapshot above.
- Static source inspection verified the targeted union variants, their adapter projection spellings, the registry entries, and planning-only labels.
- Automated verification was intentionally not executed. The missing focused test is therefore retained as a WATCH item rather than represented as passing evidence.

## Final recommendation

**APPROVE / PASS.** The seven weights are present, correctly spelled, structurally plausible, and explicitly isolated from numerical-solver claims. No CRITICAL or HIGH issue remains. Keep regression coverage and the two small maintainability cleanups on the follow-up ledger.
