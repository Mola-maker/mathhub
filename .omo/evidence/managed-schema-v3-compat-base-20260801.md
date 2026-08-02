# Managed schema-v3 compatibility base (static evidence)

Date: 2026-08-02 (requested evidence name retains the 2026-08-01 task date)

Scope: `lib/tikz/semantics/managed-construction.ts` only. No authoring export
changes were required because the existing `MANAGED_CONSTRUCTION_SCHEMA_VERSION`
import remains available and continues to mean schema-v2.

## Success criteria and captured observables

### 1. Explicit schema milestones and typed-schema predicate

Scenario: inspect the managed-construction schema declarations.

Invocation:

```powershell
rg -n -C 2 "MANAGED_CONSTRUCTION_SCHEMA_V[123]|LATEST_MANAGED_CONSTRUCTION_SCHEMA_VERSION|LEGACY_MANAGED_CONSTRUCTION_SCHEMA_VERSION|isTypedSemanticSchema" lib/tikz/semantics/managed-construction.ts
```

Binary observable: the source contains `MANAGED_CONSTRUCTION_SCHEMA_V1 = 1`,
`..._V2 = 2`, `..._V3 = 3`, `LATEST_MANAGED_CONSTRUCTION_SCHEMA_VERSION =
MANAGED_CONSTRUCTION_SCHEMA_V3`, the legacy v1 alias, the v2 write/default
alias, and `isTypedSemanticSchema(version: number | null): version is 2 | 3`.
Captured source locations: lines 9-41.

### 2. Typed semantic equality sites use the predicate without enabling v3

Scenario: inspect every former exact-v2 typed-record gate and confirm the old
equality spelling is absent.

Invocation:

```powershell
rg -n "schemaVersion === MANAGED_CONSTRUCTION_SCHEMA_VERSION|schema\.value === MANAGED_CONSTRUCTION_SCHEMA_VERSION" lib/tikz/semantics/managed-construction.ts
```

Binary observable: no matches (exit code 1). The replacement predicate sites
are the v2-only constraint shape gates at lines 262, 268, 277, 284, 306, 312,
319, 326, 343, 351, 359, plus typed-record validation at line 1139 and
semantic closure at line 1158.

### 3. Schema-v3 remains unsupported/fail-closed

Scenario: inspect the parser's numeric schema gate.

Invocation:

```powershell
rg -n -C 4 "Keep the read/write gate explicit|value !== MANAGED_CONSTRUCTION_SCHEMA_V1|value !== MANAGED_CONSTRUCTION_SCHEMA_V2|unsupported-schema-version|using header-only semantics" lib/tikz/semantics/managed-construction.ts
```

Binary observable: `schemaVersionOf()` accepts only V1/V2; any other numeric
version (including 3) returns `status: 'unsupported'` with
`unsupported-schema-version`, and `recordsOf()` exits before decoding records.
The v3 declaration/predicate therefore does not make a v3 block valid and no
new record vocabulary is accepted. `RECORD_TYPES` remains exactly
`input/entity/constraint/relation/output` (line 131).

### 4. Existing v2 writer/default and codec behavior remains intact

Scenario: inspect authoring consumers of the compatibility alias.

Invocation:

```powershell
rg -n "MANAGED_CONSTRUCTION_SCHEMA_VERSION" lib/tikz/authoring/construction-ir.ts lib/tikz/authoring/construction-plan-codec.ts
```

Binary observable: `construction-ir.ts:1747` still emits
`schema=${MANAGED_CONSTRUCTION_SCHEMA_VERSION}` and
`construction-plan-codec.ts:851` still requires that alias; the alias resolves
to V2 at `managed-construction.ts:30-31`. No writer default was changed.

### 5. v1/v2 fingerprint domain is untouched

Scenario: inspect the content fingerprint implementation after the compatibility
edit.

Invocation:

```powershell
rg -n "managedConstructionContentFingerprint|mathgeo-managed-content/v1" lib/tikz/semantics/managed-construction.ts
```

Binary observable: the existing function and `mathgeo-managed-content/v1`
domain remain present (lines 1221 and 1234); no schema version was added to the
fingerprint input.

## Validation boundary

Per task constraints, only read/search checks and `git diff --check` were run.
No tests, build, lint, typecheck, TeX, Docker, or browser commands were run.

Invocation:

```powershell
git diff --check
```

Binary observable: exit code 0; Git emitted only its existing LF-to-CRLF
conversion warnings for unrelated dirty-worktree files and no whitespace error.

