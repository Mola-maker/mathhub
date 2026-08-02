# Advanced incidence constraints — code quality review

Date: 2026-08-01

## Decision

- Result: **PASS** after targeted re-review
- `codeQualityStatus`: **WATCH**
- `recommendation`: **APPROVE**
- Blockers: **None**. The prior HIGH cyclic-degeneracy issue is fixed.
- Scope: only `lib/tikz/authoring/construction-ir.ts`, `lib/tikz/authoring/construction-catalog.ts`, `lib/tikz/semantics/managed-construction.ts`, and `lib/tikz/ir/tikz-adapter.ts`.
- Execution boundary: no tests, build, lint, typecheck, TeX, Docker, or browser commands were run. The product owner reserved those gates.
- Report routing: `omo ulw-loop status --json` failed through the generated wrapper; the installed Node CLI returned `ULW_LOOP_PLAN_MISSING`, so the requested fallback evidence path is used.

The two new constraint variants are carried through the TypeScript union, authoring validation, schema-v2 decoder, catalog plans, adapter argument/parameter projection, and existing writer formulas. Current catalog-generated references are internally resolvable and no raw/source signature is persisted as entity identity. The cyclic-quadrilateral validator now evaluates the same second-intersection formula used by the writer and rejects a derived D coincident with B or C using a scale-aware tolerance. Schema-record and header-fallback output roles now match.

## Initial snapshot reviewed

The four source files are untracked, so Git cannot provide a versioned diff. This review covers the exact current-file snapshot:

- `construction-ir.ts`: `B918DF10B98264F9A5390830404E4B42063E9ECA789B35396FC0B28D207E58F9`
- `construction-catalog.ts`: `F86F481789C55C64AB4214CFDD39F34465B6F9528DC3A214C4AE34E5AF88F2B0`
- `managed-construction.ts`: `EC8A85C49AAF802CB261790246ED83769084F6C887C5A61B1B141F92ADABF903`
- `tikz-adapter.ts`: `FC081536958F302EA48EC8D93030A04E488DBA3FDA9C5567C4369F11F530ED13`

## Final targeted re-review snapshot

The blocker fix and role-contract fix were re-reviewed in the two requested files:

- `construction-catalog.ts`: `B8022617F0B026A3517CB977567A37E601823D582A6BA46699ED4CF206231ECF`
- `tikz-adapter.ts`: `14C0E20EDEDAAAA1537B2F462A80BC80776182D5BE0F2049089D8F05EEBE03A9`

`construction-ir.ts` changed concurrently under the separate graph-closure hardening workstream (`97A2F982B658B4DE0F8CAB44AFB53B15282B840C312F23821158A9C6A76B0B62`). That separate change was not included in this targeted re-review and is not used as evidence for this approval.

## Closure audit

### `line-intersection`

- Discriminated union: `construction-ir.ts:239-248` declares point, two line references, and the explicit infinite-line domain.
- Authoring validator: `construction-ir.ts:704-712` validates the three references, distinct parent line names, and `domain='line'`.
- Complete-quadrilateral catalog: `construction-catalog.ts:1865-1868` declares all four line entities; `1880-1897` binds X to AB/CD and Y to BC/DA; `1905-1912` emits the matching dependency graph. All constraint refs resolve to catalog inputs or declared entities.
- Managed decoder: `managed-construction.ts:286-293` restricts the record to schema v2 and preserves the domain selector.
- Adapter: `tikz-adapter.ts:1094-1099` projects point/line roles and `1126-1127` projects the domain parameter.
- Writer: `construction-ir.ts:1099-1113` computes the intersection of infinite supporting lines; `1416-1434` uses the same AB/CD and BC/DA pairings and renders extended lines.

### `line-circle-other-intersection`

- Discriminated union: `construction-ir.ts:249-260` declares point, line, circle, excluded point, infinite-line domain, and stable `exclude-known-point` selector.
- Authoring validator: `construction-ir.ts:713-727` checks fields, output/excluded-point distinction, domain, and selector.
- Cyclic catalog: `construction-catalog.ts:1686-1717` declares center, D, circle, secant line, and polygon; `1719-1745` connects the three-point circle, secant/circle other-intersection, and cyclic constraints; `1746-1752` emits matching dependencies. All record references resolve to an input or declared entity.
- Managed decoder: `managed-construction.ts:294-304` restricts the record to schema v2 and preserves both domain and selector.
- Adapter: `tikz-adapter.ts:1100-1106` projects point/line/circle/excluded-point roles and `1128-1134` projects selector/domain parameters.
- Writer: `construction-ir.ts:1116-1128` computes the second line-circle root relative to the known A point; `1401-1414` uses that result in the quadrilateral and circle rendering.

### Identity, compatibility, and prior semantic branches

- Catalog constraints use semantic names declared in inputs/entities; persistent raw `source:*` identities are not introduced.
- Adapter resolution remains record/name alias first, then qualified cross-block managed identity, then persistent managed identity (`tikz-adapter.ts:794-817`). Raw circle definition signatures remain explicitly excluded from identity aliases (`637-645`).
- Invalid/detached schema-v2 metadata still fails closed rather than entering header fallback (`tikz-adapter.ts:712-729`).
- Adapter version is `1.11.0` (`tikz-adapter.ts:38`) and is published by the existing metadata path.
- Existing transform and radical-axis union/decoder/adapter branches remain present; no conflicting switch case or parameter overwrite was found.

## Findings by severity

### CRITICAL

None.

### HIGH

None.

Resolved on re-review:

- `construction-catalog.ts:1676-1717` derives `t = -2(d·r)/|d|²`, exactly matching the writer at `construction-ir.ts:1116-1128`, checks every intermediate/result for finiteness, and compares the derived point with B and C using `1e-7 * max(scene magnitudes, 1)`. A chord through AB or AC now fails before plan creation; tangent rejection remains the separate dot-product branch.
- The guard does not alter the writer or managed selector: valid non-tangent, non-degenerate secants still compile to `exclude-known-point`, while invalid input produces no partial managed transaction.

### MEDIUM

1. **Managed schema-v2 decoding checks primitive string shape, not semantic reference validity or referenced entity kind.**

   `managed-construction.ts:286-304` accepts empty/malformed strings and cannot prove that `line1/line2` are line entities or that `circle` is a circle entity. Correctly fingerprinted catalog output is safe because it passed authoring validation, but externally supplied schema-v2 metadata can be classified valid and projected into unresolved or type-incoherent IR. This is boundary-hardening debt shared with older constraint variants.

2. **Constraint parameter projection is increasingly non-exhaustive and nested.**

   `tikz-adapter.ts:1122-1135` now uses a four-branch nested ternary ending in `{}`. The current four parameterized kinds are projected correctly, but future parameterized variants can compile while silently losing parameters. This violates the remove-ai-slops readability rule and programming exhaustiveness preference. Prefer an exhaustive helper/switch keyed by the discriminated constraint union.

3. **The four synchronized modules remain oversized and omission-prone.**

   Current line/nonblank counts are approximately 1646/1573, 1958/1919, 763/731, and 1979/1925. The incidence feature required synchronized edits in a union, validators, catalog, decoder, fallback-role table, adapter switch, parameter branch, and writer. The snapshot is synchronized, but the structure makes future partial support likely. This is existing architectural debt, not the current blocker.

### LOW

None.

## Test and evidence audit

- No automated tests or compiler gates were run, by explicit owner instruction.
- `.omo/evidence/advanced-incidence-constraints-browser-verification.md` now records positive cyclic and complete-quadrilateral flows plus tangent, parallel, and collinear-secant rejection. In the collinear-secant scenario a distinct `P=(2,0)` on AB was rejected, the source stayed at six lines, and no managed block was partially written.
- The browser artifact is a prose execution record rather than a trace bundle. Approval rests primarily on independently inspected source closure; the browser record corroborates the expected transaction behavior.

## Skill-perspective check

- `remove-ai-slops`: the skill was **not available in the exposed skill catalog**, so its documented overfit/slop criteria were applied manually. No tests were in scope, hence there were no deletion-only, requested-removal, tautological, constant-mirroring, or brittle prompt tests to assess. Production findings are the nested parameter ternary and oversized synchronized modules; no unnecessary data extraction/normalization was added for this feature.
- `programming`: the skill was **not available in the exposed skill catalog**, so its documented TypeScript/boundary criteria were applied manually. Positive findings include readonly discriminated variants, no `any` escape hatch in the reviewed additions, stable selector/domain literals, finite numeric guards, and fail-closed detached metadata. The remaining violation in this targeted scope is non-exhaustive parameter projection. Construction-plan graph closure is being hardened in a separate workstream and was intentionally not used to delay this re-review.

## Final recommendation

**APPROVE / PASS.** No CRITICAL or HIGH finding remains. The writer-equivalent degeneracy guard rejects the previously demonstrated B/C coincidence, output-role vocabularies match in schema records and fallback, and the browser evidence records both positive and rejection paths. Keep the remaining decoder, parameter-exhaustiveness, and module-size items on the follow-up ledger.
