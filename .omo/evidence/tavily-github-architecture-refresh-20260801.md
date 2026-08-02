# Tavily and GitHub architecture refresh - 2026-08-01

## Research status

- Tavily `research` (`pro`) was attempted and failed with an MCP transport error
  to `https://chatgpt.com/backend-api/ps/mcp`.
- Tavily `search` (`advanced`) succeeded for two focused queries.
- GitHub connector repository search succeeded for `pgf-tikz/pgf` `pgfkeys`.
- GitHub connector `fetch_commit` for the pinned 3.1.11a release commit was
  attempted and failed with the same MCP transport error. The canonical commit URL
  remains accessible independently.

## Primary-source findings

### PGF/TikZ is a runtime macro/key ecosystem

- The official manual exposes PGF keys, handlers, styles, `foreach`, graphs,
  graph drawing, libraries, utilities, parser/math engines, the basic layer, and
  system/driver layers as separate surfaces.
- `pgfkeys` handlers can store and execute macro code; graph parsing has explicit
  timing rules for macro expansion; graph drawing can defer actions and hand nodes
  to a separate graph drawing engine.
- Therefore a static command list cannot prove execution semantics or reversible
  Canvas writeback. Static inventory, semantic plugins, and exact execution must
  remain separate lanes.

Sources:

- <https://tikz.dev/>
- <https://tikz.dev/pgfkeys>
- <https://tikz.dev/pgffor>
- <https://tikz.dev/gd-usage-pgf>
- <https://github.com/pgf-tikz/pgf>
- <https://github.com/pgf-tikz/pgf/blob/3a62cf45d206bc9fdc85175f3e60d851ed9f8db2/tex/generic/pgf/utilities/pgfkeys.code.tex>

### Lezer provides incremental syntax reuse, not persistent domain identity

- `TreeFragment.applyChanges` maps reusable syntax fragments after document
  changes.
- Lezer trees are compact editor data structures whose nodes primarily contain
  type and ranges. They are not an appropriate permanent Geometry ID store.
- Use Lezer for lossless incremental syntax projection and CodeMirror `ChangeDesc`
  for transaction-local range mapping. Reconcile semantic UUIDs separately.

Sources:

- <https://lezer.codemirror.net/docs/ref/>
- <https://lezer.codemirror.net/docs/guide/>
- <https://codemirror.net/docs/ref/>

## Decisions applied

1. Freeze five support lanes: preservation, inventory, semantics, interaction,
   exact execution.
2. Build a content-addressed sharded upstream inventory; browsers and AI receive
   only bounded slices.
3. Preserve dynamic macro/control-flow syntax as opaque unless an adapter proves a
   reversible source mapping.
4. Keep parser ranges separate from persistent geometry identity.
5. Exact TeX is a separately attested compiler-profile projection and may reject
   by policy, but it must never silently rewrite submitted source.
6. AI, Code, Canvas, Inspector, and solver submit one typed mutation protocol to a
   revision/hash/binding guarded Broker.

## Verification boundary

This was research and static repository inspection. No tests, build, typecheck,
TeX compilation, Docker, or browser validation were run.

