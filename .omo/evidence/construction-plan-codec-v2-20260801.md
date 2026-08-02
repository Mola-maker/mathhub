# ConstructionPlan schema-v2 codec evidence

Date: 2026-08-02 (Asia/Shanghai)

Owner: `/root/construction_plan_codec_v2`

Implementation artifact: `E:\Portaitsweb\math_geohub\lib\tikz\authoring\construction-plan-codec.ts`

## Scope and result

Implemented a fail-closed decoder for one revision-bound
`ManagedConstructionBlock`:

- accepts only current schema-v2 blocks with valid metadata and attached
  content integrity;
- rejects stale-range/fingerprint inputs and source-adopted blocks;
- exhaustively routes every current `ConstructionPlanKind`;
- derives source-relevant fields from ordered header inputs/outputs and typed
  semantic records, rejecting missing, ambiguous, or contradictory records;
- normalizes only schema-v2-ephemeral `status` and `selection`;
- calls `validateConstructionPlan` before trusting the candidate;
- recompiles the complete block with its current line-ending convention and
  requires byte equality;
- returns typed issues for unsupported/under-specified/styled/diverged source;
- exposes both the full validated plan and a compact source-relevant plan for
  AI context.

No tests, build, lint, typecheck, TeX compiler, Docker, or browser commands were
run, in accordance with the product-owner verification boundary.

## Static scenario 1: plan-kind exhaustiveness

Scenario: compare the `ConstructionPlanKind` union in `construction-ir.ts` with
the codec registry, and compare the union with the `recoverDefinition` switch.

Invocation: read both files with PowerShell, regex-extract the literal unions,
sort/compare them, and print counts/differences.

Binary observables captured:

```text
IR_KIND_COUNT=19
CODEC_KIND_COUNT=19
MISSING=
EXTRA=
EXHAUSTIVE=True
RECOVERY_CASE_COUNT=19
RECOVERY_MISSING=
RECOVERY_EXTRA=
RECOVERY_EXHAUSTIVE=True
```

Artifact path: `E:\Portaitsweb\math_geohub\lib\tikz\authoring\construction-plan-codec.ts`

## Static scenario 2: trusted proof boundary

Scenario: statically confirm that a decoded candidate crosses both required
proof gates: typed ConstructionPlan validation and complete source-byte
reproduction.

Invocation: regex-inspect the codec for
`validateConstructionPlan(candidate)` and the final
`compiled !== currentText` fail-closed comparison.

Binary observables captured:

```text
VALIDATOR_PRESENT=True
BYTE_PROOF_PRESENT=True
```

Artifact path: `E:\Portaitsweb\math_geohub\lib\tikz\authoring\construction-plan-codec.ts`

## Static scenario 3: schema-v2 information-loss boundary

Scenario: confirm the three plan kinds whose circle writer inputs are not
persisted by schema-v2 are routed through the typed refusal path rather than
inventing values.

Invocation: inspect the exhaustive switch and its shared
`unsupportedCircleDefinition` branch.

Binary observable captured:

```text
FAIL_CLOSED_CIRCLE_KINDS=3/3
```

Affected kinds:

- `point-on-circle`: center/through-or-radius/angle parameterization absent;
- `tangent-at-point`: through-or-radius/angle parameterization absent;
- `radical-axis`: circle parameterizations and evaluated snapshots absent.

Artifact path: `E:\Portaitsweb\math_geohub\lib\tikz\authoring\construction-plan-codec.ts`

## Static scenario 4: whitespace gate

Scenario: run Git's whitespace checker against the new untracked file by
comparing it with the Windows null device.

Invocation:

```powershell
git diff --no-index --check -- NUL lib/tikz/authoring/construction-plan-codec.ts
```

Binary observable captured after excluding Git's LF/CRLF informational warning:

```text
WHITESPACE_DIAGNOSTICS=0
```

The command's exit code is `1` because `--no-index` detects the expected new
file difference; it emitted no whitespace-error diagnostics.

Artifact SHA-256 captured before this evidence file was written:

```text
92B016DF35BB8577C919B3B029AE5E8795B18FFF9E48AD7C7B489A316C357F45
```

Artifact path: `E:\Portaitsweb\math_geohub\lib\tikz\authoring\construction-plan-codec.ts`

## Owner-run verification still required

Because execution gates are owned by the product owner, this evidence does not
claim runtime or typecheck completion. Owner verification should cover, at
minimum, one canonical success fixture per recoverable plan kind plus binary
rejections for stale fingerprint/range, detached fingerprint, source adoption,
ambiguous records, styled body divergence, and each of the three insufficient
circle-definition kinds.
