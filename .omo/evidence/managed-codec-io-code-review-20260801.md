# Managed codec / AI IO code review

Date: 2026-08-02  
Decision: **BLOCK**

- `codeQualityStatus`: `BLOCK`
- `recommendation`: `REQUEST_CHANGES`
- `reportPath`: `E:\Portaitsweb\math_geohub\.omo\evidence\managed-codec-io-code-review-20260801.md`
- `blockers`: strict-TypeScript narrowing failures; typed-plan raw TikZ injection; primitive replacement can change its concrete primitive kind; no regression evidence for these trust-boundary invariants.

## Scope and evidence boundary

Reviewed current workspace contents of:

- `lib/tikz/authoring/construction-plan-codec.ts`
- `lib/tikz/ir/ai-context.ts`
- `lib/tikz/prompt/tikz-system-prompt.ts`
- contract with `lib/tikz/ir/ai-construction-plan-proposal.ts`
- contract with `lib/tikz/authoring/managed-construction-recompile.ts`

The first, second, fourth and fifth modules are untracked in the current dirty worktree, so their complete current files were treated as the increment. The prompt file's Git diff against `HEAD` was inspected. No executor-supplied full diff or notepad path was provided. Current SHA-256 snapshots:

- `construction-plan-codec.ts`: `92B016DF35BB8577C919B3B029AE5E8795B18FFF9E48AD7C7B489A316C357F45`
- `ai-context.ts`: `AC57F17CC66DC54A4FD2947FB55C48D1B103785B2E402A74651AB10A025B8391`
- `tikz-system-prompt.ts`: `3D72A4D6C9EA93B5A11EA7D07B9AAB68F76E609C05785663DCF69A5338FB62AB`
- `ai-construction-plan-proposal.ts`: `D1FFDE9449F1F1CB6C16D74F8E1FE1F9B5B1222160D30A98BCFFF81AA90A73D0`
- `managed-construction-recompile.ts`: `A4E61F6320AB2378B372B872B2A6FB316EE45A83CD3CCD24E6EC640F3565A01F`

Per owner instruction, no tests, build, lint, typecheck, TeX/compiler, Docker or browser commands were run. Therefore this is a static review, not runtime verification.

## Skill-perspective check

The locally available `remove-ai-slops` and `programming` skills were both loaded and consulted before judging test relevance and maintainability.

- `remove-ai-slops`: **violated** by missing behavior coverage, repeated whole-source parsing and four oversized production modules. No deletion-only, requested-removal-only, tautological or prompt-phrase-pin tests were found; the problem is absence of relevant tests, not useless tests.
- `programming`: **violated** by readonly-array narrowing that strict TypeScript cannot prove, untyped casts at parsed boundaries, non-exhaustive runtime-kind preservation for primitive replacements, and raw string interpolation at a supposedly typed writer boundary.

## Findings

### CRITICAL

None.

### HIGH

#### H1 - Strict TypeScript cannot narrow the readonly collection/tuple unions used by the proposal compiler

`bindingMap()` accepts `readonly AiPatchBindingContext[] | ReadonlyMap<...>` but uses `Array.isArray()` and returns the false branch as a map (`ai-construction-plan-proposal.ts:121-126`; union declared at `ai-patch-proposal.ts:94-99`). `Array.isArray()` narrows to mutable `any[]`; it does not exclude a `readonly ...[]` from the false branch. The same defect occurs for `ConstructionPoint = readonly [number, number] | {x,y}` in `planPointSnapshot()` (`ai-construction-plan-proposal.ts:368-385`; union at `construction-ir.ts:65-67`): the false branch still includes the readonly tuple, so `.x/.y` are not type-safe.

This is a source-level compile blocker under the repository's `strict: true` TypeScript configuration. Typecheck was deliberately not run, so there is no executable gate output to cite; the invalid narrowing remains visible in the source.

Required fix: use explicit guards that recognize readonly tuples/arrays and an explicit map discriminator (`bindings instanceof Map` or a map-like guard), then obtain owner-run strict typecheck evidence.

#### H2 - Untrusted typed plans can still inject caller-authored TikZ through the trusted managed writer

The proposal compiler accepts an untrusted plan when `validateConstructionPlan()` reports no issues (`ai-construction-plan-proposal.ts:455-470`) and the recompiler passes it to `compileConstructionPlan()` (`managed-construction-recompile.ts:221`). But Construction IR validates label text only as a non-empty string (`construction-ir.ts:1267-1270`) and interpolates it directly into a TikZ node body (`construction-ir.ts:1709-1710`). A label such as a closing brace/statement followed by another allowed TikZ command and a trailing comment can escape the node body and add arbitrary TikZ statements inside the managed block. The API's later forbidden-command sanitizer does not restore the typed semantic boundary; it blocks only a small command list and still permits arbitrary drawing, scoping, clipping and other source effects.

The circle scalar path has the same structural defect: any non-empty string is accepted as a `ConstructionScalar` (`construction-ir.ts:570-572`), `tikz-coordinate-serializer.ts:5-7` returns string scalars verbatim, and point-on-circle/tangent writers interpolate radius/angle strings (`construction-ir.ts:1786-1796,1849-1864`). Those three circle-related plan kinds are decoder-unavailable for replacement, but the typed create lane still accepts them.

This violates the prompt's claim that managed mode is “typed plan only” and that the trusted compiler regenerates source without caller-authored raw replacement (`tikz-system-prompt.ts:97-115`). For a replace-capable label primitive, this is a direct raw-source tunnel into a binding that is intentionally `writable:false` to the raw patch protocol.

Required fix: parse/serialize label content and scalar expressions through explicit safe typed grammars (or reject these fields for AI-origin plans until such serializers exist). Do not rely on prompt wording or the final coarse sanitizer as the authorization boundary.

#### H3 - “Same kind” replacement does not preserve the concrete kind of a primitive block

The recompiler checks only `nextPlan.kind !== block.planKind` (`managed-construction-recompile.ts:200-208`) and reparsed `planKind` (`:221-230`). For every primitive block, both values are the family discriminator `primitive`; the concrete source/header kind is `block.kind` / `nextPlan.primitive.kind`. Neither the precondition nor the post-compile check compares that concrete kind. The binding/proposal carries `expectedPlanKind`, not the managed syntax/primitive kind (`ai-construction-plan-proposal.ts:47-55,586-604`).

Consequently a canonical primitive point/segment/etc. can be replaced by a primitive label (or another primitive subtype) while satisfying the advertised same-kind guard. This contradicts `tikz-system-prompt.ts:109`, can invalidate the semantic identity of the managed block, and amplifies H2 by allowing a non-label primitive to be converted into the raw label-text sink.

Required fix: attest and compare the concrete managed kind as well as `planKind`; for `planKind === 'primitive'`, require `nextPlan.primitive.kind === block.kind`, and require the reparsed replacement's `kind` to remain equal to the prior block's `kind`. The ConstructionPlan validator should also require the primitive definition to agree with its semantic entity/output records.

### MEDIUM

#### M1 - No focused regression tests cover the new codec or managed replacement contract

Repository search found no tests referencing `decodeManagedConstructionPlan`, `managedConstructionPlanRecompilePatches`, `compileAiConstructionPlanProposal`, `construction-plan-proposal/v1` or `managedPlan`. Existing `ai-context.test.ts` covers insertion policy and focus binding authorization only; it does not assert canonical `previousPlan`, unavailable diagnostics or replace capability.

Required coverage should be behavior-level, not prompt-string snapshots: all 16 recoverable plan kinds; the 3 intentionally unavailable circle-related kinds; stale/invalid/source-adopted/styled/CRLF/mixed-EOL cases; focus-only `previousPlan`; no raw-patch fallback; primitive subtype preservation; adversarial label/scalar payload rejection; client/server proposal parity. No deletion-only or implementation-constant tests should be added.

#### M2 - Focused context reparses the complete source once per focused managed block

`compactConstruction()` already caches `parseManagedConstructionBlocks(source.text)` per source (`ai-context.ts:315-341`), but each `managedPlanOf()` then calls `decodeManagedConstructionPlan()` (`:356`), whose `currentBlock()` reparses the complete source again (`construction-plan-codec.ts:791-802`). With up to 240 bindings (`ai-context.ts:384-387`), prompt construction can become `O(focused managed blocks × source length)` synchronously on both client and server.

This is not classified HIGH without a benchmark or demonstrated UI/API latency failure, but it is avoidable repeated boundary work. Keep the decoder fail-closed while allowing it to consume a trusted parser-owned current block/index without rescanning the source for every binding.

#### M3 - Four reviewed production modules exceed the consulted skills' maintainability ceiling

Approximate nonblank/non-comment LOC: codec 906, AI context 567, proposal compiler 668, managed recompiler 292. The codec combines per-kind schema recovery, semantic matching, canonical proof and context projection; the proposal module combines shape parsing, scope analysis, namespace projection, evaluation and transaction lowering. This violates both consulted skills' 250-LOC perspective and materially raises the chance that the manually duplicated kind/guard matrices drift.

Refactor by responsibility after behavior is locked; do not split mechanically or create catch-all helpers.

### LOW

#### L1 - The 19-kind registry is manually duplicated

`PLAN_KINDS` lists all current 19 `ConstructionPlanKind` values (`construction-plan-codec.ts:77-97`), while `recoverDefinition()` separately lists all branches (`:725-760`). The switch's `never` default helps the switch itself, but the `Set<ConstructionPlanKind>` type does not prove completeness. A future kind can be added to the union/switch but omitted from the set and will fail early as unsupported. Prefer a single exhaustive registry or a compile-time completeness assertion.

## Success-criteria matrix

| Criterion | Static verdict | Evidence |
| --- | --- | --- |
| Schema-v2 canonical decode fails closed | **PASS** for the decoder itself | Current block is reparsed and uniquely matched; schema/metadata/integrity/source-adopted checks precede recovery; the recovered plan is validated; the entire managed slice must byte-match trusted recompilation (`construction-plan-codec.ts:791-960`). Styled/diverged blocks fail closed. |
| Focused context exposes `previousPlan` correctly | **PASS** | Only focus-scoped whole-block bindings call the decoder; only canonical success publishes full `previousPlan`; failures publish bounded typed issues; raw semantic records are withheld (`ai-context.ts:315-378,420-455,474-481`). |
| Replace capability cannot be bypassed | **BLOCK** | Raw patching remains correctly denied because managed bindings are `writable:false`, and capability requires focus + valid metadata/integrity + canonical decode (`ai-context.ts:420-449`). However H2 provides a raw-source tunnel through typed fields and H3 permits primitive subtype change. |
| 19 kinds / 3 unsupported circle-related kinds are consistent | **PASS** statically | All 19 current union members are in `PLAN_KINDS`; 16 enter recovery; exactly `point-on-circle`, `tangent-at-point` and `radical-axis` share the fail-closed `insufficient-plan-data` path (`construction-plan-codec.ts:705-760`). Primitive circle and circumcircle remain recoverable. |
| Serialization | **WATCH/BLOCK via H2** | `previousPlan` is JSON-shaped in practice and full-plan serialization retains required transient validation fields, but raw string source fields are not grammar-safe. |
| Performance | **WATCH** | No demonstrated HIGH, but M2 is avoidable repeated full-source parsing. |
| Permission / trust boundary | **BLOCK** | Binding/CAS/focus checks are strong, but typed plan content can escape its semantic representation (H2), and concrete primitive kind is not preserved (H3). |

## Blockers before approval

1. Replace both readonly `Array.isArray` narrowings with strict-type-safe guards and provide owner-run typecheck evidence.
2. Close label/scalar raw-source injection at the ConstructionPlan boundary for AI-origin plans.
3. Preserve and attest concrete primitive kind before and after managed replacement, and couple primitive definition to semantic records.
4. Add focused adversarial/round-trip tests for the codec, focused `previousPlan`, capability denial, concrete-kind preservation and raw-string rejection; have the owner run the authorized gates.

Final recommendation: **REQUEST_CHANGES / BLOCK**.
