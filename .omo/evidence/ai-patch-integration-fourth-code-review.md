# Binding-scoped AI patch integration — fourth code review

Date: 2026-07-29

## Verdict

- `codeQualityStatus`: **CLEAR**
- `recommendation`: **APPROVE**
- `blockers`: none
- Tests/build/lint/typecheck/browser were not run, per the parent task. This is
  a static code-and-test review, not execution evidence.
- The `remove-ai-slops` and `programming` skills were not available in the
  current skill catalog. Their criteria were applied manually. The added tests
  exercise distinct semantic inputs and observable validation outcomes; none
  is deletion-only, tautological, or merely an assertion over an extracted
  implementation constant.

## Confirmed boundaries

### Hash verifier present but trusted source absent

Production validation requires both source text and `hashSlice` for a
hash-only guard:

- `lib/tikz/ir/ai-patch-proposal.ts:490-503`

The regression test supplies a verifier while omitting `source` and asserts an
`expected-guard` rejection:

- `lib/tikz/ir/ai-patch-proposal.test.ts:400-410`

This closes the exported-API bypass identified in the second review.

### Independent doubled-backslash literal

The outer scanner treats a control symbol independently from a following
control word. Two backslashes are consumed as `\\`, so the following letters
`begin` are text rather than a `\begin` command:

- `lib/tikz/ir/ai-patch-proposal.ts:320-333`

The test isolates this form outside a comment and accepts it:

- `lib/tikz/ir/ai-patch-proposal.test.ts:297-315`

This is separate from the existing commented-text case.

### `\string` and `\verb` fail closed

The narrow write protocol intentionally does not execute TeX literalizing or
verbatim commands. The scanner therefore still sees the later direct
`\begin{tikzpicture}` token and rejects the insertion. The policy is stated
beside behavior tests for both forms:

- `lib/tikz/ir/ai-patch-proposal.test.ts:317-343`

This is conservative: it can reject otherwise exact-compilable body text, but
it cannot authorize a nested environment by interpreting macros. That tradeoff
is appropriate for a mutation authorization boundary.

### CR-only comments

`skipTexComment()` now terminates on either LF or CR:

- `lib/tikz/ir/ai-patch-proposal.ts:252-262`

The regression test places a direct environment after a CR-only comment and
asserts rejection:

- `lib/tikz/ir/ai-patch-proposal.test.ts:345-363`

CRLF remains covered by the same logic: CR terminates the comment and normal
whitespace scanning consumes the following LF.

## Rechecked scanner invariants

- Command/group whitespace and repeated comments are consumed by
  `skipTexTrivia()`.
- Comments inside the environment-name group are removed before the normalized
  name comparison.
- Commented commands are skipped by the outer scan.
- Doubled-backslash control symbols are not misclassified as control words.
- `isSingleTikzpictureDocument()` requires exactly one ordered begin/end pair
  and only TeX trivia outside it, so canonical/disguised nested environments
  remain rejected.
- Literalizing constructs fail closed instead of requiring macro expansion in
  the authorization path.

## Findings by severity

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None required for this scoped review.

