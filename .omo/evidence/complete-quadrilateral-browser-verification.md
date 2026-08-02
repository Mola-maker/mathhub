# Complete quadrilateral browser verification

Date: 2026-08-01

Environment: local Next.js development server at `http://localhost:3000/tikz`,
controlled through the in-app Edge browser. Docker was not used. Tests, build,
lint, typecheck and TeX compilation were not run, following the product owner's
verification boundary.

## Scenario

1. Opened TikZ Studio and selected Competition → Complete quadrilateral.
2. Selected existing points A, C, B and H.
3. The committed managed block reported `plan-kind=complete-quadrilateral` and
   remained `构造有效`.
4. Rendering Truth exposed five independently selectable primitives:
   four infinite lines A–C, C–B, B–H and H–A, plus segment X1–X2.
5. Selecting line A–C resolved Inspector identity to:
   - semantic kind `line`;
   - a current RenderPrimitive;
   - `binding:managed:complete-quadrilateral-X1:record:entity:entity-line-A-C`;
   - managed write capability `managed-recompile`.
6. The Relations panel showed A and C as upstream inputs and X1 as downstream,
   matching the canonical line/intersection graph.
7. Applying the Emphasis preset changed the selected line to blue / very thick.
   The construction stayed valid and the selected semantic/render identity was
   recovered after the whole-block fingerprinted recompile.
8. From the selected internal line, invoking cascade deletion removed the entire
   `@mathgeo` command block atomically. The editor returned from 25 to 16 lines,
   the canvas returned from `7 点 · 14 图元` to `5 点 · 9 图元`, the Inspector
   cleared, and no stale managed metadata or body statement remained.

After the review pass, the default managed delete action was tightened to
`block`: it removes the whole block only when no external descendant would be
lost. External descendants require the separate `cascade` action and a second
confirmation. This wording/branch update was subsequently observed in the same
local browser; the earlier cascade exercise remains evidence for atomic block
expansion, not for the final default button mode.

## Architectural conclusion

The current safe deletion boundary for a managed composite is the whole command
block. Fine-grained deletion must remain unavailable until a typed structural
recompiler can rewrite the entity/constraint/relation/output closure, TikZ body,
header inputs/outputs and content fingerprint in one transaction.
