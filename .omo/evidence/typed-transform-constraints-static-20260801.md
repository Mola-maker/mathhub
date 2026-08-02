# Typed transform constraints static evidence

Date: 2026-08-01

Scope: `lib/tikz/authoring/construction-ir.ts`,
`lib/tikz/authoring/construction-catalog.ts`,
`lib/tikz/semantics/managed-construction.ts`, and
`lib/tikz/ir/tikz-adapter.ts` only.

The product owner explicitly owns test/build/lint/typecheck/compiler/Docker
execution for this pass. None of those commands were run.

## Static scenarios

1. Command:
   `rg -n "point-reflection|line-reflection|kind: 'rotation'|kind: 'homothety'|validScalar|isScalarRecordValue|TIKZ_SEMANTIC_ADAPTER_VERSION|angleDegrees: 90|scale: 2|parameters: \\{ angleDegrees|parameters: \\{ scale" <four scoped files>`
   - Observable: the ConstructionConstraint union, construction validator,
     catalog records, schema-v2 validator, adapter projection roles, and
     adapter version all contain the four typed transform operations.
   - Captured result: matches were reported at construction-ir lines 122-156,
     531/611-632; catalog lines 1066-1162; managed-construction lines 131 and
     197-224; adapter lines 38, 991-1013, and 1110-1112.

2. Command:
   `rg -n "constraints: \\[\\]" lib/tikz/authoring/construction-catalog.ts`
   - Observable: the only remaining empty constraint list is the primitive
     plan (line 637); reflect-point, reflect-line, rotate-90, and homothety-2
     now each emit a typed record.

3. Command:
   `rg -n -F` for the four existing writer formulas in
   `lib/tikz/authoring/construction-ir.ts`.
   - Observable: the original point reflection, line projection/reflection,
     90-degree rotation, and scale-2 interpolation formulas remain present at
     lines 1289-1312; only metadata/constraint projection changed.

4. Command:
   `git diff --no-index --check -- NUL <scoped file>` for each scoped file.
   - Observable: Git emitted only the expected LF-to-CRLF working-copy
     warnings; no whitespace-error diagnostics were emitted.

