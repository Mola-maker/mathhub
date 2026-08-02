# Advanced incidence constraints — local browser verification

Date: 2026-08-01

Boundary: local Next.js page at `http://localhost:3000/tikz`. No Docker,
test runner, build, lint, typecheck, or TeX command was executed. This is
interaction evidence, not user acceptance or exact-TeX certification.

## Cyclic quadrilateral — positive

Input source defined `A=(0,0)`, `B=(4,0)`, `C=(2,3)`, and secant direction
point `P=(3,1)`. Selecting A, B, C, P with the canvas tool produced one valid
schema-v2 managed block.

Observed result:

- page status: `6 points / 2 elements`, `construction valid`;
- managed circle entity `circle-O1`, centered at `O1`, through `A`;
- managed secant line entity `line-A-P`;
- `circle-through-three-points(circle-O1, O1, [A,B,C])`;
- `line-circle-other-intersection(D1, line-A-P, circle-O1)` with
  `excludePoint=A`, `domain=line`, `selector=exclude-known-point`;
- explicit outputs for circumcenter, fourth vertex, circle, secant, and polygon;
- TikZ body remained the existing circumcenter/second-intersection construction
  and rendered without an error overlay.

## Cyclic quadrilateral — tangent rejection

Input source used `T=(5,-12)`, a tangent direction at A for the circumcircle of
A/B/C. The fourth selection was rejected with the visible diagnostic:

`The current direction is tangent to the circumcircle at the first point and cannot determine a distinct fourth point.`

The source remained the original six lines with no partial managed block.

## Cyclic quadrilateral — collinear secant rejection

Input source used a distinct direction point `P=(2,0)` on line AB. The writer
formula would place the other circle intersection at B. The canvas now rejects
this before plan creation with a visible diagnostic that the second secant
intersection coincides with B or C and cannot form four distinct vertices.
The source remained the original six lines with no partial managed block.

## Complete quadrilateral — positive

Input source defined `A=(0,0)`, `B=(4,0)`, `C=(3,3)`, `D=(-1,2)`. Selecting
A, B, C, D produced a valid schema-v2 block.

Observed result:

- page status: `6 points / 5 elements`, `construction valid`;
- four managed line entities AB, BC, CD, DA;
- `line-intersection(X1, line-A-B, line-C-D, domain=line)`;
- `line-intersection(X2, line-B-C, line-D-A, domain=line)`;
- the aggregate `complete-quadrilateral` constraint remained present;
- the existing TikZ writer rendered both finite intersections and the diagonal.

## Complete quadrilateral — parallel rejection

Rectangle-shaped inputs `A=(0,0)`, `B=(4,0)`, `C=(4,2)`, `D=(0,2)` were
rejected because AB and CD are parallel. The page showed the finite-intersection
diagnostic and kept the source unchanged with no partial managed block.

## Structural-closure compatibility rerun

After adding catalog-independent ConstructionPlan entity/relation/reference
closure validation, the positive cyclic and complete-quadrilateral scenarios
were repeated in the local browser. Both still committed one schema-v2 block
and remained `construction valid` (`6 points / 2 elements` and
`6 points / 5 elements`, respectively). This checks that strict closure did not
falsely reject their declared inputs and derived entity aliases.
