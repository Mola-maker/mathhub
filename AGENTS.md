# math_geohub project rules

## Production deployment

- The product is a public service website deployed on ECS with CDN acceleration. It is not an on-premises/private-deployment product.
- The production application runs in containers on ECS behind Nginx or a load balancer. Immutable frontend assets and generated render artifacts are stored in object storage and delivered through the CDN.
- `.openai/hosting.json`, Sites, Cloudflare, and other edge runtimes may be used for preview only. Do not make production architecture decisions that depend on their runtime, bundle, CPU, or filesystem model.
- Dynamic APIs, LLM relay calls, and compile job control stay on ECS. Do not cache authenticated or user-specific API responses at the CDN.

## TikZ Studio architecture

- TikZ source is the persistent source of truth. The interactive construction graph is a revision-bound semantic projection, never a second independently writable truth.
- All source changes, including canvas operations, must enter through CodeMirror transactions and minimal source patches. Preserve untouched source bytes, comments, formatting, and unsupported TikZ blocks.
- Interactive geometry rendering and exact TeX rendering are separate lanes. The SVG interaction lane must remain responsive; exact TeX compilation runs asynchronously and never in the pointer-move/frame loop.
- Exact TeX compilation is an isolated ECS service. Do not run untrusted TeX inside the Next.js process or use `node-tikzjax` as the production compiler.
- Derived geometry is edited through the general constraint solver. Persist changes by patching upstream driving variables; never silently freeze a derived expression into a literal coordinate.
- Selection, hover, current tool, and drag previews are ephemeral interaction state. Locks, visibility, and groups are document metadata, not geometry.

## Workspace information architecture

- `mathhub/` is the only landing-page frontend and `/` is its only public entry. Do not add an alternate Hero homepage, `/hero-demo`, or a second landing-page component tree inside the Next.js app.
- MathHub gateway links must use same-origin relative routes (`/math` and `/tikz`). `MATHHUB_DEV_ORIGIN` is a local server-to-server proxy target only and must never become a browser-facing production callback URL.
- The production build emits MathHub into `public/mathhub/`; this directory is generated and must not become a hand-edited source tree. The ECS standalone image must copy the generated `public/` directory.
- Workspace analytics and cross-canvas modules belong on the main dashboard: semantic heatmaps, capability coverage, session activity, health, recent work, and global entry points.
- TikZ Studio contains only task-local direct-manipulation surfaces: AI/command input, construction tools, Canvas, CodeMirror source, object inspector, and exact preview.
- The dashboard consumes a read-only, revision-bound semantic snapshot from Studio. It must not parse or persist a second copy of TikZ source, and stale projections must expose their `semanticRevision`.
- Dashboard deep links reuse the Canvas `selectionRefs + stmtIndex` protocol and never mutate source directly.

## Canvas issue protocol

- Whenever a TikZ canvas defect, missing construction, or interaction failure is reported, first inspect the affected repository paths and then research current official documentation and maintained open-source implementations. Record the evidence and countermeasures before choosing an implementation.
- Canvas fixes must address the owning architecture boundary (document transaction, semantic graph, constraint, command, renderer, compiler, or AI patch protocol). Do not mask semantic failures with component-local state or one-off string replacements.
- For substantial canvas upgrades, proactively split independent read-only audits and research across sub-agents to control context growth. Keep implementation ownership explicit, preserve unrelated edits, and integrate through the shared document transaction boundary.
- Finish the interactive canvas construction model before treating exact TeX compilation as the primary debugging surface. Exact rendering validates fidelity; it must not become the only usable canvas.
- Local browser verification must run directly on the host and must not use Docker. Production compiler isolation remains an ECS deployment concern.

## Delivery gates

- Preserve the current dirty worktree and unrelated user changes.
- Architecture changes require unit, property-based, integration, Playwright browser, performance, and compiler-isolation tests proportional to the affected layer.
- The product owner currently owns automated, compiler, and domain-test execution. Codex must not run test, build, lint, typecheck, compiler, or Docker commands unless the product owner explicitly reauthorizes them; host-browser interaction checks remain allowed.
- GPL/AGPL or WebAssembly-linked LGPL dependencies require an explicit license review before production distribution.
