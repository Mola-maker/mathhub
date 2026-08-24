# MathHub Hero — Scene Worker Contracts

This file is the **single source of truth** for the five scene workers.
Import only what is documented here. Do not invent new colors, easing
libraries, or layout systems.

---

## 1. Hard rules (violations will be rejected)

- **Palette is closed.** Use ONLY the CSS variables below. No hex literals,
  no rgba() inventions, no new hues. Absolutely **no gradients, no purple,
  no cyan, no neon**.
- **No cards.** No container backgrounds, no glassmorphism, no panels.
  Fragments float on the cobalt field with hairline rules only.
- **No shadows** except extremely subtle ones; when in doubt, none.
- **Border-radius ≤ 2px** everywhere (`var(--radius)` is 1px).
- **Animations: `transform` and `opacity` only.** Plus `stroke-dashoffset`
  for SVG draw-on. No width/height/top/left animation.
- **Respect reduced motion**: wrap ambient/decorative motion with
  `useReducedMotion()` or use the `ambient()` helper (auto-disables).
- **One focal point per scene.** Everything else is secondary geometry,
  metadata, or construction lines.
- Scenes render inside a pinned 100svh stage. Position content absolutely
  (or flex) inside your scene root, which already fills the stage.

## 2. Palette variables (`src/system/tokens.css`)

| Variable         | Value                        | Use |
| ---------------- | ---------------------------- | --- |
| `--cobalt`       | `#1D4199`                    | dominant background (already on body) |
| `--deep`         | `#16367F`                    | recessed areas, pressed states — sparing |
| `--soft`         | `#4965AA`                    | secondary geometry, inactive states |
| `--paper`        | `#F5F4EE`                    | primary type, active geometry, key labels |
| `--mist`         | `rgba(255,255,255,0.55)`     | secondary text, metadata, inactive controls |
| `--line-faint`   | `rgba(245,244,238,0.12)`     | construction lines |
| `--line-strong`  | `rgba(245,244,238,0.25)`     | separators, annotations, hairline borders |

Type / spacing tokens: `--font-sans`, `--font-mono`, `--text-hero`
(clamp 96→160px), `--text-title`, `--text-body` (13px), `--text-meta`
(10.5px), `--tracking-meta` (0.22em), `--margin-x` (clamp 48→80px),
`--gutter` (24px), `--radius` (1px).

## 3. Geometry — `src/system/geometry.tsx`

```tsx
import { GeometryProvider, useGeometry } from "../system/geometry";
// (App already wraps everything in <GeometryProvider>)

const { A, B, C, setA, circumcenter, circumradius, sourceLines, lastTransaction } =
  useGeometry();
```

| Export | Type | Notes |
| ------ | ---- | ----- |
| `GeometryProvider` | component | already mounted in `App.tsx` — do not remount |
| `useGeometry()` | hook | returns the state below; throws outside provider |
| `A`, `B`, `C` | `{x:number;y:number}` | points in normalized viewBox space **0..10** |
| `setA(p)` | `(p:{x;y})=>void` | updates A (clamped to space); refreshes `sourceLines`; sets `lastTransaction` transiently (~1.2s) |
| `circumcenter` | `{x;y}` | derived O, recomputed every render |
| `circumradius` | `number` | `dist(O, A)` |
| `sourceLines` | `string[]` | e.g. `["triangle(A, B, C)", "A = point(5.10, 1.90)", "circumcircle(A, B, C)"]` |
| `lastTransaction` | `string \| null` | `"Δ A"` briefly after a drag; `null` otherwise |

Also exported: `circumcenterOf(a,b,c)`, `distance(p,q)`,
`buildSourceLines(a)`, `Point`, `GeometryState`.

## 4. Scroll — `src/system/scroll.tsx`

Scenes are pinned chapters. **App already wires the shells**; your scene
component receives `progress` as a prop — you never create a SceneShell
yourself.

```tsx
// App pattern (already implemented):
<SceneShell id="scene-1" title="Origin">
  {(progress) => <Scene1 progress={progress} />}
</SceneShell>
```

| Export | Signature | Notes |
| ------ | --------- | ----- |
| `SceneShell` | `{id, title, length?, children(progress), className?, style?}` | occupies `length` svh (default 150); sticky 100svh inner stage |
| `useGlobalScroll()` | `() => number` | 0..1 across whole page — for the integration worker |
| `ease(p)` | `(p:number)=>number` | easeOutCubic, the house ease |
| `clamp01(v)` | `(v:number)=>number` | clamp to 0..1 |
| `window01(p, from, to)` | `(p,from,to)=>number` | remap p through a window to 0..1 |
| `registerScene(id,title)` / `getScenes()` | registry | SceneShell auto-registers on mount |

## 5. Motion — `src/system/motion.ts`

```ts
import {
  useReducedMotion, ambient, subscribeTicker,
  fadeIn, riseIn, drawStroke, clamp01, window01,
} from "../system/motion";
```

| Export | Signature | Notes |
| ------ | --------- | ----- |
| `useReducedMotion()` | `() => boolean` | live `prefers-reduced-motion` |
| `ambient(targets, opts?)` | `=> () => void` cleanup | Level-1 loop: `drift` px (default 3), `duration` ms (default 8000), anime.js `inOutSine`, alternate+loop. **Auto no-op under reduced motion.** Call inside `useEffect`, return the cleanup. |
| `subscribeTicker(cb)` | `=> unsubscribe` | the ONE shared rAF ticker: `cb(time, deltaMs)`. Use for custom per-frame work — never spawn your own rAF loops or anime loops for ambient drift. |
| `fadeIn(p, from?, to?)` | `=> {opacity}` | progress-driven style |
| `riseIn(p, from?, to?, px?)` | `=> {opacity, transform}` | fade + translateY (default 24px) |
| `drawStroke(p, from?, to?)` | `=> {strokeDasharray, strokeDashoffset}` | SVG draw-on. **Requires `pathLength={1}` on the SVG element.** |

anime.js v4 is available as `import { animate, stagger, ... } from "animejs"`
for one-shot/choreographed animations. Prefer the shared ticker for
continuous work.

## 6. Fragments — `src/system/fragments.tsx` (+ `fragments.css`)

```tsx
import { Frag, TinyLabel, SourceLine, KeyHint } from "../system/fragments";
```

```tsx
<Frag x={12} y={20} label="Source" edges={["top", "left"]}>
  <SourceLine>A = point(5.10, 1.90)</SourceLine>
  <SourceLine dim>circumcircle(A, B, C)</SourceLine>
</Frag>

<TinyLabel>Fig. 01 — Circumcircle</TinyLabel>
<TinyLabel active>Δ A</TinyLabel>

<KeyHint keys={["⌘", "K"]} label="Command deck" />
```

- `<Frag>` — absolutely positioned floating fragment. Props:
  `x` / `y` (**percent of the stage**), `label?`, `edges?`
  (`("top"|"bottom"|"left"|"right")[]`, **hard-capped at 2 sides**),
  `className?`, `style?`. No background ever. Parent must be
  `position: relative` (your scene root is).
- `<TinyLabel>` — tiny uppercase spaced metadata. `active` turns it `--paper`.
- `<SourceLine>` — monospace source text; `dim` for secondary lines.
- `<KeyHint>` — bordered key caps + optional trailing label.

## 7. GeometryCanvas — `src/system/GeometryCanvas.tsx`

```tsx
import GeometryCanvas from "../system/GeometryCanvas";

<GeometryCanvas variant="hero" interactive className="my-scene-canvas" />
```

| Prop | Type | Default | Notes |
| ---- | ---- | ------- | ----- |
| `variant` | `"hero" \| "dock"` | `"hero"` | `dock` omits the faint auxiliary circle |
| `interactive` | `boolean` | `true` | wires pointer drag on A → `setA` |
| `className` | `string` | — | size via CSS (SVG is width/height 100%) |

Renders: triangle A/B/C (1px `--paper`), circumcircle, two construction
rays (`--line-faint`), one faint dashed auxiliary circle, draggable A,
labels A/B/C/O (`--mist`), one constraint tick at midpoint of BC.
All strokes use `vector-effect="non-scaling-stroke"` — always 1px.

## 8. Scene file conventions

- Your scene lives at `src/scenes/SceneN.tsx` with `src/scenes/SceneN.css`.
- Signature is fixed: `export default function SceneN({ progress }: { progress: number })`.
- Root element: `<div className="scene-N">` — already `position:relative`,
  100% of the pinned stage. Keep it as the positioning context.
- Put every new class in your own `SceneN.css`, prefixed `scene-N__`.
- Import system modules via relative paths: `../system/geometry`, etc.
- Progress windows: pick sub-ranges of `progress` (via `window01` /
  `fadeIn(p, from, to)` / `riseIn` / `drawStroke`) to sequence your beats.

## 9. Reference: existing assembly

- `src/App.tsx` — provider + floating top area + five shells (150svh each).
- `src/index.css` — tokens import + body base. Do not restyle `body`.
- Top area is `position: fixed`, `z-index: 50`. Scene content stays below
  z-index 50 unless intentionally covering it.

---

## 10. Appendix — Construction variants (Geometry_Expansion)

The geometry system supports four construction variants, all derived from
the **same draggable A/B/C** — interactivity is identical in every variant.
Everything in §3 and §7 above keeps working unchanged; this appendix is
purely additive.

### 10.1 Variant names

```ts
type ConstructionVariant = "circumcircle" | "incircle" | "medians" | "altitudes";
```

| Variant | Renders (on top of the always-present triangle) |
| ------- | ----------------------------------------------- |
| `circumcircle` | circumcircle + O + construction rays + faint aux circle (hero) + faint dashed perpendicular bisector from O + midpoint tick marks on BC & CA — **the default, original behavior, lightly enriched** |
| `incircle` | incircle + label I + dashed angle-bisector rays from A and B + touch-point tick marks on all three sides |
| `medians` | three medians (`--line-faint`) + centroid G + midpoint tick marks on all three sides |
| `altitudes` | three altitudes (faint dashed) + orthocenter H + right-angle marks at the three feet |

All strokes remain 1px `non-scaling-stroke`; main strokes `--paper`,
construction/dashed lines `--line-faint`, tick & right-angle marks
`--line-strong`, labels ~11px `--mist`. No glow, no gradients.

### 10.2 `useGeometry()` additions

```tsx
const { construction, setConstruction, derived } = useGeometry();
```

| Field | Type | Notes |
| ----- | ---- | ----- |
| `construction` | `ConstructionVariant` | current variant, default `"circumcircle"` |
| `setConstruction(c)` | `(c: ConstructionVariant) => void` | switches variant; also re-themes `sourceLines` |
| `derived` | `DerivedGeometry` | `{ circumcenter, incenter, centroid, orthocenter, midAB, midBC, midCA, inradius }` — recomputed from A/B/C every render for scenes that need coordinates |

`sourceLines` now follows the active variant. The `circumcircle` lines are
**byte-identical to before**; other variants yield plausible source, e.g.:

- incircle: `incircle(A, B, C)`, `I = incenter(A, B, C)`
- medians: `median(A, BC)`, `median(B, CA)`, `centroid G = median ∩ median`
- altitudes: `altitude(A, BC)`, `altitude(B, CA)`, `H = orthocenter(A, B, C)`

### 10.3 `GeometryCanvas` new prop

```tsx
<GeometryCanvas construction="medians" />
```

| Prop | Type | Default | Notes |
| ---- | ---- | ------- | ----- |
| `construction` | `ConstructionVariant` | — | When omitted, the canvas **follows `useGeometry().construction`** (itself defaulting to `"circumcircle"`). Pass explicitly to pin a variant per instance. |

The SVG root also gains a `geometry-canvas--{construction}` modifier class
alongside the existing `geometry-canvas--{variant}` one.

### 10.4 New geometry exports

`midpointOf(p,q)`, `centroidOf(a,b,c)`, `incenterOf(a,b,c)`,
`inradiusOf(a,b,c)`, `orthocenterOf(a,b,c)`,
`projectToLine(p, l1, l2)` (orthogonal projection onto a line — used for
incircle touch points and altitude feet), plus the types
`ConstructionVariant` and `DerivedGeometry`.

`buildSourceLines(a, construction?)` gained an optional second parameter;
`buildSourceLines(a)` still returns exactly the original circumcircle lines.

---

## 10. Smoothing note (motion/scroll)

- **Progress is temporally smoothed.** `SceneShell`'s render-prop `progress`
  and `useGlobalScroll()` emit critically-damped values: raw scroll is
  measured on passive, rAF-throttled listeners, then each scene's external
  store lerps the emitted value toward raw on the shared ticker
  (`k ≈ 0.14`/frame @60fps, frame-rate independent via
  `1 - pow(1 - k, dt / 16.67)`). Reads go through `useSyncExternalStore` —
  no React state per frame; only progress consumers re-render, and the
  ticker disengages once settled. First measurement snaps (no sweep on
  mid-page load); `prefers-reduced-motion` bypasses smoothing entirely.
- New motion exports: `easeInOut3(p)` (cubic in-out, animejs signature
  feel), `easeOut3(p)`, `smooth01(p, k)` (blend linear → cubic in-out),
  and `prefersReduced()` (cheap non-hook reduced-motion check).
- `fadeIn` / `riseIn` outputs now include `willChange: "transform, opacity"`.
- The pinned stage carries compositing hints (`translateZ(0)` +
  `contain: layout paint`). Keep animations on transform/opacity.
- New scroll exports: `createSmoothProgressStore(k?)`,
  `SmoothProgressStore` — for integration workers needing custom smoothed
  signals off the same ticker.

## 10. i18n — `src/system/i18n.tsx`

The app is wrapped in `<LanguageProvider>` (mounted in `App.tsx` — do not
remount). All user-visible copy lives in one dictionary; scenes consume it
via `useLang()`.

```tsx
import { useLang } from "../system/i18n";

const { lang, setLang, t } = useLang();
// lang: "zh" | "en"   (default "zh"; persisted to localStorage "mathhub-lang")
// t("s3.headline.a") → string, typed — keys are autocompleted
```

| Export | Type | Notes |
| ------ | ---- | ----- |
| `LanguageProvider` | component | already mounted in `App.tsx` |
| `useLang()` | hook | returns `{ lang, setLang, t }`; throws outside provider |
| `t(key)` | `(key: I18nKey) => string` | dictionary lookup, English fallback |
| `dict` | `{ en, zh }` | full dictionary, for introspection/tests |
| `I18nKey` | union type | every valid key, derived from the English table |
| `Lang` | `"zh" \| "en"` | language id |

**Key naming scheme:** `<area>.<thing>[.<part>]` —

- `nav.*` header nav labels · `header.*` header chrome · `chapter.*` SceneShell titles
- `s1.*`…`s5.*` per scene: `.title`, `.standfirst`, `.cta`, `.fig` (captions),
  `.frag.*` (fragment metadata labels), `.mode.*`, `.tool.*`, `.echo.*`,
  `.history.*`, `.rel.*`, `.tx.*`, `.deck.*`, `.enter`, etc.

**Rules:**

- **Never translate mathematical notation** — `A = point(...)`, `⌘K`,
  `AB = AC`, `Δ A`, `∠BAC = 42.3°` stay identical in both languages.
- Brand type (`MathHub`, the `Math`/`Hub` album anchor) stays English in `zh`.
- Dynamic numbers keep their live formatting: split around the placeholder,
  e.g. `{t("s4.tx.move")}{A.x.toFixed(1)}, {A.y.toFixed(1)})`.
- Chinese copy already renders in the CJK-capable font stack on `body` —
  no per-scene font changes needed.
- When adding new copy, add BOTH `en` and `zh` entries (the `zh` table is
  type-checked against every `I18nKey`; a missing key fails `tsc`).
