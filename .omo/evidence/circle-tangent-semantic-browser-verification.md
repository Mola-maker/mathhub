# Circle, tangent, and bisector semantic browser verification

Date: 2026-08-01

Environment: local Next.js development server at
`http://localhost:3000/tikz`, controlled through the in-app Edge browser.
Docker was not used. Tests, build, lint, typecheck, and TeX compilation were
not run.

## Three-point circle

- Started from the default `5 points / 9 elements` document.
- Selected Constraint -> Three-point circle, then existing points A, B, C.
- The page stayed `construction valid` and advanced to
  `6 points / 10 elements`.
- The writer emitted a schema-v2 managed block with
  `outputs=O1,circle-O1`.
- The records contained a typed circle entity and the exact predicate:

  ```json
  {
    "recordType": "constraint",
    "kind": "circle-through-three-points",
    "circle": "circle-O1",
    "center": "O1",
    "points": ["A", "B", "C"]
  }
  ```

- Separate center and circle outputs, plus dependencies on all three input
  points, were visible in the source editor.

## Tangent bound to an actual circle

- With the three-point circle visible, selected Constraint -> Tangent.
- The tool exposed one semantic slot: `click the tangent position on the
  target circle`.
- Clicking the circle at A succeeded through the RenderPrimitive circle-hit
  lane; the page stayed valid and advanced from `6 points / 10 elements` to
  `8 points / 11 elements`.
- The final schema-v2 header declared one stable managed circle input,
  `managed:circumcircle-O1:circle-O1`, and three typed outputs:
  `T1,Q1,line-T1-Q1`. No revision-local `tz_<uuid>` was persisted.
- The managed records contained both predicates:

  ```json
  {
    "recordType": "constraint",
    "kind": "on-circle",
    "point": "T1",
    "circle": "managed:circumcircle-O1:circle-O1"
  }
  ```

  ```json
  {
    "recordType": "constraint",
    "kind": "tangent-at-point",
    "line": "line-T1-Q1",
    "touch": "T1",
    "circle": "managed:circumcircle-O1:circle-O1",
    "center": "O1"
  }
  ```

- TikZ source first materialized T1 from the selected circle's own
  center/through/angle parameterization, then constructed Q1 perpendicular to
  O1--T1 and drew the extended tangent line.
- No visual radius tolerance, duplicate dependency edge, pseudo radius entity,
  or `radiusPoint` alias remained.
- The Geometry IR adapter pre-indexes qualified entity aliases across valid
  managed blocks, so the persisted circle reference resolves back to the
  current revision's canonical circle entity after reprojection.

## Raw / AI-generated circle fallback

The previous managed-only hit predicate was safe but incomplete: a visible
ordinary TikZ circle could not be selected by point-on-circle or tangent. The
fallback is typed at the parser boundary and immediately adopts a raw source
circle before another construction is allowed to depend on it.

- `SceneElement.circle.definition` is present only for either a direct named
  center plus a direct named through point, or a direct named center plus a
  positive literal radius. Calculated/ambiguous definitions remain
  non-authorable and fail closed.
- The typed definition is preserved through Geometry IR, interactive
  RenderPrimitive geometry, and the decoder. Canvas hit-testing never persists
  `element:<statement>:<ordinal>` or a runtime UUID.
- A shared canonicalizer emits current-revision definition selectors:
  `source:circle:center:<name>:through:<name>` or
  `source:circle:center:<name>:radius:<number>`. These values select a raw circle
  only inside the current source revision; they are not durable entity IDs and
  the adapter does not expose them as persistent aliases.
- On first use, the selected raw statement is range-checked, preserved exactly
  as the body of a schema-v2 `source-circle` managed block, and assigned the
  durable reference `managed:source-circle:circle`. The adoption block and the
  dependent construction are committed as one minimal CodeMirror/Broker patch.
- New Construction IR validation accepts only `managed:` persistent entity
  references. It cannot serialize a raw selector into a constraint, relation,
  input, or output record.
- Definition selectors are accepted only when unique in the current revision.
  Duplicate definitions are quarantined by the Canvas hit predicate. A later
  raw circle with the same definition is adopted under a new document-unique
  managed ID (`source-circle-2`, etc.), preventing cross-revision takeover.

Local browser scenarios:

1. Loaded a plain radius circle with named center O and radius 2, then clicked
   Constraint -> Tangent at the existing circumference point A. The raw draw
   statement was preserved inside a `source-circle` schema-v2 block whose circle
   entity records `center=O, radius=2`. The tangent block used only
   `managed:source-circle:circle`.
2. Loaded `\node[draw,circle through=(A)] at (O) {};` and repeated the same
   action. The page moved from `2 points / 1 element` to `4 points / 2 elements`,
   remained valid, preserved the node statement inside the adoption block, and
   emitted `center=O, through=A` plus a tangent reference to
   `managed:source-circle:circle`.
3. DOM inspection after reprojection showed valid source-circle entity/input/
   output records and no `unresolved` marker. The dependent tangent records all
   referenced the managed circle, never the raw selector.
4. Loaded two distinct draw statements with the identical typed definition
   `center=O, radius=2`. After selecting Tangent and the circumference point A,
   clicking the coincident circle was rejected with `请选择具有可逆圆定义语义的圆`.
   The document stayed at `2 points / 2 elements`, remained valid, and no
   `@mathgeo` block was written. This is the required fail-closed path for an
   ambiguous definition-level source identity.
5. Changed only the second circle to radius 3 and repeated the interaction on
   the radius-2 circle. The unique raw circle was adopted and the tangent bound
   to `managed:source-circle:circle`.
6. Edited the adopted circle body from radius 2 to radius 3, then added a new raw
   radius-2 circle and constructed its tangent. The new circle became
   `source-circle-2`; the old tangent still referenced
   `managed:source-circle:circle`, while the new tangent referenced
   `managed:source-circle-2:circle`. No raw alias or definition signature could
   transfer the old dependency to the new circle.
7. The construction-ID allocator now also reserves every candidate still
   mentioned as `managed:<candidate>:` anywhere in the source. Deleting an
   adoption block while leaving a dependent record therefore cannot make its ID
   available for a new circle.
8. Modified an adopted circle body so its fingerprint became detached, then
   selected its visible circle again. The source remained unchanged, the number
   of `@mathgeo begin` markers did not increase, and no `source-circle-2` block
   was nested inside the detached owner. Adoption now rejects any circle source
   range that overlaps an existing managed block.

## Perpendicular and angle bisectors

These were verified in a fresh default document to avoid overlapping-point hit
ambiguity from the tangent construction.

- Perpendicular bisector: selected A and B. The page advanced from
  `5 points / 9 elements` to `7 points / 10 elements`, stayed valid, and wrote
  a schema-v2 block with outputs `M1,Q1,line-M1-Q1`.
- Its metadata contained both the midpoint predicate and the typed
  `perpendicular-bisector` predicate, and the writer produced the midpoint,
  perpendicular direction point, and extended line.
- Angle bisector: selected A, C, B. The page advanced to
  `8 points / 11 elements`, stayed valid, and wrote a schema-v2 block with
  `angle-bisector(line-C-Q2,A,C,B)` plus direction-point and line outputs.
- No Next.js runtime/build overlay appeared in either flow.

## Managed deletion safety carried forward

- Managed selections expose `delete entire managed construction` as the safe
  default and a distinct `delete construction and external downstream`
  cascade action.
- The default block deletion refuses when external descendants exist.
- The cascade action requires an explicit second click; Delete/Backspace uses
  the same block-safe policy and cannot bypass that confirmation.
