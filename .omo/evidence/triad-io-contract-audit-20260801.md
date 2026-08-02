# AI / Construction IR / TikZ Writer / Canvas Preview IO contract audit

Date: 2026-08-02 (expected-kind closure re-review)  
Scope: current uncommitted workspace snapshot; static architecture review.  
Verification boundary: no tests, build, lint, typecheck, TeX compilation, Docker, browser, or runtime execution.

## Verdict

**PASS (static architecture gate).**

The reviewed AI / Code / Canvas contract now reaches typed managed construction creation and canonical same-ID replacement with document-level persistent-reference closure. The previous replacement-identity HIGH and the later wrong-kind persistent-reference HIGH are both closed.

Presentation-preserving schema-v3 hydration remains a WATCH/future capability; schema-v2 currently fails closed on styled or source-diverged managed blocks and therefore does not invalidate this safety verdict.

## Closed: persistent cross-block identity

- Document-level resolution indexes valid fingerprint-attached entity records and reports dangling, ambiguous, and incompatible persistent references (`lib/tikz/semantics/managed-construction.ts:1331-1433`).
- Typed recompile finds entity records referenced from other managed blocks and requires the same record ID, entity kind, and TikZ name to survive (`lib/tikz/authoring/managed-construction-recompile.ts:68-142`).
- Whole-block replacement retains range/fingerprint/kind/canonical-source guards, regenerates one valid attached block, and rejects newly introduced document-reference errors (`managed-construction-recompile.ts:169-244`).
- The typed AI compiler independently applies the candidate in memory and performs the same baseline-vs-candidate reference check before transaction emission (`lib/tikz/ir/ai-construction-plan-proposal.ts:262-272`, `397-459`).
- The transaction Broker repeats the managed-reference candidate guard immediately before commit for AI/Canvas/style origins (`lib/tikz/transactions/broker.ts:242-252`, `506-547`).
- Managed document-reference issues become Geometry Truth errors (`lib/tikz/ir/tikz-adapter.ts:1956-1980`), and the API rejects a candidate with any complete Geometry Truth semantic error before returning it (`app/api/tikz/route.ts:151-171`).

Therefore replacing construction A cannot silently remove/rename/retype `managed:A:<recordId>` while another valid construction still consumes it.

## Closed: expected-kind coverage

Both local schema-v2 semantic closure and cross-block document resolution consume the same `semanticReferencesOf` reference contract (`lib/tikz/semantics/managed-construction.ts:555-730`, `840-866`, `1387-1433`). The latest snapshot covers every fixed-kind reference surface:

### Entity records

- segment/vector/line/ray endpoints require points (`managed-construction.ts:578-585`);
- polyline/polygon vertices and rectangle corners require points (`586-590`);
- circle center/through, label anchor, and angle/right-angle points require points (`591-604`).

### All typed construction constraints

- reflection, rotation, homothety, midpoint, perpendicular-foot: point contracts (`610-648`);
- on-circle and three-point circle: point/circle contracts (`649-658`);
- tangent, perpendicular bisector, angle bisector, parallel/perpendicular: line/point contracts (`659-685`);
- inversion and radical axis: point/line/circle contracts (`686-699`);
- line intersection, line-circle branch selection, cyclic, complete quadrilateral: point/line/circle contracts (`700-715`).

This switch covers the complete `ConstructionConstraint` discriminated union in `lib/tikz/authoring/construction-ir.ts:118-272`.

### Outputs

Output references derive their expected entity kind from the declared output kind; `derived-point` normalizes to `point` and `derived-line` to `line` (`managed-construction.ts:725-730`).

### Deliberately polymorphic relations

Relation `from`/`to` remain untyped (`managed-construction.ts:719-723`) because the relation model permits heterogeneous entity endpoints. This is not a missing fixed-kind contract; dangling and ambiguous identity checks still apply.

## Fail-closed result for the prior counterexample

An existing managed **line** used as `on-circle.circle` or `radical-axis.circle1` is now resolved successfully by identity but compared against expected kind `circle`. The document resolver emits `incompatible-managed-reference-kind`; then:

1. typed create/replace compilation rejects the newly introduced issue;
2. the Broker independently rejects it before commit;
3. server Geometry Truth projection exposes the issue as a semantic error and refuses proposal emission.

A persistent circle used in those fields has the matching kind and remains admissible, subject to the existing source/read-binding and plan-evaluation preconditions.

## Triad IO gate

| Direction | Static status | Contract |
|---|---|---|
| AI typed create -> Construction IR -> managed TikZ | **PASS** | Binding scope + plan shape/type validation + evaluator preconditions + canonical writer + candidate persistent-reference guard. |
| Managed TikZ -> Semantic IR / AI comprehension | **PASS** | Valid records resolve document-wide; dangling/ambiguous/incompatible references become semantic diagnostics instead of silent aliases. |
| Construction IR -> Canvas Preview | **PASS for audited advanced plans** | Inversion/radical/cyclic/complete use the shared plan evaluator and Preview IR lowering. |
| Construction IR -> TikZ writer | **PASS for audited advanced plans** | Public outputs, complete supporting lines/diagonal, and cyclic secant remain aligned. |
| AI canonical same-ID replace -> managed TikZ | **PASS** | CAS + canonical previous plan + atomic whole-block regeneration + external ID/kind/name stability. |
| AI canonical replace -> document-wide Semantic IR / Canvas | **PASS** | Recompiler, compiler, Broker, and API Geometry Truth gates reject new document-reference faults. |
| Raw AI source proposal -> managed body | **PASS (denied)** | Managed raw bindings remain read-only; only typed semantic capability reaches the trusted recompiler. |

## Earlier findings still closed

- Radical-axis, cyclic-quadrilateral, and complete-quadrilateral have evaluator and Preview IO.
- Complete quadrilateral exposes its four supporting lines and diagonal as outputs.
- Cyclic quadrilateral writes and previews its public secant.
- Canonical outputs resolve to declared entities and enforce output/entity type compatibility.
- Advanced construction fallback roles align with full semantic record roles.

## WATCH / future work

- **Presentation IR / schema-v3:** schema-v2 replacement requires the current block to equal canonical compilation of `previousPlan`; styled or manually diverged bodies fail closed (`managed-construction-recompile.ts:28-34`, `211-219`).
- **Trusted prior-plan hydration:** a trusted managed-record/CST -> canonical ConstructionPlan hydrator should eventually provide `previousPlan`, allowing the model to emit only typed deltas instead of reconstructing the whole prior plan.
- **Repair mode:** guarded candidate comparisons preserve pre-existing document-reference faults while rejecting new ones; the API's complete Geometry Truth gate is stricter. Existing broken documents need an explicit repair transaction rather than weaker write guards.
- **Runtime confidence:** PASS is static only because execution was explicitly out of scope.

## Gate conclusion

Within the reviewed managed ConstructionPlan vocabulary, wrong-kind but existing persistent references now fail closed, while correct references pass through the same typed IO contract. No architecture blocker remains for typed create plus canonical same-ID replace; schema-v3 presentation round-tripping remains an explicit non-blocking WATCH.
