# Binding-scoped AI patch integration — code review

Date: 2026-07-29  
Scope reviewed:

- `lib/tikz/ir/ai-patch-proposal.ts`
- `lib/tikz/ir/ai-context.ts`
- `lib/tikz/ir/tikz-adapter.ts`
- `lib/tikz/server/extract-ai-patch.ts`
- `lib/tikz/prompt/tikz-system-prompt.ts`
- `app/api/tikz/route.ts`
- `components/tikz-studio.tsx`
- `lib/tikz/transactions/broker.ts`

Supporting dependency inspected for SSE compatibility only:
`lib/llm/sse-stream.ts`.

## Verdict

- `codeQualityStatus`: **BLOCK**
- `recommendation`: **REQUEST_CHANGES**
- Tests/build/lint/typecheck/browser were not run, per the parent task.
- The `remove-ai-slops` and `programming` skills were not available in the
  current skill catalog. Their requested criteria were applied manually. The
  production boundary is justified, but the diff currently violates the
  programming perspective through an unenforced authorization abstraction and
  a declared hash guard that is not actually checked. No new tests were present
  to run the deletion-only/tautology/implementation-mirroring test checks
  against.

## CRITICAL

None.

## HIGH

### H1 — The route computes a least-privilege read scope but never enforces it

`app/api/tikz/route.ts:437-449` derives `readBindingIds` from the focus closure,
but the validator is given every client-supplied binding at
`app/api/tikz/route.ts:91-100`. The derived set is written only to metadata as
`requestedReadBindingIds`. In `lib/tikz/ir/ai-patch-proposal.ts:304-310`, any
binding in that full map is accepted, and `lib/tikz/ir/ai-patch-proposal.ts:405-415`
only verifies that an operation belongs to the model's own self-declared
`readBindingIds`.

Consequently a model can declare any writable binding in the compact kernel as
read scope and modify an unrelated statement, even when it is outside the
server-derived focus closure. This defeats the main containment property of a
binding-scoped proposal and makes the route's `readBindingIds` calculation
dead authorization code.

Required change: distinguish available bindings from authorized bindings.
Validate proposal read/focus/operation binding IDs against an immutable allowed
set derived by the server (or pass only that filtered map to the compiler), and
make the allowed IDs explicit in the prompt/context.

### H2 — Empty-document generation cannot satisfy the advertised contract

The adapter correctly records `requiresFullEnvironment` on the document
insertion binding at `lib/tikz/ir/tikz-adapter.ts:568-583`. The AI context type
and compactor discard all binding metadata at
`lib/tikz/ir/ai-context.ts:57-72` and
`lib/tikz/ir/ai-context.ts:229-244`. Meanwhile the prompt requires that exact
flag before inserting a complete environment at
`lib/tikz/prompt/tikz-system-prompt.ts:65-67`. It also omits the current source
section when the source is empty (`lib/tikz/prompt/tikz-system-prompt.ts:158`).

After clearing the editor, the model is therefore told to rely on a flag it
cannot see. It may refuse, emit only body statements into an empty file, or
guess a full environment. This directly regresses the required "clear, then
draw again" and first-generation paths.

Required change: expose a narrow, typed insertion policy on source bindings
(for example `insertionMode: "tikzpicture-body" | "full-document"`) and validate
that an empty-document insertion contains a complete environment while a
non-empty body insertion does not.

### H3 — Reasoning-only relay recovery still speaks the old full-document protocol

Both build and repair call the provider with
`reasoningTarget: "tikz"` (`app/api/tikz/route.ts:219` and
`app/api/tikz/route.ts:483`). The supporting stream layer's recovery parser only
recognizes fenced `tikz|latex|tex` or a bare `tikzpicture`
(`lib/llm/sse-stream.ts:22-30`, `lib/llm/sse-stream.ts:211-216`). It cannot
recover a valid ````tikz-patch```` block from a reasoning-only model.

For those upstream models, a valid patch in `reasoning_content` is converted to
the old fallback message/full-document shape and then
`extractAiPatchProposal()` fails. This is a concrete provider-compatibility
failure in the new build path, not an SSE ordering problem.

Required change: give the build route a distinct patch recovery target and
teach the stream recovery boundary to extract only the fenced patch protocol
for that target. Repair can retain the full-TikZ recovery target.

## MEDIUM

### M1 — `expectedSliceHash` is accepted but never verified in this path

The validator accepts the hash-only guard at
`lib/tikz/ir/ai-patch-proposal.ts:347-350`, but only compares it when an
optional `hashSlice` callback exists
(`lib/tikz/ir/ai-patch-proposal.ts:398-399`). Neither the route
(`app/api/tikz/route.ts:91-95`) nor the client
(`components/tikz-studio.tsx:401-414`) supplies that callback. The Broker checks
only textual preconditions and `expectedText`
(`lib/tikz/transactions/broker.ts:271-295` and
`lib/tikz/transactions/broker.ts:325-337`); it never checks a slice hash.

The full-document revision/hash guard still protects current commits, so this
is not presently a stale-write exploit. It is nevertheless a false
compare-and-swap guarantee and becomes dangerous when this compiler is reused
without the stronger full-source evidence.

Required change: reject `expectedSliceHash` unless the selected algorithm and a
verifier are present, or remove the variant until the Broker implements it.

### M2 — Kernel/plugin guards are emitted but not authoritative at commit

`compileAiPatchProposal()` emits `expectedKernelHash` and `pluginSetDigest`
(`lib/tikz/ir/ai-patch-proposal.ts:503-521`), but
`TikzTransactionBroker.commit()` only checks document identity, epoch,
revision, and source evidence before moving to resource validation
(`lib/tikz/transactions/broker.ts:193-270`). There is no Broker check for either
field.

Client/server proposal validation reduces current exposure, but the final
mutation authority can still accept a transaction projected by a different
semantic/plugin version. Either enforce these guards against a trusted current
projection descriptor or stop presenting them as commit preconditions.

### M3 — No regression tests cover the new mutation boundary

A repository search found no test reference to `ai-patch-proposal`,
`aiPatchProposal`, `semanticKernel`, `expectedSliceHash`, or the document-end
binding. Static evidence in
`.omo/evidence/ai-patch-proposal-20260729.md` only checks whitespace and
describes the pure validator; it does not prove the route/client/Broker
integration.

Minimum coverage should include:

1. two disjoint operations committed atomically in descending-offset order;
2. overlap and same-offset insertion rejection;
3. stale revision/source hash rejection after an edit during streaming;
4. an out-of-authorized-scope binding rejected even when it exists;
5. empty source receives exactly one complete `tikzpicture`;
6. non-empty source receives body-only insertion;
7. reasoning-only ````tikz-patch```` recovery;
8. hash-only guard rejection until a verifier exists;
9. duplicate proposal/idempotency behavior and SSE proposal-before-DONE order.

## LOW

### L1 — Exact-offset proposals omit the exact binding text

The compact context provides global UTF-16 ranges but no binding `verbatim`
slice (`lib/tikz/ir/ai-context.ts:57-72`,
`lib/tikz/ir/ai-context.ts:229-244`). The model must count offsets in the full
document and reconstruct `expectedText`, which is brittle for long Unicode
sources. Supplying a bounded exact binding slice (or binding-relative edits
lowered by the server) would materially improve proposal reliability without
weakening source preservation.

## Blockers

1. Enforce the server-derived allowed binding/read scope.
2. Carry and validate the empty-document/full-environment insertion policy.
3. Add a patch-aware reasoning-only relay recovery path.
4. Add focused integration tests for the three high-risk paths before approval.

