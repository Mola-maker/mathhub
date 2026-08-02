# Radical-axis semantic browser verification

Date: 2026-08-01

Environment: local Next.js development server at
`http://localhost:3000/tikz`, controlled through the in-app Edge browser.
Docker was not used. Tests, build, lint, typecheck, and TeX compilation were
not run.

## Research basis

- The JSXGraph radical-axis implementation accepts exactly two circle parents,
  subtracts their dynamic standard-form equations, and registers both circles
  as dependencies for reactive updates:
  <https://jsxgraph.org/docs/symbols/src/src_base_line.js.html>.
- The invariant is the equal-power locus, so one algorithm applies to
  intersecting, tangent, and disjoint circles. Concentric circles have no unique
  finite radical axis and must fail before source mutation.

## Architecture change

- The tool now accepts two `CircleConstructionReference` inputs rather than four
  point approximations.
- Raw typed circles are first adopted into schema-v2 managed circle entities;
  the radical-axis construction stores only `managed:` circle references.
- The writer computes
  `t=(d^2+r1^2-r2^2)/(2d^2)`, materializes the equal-power point, derives a
  perpendicular direction from the center-center vector, and emits a real line
  entity.
- The managed schema and Geometry IR adapter expose a typed `radical-axis`
  constraint with line, equal-power point, first-circle, and second-circle
  roles, plus point/direction/line outputs and dependency edges.
- Same-circle, non-positive-radius, concentric, and near-concentric inputs are
  rejected before any adoption or dependent block is written.

## Positive browser scenario

Loaded two raw literal-radius circles:

- `O1=(0,0)`, radius `2`, with existing circumference point A.
- `O2=(5,0)`, radius `1.5`, with existing circumference point B.

Selected Competition -> Radical axis and clicked A then B. The browser showed
`6 points / 3 elements` and `construction valid`.

- Both raw circle statements were adopted as `source-circle` and
  `source-circle-2`.
- The radical-axis header declared only
  `managed:source-circle:circle,managed:source-circle-2:circle` as inputs.
- The source contained typed relation/output records, the equal-power formula,
  the perpendicular direction point, the extended line, and a valid
  `% @mathgeo end` marker.
- CodeMirror virtualized off-screen lines; moving the editor to the end exposed
  the complete block and confirmed that it was not truncated.

## Degenerate browser scenario

Loaded two concentric raw circles centered at O with radii 2 and 3, selected
Competition -> Radical axis, and clicked their existing circumference points.

- The UI reported `同心或近同心圆没有唯一的有限根轴`.
- The editor source remained exactly equal to the pre-action source.
- No adoption block, radical-axis block, or partial managed metadata was
  written.
- Repeated the scenario with distinct center names `O1` and `O2` at the same
  evaluated coordinate `(0,0)`. The same diagnostic appeared and the source
  again remained unchanged. The plan carries evaluated center/radius snapshots,
  so Construction IR validation cannot be bypassed merely by renaming a center.

This confirms the degeneracy check runs before the atomic adoption/construction
transaction.
