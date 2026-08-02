# Geometry Semantic Kernel v1 implementation evidence

Artifact path: `.omo/evidence/semantic-kernel-v1-implementation.md`

Validation boundary: static source/API inspection only. Per task instruction,
no test, build, lint, TypeScript compiler, or runtime execution was invoked.

## Scenario matrix

| Success criterion | Exact invocation | Binary observable |
| --- | --- | --- |
| Three truth lanes plus lossless/opaque/TikZ-CST construction model | PowerShell loaded `lib/tikz/ir/model.ts` with `Get-Content -Raw` and asserted all of `kind: 'semantic'`, `kind: 'construction'`, `kind: 'rendering'`, `interface LosslessSourceReference`, `verbatim: string`, `interface OpaqueConstructionNode`, `interface TikzCstConstructionBinding`, and `cstRanges: TikzCstRangeSet`; command exits 1 on any false assertion | Exit 0; `PASS: three-truth-model`, `PASS: lossless-opaque-and-tikz-cst` |
| IR entity, constraint, relation, style, and source-binding families | Same PowerShell contract scan asserted `interface GeometryEntity`, `interface GeometryConstraint`, `interface GeometryRelation`, `interface GeometryStyle`, and `type ConstructionBinding` in `lib/tikz/ir/model.ts` | Exit 0; `PASS: ir-record-families` |
| Revision/hash-bound atomic transaction protocol with all six operations, preconditions, and conflict result | Same PowerShell contract scan asserted `add`, `update`, `remove`, `relate`, `constrain`, `source-patch`, `expectedRevision: number`, `sourceHash: string`, `preconditions`, and `status: 'conflict'` in `lib/tikz/ir/transactions.ts` | Exit 0; `PASS: six-operation-protocol`, `PASS: revision-hash-conflict` |
| Independent source, AI, canvas, and compiler input/output envelopes | Same PowerShell contract scan asserted `SourceInputEnvelope`, `SourceOutputEnvelope`, `AiInputEnvelope`, `AiOutputEnvelope`, `CanvasInputEnvelope`, `CanvasOutputEnvelope`, `CompilerInputEnvelope`, and `CompilerOutputEnvelope` in `lib/tikz/ir/io.ts` | Exit 0; `PASS: four-channel-bidirectional-io` |
| Semantic plugin interface, capability-aware registry, and public barrel | Same PowerShell contract scan asserted `interface GeometrySemanticPlugin`, `class SemanticPluginRegistry`, `resolveAll`, and all seven module exports from `lib/tikz/ir/index.ts` | Exit 0; `PASS: plugin-interface-and-registry`, `PASS: public-barrel` |
| New-module scope and text hygiene | `Get-ChildItem lib/tikz/ir -File -Filter '*.ts' \| Select-String -Pattern '[ \t]+$'`; then `git status --short -- lib/tikz/ir` | Exit 0; `PASS: no trailing whitespace`; status is exactly `?? lib/tikz/ir/` |

## Captured file fingerprints

Invocation:

`Get-FileHash lib/tikz/ir/*.ts -Algorithm SHA256 | Sort-Object Path`

Observable:

```text
capabilities.ts 6687d83526250836f639e0d2129a9fbe5281e3553cc4ff22d17a4bec22117eab
index.ts 7c7ddc3a953cd941f75de28d6e7d2b8a2fc7c5183e894bdd69656d8b88ae3364
io.ts 8ddc65bf363012f901604248d6d720d7c59715208527417da0722cdc796efdc3
model.ts f33f1e35a6d24e021a549069f3a7b371f745a4c0037ba45a8e20dc68526d8d2a
plugin.ts 0311fa46cb88b79ef3e2fedd339a4af1055d6d14189c0aaa13701ba586b6963c
projection.ts 076a65f9d9a8bba8910cce7323fa6380353d5d203fe3ae25ac33fc773d1e24c7
registry.ts 78a53af25c472e5182b5f44bc201b9d10010001b2293b98a21e56d78eaf79556
transactions.ts e91e7153e597a514f9a79d119051ba9ee237482e3bc0ba30b2928341fcb13c6a
```
