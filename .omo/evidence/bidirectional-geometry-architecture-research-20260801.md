# Bidirectional geometry architecture research (2026-08-01)

Scope: AI ↔ canonical geometry model ↔ Code/TikZ canvas. Sources are primary documentation or pinned upstream source. This is an architecture memo, not domain-acceptance evidence.

## Source-backed primitives

### Lezer + CodeMirror

Lezer parsers accept reusable `TreeFragment[]` and changed ranges when creating a parse; this is the incremental-parse seam ([pinned source](https://github.com/lezer-parser/lr/blob/ed59b8b9c0c26164d6483f4c881a8c200184894e/src/parse.ts#L773-L776)). The Lezer guide explicitly describes compact trees optimized for reuse during incremental parsing ([official guide](https://lezer.codemirror.net/docs/guide/)).

CodeMirror transactions carry `ChangeSet`, selection, effects, and annotations. Effects can define a `map(value, ChangeDesc)` function and are dropped when mapping returns `undefined` ([pinned source](https://github.com/codemirror/state/blob/main/src/transaction.ts#L34-L52), [L62-L94](https://github.com/codemirror/state/blob/main/src/transaction.ts#L62-L94)). Merging transactions composes changes and maps both selections/effects through the composed change ([L282-L299](https://github.com/codemirror/state/blob/main/src/transaction.ts#L282-L299)).

**Use:** keep parser-node identity separate from text offsets; attach `nodeId`/diagnostic effects with explicit mapping. Reparse only changed ranges, then reconcile semantic objects by stable IDs. Do not treat a Lezer tree node or character offset as a durable geometry identity.

### Yjs / Automerge-style identity

Yjs relative positions are anchored to an item ID/type rather than a numeric offset and remain associated with the same character across edits ([pinned source](https://github.com/yjs/yjs/blob/9c1994547d7bc86245a21e1a4c8319f056d05ecf/src/utils/RelativePosition.js#L7-L16)). The representation stores `type`, root type name, item ID, and association side ([L31-L63](https://github.com/yjs/yjs/blob/9c1994547d7bc86245a21e1a4c8319f056d05ecf/src/utils/RelativePosition.js#L31-L63)); conversion walks linked items and emits the stable item ID ([L146-L168](https://github.com/yjs/yjs/blob/9c1994547d7bc86245a21e1a4c8319f056d05ecf/src/utils/RelativePosition.js#L146-L168)).

**Use:** represent canvas selections, source spans, and AI patch anchors as `{root/type, itemId, assoc}`. For semantic geometry, use application-level UUIDs in a map keyed by CRDT objects; CRDT item IDs are excellent text anchors but are not a substitute for object identity when an object is deleted/recreated.

### GeoGebra kernel/construction model

The official GeoGebra command reference is the compatibility target for textual construction commands ([command reference](https://geogebra.github.io/docs/manual/en/commands/)). The open-source project is GPL and its `common` kernel/construction code is the relevant primary implementation ([repository](https://github.com/geogebra/geogebra/tree/master/common/src/main/java/org/geogebra/common/kernel)).

**Use:** model geometry as a DAG: objects have UUID, type, defining command/parameters, parents, dependents, and cached numeric state. Execute commands in topological order; preserve the original command string and normalized AST so source regeneration does not depend on floating-point serialization. Treat unsupported/ambiguous commands as explicit unresolved nodes.

### Constraints

Cassowary/Kiwi is appropriate for linear UI/layout constraints, but not as the sole geometry kernel. A geometry solve should separate exact symbolic constraints (incidence, perpendicularity, equal lengths) from soft viewport constraints. Use a deterministic priority order and record residuals; never silently mutate construction semantics to satisfy a soft constraint. (Primary implementation: [Kiwi solver](https://github.com/nucleic/kiwi), Cassowary algorithm reference: [UW technical report](https://constraints.cs.washington.edu/solvers/cassowary-tochi.pdf).)

### Bidirectional transformations / lenses

Use a *partial lens* boundary: `get : Source -> Model` may reject unsupported TikZ/TeX; `put : Source × ModelDelta -> Source` must preserve untouched source text and report conflicts. A full round-trip law is unrealistic with macro expansion and lossy rendering; enforce local laws for supported subset: parse(print(ast)) ≅ ast and print(parse(source)) preserves protected trivia. Keep source-map segments `(semanticId, startAnchor, endAnchor, confidence)` and invalidate them on overlapping edits.

### PGF/TikZ dynamic behavior

The PGF/TikZ key system supports dynamic key handlers and macro-backed values ([official pgfkeys manual](https://tikz.dev/pgfkeys)). Consequently, textual TikZ is not a simple declarative AST: keys may expand macros, set styles, or execute code. Parse a documented safe subset (`\\draw`, coordinates, node names, selected keys); preserve unknown options as opaque token lists. Never claim semantic equivalence after arbitrary macro expansion.

### Exact TeX sandbox

Compile/render in a separate process with a strict allowlist, no shell escape, bounded CPU/memory/time, temporary directory, and output-size limits. Treat TeX logs as untrusted diagnostics. The sandbox is a renderer/validator, not the source of truth: generated PDF/SVG cannot recover lost semantic IDs.

## Proposed canonical data model

```ts
GeometryDoc {
  objects: Map<UUID, GeometryObject>
  constraints: Map<UUID, Constraint>
  order: UUID[]                 // construction/topological order
  source: { text: Y.Text, anchors: SourceAnchor[] }
  revisions: { sourceHash, modelHash, actor, timestamp }[]
}
GeometryObject {
  id, kind, parents: UUID[], definition: CommandAST,
  tikz: { spanAnchors, styleTokens }, state: ExactOrNumericState,
  status: "resolved"|"ambiguous"|"unsupported"|"conflict"
}
```

## Breaking points and algorithm choices

1. **Offset drift:** numeric offsets break under edits. Use CodeMirror `ChangeDesc` for one transaction and Yjs relative positions for persisted/collaborative anchors.
2. **Identity collapse:** reparsing can create equivalent-but-new nodes. Reconcile by explicit UUID/name hints, parent signature, and definition hash; surface ambiguity instead of guessing.
3. **Macro opacity:** arbitrary pgfkeys/TeX expansion defeats semantic inversion. Maintain a safe subset plus opaque preservation; require user confirmation for edits crossing opaque regions.
4. **Dependency cycles:** reject cycles in the construction DAG; show the minimal cycle and keep prior valid revision.
5. **Numerical instability:** use exact/rational representations where possible, deterministic solver tolerances, and residual diagnostics. Kiwi/Cassowary is suitable only for linearized/soft constraints.
6. **Concurrent edits:** merge text via CRDT, then run semantic reconciliation. Object UUID conflicts become explicit conflict records; do not last-write-wins geometry silently.
7. **AI patches:** accept structured `ModelDelta` plus anchored source edits, validate preconditions (source hash, anchor IDs, parent IDs), apply transactionally, and emit inverse patch for undo.

## Suitable vs unsuitable direct adoption

| Technology | Adopt directly | Do not adopt directly |
|---|---|---|
| Lezer | incremental syntax parsing/tree fragments | durable semantic identity or TeX execution |
| CodeMirror ChangeSet | transaction mapping, undo/redo, diagnostics | cross-document identity without anchors |
| Yjs relative positions | stable collaborative text/cursor anchors | geometry UUID replacement semantics |
| GeoGebra command/kernel concepts | construction DAG, command registry, dependents | GPL code embedding without license review; opaque numeric state as truth |
| Kiwi/Cassowary | linear UI constraints and soft layout | nonlinear geometric theorem solving |
| PGF/TikZ | safe-subset parser and opaque token preservation | arbitrary macro expansion inversion |
| TeX engine | isolated rendering/validation | authoritative semantic model |

Open questions: exact license boundary for embedding GeoGebra kernel; chosen CRDT (Yjs vs Automerge); supported TikZ grammar and macro allowlist; exact-vs-numeric geometry policy.
