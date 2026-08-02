# Official PGF registry scaffold evidence

Date: 2026-08-02 (implementation snapshot for the 2026-08-01 architecture tranche)

## Scope

Implemented the first source-pinned PGF/TikZ registry boundary without
touching the existing catalog/index or executing TeX. The registry is
intentionally a separate language-surface registry from the UI shortcut
registry and the interactive construction catalog.

## Artifacts

- `lib/tikz/syntax/upstream-registry.ts`
  - Version/SHA-pinned manifest and entry schema for command, environment,
    key, handler, library, and PGF-function surfaces.
  - Explicit `upstream`, `namespaces`, `keyPath`, `valueGrammar`, effects
    (`scope`, `expansion`, `outputs`), independent parse/preview/exact lanes,
    transaction writeback policy, and security policy.
  - Strict runtime validation rejects malformed provenance, absolute/path
    traversal provenance, duplicate ids, missing diagnostics on dynamic or
    unsupported entries, unsafe writeback claims, and mismatched entry vs
    manifest version/SHA.
  - Deterministic indexes and read-only query helpers by id, surface,
    namespace, key path, status, and text; diagnostics remain queryable.
- `lib/tikz/syntax/generated/pgf-3.1.11a-registry.ts`
  - Checked-in representative seed pinned to PGF/TikZ 3.1.11a and SHA
    `839974a3f895bfb86f5a8bc155f0886c918f1bff`.
  - Includes command/environment/key/handler/library/PGF-function entries and
    explicit dynamic/unsupported records with source provenance/diagnostics.
  - The manifest explicitly says the seed is representative, not exhaustive.
- `tools/generate-pgf-registry.mjs`
  - Offline-only generator requiring explicit `--checkout`, `--version`, and
    full `--sha`; optional `--output` defaults to a versioned generated path.
  - Recursively scans local `.code.tex` files for statically recognizable
    `pgfkeys`/`pgfkeysdef`, declaration commands, environments, libraries, and
    `pgfmathdeclarefunction` surfaces.
  - Emits dynamic/unsupported file entries with provenance and diagnostics;
    it never fetches, invokes git, evaluates macros, runs TeX, or claims full
    dynamic macro coverage.

## Static verification

Invocation:

```powershell
$targets = @('lib/tikz/syntax/upstream-registry.ts','lib/tikz/syntax/generated/pgf-3.1.11a-registry.ts','tools/generate-pgf-registry.mjs')
foreach ($target in $targets) { if (-not (Test-Path -LiteralPath $target)) { throw "missing $target" } }
git diff --check -- $targets
```

Observed result: all three files existed; `git diff --check` emitted no
whitespace errors. A second static inventory reported non-empty UTF-8 files
with `upstream`, `diagnostic`, and `dynamic` markers in each artifact.

Not run by design: the generator itself, tests, build, lint, typecheck, TeX,
Docker, or browser automation. The product owner owns those execution gates.

