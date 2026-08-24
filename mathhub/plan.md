# MathHub Hero Page — Execution Plan

Build a scroll-driven cinematic hero page for MathHub (source-native geometry workspace)
per the owner's art direction spec: monochromatic cobalt-blue Japanese indie editorial
minimalism, 5 scroll scenes, dense component animation, workspace reveal transition.

## Stack
Vite + React + TypeScript + anime.js + SVG geometry + CSS variables.
No Tailwind, no Three.js. `npm run dev` must forward host/port args (preview on :7100).

## Stage 1 — Scaffold & Design System (1 coder, sequential gate)
- Vite React-TS project, anime.js dependency
- Design tokens as CSS variables (palette: #1D4199 / #16367F / #4965AA / #F5F4EE / mist white / faint lines; NO gradients, NO purple/cyan)
- Typography system (neo-grotesk stack, extreme scale contrast 96–160px vs 11–14px)
- Shared contracts in `src/system/`:
  - `GeometryContext` — points A/B/C, draggable point, circumcircle derivation, source transaction state (`A = point(x, y)` etc.)
  - `useScrollProgress` / scene registry — each scene receives local progress 0..1
  - `useReducedMotion`, ambient animation utilities (one coordinated timeline, transform/opacity only)
  - `SceneShell` layout primitives, floating fragment components (thin rules, open alignment, no cards)
- `src/system/CONTRACTS.md` documenting exact props/exports scene workers must use
- Empty `src/scenes/Scene1..5.tsx` stubs + `src/App.tsx` assembling them
Output: compiling scaffold + CONTRACTS.md

## Stage 2 — Scene Workers (5 parallel coders, no cross-dependency)
Each builds exactly one scene per spec excerpt, using ONLY Stage-1 contracts:
- Scene 1: Atmospheric opening — oversized typography, one living geometry object, minimal fragments
- Scene 2: Gesture becomes source — drag point A → geometry updates → source transaction appears
- Scene 3: Multiple entry points — toolbar, command deck, keyboard, canvas, source editing as separate floating fragments
- Scene 4: Unified source of truth — all fragments converge visually into one source transaction
- Scene 5: Workspace reveal — fragments morph/dock into toolbar / left AI deck / right inspector / bottom source dock
Each worker must satisfy: one dominant focal point, no gradients/cards/glass, motion levels 1–4 as applicable, 60fps transform/opacity only.

## Stage 3 — Integration & Polish (1 coder, sequential gate)
- Wire 5 scenes into one continuous scroll narrative (chapter feel, no abrupt cuts, continuous morph into workspace reveal)
- Entrance choreography on load (7-step sequence from spec §9 Level 4)
- Minimal top: small MathHub wordmark + "Enter workspace ↗" only
- Responsive (tablet/mobile simplification), `prefers-reduced-motion`, keyboard accessibility
- `npm run build` passes; `npm run dev` verified; stop server after validation

## Delivery
Preview link per Kimi Work web-app rules + absolute root path.
