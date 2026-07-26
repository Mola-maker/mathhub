# Hero Binary — isolated design sandbox

Self-contained Vite + vanilla TypeScript project for the `Geo · math geohub`
hero design. Lives entirely inside `Herodeisgn/` and does NOT touch the
parent Next.js app. Compile / dev / build commands stay local to this folder.

## What's in here

- **3D triangulated `Geo` wordmark** built with `three.js` (ShapeGeometry +
  EdgesGeometry, rendered as LineSegments so the internal triangulation is
  visible).
- **Binary "data-storm" columns** as pure DOM (24 rows × 4 columns, one
  highlighted digit per column in vermilion).
- **Entrance reveal** via `animejs` v4 — wordmark settle, line-by-line fade-in,
  DOM fade-up cascade.
- **Ambient interaction** — pointer movement produces a very small rotation
  of the wordmark group (max ~5° in either axis).

## Run

```bash
cd Herodeisgn
npm install          # one-time
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit
npm run build        # tsc + vite build → dist/
npm run preview      # serve dist/ locally
```

## File map

```
Herodeisgn/
├── package.json          ← vite + animejs + three (local-only)
├── tsconfig.json
├── vite.config.ts
├── index.html            ← DOM scaffold
└── src/
    ├── main.ts           ← entry — wires everything
    ├── scene.ts          ← three.js renderer/camera/loop
    ├── geoLetters.ts     ← ShapeGeometry + EdgesGeometry for G/e/o
    ├── binaryColumns.ts  ← DOM injection
    ├── reveal.ts         ← anime.js v4 entrance timeline
    └── style.css         ← design tokens + layout
```

## Design tokens

All tokens live in `src/style.css :root`:

| Token          | Value      | Use                          |
| -------------- | ---------- | ---------------------------- |
| `--hb-bg`      | `#ffffff`  | canvas                       |
| `--hb-ink`     | `#0a0a0a`  | wordmark stroke + type       |
| `--hb-mid`     | `#4a4a4a`  | primary binary digits        |
| `--hb-soft`    | `#a8a8a8`  | faded binary digits          |
| `--hb-rule`    | `#e5e5e5`  | (reserved) hairline rule     |
| `--hb-accent`  | `#ff4d2e`  | single highlighted digit     |

## Isolation guarantees

- No files outside `Herodeisgn/` are created or modified.
- Dependencies are installed in `Herodeisgn/node_modules/` only — the
  parent project's `node_modules/` is untouched.
- The dev server uses port 5173 and is independent of the Next.js dev
  server (which uses 3000).
- `publicDir: false` in `vite.config.ts` blocks any accidental creation
  of a `public/` folder at the project root.

## Reduced motion

`@media (prefers-reduced-motion: reduce)` collapses all entrance animations
to instant reveal — the wordmark and DOM targets appear at their final state
without any motion.