# Construction IR structural validation evidence

Date: 2026-08-01

Scope: `lib/tikz/authoring/construction-ir.ts` and `lib/tikz/authoring/construction-catalog.ts`. No automated tests, build, lint, typecheck, TeX compiler, or Docker command was run; those gates remain product-owner owned.

## Implemented boundary checks

- `validateEntity` at lines 587-664 exhaustively switches over point, edge, polyline/polygon, rectangle, circle, label, angle, and right-angle records. It checks `recordType`, TikZ-safe `id`/`name`, finite optional point literals, reference endpoints/cardinality, and the circle XOR (`through` or positive finite literal `radius`) invariant.
- Entity IDs and names are collected and checked for duplicates in `validateBase` at lines 907-932. A cross-record alias collision is rejected while an id/name alias on the same record remains unambiguous.
- Relation records are checked in `validateBase` at lines 934-971 for record type, unique safe IDs, supported kinds, distinct valid endpoints, and optional boolean `directed`.
- Output record type and output kind are checked in `validateBase` at lines 981-1003. Constraint record type is checked before the existing constraint-specific switch at lines 1012-1092.
- `entityReferenceEntries` (lines 666-698) and `constraintReferenceEntries` (lines 700-748) are explicit discriminated switches. They do not inspect arbitrary string properties.
- `validateReferenceClosure` at lines 837-897 builds the allowed set from input refs plus entity IDs/names, then validates entity dependencies, constraint refs, relation endpoints, output refs, selection refs, and declared plan refs. A `managed:*` ref passes only when it is present as an input ref. Mirrored circle center/through metadata is intentionally not treated as an undeclared plan dependency; the owning circle identity is checked through its `id` input ref.
- `validateConstructionPlan` invokes the closure before `compileConstructionPlan` can serialize at line 1427.

## Follow-up blocker fixes

- `hasPersistentReferencePrefix`, `isPersistentReference`, `validName`, and `validReference` at lines 538-553 reserve the entire `managed:` namespace independently of the TikZ name grammar. Entity IDs/names and plan IDs therefore cannot masquerade as persistent references.
- `validateReferenceClosure` keeps a separate `inputReferences` set at lines 848-870. Any valid `managed:*` value encountered in selection, entity, constraint, relation, output, plan, or persistent circle-witness references must be present in `inputs`; a local alias cannot satisfy provenance.
- Circle center/through metadata remains exempt only for ordinary names. Persistent center/through witnesses are emitted into closure entries at lines 838-839 and must resolve through inputs.
- Tangent construction now declares `circle-center` as an explicit input at `construction-catalog.ts:1001-1004`.
- Tangent directive serialization now carries both the stable circle identity and its explicit center input (deduplicated when identical) at `construction-ir.ts:1867-1871`.
- Parallel and perpendicular construction plans now declare `line-${a}-${b}` as typed `line` entities and add dependency relations at `construction-catalog.ts:1289-1310` and `1368-1389`; the reference line remains an internal dependency and is not an output.

## Static observable

The source contains the above helpers and the `validateConstructionPlan -> validateReferenceClosure` call at the cited lines. Browser and automated test execution were intentionally not performed under the product-owner testing boundary.
