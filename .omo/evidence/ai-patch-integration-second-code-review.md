# Binding-scoped AI patch integration — second code review

Date: 2026-07-29

## Verdict

- `codeQualityStatus`: **BLOCK**
- `recommendation`: **REQUEST_CHANGES**
- Tests/build/lint/typecheck/browser were not run, per the parent task.
- The `remove-ai-slops` and `programming` skills were not available in the
  current skill catalog. Their criteria were applied manually. The new tests
  are generally behavior-oriented, but the body-only environment test mirrors
  one canonical spelling and therefore misses a semantically equivalent TeX
  input that bypasses the production guard.

## Recheck of previous blockers

### Resolved — allowed binding scope is now passed to validation

The route passes its derived scope as `allowedBindingIds`
(`app/api/tikz/route.ts:92-103`). The validator separately rejects proposal
read/focus IDs and operation binding IDs outside that immutable set
(`lib/tikz/ir/ai-patch-proposal.ts:328-371`). The client repeats the same check
using the captured context (`components/tikz-studio.tsx:412-428`).

The server still derives this data from the client-submitted semantic kernel,
so it is containment against an untrusted model, not an authorization boundary
against a malicious client. That is appropriate for the current local-document
threat model because the API does not commit server-side document state.

### Resolved — AI context carries authorization, insertion policy, and source text

`GeometryAiContext` now exposes `authorizedBindingIds`, typed
`insertionPolicy`, and bounded per-binding `verbatim`
(`lib/tikz/ir/ai-context.ts:55-75`). The compactor derives the empty-document
policy from adapter metadata and carries the exact slice when it is at most
4096 UTF-16 code units (`lib/tikz/ir/ai-context.ts:229-270`).

### Partially resolved — empty/full and non-empty/body-only policy exists

The validator now requires a full document for an empty source and rejects a
canonical nested environment for body-only insertion
(`lib/tikz/ir/ai-patch-proposal.ts:430-458`). The route also validates that
client-declared insertion policy matches whether the submitted source is empty
(`app/api/tikz/route.ts:473-486`).

The remaining HIGH finding below prevents approval.

### Resolved — reasoning-only patch recovery

The build route selects `reasoningTarget: "tikz-patch"` only when a semantic
proposal is required (`app/api/tikz/route.ts:510-520`). The stream boundary has
a distinct patch extractor and fallback
(`lib/llm/sse-stream.ts:20-40`, `lib/llm/sse-stream.ts:221-227`).

### Resolved for current integration — hash-only guard needs a verifier

`expectedSliceHash` is rejected when `hashSlice` is absent
(`lib/tikz/ir/ai-patch-proposal.ts:385-391`). Both current route and client
provide source text but intentionally no hash verifier, so a model cannot use
the previously decorative hash-only branch.

### Resolved — Broker checks kernel/plugin evidence

The evidence type carries trusted kernel/plugin identities
(`lib/tikz/transactions/broker.ts:18-27`) and the final commit authority rejects
mismatches before resource validation
(`lib/tikz/transactions/broker.ts:260-283`). The client supplies the current
plugin digest and optional kernel hash
(`components/tikz-studio.tsx:474-484`).

### Added tests are meaningful but incomplete

Pure tests now cover unauthorized bindings, two-operation lowering, empty
full-document insertion, canonical non-empty body rejection, missing hash
verifier, plugin mismatch/idempotency, and reasoning-only patch recovery:

- `lib/tikz/ir/ai-patch-proposal.test.ts`
- `lib/tikz/transactions/broker.test.ts`
- `lib/llm/sse-stream.test.ts`

They were inspected only, not executed.

## CRITICAL

None.

## HIGH

### H1 — Body-only/full-document validation is bypassable by legal TeX whitespace

`hasTikzpictureEnvironment()` only recognizes the byte-exact forms
`\begin{tikzpicture}` and `\end{tikzpicture}`
(`lib/tikz/ir/ai-patch-proposal.ts:246-248`). TeX ignores whitespace following
a control word, so `\begin {tikzpicture}` and `\end {tikzpicture}` are
semantically the same environment commands but do not match this regular
expression.

As a result, a non-empty document operation can insert:

```tex
\begin {tikzpicture}
...
\end {tikzpicture}
```

and pass the `tikzpicture-body` branch at
`lib/tikz/ir/ai-patch-proposal.ts:447-458`. The same spelling can be nested
inside a canonical outer environment and evade the "single environment" count
in `isSingleTikzpictureDocument()`
(`lib/tikz/ir/ai-patch-proposal.ts:250-259`). Comments between the command and
argument create additional equivalent evasions.

The candidate analysis gate is not a substitute for this policy: unsupported
or opaque-but-preserved TeX can remain warning/partial syntax rather than an
`error`, while the insertion policy promises a stronger construction
invariant.

The new test at
`lib/tikz/ir/ai-patch-proposal.test.ts:206-238` checks only the exact canonical
spelling used by the implementation, so it gives false confidence for the
semantic rule.

Required change: enforce the policy with the TikZ/TeX token or CST boundary,
normalizing control-word whitespace and comments before recognizing
`begin/end{tikzpicture}`. Add rejection cases for whitespace, newline/comment,
mixed canonical/noncanonical, and nested variants. A more permissive regular
expression alone should not be presented as complete TeX recognition.

## MEDIUM

### M1 — No direct tests cover AI-context lowering or route authorization wiring

The new compiler tests construct `AiPatchBindingContext` and
`allowedBindingIds` manually. They do not prove that:

1. `buildGeometryAiContext()` preserves the adapter's empty-document metadata;
2. the document-end insertion binding remains in the compacted/authorized set;
3. route-declared authorization is rejected when it differs from the focus
   closure;
4. `verbatim` equals the actual UTF-16 source range.

These should be pure tests; no browser or network is necessary.

### M2 — Kernel mismatch behavior is implemented but untested

`lib/tikz/transactions/broker.test.ts:55-101` covers plugin mismatch and
idempotency but not `expectedKernelHash`. Add one state-preservation assertion
for a mismatched kernel hash, parallel to the plugin test.

### M3 — Hash-only validation can still be misused by future callers without source text

The validator requires a `hashSlice` function but does not also require
`context.source`. When source is absent, `sourceSlice()` returns `undefined`,
so the hash comparison at
`lib/tikz/ir/ai-patch-proposal.ts:460-468` is skipped even though a verifier was
provided. The current route/client always pass source text, so this does not
affect the present integration, but the exported API can still compile an
unchecked hash-only proposal.

Require both source text and the verifier for hash-only guards, or move hash
verification to an authority that always owns the source.

## LOW

### L1 — `verbatim` has a per-binding limit but no total context budget

Up to 220 bindings can each carry as many as 4096 code units
(`lib/tikz/ir/ai-context.ts:221-250`). A large or overlapping construction can
therefore exceed the route's 128 KB semantic-kernel limit even when the source
itself passes its limit. Apply one shared byte/token budget and record omitted
verbatim slices in truncation metadata.

## Blockers

1. Replace byte-exact TikZ environment detection with token/CST-aware policy
   validation.
2. Add noncanonical-whitespace/comment environment cases so the regression
   test proves semantic rejection rather than mirroring the regex.

