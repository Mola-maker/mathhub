# GeoGebra runtime design extraction for TikZ Studio

Date: 2026-08-15
Source inspected: `E:\Portaitsweb\molamaker-site\public\geogebra`

## Scope and license boundary

The inspected directory is a compiled GeoGebra HTML5 distribution. Its README
and `deployggb.js` identify the GeoGebra Non-Commercial License. Math GeoHub
must not copy the compiled runtime, minified algorithms, icons, fonts, or CSS.
This audit extracts interface and interaction patterns only; the implementation
below remains original and keeps TikZ source plus GeometryDoc as its truth.

## High-value patterns found

### 1. Object lifecycle is observable

The packaged API exposes add, update, remove, rename, clear, click, object-click,
object-update, client, and store-undo listeners. This is more useful than a
generic React rerender notification: downstream views can invalidate exactly
the affected cache and can distinguish a source edit from a selection change.

TikZ mapping:

- `StudioDocument` emits one bounded, typed change event after an atomic commit.
- The event carries document/epoch/revision/transaction/origin and patch
  summaries, but never duplicates source bytes.
- CodeMirror, Canvas, Agent context, exact preview, VLM audit, and future
  collaboration consume the same event identity while re-reading current truth.

### 2. Model, algorithm, presentation, and export are separate APIs

The distribution exposes object names/types, algorithm XML, style XML,
visibility/color/line/point setters, and SVG/PNG/PDF export separately. The
valuable idea is the separation, not GeoGebra XML itself.

TikZ mapping:

- GeometryDoc entity/constraint/relation lanes are model and algorithm truth.
- Managed presentation slots are style truth.
- Interactive RenderPrimitive SVG is authoring truth.
- isolated TeX/dvisvgm SVG is exact export truth.
- no exporter or visual audit can write semantic truth directly.

### 3. Selection drives contextual tools

GeoGebra provides selection APIs, a compact quick style bar, disabled states,
and a categorized toolbox. The important behavior is capability-driven UI:
the selected object determines which tools are offered and why a tool is
blocked.

TikZ mapping:

- Catalog remains the single registry for Canvas and Agent construction tools.
- selection capabilities must be computed before pointer-down/apply.
- style/transform widgets target canonical entity and writer-slot identities;
  they never probe support by attempting a source mutation.

### 4. Atomic history is a first-class interaction

The API includes undo/store-undo hooks and the UI keeps undo/redo independent
from individual object rendering. TikZ Studio already commits through one
Broker transaction; its remaining gap is bounded journal retention and stable
idempotency after hot records are evicted.

TikZ mapping:

- keep a byte- and count-bounded hot transaction journal;
- retain small idempotency tombstones longer than full patch records;
- emit a single lifecycle event only after the commit is current truth;
- do not log preview, hover, or solver intermediate frames as document commits.

### 5. Responsive graphics controls are overlays

The packaged CSS uses a graphics overlay, contextual quick style bar, floating
zoom controls, pointer-event suppression while dragging, focus-visible rings,
and short 150–250 ms transitions. These are authoring overlays, not geometry.

TikZ mapping:

- keep selection handles, impact halos, dynamic pen strokes, and toasts outside
  RenderPrimitive document style;
- suppress unrelated pointer surfaces during an active gesture;
- retain keyboard-equivalent controls and focus-visible states;
- apply Apple-style motion only after capability and transaction behavior is
  correct.

## Rejected extraction paths

- Do not embed GeoGebra as a second geometry truth or round-trip through GGB XML.
- Do not copy compiled construction algorithms; trusted Catalog plans remain
  explicit and testable.
- Do not import GeoGebra toolbar CSS or icons.
- Do not route TikZ writes through `evalCommand`; Broker replay remains the only
  commit boundary.

## Framework acceptance criteria

1. One successful source transaction emits exactly one ordered lifecycle event.
2. CST-only refreshes, hover, preview, and failed/stale writes emit no commit
   event.
3. The event contains no source or candidate payload and stays bounded.
4. Hot transaction history is count- and byte-bounded; old idempotency keys
   still reject duplicate commits through bounded tombstones.
5. Agent cache invalidation keys use document/epoch/revision/source hash rather
   than UI object instances.
6. All contextual tools resolve their capabilities from Catalog + GeometryDoc,
   not from copied GeoGebra behavior or visual guesses.
