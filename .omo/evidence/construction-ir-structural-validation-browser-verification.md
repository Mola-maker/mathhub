# Construction IR structural closure — local browser verification

Date: 2026-08-01

Environment: local Next.js dev server at `http://localhost:3000/tikz`; in-app browser. No Docker, test suite, build, lint, typecheck, or TeX command was run.

## Parallel line

- Source: free points `A=(0,0)`, `B=(3,1)`, `C=(0,2)`.
- Interaction: `平行线`, then `C`, `A`, `B`.
- Result: `4 点 · 1 图元`, `构造有效`.
- The schema-v2 block contained an explicit reference-line entity `line-A-B`, `parallel(line-Q1, line-A-B)`, dependency edges for the reference line, and a derived direction-point output.

## Perpendicular line

- Same source and interaction order with `垂线`.
- Result: `4 点 · 1 图元`, `构造有效`.
- The schema-v2 block contained an explicit reference-line entity `line-A-B`, `perpendicular(line-Q1, line-A-B)`, dependency edges for the reference line, and a derived direction-point output.

## Tangent at a managed circle

- Source: three free points `A=(0,0)`, `B=(3,0)`, `C=(0,2)`.
- Interaction: create `三点圆`, then select `切线` and click a non-point location on its circumference.
- Result: `6 点 · 2 图元`, `构造有效`.
- The tangent schema-v2 block declared both inputs: `managed:circumcircle-O1:circle-O1` and explicit center `O1`.
- It emitted `on-circle` and `tangent-at-point` constraints, a typed tangent line entity, and the exact dependency `Q1 -> O1` used by the legacy-compatibility guard.

## Observation

The first two automated clicks used locator centers and intentionally did not hit the circumference; the UI correctly rejected them with `请选择具有可逆圆定义语义的圆`. A coordinate click on the visible circumference succeeded, confirming the semantic circle hit path rather than a false center-point selection.
