# TikZ/PGF registry and parser architecture research

Date: 2026-08-02 (research snapshot requested for 2026-08-01)

## Executive result

The project already has a strong *capability inventory* (including an exhaustive library-name table), a Lezer CST wrapper, UTF-16/UTF-8 source indexing, opaque-node preservation, and separate source/semantic/render lanes. The remaining gap is not “add more library names”; it is a **machine-readable registry of command/key definitions generated from the official PGF source**, plus a lossless token/CST model for macros, active characters, key handlers, scopes, and execution products. The official implementation is a dynamic TeX program: a static list can classify and route syntax, but cannot claim full semantic interpretation without an execution boundary.

## Primary evidence

**Claim**: PGF/TikZ is layered and TikZ is a frontend over PGF; libraries/modules are loaded independently.

**Evidence** ([official PGF design principles](https://github.com/pgf-tikz/pgf/blob/ecb9ba41446a32c9be0e8b8ce726670ad20625cd/doc/generic/pgf/pgfmanual-en-main.tex#L118-L145)):
```tex
% The basic layer does not provide a convenient syntax ... left to frontends like TikZ.
% Modules are loaded using the \usepgfmodule command.
```

**Explanation**: Registry entries must carry layer (`tikz`, `pgf-basic`, `pgf-system`, module), load requirement, and execution/render lane; a flat command enum will misclassify backend-only and module syntax.

**Claim**: The official implementation is key-tree based, with styles, handlers, and executable callbacks rather than a finite option enum.

**Evidence** ([official `tikz.code.tex`](https://github.com/pgf-tikz/pgf/blob/ecb9ba41446a32c9be0e8b8ce726670ad20625cd/tex/generic/pgf/frontendlayer/tikz/tikz.code.tex#L68-L86)):
```tex
\pgfkeys{/tikz/.is family}%
\pgfkeysdef{/tikz/#1}{#3}%
\pgfkeyssetvalue{/tikz/#1/.@def}{#2}%
```

**Evidence** ([official pgfkeys manual](https://tikz.dev/pgfkeys)):
```text
pgfkeys organizes keys in a tree ... supports styles ... and handlers.
```

**Explanation**: A capability registry needs `keyPath`, `valueGrammar`, `handlerKind`, `expansionEffect`, `scope`, and `unknownKeyPolicy`; `options: string[]` is insufficient. Unknown keys must remain source-preserved and be routed to exact TeX.

**Claim**: Libraries can introduce executable syntax and derived entities, not merely drawing primitives.

**Evidence** ([official intersections library](https://github.com/pgf-tikz/pgf/blob/ecb9ba41446a32c9be0e8b8ce726670ad20625cd/tex/generic/pgf/frontendlayer/tikz/libraries/tikzlibraryintersections.code.tex#L15-L27)):
```tex
/tikz/name path global/.code={...}
/tikz/name path/.code={...}
```

**Evidence** ([official intersections output path](https://github.com/pgf-tikz/pgf/blob/ecb9ba41446a32c9be0e8b8ce726670ad20625cd/tex/generic/pgf/frontendlayer/tikz/libraries/tikzlibraryintersections.code.tex#L79-L145)):
```tex
name intersections/.code={...}
\foreach ...
\coordinate ... at (\tikz@intersect@@name-\tikz@intersection@count);
```

**Explanation**: The registry must distinguish source command, key callback, and generated semantic outputs. `name intersections` needs an execution contract (inputs: named paths; outputs: coordinates; ordering and naming rules), while Canvas projection can only be enabled when that contract is available.

**Claim**: The graph library parses a mini-language and expands `foreach`, so graph syntax cannot be treated as an ordinary path statement.

**Evidence** ([official graph library](https://github.com/pgf-tikz/pgf/blob/ecb9ba41446a32c9be0e8b8ce726670ad20625cd/tex/generic/pgf/frontendlayer/tikz/libraries/graphs/tikzlibrarygraphs.code.tex#L529-L557)):
```tex
\pgfutil@ifnextchar"{... graph quote parser ...}
```

**Evidence** ([graph foreach expansion](https://github.com/pgf-tikz/pgf/blob/ecb9ba41446a32c9be0e8b8ce726670ad20625cd/tex/generic/pgf/frontendlayer/tikz/libraries/graphs/tikzlibrarygraphs.code.tex#L800-L823)):
```tex
\def\tikz@lib@graph@do@foreach\foreach#1in{...
\foreach #1 in {#2}%
```

**Explanation**: Add an explicit `ExecutionProduct` relation: source CST node → expansion instances → semantic records/render primitives. Preserve the original source node and map every generated product back to the source range; never write back by replacing generated expansion text.

**Claim**: Browser exact rendering is best isolated behind a TeX/WASM execution lane, not reimplemented by the interactive parser.

**Evidence** ([TikZJax pinned source](https://github.com/kisonecat/tikzjax/blob/f56ddce3d5aec44b54a55bdbd726de598e1d5b0a/src/TikZJax.js#L24-L43)):
```js
let tex = await fetch(urlRoot + '/tex.wasm');
... core.dump.gz ...
```

**Evidence** ([TikZJax compile-to-DVI/SVG pipeline](https://github.com/kisonecat/tikzjax/blob/f56ddce3d5aec44b54a55bdbd726de598e1d5b0a/src/TikZJax.js#L52-L74)):
```js
library.writeFileSync("sample.tex", ...);
library.setInput(" sample.tex \\n\\end\\n");
return library.readFileSync("sample.dvi");
```

**Explanation**: Keep the current interactive SVG lane conservative and send opaque/expansion/driver-risk blocks to exact TeX. The exact result is a rendering truth artifact, not a mutable semantic graph.

## Current repository gap scan (read-only)

Observed in `lib/tikz`:

1. `syntax/catalog.ts` already contains `TIKZ_LIBRARY_NAMES`, per-library security/recognition/interactive/semantic classifications, official source-file references, and integrity checks. This is a useful seed registry, but it mostly describes **capability lanes**, not every command/key/value grammar exposed by each `.code.tex` file.
2. `document/tikz-cst.ts` provides a Lezer tree, statement ranges, opaque nodes, source index, semantic ratio, and a safe-writeback gate. It intentionally treats scopes and unsupported statements as opaque. The missing piece is lossless token trivia and nested CST nodes for key/value lists, macro definitions, active-character syntax, and generated expansion maps.
3. `subset/lexer.ts` and `subset/parser.ts` are intentionally a small geometry subset. The lexer skips comments and recognizes a limited command/name grammar; this is correct for the interactive subset but cannot be the official-language parser.
4. `ir/source-map.ts` maps source bindings to semantic records and render primitives, but it does not yet model expansion products, key-handler provenance, macro definition/use edges, or multiple source ranges for a generated entity.
5. `commands/command-registry.ts` is a UI shortcut registry, not a TikZ syntax registry. It should remain separate; conflating keyboard commands with TikZ command/key capability metadata would make conflict/security policy opaque.

## Required registry shape (recommended)

```ts
interface TikzCapability {
  id: string;                       // stable, versioned
  upstream: { repo: string; sha: string; path: string; line?: [number, number] };
  surface: 'command' | 'environment' | 'key' | 'handler' | 'library' | 'pgf-function';
  namespaces: readonly string[];    // /tikz, /pgf, /pgf/..., custom
  syntax: { args: readonly ArgSpec[]; terminator?: 'semicolon' | 'group' | 'eof' };
  effects: { scope: 'local' | 'group' | 'document'; expansion: 'none' | 'macro' | 'foreach' | 'tex'; outputs: readonly OutputSpec[] };
  lanes: { preserve: true; parse: 'full' | 'partial'; preview: 'plugin' | 'opaque'; exact: 'tex' | 'wasm' | 'server' };
  writeback: 'safe' | 'transaction-only' | 'never';
}
```

Generate a versioned registry artifact from the pinned PGF checkout, but keep hand-authored semantic adapters separate. A missing adapter must lower to `OpaqueSourceNode`, never to a guessed geometry entity.

## CST/source-map architecture changes

- Keep `TikzCst` as the lossless source boundary, but add token trivia (comments, whitespace, delimiters), balanced-group nodes, key-path/value nodes, and error-recovery nodes.
- Add `sourceOrigin[]` to every semantic/render product; an origin may contain multiple source ranges (macro definition plus invocation, or a `foreach` template plus iteration binding).
- Add `expansionId`, `parentExpansionId`, and `executionRevision` to expansion products. Expansion output is read-only in Canvas; writeback targets the source CST node.
- Make source slices hashable at every binding. A managed transaction must check exact expected text plus source hash/fingerprint and reject style/divergent blocks rather than silently dropping unknown options.
- Track `loadedLibraries` and `keyPath` namespaces in the document manifest. `\usetikzlibrary` and `\usepgflibrary` are document-scope dependencies, not local draw options.

## Priority gap list

P0: derive command/key/library registry from pinned PGF source; add upstream SHA and generated-manifest provenance.

P0: preserve opaque syntax with lossless CST/trivia and multi-range source maps; add macro/foreach execution-product records.

P1: add key-tree parser (`/tikz`, `/pgf`, handlers/styles), library-load graph, and security classification for TeX expansion, Lua, externalization, RDF/network, and driver output.

P1: expose capability-driven AI context: AI receives semantic records plus source origins and write capabilities, never raw writable flags for opaque/managed blocks.

P2: add adapters incrementally for core paths, calc/intersections, positioning, matrix, graphs, decorations, data visualization, and PGFPlots; unsupported features still exact-render and round-trip unchanged.

## Architectural conclusion

“All official syntax integrated” should mean: every official source surface is recognized, preserved, capability-classified, and exactly renderable; only a reviewed subset is semantically editable on Canvas. This exceeds a giant parser because it gives AI, code, and Canvas one source-indexed middle layer while maintaining a hard boundary between semantic edits and TeX execution.

Open questions: whether the product will vendor a pinned PGF source manifest or fetch it during release generation; which TeX/WASM backend is approved for ECS exact rendering; and the acceptable expansion/resource budgets for `foreach`, graph drawing, Lua, RDF, and externalization.
