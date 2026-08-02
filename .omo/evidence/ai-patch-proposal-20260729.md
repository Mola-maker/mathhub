# AI patch proposal static evidence

- Scope: `lib/tikz/ir/ai-patch-proposal.ts` and the export line in `lib/tikz/ir/index.ts`.
- Scenario: an untrusted `ai-patch-proposal/v1` value is passed to `validateAiPatchProposal` with a verified document basis and source-binding map. The validator rejects stale basis identities, unknown/read-out-of-scope bindings, opaque or non-writable bindings, mismatched `sourceId`/ranges, missing compare-and-swap guards, invalid operation kinds, source ranges outside their binding, and overlapping or same-point insert operations.
- Compile path: `compileAiPatchProposal` calls the pure validator and, on success, emits one `GeometryTransactionRequest` whose only operation is `source-patch` with the validated multi-patch list. No whole-document replacement branch exists.
- Static invocation: `git diff --no-index --check -- NUL lib/tikz/ir/ai-patch-proposal.ts`.
- Static result: no whitespace errors; only Git's normal LF-to-CRLF working-copy warning.
- Additional invocation: PowerShell trailing-whitespace scan over both owned source files returned no matches.
- Deliberately not run: tests, build, lint, typecheck, Docker, or browser validation, per task instructions.

