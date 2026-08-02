# Parse Gate / Transaction Broker code review

- Review scope: current uncommitted state of `components/tikz/use-tikz-engine.ts`,
  `components/tikz/tikz-canvas.tsx`, `components/tikz-studio.tsx`,
  `lib/tikz/document/projection-gate.ts`, `lib/tikz/transactions/broker.ts`,
  `lib/tikz/document/studio-document.ts`, and `lib/tikz/render/tools.ts`.
- Goal: invalid current TikZ source must remain the source of truth while the
  last usable semantic projection is displayed read-only; Canvas and AI writes
  must be revision-bound and enter through one idempotent transaction broker.
- Review boundary: read-only source inspection. Per task instruction, no test,
  build, lint, TypeScript compiler, or Docker command was run.
- ULW lookup: `omo ulw-loop status --json` could not run because the installed
  Windows `omo.cmd` wrapper returned `The syntax of the command is incorrect`.
  No `.omo/evidence/ulw` attempt directory exists, so the documented fallback
  evidence path is used.
- Input gaps: no notepad path or Parse Gate-specific browser artifact was
  supplied. `output/playwright/parallel-tool.png` was inspected, but it only
  shows the parallel-line UI and cannot prove stale-projection or broker
  behavior.

## Skill-perspective check

The requested `remove-ai-slops` and `programming` skills were not available in
the session skill catalog, so their stated criteria were applied manually.

- `remove-ai-slops`: no deletion-only or tautological new test was found.
  However, the current stale-scene test asserts the opposite behavior and gives
  false confidence, and the unbounded transaction index retains unnecessary
  production data.
- `programming`: the untrusted SSE boundary validation is justified, but the
  automatic repair path bypasses the typed AI transaction provenance, and the
  broker accepts caller-supplied hash evidence instead of enforcing its own
  advertised source-hash invariant.

The diff therefore violates both perspectives in the concrete findings below.

## CRITICAL

None.

## HIGH

### H1. Invalid or untransactioned AI output is still committed through the repair lane

Evidence:

- `components/tikz-studio.tsx:527-530` rejects an invalid AI source transaction
  and calls it an uncommitted proposal.
- `components/tikz-studio.tsx:551-560` says a raw `tikzCode` response without a
  verifiable transaction will not be written.
- Despite both decisions, `components/tikz-studio.tsx:570-574` sends any invalid
  `generatedCode` to `repairCode`.
- `components/tikz-studio.tsx:310-330` diffs the current/base source against the
  repaired full AI output and commits it as origin `repair`.

The revision guard only protects against a concurrent user edit. When the
document has not changed, an invalid rejected proposal, or even raw AI code
with no transaction, can be normalized/repaired and then replace a large
portion of the source under a different origin. That can remove comments,
formatting, and opaque/unsupported blocks while evading the AI transaction
read/write set and provenance checks.

Required change: automatic repair must remain an uncommitted preview unless the
repaired result is compiled into and validated as a new AI/source transaction
against the original basis. Manual repair of the current user source is a
separate explicit action and must not be reused as the fallback for rejected AI
output.

### H2. The checked-in engine test asserts the opposite of the new Parse Gate contract

Evidence:

- `lib/tikz/document/projection-gate.ts:43-49` returns the last usable projection
  with state `stale`.
- `components/tikz/use-tikz-engine.ts:129-138` feeds that projection into the
  engine, and `components/tikz/use-tikz-engine.ts:294-297` exposes its scene and
  free-point ranges.
- `components/tikz/use-tikz-engine.test.tsx:9-18` is named “坏代码不复用上一版场景”
  and expects `result.current.scene` to be null after invalid source.

Static control-flow inspection shows this assertion is incompatible with the
implementation after the initial valid projection effect has run. The test
should instead assert that current source/revision/issues remain invalid/current
while scene revision 0 is exposed as `stale`, and all Canvas/AI write APIs are
rejected. No such Parse Gate test exists.

Required change: update this test to the approved contract and add focused
coverage for stale selection/pan, blocked drag/style/delete/construction/AI
writes, source preservation, and recovery to a new current semantic revision.

## MEDIUM

### M1. The broker's source-hash check does not verify the authoritative document source

Evidence:

- `lib/tikz/transactions/broker.ts:187-190` accepts `SourceHashEvidence` from its
  caller.
- `lib/tikz/transactions/broker.ts:240-247` only checks
  `request.sourceHash === evidence.hash`; it never recomputes or otherwise binds
  that evidence to `snapshot.source`, nor validates the claimed algorithm.
- `lib/tikz/transactions/broker.ts:280-289` and
  `lib/tikz/transactions/broker.ts:320-331` make both precondition text and
  patch `expectedText` optional.

Revision checks protect current known call sites from most stale writes, and
the UI's AI validator currently requires exact text, so this is not classified
HIGH. Nevertheless the broker is documented as the runtime authority and its
source-hash invariant can be satisfied by two matching caller-provided strings.
A future plugin/integration can omit text guards and commit without proving the
source basis.

Required change: make the broker derive/verify the hash from its own snapshot
(with an algorithm-aware verifier) or accept a trusted precomputed document
basis owned by `StudioDocument`, not arbitrary request evidence.

### M2. The idempotency index retains every transaction forever

Evidence:

- `lib/tikz/document/studio-document.ts:92-94` owns both a bounded transaction
  array and an `idempotencyIndex`.
- `lib/tikz/document/studio-document.ts:293-295` inserts every transaction into
  the map, truncates only the array at 256, and never deletes the corresponding
  map entry.
- `lib/tikz/document/studio-document.ts:268-283` records patches, read/write
  sets, and the canonical request fingerprint. Large replacement transactions
  can retain large source slices.

Normal CodeMirror keyboard edits also create transaction records, so a long
editing session grows this map without bound. The exact canonical fingerprint
amplifies retention for large edits.

Required change: define a bounded replay window or persisted result store and
expire index entries consistently with that policy. Do not keep large canonical
request strings indefinitely merely to emulate a future cross-process store.

### M3. Idempotent replay reports a transaction id that was never committed

Evidence:

- `lib/tikz/transactions/broker.ts:142-155` intentionally excludes
  `transactionId` from the request fingerprint.
- On replay, `lib/tikz/transactions/broker.ts:220-228` returns
  `transactionId: request.transactionId` while `record` is the earlier applied
  record with a potentially different transaction id.

For general plugin/integration callers, the result can claim the retry's new
transaction id was idempotently committed while the durable record names a
different transaction. Current AI requests avoid this by equating
idempotencyKey and transactionId, but the broker API does not require that.

Required change: either bind transaction id into the idempotency identity,
require it to match the original request, or replay the original record's
transaction id/result consistently.

### M4. Critical Parse Gate and idempotency behavior has no focused coverage

No `projection-gate.test.*` or broker test exists, and repository-wide static
search found no assertions for `semanticProjectionState`,
`semantic-projection-stale`, `requestFingerprint`,
`idempotency-key-reused`, or read-only tool behavior. This leaves the most
failure-prone paths (same-key/different-payload, same-key replay, stale Canvas
write attempts, recovery, undo interactions) unprotected. This is especially
material because the one related engine test currently asserts obsolete
behavior.

Required change: add behavior-level tests at the gate/broker boundaries. Avoid
tests that merely mirror constants or private helper serialization.

## LOW

### L1. Canvas motion is keyed to the current source revision while rendering a stale semantic revision

Evidence:

- `components/tikz/tikz-canvas.tsx:275-280` passes
  `revision: engine.revision` to `useTikzMotion`.
- During Parse Gate stale mode, the displayed `revealedScene` belongs to
  `engine.semanticRevision`, shown at `components/tikz/tikz-canvas.tsx:347-351`.

The current motion hook only uses this number as an effect trigger, so this does
not create a write path, but it breaks the revision-label invariant and reruns
visual reconciliation for invalid source keystrokes that did not change the
displayed scene.

Suggested change: key scene consumers to `revealedScene.sourceRevision` (or the
explicit semantic revision), and reserve `engine.revision` for current source
transactions.

## Evidence and test relevance

- Inspected the full current contents of all requested files, the relevant
  CodeMirror dispatch/commit bridge, transaction model, source patch helpers,
  AI SSE proposal builder, and repair implementation.
- Inspected `git status`, targeted diff/stat, current unit tests, and
  `output/playwright/parallel-tool.png`.
- Did not run tests or static tooling, as explicitly prohibited. The reported
  H2 failure is a direct contradictory assertion found by static inspection,
  not a claimed test run.
- Existing `StudioDocument` tests cover basic revision rejection and the
  CodeMirror authority bridge, but do not cover the new fingerprint/index
  semantics.

## Decision

- `codeQualityStatus`: **BLOCK**
- `recommendation`: **REQUEST_CHANGES**

### Blockers before approval

1. Remove the AI-output-to-repair write bypass and keep rejected/untransactioned
   AI source as a noncommitted proposal.
2. Align the engine test with the stale read-only Parse Gate contract and add
   focused gate/broker behavior coverage.
3. Make source-hash evidence authoritative at the broker/document boundary.
4. Bound idempotency retention and make replay transaction identity
   self-consistent.

