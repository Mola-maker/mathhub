# Binding-scoped AI patch integration — third code review

Date: 2026-07-29

## Verdict

- `codeQualityStatus`: **WATCH**
- `recommendation`: **REQUEST_CHANGES**
- Tests/build/lint/typecheck/browser were not run, per the parent task.
- The `remove-ai-slops` and `programming` skills were not available in the
  current skill catalog. Their criteria were applied manually. The new lexical
  tests are behavior-oriented rather than deletion-only or tautological, but
  two explicitly requested regression cases are still missing.

## Confirmed by static inspection

### Direct command/group whitespace and comments

`skipTexTrivia()` consumes Unicode whitespace and repeated `%` comments before
the environment-name group
(`lib/tikz/ir/ai-patch-proposal.ts:252-265`,
`lib/tikz/ir/ai-patch-proposal.ts:267-301`). Therefore direct forms such as:

```tex
\begin {tikzpicture}
\begin% comment
{tikzpicture}
```

produce the same marker as the canonical spelling.

### Comments inside the environment name

`readEnvironmentName()` removes comments, then removes whitespace from the
group value. It therefore recognizes:

```tex
\begin{tikz% comment
picture}
```

as `tikzpicture` (`lib/tikz/ir/ai-patch-proposal.ts:276-301`). A positive
full-document case and a negative body-insertion case cover this behavior at
`lib/tikz/ir/ai-patch-proposal.test.ts:199-205` and
`lib/tikz/ir/ai-patch-proposal.test.ts:252-276`.

### Commented text

The outer scanner skips `%` comments before interpreting control sequences
(`lib/tikz/ir/ai-patch-proposal.ts:304-338`). The test at
`lib/tikz/ir/ai-patch-proposal.test.ts:277-295` confirms a commented
`\begin{tikzpicture}` does not trigger the body-only guard.

### Nested environments

`isSingleTikzpictureDocument()` requires exactly one ordered begin/end pair and
only TeX trivia outside it
(`lib/tikz/ir/ai-patch-proposal.ts:349-358`). An additional direct or disguised
pair therefore makes the marker count exceed two. The mixed canonical and
whitespace-form nested case is covered at
`lib/tikz/ir/ai-patch-proposal.test.ts:211-217`.

### AI context and Broker kernel guard

`lib/tikz/ir/ai-context.test.ts:29-73` now exercises empty/full-document policy,
the document insertion authorization, focused binding authorization, and exact
binding verbatim. `lib/tikz/transactions/broker.test.ts:55-80` now proves a
kernel hash mismatch preserves the source and returns the expected conflict.

## CRITICAL

None.

## HIGH

None.

## MEDIUM

### M1 — The explicitly requested hash-only/no-source regression test is absent

Production validation now correctly rejects a hash-only guard whenever either
trusted source text or a `hashSlice` verifier is absent
(`lib/tikz/ir/ai-patch-proposal.ts:484-497`).

However, the only test at
`lib/tikz/ir/ai-patch-proposal.test.ts:298-330` supplies `source` and omits
`hashSlice`. No test supplies `hashSlice` while omitting `source`, which was
the distinct bypass found in the second review. A repository search found no
other `hashSlice` test.

Required change: add a hash-only proposal context with a verifier but no
`source` property and assert `expected-guard`. This is a named regression
deliverable, not optional broad coverage.

### M2 — Escaped literal behavior is not independently tested or fully specified

The scanner handles a doubled backslash such as
`\\begin{tikzpicture}` by consuming the first non-control-word escape, so it
does not create a marker. The current "comment-only" test contains doubled
slashes inside an already skipped comment
(`lib/tikz/ir/ai-patch-proposal.test.ts:277-295`); it does not isolate escaped
text.

Additionally, literalizing constructs such as
`\string\begin{tikzpicture}` or
`\verb|\begin{tikzpicture}|` will conservatively be seen as an environment
marker because the lightweight scanner does not model `\string` or verbatim
commands. This is a false rejection rather than an unsafe write, but the
requested "escaped text" behavior remains undefined.

Required change: add an isolated doubled-backslash case. Either document that
`\string`/verbatim constructs are intentionally rejected by this narrow AI
write protocol, or teach the lexer to skip the supported literalizing forms
and add corresponding tests.

## LOW

### L1 — CR-only comment termination is not recognized

`skipTexComment()` stops only at `\n`
(`lib/tikz/ir/ai-patch-proposal.ts:252-255`). CRLF works because the scan
eventually reaches `\n`, but a CR-only source can hide a following direct
environment marker from the scanner even though TeX/file readers commonly
normalize CR as an end of line.

Stopping at either `\r` or `\n`, with a small regression case, would close this
edge without expanding the lexer materially.

## Blockers

1. Add the requested `hashSlice`-present/source-absent regression test.
2. Add an isolated escaped-literal case and define the policy for
   `\string`/verbatim literals.

