# Managed codec / AI I/O blocker fix

Date: 2026-08-01

Scope was intentionally limited to:

- `lib/tikz/authoring/construction-plan-codec.ts`
- `lib/tikz/ir/ai-context.ts`
- `lib/tikz/ir/ai-construction-plan-proposal.ts`
- `lib/tikz/prompt/tikz-system-prompt.ts`

No test, build, lint, TypeScript, TeX, Docker, or browser command was run. Product
verification remains with the user. Only source inspection, `rg`, and diff whitespace
checks were used.

## Blockers addressed

### 1. Strict readonly narrowing

- `bindingMap()` now uses an explicit map-like type predicate rather than relying on
  `Array.isArray()` to negatively narrow a `readonly array | ReadonlyMap` union.
- `planPointSnapshot()` now uses an explicit `ConstructionPoint` object guard, so the
  readonly tuple branch is indexed only after positive object narrowing fails.

### 2. One fail-closed TikZ writer grammar at the AI/codec boundary

`validateConstructionPlanWriterSafety()` is exported by the codec and is called by:

- the schema-v2 canonical decoder before it exposes a replaceable `previousPlan`;
- the AI proposal compiler for both `plan` and `previousPlan` before any writer call.

It rejects:

- names, references, roles, tags, IDs, output names, and plan fields outside their
  canonical grammars;
- arbitrary label TeX, control sequences, structural delimiters, managed markers, and
  labels over 256 code units (the only math-label form admitted is one canonical
  `$name$` token, needed by the existing primitive-label factory);
- string-valued raw TikZ scalar expressions; AI-replaceable scalars must be finite JSON
  numbers;
- every `sourceWriterHint`;
- primitive definitions that do not agree with exactly one concrete semantic entity and
  output record.

Codec rejection is typed as `unsafe-writer-surface`; unsafe canonical recovery therefore
cannot mint a replacement capability.

### 3. Concrete primitive kind is a CAS precondition

- `constructionPlanSyntaxKind()` returns `primitive.kind` for primitive plans and the
  ordinary plan kind for every other plan.
- AI context exposes `managedSyntaxKind` and canonical `managedPlan.syntaxKind` only from
  revision-bound adapter metadata plus a canonical decoded plan.
- `replace-managed-construction` capability is granted only when metadata, integrity,
  schema-v2 canonical decode, writer safety, and both syntax-kind values agree.
- Replacement proposals must carry `expectedSyntaxKind` in addition to
  `expectedPlanKind`.
- Before recompile, binding metadata, previous plan, and next plan must all preserve the
  construction ID, plan family, and concrete syntax kind.
- After recompile, the inserted managed block is reparsed and its header `kind` must still
  equal `expectedSyntaxKind`.

Thus a `primitive/segment` block cannot be replaced by a `primitive/circle` block through
the AI semantic write protocol.

### 4. Capability denial fails closed

Missing `constructionSyntaxKind`, a mismatch with the decoded plan, an unsafe writer
surface, invalid metadata/integrity, noncanonical source, or a non-focus binding produces
no replace capability. A focused mismatch is exposed as a typed unavailable diagnostic;
the raw managed binding remains `writable: false`.

## Static evidence

The following source anchors were inspected with `rg` after editing:

- `construction-plan-codec.ts`: `validateConstructionPlanWriterSafety`,
  `constructionPlanSyntaxKind`, `unsafe-writer-surface`.
- `ai-context.ts`: `managedSyntaxKind`, canonical `syntaxKind`, capability equality gate.
- `ai-construction-plan-proposal.ts`: `expectedSyntaxKind`, readonly guards, writer-safety
  calls, before/after concrete-kind checks.
- `tikz-system-prompt.ts`: required syntax-kind copying and writer grammar constraints.

`git diff --check` and per-untracked-file `git diff --no-index --check` produced no
whitespace-error matches. Git emitted only repository-wide LF/CRLF conversion warnings.

## Deliberate boundary

The generic recompiler file was not changed because this task explicitly constrained the
implementation surface and its only current call site is the hardened AI proposal compiler.
If the generic recompiler becomes a direct public Canvas API, it should accept the same
concrete syntax-kind precondition as a defense-in-depth follow-up.
