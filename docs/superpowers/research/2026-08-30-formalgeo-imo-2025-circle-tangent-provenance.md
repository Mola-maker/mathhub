# FormalGeo circle/tangent benchmark provenance checkpoint

## Purpose

This note records a provenance-only seed for the next independently authored
TikZ/GeoGebra paired semantic fixture. It does not copy a problem statement,
diagram, solution, or dataset artifact into the repository.

## Fixed primary evidence

- FormalGeo repository revision:
  `e7d90421e809a129109286fdb03832d8014d390f`
- The maintained project presents an IMO 2025 P2 example with two intersecting
  circles, a center-line construction, a circumcenter, an orthocenter, a
  derived circumcircle, and a joint parallel/tangent goal:
  <https://github.com/FormalGeo/FormalGeo/blob/e7d90421e809a129109286fdb03832d8014d390f/README.md#L224-L297>
- The corresponding formal predicate vocabulary includes circle, circumcenter,
  orthocenter, incidence, perpendicular, parallel, concyclic, and tangent
  relations:
  <https://github.com/FormalGeo/FormalGeo/blob/e7d90421e809a129109286fdb03832d8014d390f/tests/gdl.json#L165-L184>
- Repository licensing changed for releases on or after 2026-05-01; the fixed
  README must be consulted before redistributing code or dataset material:
  <https://github.com/FormalGeo/FormalGeo/blob/e7d90421e809a129109286fdb03832d8014d390f/README.md#L710-L717>

## Safe fixture policy

The source remains `research-reference-only` and `not-admitted`. The executable
fixture must be authored from scratch using only the abstract relation shape:

1. two circles with two common points;
2. a line through the centers;
3. one circumcenter and one orthocenter;
4. a second circle through three derived points;
5. one line constrained parallel to a secant;
6. the same line constrained tangent to the derived circle.

The local fixture must use new coordinates, names, source ordering, prose, and
presentation. It must remain byte-pinned and may cite only this repository
revision as provenance. No original statement text or image may enter prompt
caches, fixtures, screenshots, or generated source.

## Admission gates for the future pair

- both TikZ and GeoGebra projections are complete and comparable;
- entity, constraint, and portable relation minimums are explicit;
- `semanticHash` and `relationHash` match independently;
- incidence, perpendicular, parallel, concyclic, and tangent kinds have one
  shared canonical spelling and argument order;
- context compaction retains both mathematical and relationship hashes;
- presentation differences remain reported separately from mathematical truth.

## Implemented semantic core

The extended independently authored pair covers the non-branch-ambiguous
foundation of that chain: two center-radius circles, both named intersection
outputs, their common chord, a tangent derived by rotating one radius direction
through 90 degrees, and a second segment whose direction is copied by vector
translation. TikZ `name path` records and GeoGebra `Vector` commands stay
available as construction/source-binding helpers without inflating portable
entity coverage. Both adapters recover the same tangent and parallel
constraints from ordinary source constructions rather than coordinate
coincidence or managed metadata.

The pair pins eleven mathematical entities, two portable constraints, and five
portable relations (two intersections and three segment incidences), and
requires both the semantic and relation hashes to match. An explicit
point-on-circle constraint plus circumcenter and orthocenter parity remain
future gates, so this pair still must not be described as validating the full
IMO-derived dependency shape.
