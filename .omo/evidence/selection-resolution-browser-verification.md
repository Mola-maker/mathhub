# Selection Resolution browser verification

- Date: 2026-07-30 (Asia/Shanghai)
- Runtime: local Next.js dev server at `http://localhost:3000/tikz`
- Container/Docker: not used
- Build/test/lint/typecheck/TeX commands: not run (user owns those gates)
- Browser: Codex in-app Chromium

## Scenario: managed primitive style recompile keeps exact identity

1. Opened TikZ Studio and created a managed ray from existing points `B` and
   `C`.
2. Switched to Select/Drag and selected the ray.
3. Captured the committed SVG identity before editing:

   ```json
   {
     "entityId": "tz_ef03f78b-bf43-4327-b19a-f8e2423c5f10",
     "renderPrimitiveId": "interactive:tz_ef03f78b-bf43-4327-b19a-f8e2423c5f10"
   }
   ```

4. Applied the `强调` preset. The source became:

   ```tex
   \draw[->,blue,very thick] (B) -- ($(B)!4!(C)$);
   ```

5. Applied the `辅助线` preset as a second consecutive managed recompile. The
   source became:

   ```tex
   \draw[->,gray,thin,dashed] (B) -- ($(B)!4!(C)$);
   ```

6. After both whole-block replacements:

   - toolbar still reported `构造有效`;
   - Inspector still reported `ray · B–C`;
   - selected entity ID remained
     `tz_ef03f78b-bf43-4327-b19a-f8e2423c5f10`;
   - selected RenderPrimitive ID remained
     `interactive:tz_ef03f78b-bf43-4327-b19a-f8e2423c5f10`;
   - Inspector exposed the unique record binding
     `binding:managed:ray-B-C:record:entity:entity-ray-B-C`;
   - Inspector write policy remained `managed-recompile`.

## Scenario: relation direction

Selected free point `A`, opened the Relations tab, and observed:

- upstream: `无上游依赖 · 自由对象`;
- downstream: `M`, `H`;
- freedom: `A 可直接拖拽`.

This confirms ordinary `depends-on` edges are interpreted as
`dependent -> dependency`, rather than reversed.

## Scenario: local load gate

After the identity/binding changes, a fresh local navigation to `/tikz`
rendered the Studio with `构造有效` and no Next.js build/runtime error overlay.

## Scenario: right-angle mark is independently selectable

The committed right-angle path rendered as:

```svg
M 189.7 435.15 L 201.7 435.15 L 201.7 447.15
```

Clicking its outer corner (where the angle path is closer than point `H`)
selected exactly one committed primitive:

```json
{
  "kind": "right-angle",
  "refs": "C H B",
  "entityId": "tz_b77b505e-7c34-4b28-b08d-c138111154a4"
}
```

The Inspector switched to the corresponding right-angle object. This verifies
that angle hit testing now consumes the same shared mark geometry as rendering,
and that a nearby point handle no longer makes the complete angle mark
unselectable.
