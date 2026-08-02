# Managed-record closure hardening final code review

Date: 2026-08-01

Scope: read-only final re-review of
`lib/tikz/semantics/managed-construction.ts`, focused on managed-reference input
provenance, duplicate entity aliases, the exact legacy tangent witness, local
kind checks, forward-compatible records, atomic metadata failure, and removal
of the undocumented `constraint.output` casts. The current tangent producer was
inspected only to confirm compatibility.

No test, build, lint, typecheck, TeX, Docker, or browser command was run. The
target is still untracked in a dirty worktree, so this is a review of the
current source state rather than a clean Git baseline diff.

## Verdict

- `codeQualityStatus`: **CLEAR**
- `recommendation`: **APPROVE**
- `reportPath`: `.omo/evidence/managed-record-closure-code-review.md`
- `blockers`: none

## Skill-perspective check

The requested `remove-ai-slops` and `programming` skills were **not available
in the exposed skill catalog**, so they could not be loaded. Their documented
criteria were applied manually.

- No tests are in scope, so no deletion-only, removal-verification,
  tautological, implementation-constant, or brittle prompt tests were present.
- The explicit discriminated switches, alias ownership map, and small legacy
  compatibility recognizer are required at this untrusted JSON boundary; they
  are not needless abstraction or production parsing unrelated to the goal.
- The previous `unknown as Record` / undocumented `constraint.output` escape
  hatch is absent.
- The current diff does not violate either skill perspective within this
  reviewed scope.

## Final verification

### Managed provenance isolation - PASS

- `managed:`-prefixed values are separated from ordinary TikZ names, malformed
  persistent refs cannot fall through to the name branch, and entity ids/names
  cannot claim the reserved provenance prefix
  (`managed-construction.ts:102-127,378-410`).
- `inputReferences` is independent of local entity aliases
  (`managed-construction.ts:728-752`). Every semantic `managed:*` reference must
  be an exact explicit input, regardless of ordinary alias membership
  (`managed-construction.ts:835-847`).

### Duplicate aliases and exact local kinds - PASS

- Entity alias ownership is tracked per record; an entity whose id equals its
  own name counts once, while cross-entity name/name or name/id collisions emit
  `duplicate-entity-alias` (`managed-construction.ts:733-769`).
- Any such issue invalidates the metadata transaction before the adapter can
  apply last-write-wins alias resolution.
- For an unambiguous internal alias, line/circle intersection parents and
  output points must have the exact expected owner kind
  (`managed-construction.ts:848-860`).

### Exact legacy tangent witness - PASS

The compatibility witness is now created only when all required historical
facts are present (`managed-construction.ts:771-811`):

1. the record is a `tangent-at-point` constraint;
2. its circle is both an explicit input and a syntactically valid persistent
   managed reference;
3. its center is a non-managed TikZ entity name;
4. exactly one local line entity is identified by the constraint's line alias;
5. the historical direction point is exactly that line entity's `to` endpoint;
6. an existing relation is exactly `kind=depends-on`, `directed=true`,
   `from=directionPoint`, `to=center`.

The exception then authorizes only two reference occurrences
(`managed-construction.ts:813-833`):

- the matched tangent constraint's own `center` field, identified by the same
  constraint id and center value;
- the exact directed depends-on relation's `to` field, with matching
  direction-point source and center target.

Other relations cannot reuse the witness:

- a different relation kind fails the `depends-on` predicate;
- an undirected or explicitly false relation fails `directed === true`;
- a different `from`, `to`, or reference path fails the tuple match;
- a different tangent constraint id cannot borrow the witness;
- a raw or malformed circle reference cannot activate compatibility;
- an undeclared line endpoint is still rejected independently when the line
  entity and relation `from` references undergo ordinary closure.

An exact duplicate of the historical dependency tuple may match, but it does
not authorize a new target or relation shape; it represents the same already
permitted edge and is not a closure bypass.

The current tangent producer no longer needs the exception because it declares
the center explicitly alongside the managed circle
(`construction-catalog.ts:990-1007`). The recognizer is therefore limited to
previously emitted schema-v2 tangent records.

### Untyped compatibility casts - PASS

`line-intersection` and `line-circle-other-intersection` now inspect only their
declared discriminated fields in both lexical and reference collection paths
(`managed-construction.ts:504-517,699-714`). Real output records retain their
own explicit closure branch. No `constraint.output`, `hasOwnProperty('output')`,
or `unknown as Record` path remains.

### Metadata and compatibility behavior - PASS

- Schema-v1 remains outside schema-v2 lexical and closure hardening.
- Known schema-v2 entity, constraint, relation, and output references are
  closed against exact inputs plus unambiguous local entity aliases.
- Unknown top-level record types retain source-preserving forward-compatible
  behavior while known decoded records still undergo closure.
- Any non-forward-compatible lexical, alias, closure, or kind issue atomically
  sets metadata invalid and exposes an empty semantic record set.
- Integrity remains a separate gate; invalid or detached fingerprints are not
  projected by the adapter.
- Parsing and fingerprint calculation remain read-only. No source text,
  comments, TikZ body, or content fingerprint is rewritten.

## Findings by severity

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

#### L1 - executable verification remains product-owner owned

No execution was permitted. The owner-run boundary suite should still include
the exact old tangent tuple and negative variants for relation kind, direction,
source endpoint, target center, raw circle input, missing/duplicate line
entities, managed center forgery, and an unrelated relation targeting the same
center. This is a verification handoff, not a remaining code-quality blocker.

## Current producer compatibility

- Cyclic quadrilateral: closed inputs/entities and correct point/line/circle
  internal kinds.
- Complete quadrilateral: both line intersections resolve to unique local line
  and point entities.
- Radical axis: both persistent circles are explicit inputs; result/direction/
  line are local entities.
- Current tangent: circle and center are explicit inputs; no legacy exception
  is needed.
- Historical tangent: accepted only through the exact witness tuple above.
- Point/line reflection, rotation and homothety: all references close through
  inputs and local result/foot entities.
- Adopted source circle: center/through witnesses are explicit inputs and the
  circle output is a local entity.

## Final recommendation

**APPROVE.** The four requested fixes now satisfy the block-level semantic
contract. In particular, the legacy tangent exception recognizes only the
historical persistent-circle, unique-line, direction-point dependency tuple;
other relation shapes remain subject to fail-closed reference validation.
