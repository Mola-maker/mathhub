# Typed transform constraints — code quality review

Date: 2026-08-01

## Decision

- Result: **PASS**
- `codeQualityStatus`: **WATCH**
- `recommendation`: **APPROVE**
- Blockers: **None**
- Scope: only the four requested source files and the two requested evidence files.
- Execution boundary: no tests, build, lint, typecheck, TeX, Docker, or browser commands were run by this reviewer.
- Report routing: `omo ulw-loop status --json` was consulted through the installed Node entrypoint and returned `ULW_LOOP_PLAN_MISSING`; the requested fallback report path is therefore used.

The current snapshot is internally closed for all four typed transforms. No optional field, unsupported adapter branch, formula mismatch, duplicate record ID, orphan result/foot record, missing adapter parameter, missing fallback role entry, or missing adapter version bump was found.

## Snapshot reviewed

The four source files are currently untracked, so Git cannot supply a versioned full diff. The review therefore covers the exact current-file snapshot supplied for this task. SHA-256 values were checked before and after review and did not drift:

- `lib/tikz/authoring/construction-ir.ts`: `75DD025DD7FA2B849E7EFB0F7AA6ED5546CC758A8D81BD9FA331672043AE559A`
- `lib/tikz/authoring/construction-catalog.ts`: `CA351D2B15BC6C9710AAD12E9C9DF655F0EA050088F38C2BEE1351B1701EBFAC`
- `lib/tikz/semantics/managed-construction.ts`: `591EEADC132CA73A924A7D1C4F75D7056F38FFF007EC4EF6FD83E6B0F758BD2F`
- `lib/tikz/ir/tikz-adapter.ts`: `654E22D1D8D3C511E0188BD77AD17AD95C478999FD52DA0975233AD48405A93D`

## Closure matrix

| Plan | Typed schema | Authoring validator | Catalog record/references | Schema-v2 decoder | Adapter roles/parameters | Writer semantics | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `reflect-point` | `construction-ir.ts:118-126` | `construction-ir.ts:618-621`, plus plan refs/distinctness at `877-880` | Constraint/result/dependencies/output at `construction-catalog.ts:1056-1078` | `managed-construction.ts:194-202` | Constraint roles at `tikz-adapter.ts:991-996`; fallback roles at `339-342` | `construction-ir.ts:1285-1290` emits `P + 2(C-P) = 2C-P` | PASS |
| `reflect-line` | `construction-ir.ts:127-136` | `construction-ir.ts:622-626`, plus plan refs/axis check at `882-885` | Foot/result entities, one typed constraint, separate dependencies and outputs at `construction-catalog.ts:1082-1116` | `managed-construction.ts:203-211` | Source/axis endpoints/foot/result at `tikz-adapter.ts:997-1004`; fallback roles at `343-346` | `construction-ir.ts:1291-1300` emits projection foot `H`, then `2H-P` | PASS |
| `rotate-90` | `construction-ir.ts:137-145` | References and scalar at `construction-ir.ts:628-631`, plus plan refs/distinctness at `877-880` | `angleDegrees: 90`, result, dependencies and output at `construction-catalog.ts:1120-1143` | `managed-construction.ts:212-218` | Source/center/result at `tikz-adapter.ts:1005-1010`; `angleDegrees` at `1109-1110`; fallback roles at `347-350` | `construction-ir.ts:1302-1306` emits a +90° rotation about the center | PASS |
| `homothety-2` | `construction-ir.ts:146-154` | References and scalar at `construction-ir.ts:632-634`, plus plan refs/distinctness at `877-880` | `scale: 2`, result, dependencies and output at `construction-catalog.ts:1147-1170` | `managed-construction.ts:219-225` | Source/center/result at `tikz-adapter.ts:1011-1016`; `scale` at `1111-1112`; fallback roles at `351-354` | `construction-ir.ts:1308-1312` emits `C + 2(P-C)` | PASS |

The scalar validators accept finite numbers or non-blank scalar expressions consistently (`construction-ir.ts:527-534`, `managed-construction.ts:131-136`). The adapter version is explicitly `1.10.0` (`tikz-adapter.ts:37-40`) and is published into Geometry IR metadata (`1889-1893`). The only remaining `constraints: []` catalog record is the primitive plan (`construction-catalog.ts:637`), not one of the four transforms.

Record/reference audit:

- Every reflected/rotated/homothetic result has an entity, constraint reference, dependency relation, and output record.
- Line reflection additionally exposes its projection foot as both an entity and output, and its foot/result dependency edges are separate (`construction-catalog.ts:1094-1109`).
- Record IDs are unique within each managed record type. The homothety block ID and constraint record ID share text intentionally but occupy different identity namespaces; adapter IDs remain block- and record-qualified (`tikz-adapter.ts:1102-1105`).
- Adapter resolution aliases entity record IDs and semantic names before projecting constraints (`tikz-adapter.ts:800-817`), so result and foot arguments resolve to their emitted entities rather than becoming unused metadata.
- Invalid/unsupported/detached versioned metadata does not enter lossy header fallback (`tikz-adapter.ts:712-729`). Legacy header fallback has entries for all four plan kinds (`339-354`).

## Findings by severity

### CRITICAL

None.

### HIGH

None.

### MEDIUM

1. **Managed schema-v2 reference validation is weaker than authoring validation.** The new transform decoder branches accept reference fields using only `typeof value.* === 'string'` (`managed-construction.ts:197-225`), while authoring validation requires a TikZ-safe name or persistent semantic reference (`construction-ir.ts:516-525`, `607-615`). A correctly fingerprinted but externally supplied record with empty/malformed references can therefore be classified as valid metadata and later resolve to `unresolved:reference:*` (`tikz-adapter.ts:373-388`, `812-817`). This does not affect the four catalog plans because they pass the stricter authoring validator before serialization, so it is not a blocker for this snapshot; it is boundary-hardening debt.

2. **Parameterized constraint projection is not explicitly exhaustive.** `tikz-adapter.ts:1109-1113` uses a nested ternary and an optional empty-object fallback for parameter projection. The current `rotation` and `homothety` cases are correct, but a future parameterized constraint can compile while silently omitting its parameters. This violates the `remove-ai-slops` nested-ternary rule and the `programming` exhaustive-variant preference. It is a forward-maintenance risk, not a current correctness failure.

3. **All four touched modules exceed the programming/remove-ai-slops 250-pure-LOC ceiling.** Approximate non-blank/non-comment counts are: `construction-ir.ts` 1495, `construction-catalog.ts` 1836, `managed-construction.ts` 698, and `tikz-adapter.ts` 1885. The transform feature consequently requires synchronized edits across a large union, validators, catalog, decoder, role table, and adapter switch. The current snapshot is synchronized, but the structure raises future omission risk. This is existing architectural debt and does not justify blocking this bounded transform closure.

### LOW

None.

## Evidence audit

- `.omo/evidence/typed-transform-constraints-static-20260801.md` accurately identifies the relevant schema, validator, catalog, adapter, parameter, version, and writer locations. Its `constraints: []` claim was independently matched at catalog line 637.
- `.omo/evidence/typed-transform-constraints-browser-verification.md` records all four observable operations, scalar values, line-reflection foot/result records, final construction validity, and the explicit prohibition on Docker/test/build/lint/typecheck/TeX. It is a prose execution record rather than a screenshot/trace bundle; the code-review approval rests on independently inspected source closure, not on trusting that prose alone.
- No claim is made that automated or compiler gates passed; they were explicitly owner-reserved and not run.

## Skill-perspective check

- `remove-ai-slops`: **Ran.** No test files were in scope, so no deletion-only, removal-verification, tautological, constant-mirroring, or brittle prompt tests were present to assess. Production-code violations: oversized modules and the nested parameter ternary noted above. No needless data extraction/parsing/normalization was added for these transforms; the managed-record parser is the required source boundary.
- `programming`: **Ran**, including its TypeScript entry, type-pattern, and data-modeling guidance. Positive findings: readonly discriminated constraint variants, no `any`, no `as any`/`as unknown`, no non-null assertions, no `@ts-ignore`/`@ts-expect-error`, and boundary decoding before adapter projection. Violations: the 250-pure-LOC ceiling and the non-explicitly-exhaustive parameter projection. Neither violation breaks the current four transforms.

## Final recommendation

**APPROVE / PASS.** No CRITICAL or HIGH finding remains, and there is no issue that must be fixed before the parent task proceeds. Keep the two validator/exhaustiveness observations and the module-size debt on the follow-up ledger.
