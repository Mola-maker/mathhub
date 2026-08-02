# Construction IR canvas integration evidence

Date: 2026-07-29

Scope:

- Added a renderer-independent typed Construction IR.
- Added validation and one TikZ writer for supported construction plans.
- Routed Canvas authoring through `plan -> validate -> compile -> source patch -> Broker`.
- Migrated point-on-circle, parallel/perpendicular line, inversion point,
  cyclic quadrilateral, and complete quadrilateral from direct string builders.
- Projected managed construction blocks back into Geometry IR constraints,
  relations, and source bindings for AI context.

Static review:

- Fixed the rectangle writer template delimiter.
- Fixed numeric-radius point-on-circle compilation so the pointer angle is
  preserved with `cos`/`sin`.
- `git diff --check` reported no whitespace errors for the touched TypeScript
  files.
- Per user instruction, no test, build, lint, typecheck, compiler test, or
  Docker command was run.

Local Edge browser evidence:

1. Parallel-line selected `C` as the through point and `A/B` as reference:
   - Generated managed block `parallel-Q1`.
   - Generated `\coordinate (Q1) at ($(C)+(B)-(A)$);`.
   - Generated `\draw ($(C)!-3!(Q1)$) -- ($(C)!4!(Q1)$);`.
   - Canvas changed from 5 points / 9 elements to 6 points / 10 elements.
   - Construction remained valid.
2. Created a circle centered at `A` through `C`, then used point-on-circle:
   - Generated managed block `point-on-circle-P1`.
   - Generated `\coordinate (P1) at ($(A)!1!0.001:(C)$);`.
   - Canvas recognized 6 points / 10 elements.
   - Construction remained valid.
3. Browser console reported 0 errors and 0 warnings.

Source map / AI graph follow-up:

- Resolved dependency and constraint point names to the current stable entity
  IDs before emitting Geometry IR.
- Added `geometry-source-map/v1` composition from UTF-16 source bindings through
  semantic records to interactive render primitive IDs.
- Added SVG `data-tikz-source-binding`, `data-tikz-source-start`, and
  `data-tikz-source-end` attributes.
- Browser DOM inspection confirmed one primitive mapped
  `binding:tz_...` to source range `[186, 226)`.
- Added focus-ref dependency closure prioritization to AI context and bound API
  `contextRefs` to the same semantic kernel focus snapshot.
