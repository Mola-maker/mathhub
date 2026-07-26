# Static Assets via CDN — Project-Wide Rule

**Every static asset shipped to the browser MUST be loaded through a CDN. No
self-hosting in this project's `public/` directory. No inline `url(...)` that
references a local `/...` path.**

This is the math_geohub project rule and applies to all future work in this
repo. Existing math_studio (in apps/math inside the monorepo worktree) and
math_geohub (the standalone clone) both follow it.

## Scope

Applies to: images, fonts, video, audio, JSON data, scripts, stylesheets,
3D models (.glb / .gltf / .obj / .fbx / .hdr), textures, Lottie / Rive JSON,
icons, sprites, splash logos, and any other resource that would otherwise be
placed under `public/` or imported as a static file.

Does **not** apply to: npm package code (`three`, `@react-three/fiber`,
`@react-three/drei`, `animejs`, `katex`, `react-markdown`, etc.) — those are
bundled by Turbopack into the JS chunk graph and are not "static assets" in
the CDN sense.

## Approved CDN origins (CSP-aligned)

Already allowlisted in `app/next.config.mjs` CSP for `script-src`, `img-src`,
`style-src`, `font-src`, `connect-src`, `worker-src`, `frame-src`:

| Origin | Use |
|---|---|
| `https://cdn.geogebra.org` | GeoGebra Math Apps bundle |
| `https://www.geogebra.org` | GeoGebra fallback / legacy bundle |
| `https://cdn.jsdelivr.net` | KaTeX CSS, NPM-served libs (if ever needed) |

Add **new** CDN origins by extending the CSP in `next.config.mjs` AND the
allow-list below. Never add an origin to one without the other.

| New origin | Use | CSP changes |
|---|---|---|
| `https://cdn.jsdelivr.net/npm/three@...` | Three.js core (if ever self-ejected from bundle) | `script-src` |
| `https://*.polyhaven.com` or `https://dl.polyhaven.org` | HDR / texture assets | `img-src` + `connect-src` |
| `https://fonts.googleapis.com` / `https://fonts.gstatic.com` | Google Fonts (NOT recommended — see self-host note below) | `style-src` + `font-src` |
| `https://*.figma.com` / `https://images.figma.com` | Figma exports | `img-src` + `connect-src` |
| `https://avatars.githubusercontent.com` | GitHub avatars (commits page etc.) | `img-src` |

## Self-hosting is NOT allowed

Even when a library like Three.js, KaTeX, or GeoGebra offers a downloadable
artifact, do **not** place it under `public/`. The math_geohub `public/`
directory must not exist (verified by the audit script below).

Rationale: self-hosted assets bypass the CDN's edge caching, increase origin
bandwidth on the ECS, and create a deployment-time artifact that must be kept
in sync (e.g. GeoGebra's Math Apps Bundle is ~100 MB and is `.gitignore`d in
the main repo — that has bitten deploys before).

## When a CDN does not exist

If a library you want does not provide a public CDN URL:

1. **Ask first.** Post in the project channel / PR description before adding
   a self-hosted asset.
2. **CDN-mirror it.** Many npm packages are mirrored on jsdelivr
   (`https://cdn.jsdelivr.net/npm/<pkg>@<version>/...`). Use that URL with
   an explicit version pin.
3. **Bundle it (npm).** If neither CDN works, install via npm and let
   Turbopack bundle. This is the documented exception for runtime libs —
   NOT for static assets like images / fonts / 3D models.

## Lint / audit script

Run from the project root before committing any change that touches assets:

```bash
node tools/audit-static-assets.mjs
```

It fails CI if:

- `public/` directory exists or is added
- Any source file contains a non-CDN `url(...)` reference (`/foo.png`,
  `/static/...`, `data:` for images > 2 KB, etc.)
- Any `<Image src="/...">` or `<img src="/...">` uses a non-CDN path
- Any loader (`new GLTFLoader().load('/foo.glb')`) points at a local path

The audit does **not** flag npm-bundled code or CSP-allowlisted CDN URLs.

## How to add a new asset (recipe)

1. Pick a CDN origin from the table above; if none fits, propose one
   (with rationale) and update both this rule and `next.config.mjs` CSP.
2. Pin the version in the URL (jsdelivr supports `@<semver>`).
3. Reference the URL in code, not a local import.
4. Run the audit script.
5. Run `npm run build` and confirm CSP allows the new origin (look in
   the dev-server / build response headers).