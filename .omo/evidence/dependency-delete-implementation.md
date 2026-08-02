# Dependency graph and source deletion evidence

## Scope

- Implementation file: `lib/tikz/authoring/delete-transaction.ts`
- Existing dirty file `lib/tikz/semantics/dependency-graph.ts` was read but not rewritten.

## Static evidence

| Scenario | Invocation | Binary observable | Artifact |
| --- | --- | --- | --- |
| Source patch formatting/range guard | `git diff --check -- lib/tikz/authoring/delete-transaction.ts` | exit code `0`; no whitespace errors | `lib/tikz/authoring/delete-transaction.ts` |
| TypeScript syntax-only parse | `node -e "typescript.transpileModule(readFileSync(...), reportDiagnostics)"` | stdout `TRANSPILE_SYNTAX_OK` | `lib/tikz/authoring/delete-transaction.ts` |
| Ownership boundary | `git status --short -- lib/tikz/semantics/dependency-graph.ts lib/tikz/authoring/delete-transaction.ts` | dependency graph remains `M` from pre-existing work; delete transaction is the only new file | `lib/tikz/authoring/delete-transaction.ts` |

## API coverage

- `buildDeletionDependencyGraph(scene, statements)` creates statement, point, path, and element nodes with source ranges, stable ids, dependencies/dependents, and ancestor/descendant closures.
- `resolveDeleteTarget(graph, target)` resolves stable ids, statement indices, internal node ids, and point-name shorthand without guessing ambiguous identities.
- `planDeletion(...)` emits non-overlapping `TextPatch[]` for `cascade`, `block`, and `detach`; `sourceRootNodeIds` includes owner statements so deleting one rendered element cannot leave named-path dependents dangling. Detach freezes safely rewritable coordinate expressions and rejects unsupported `pic`/named-path intersection cases with diagnostics instead of corrupting source.

Automated tests/build/lint were intentionally not run per the task boundary.
