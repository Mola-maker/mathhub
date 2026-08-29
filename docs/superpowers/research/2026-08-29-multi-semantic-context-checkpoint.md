# Multi-semantic geometry context checkpoint and benchmark increment

Date: 2026-08-29

## Decision

The next shared seam is not a second mutable geometry document. It is a
renderer-neutral conversation checkpoint plus source-specific projections into
the existing `GeometryDoc` truth lanes.

- TikZ remains source-of-truth and the service reconstructs its GeometryDoc,
  therefore its checkpoint basis is `server-attested`.
- GeoGebra commands become the source snapshot after a successful applet run.
  The browser projects those exact commands into GeometryDoc. Until the Math
  Studio receives a server-side projection/broker lane, its API checkpoint
  basis is explicitly `client-declared`.
- Retained dialogue is advisory. Its fixed truth policy is
  `current-source-projection-only`; an extractive compaction receipt is never
  promoted into semantic, construction, or rendering truth.
- Fenced command/protocol blocks are atomic during compaction. An oversized
  block is omitted whole rather than sliced into a syntactically plausible but
  false fragment.
- Unsupported GeoGebra commands are retained as exact opaque source slices.
  The adapter does not invent entities or constraints for them.

## Implemented slice

1. `lib/geometry/agent/conversation-context.ts`
   - shared TikZ/GeoGebra budgets;
   - structured-block-safe extraction;
   - loss ledger, retained/dropped counts, basis provenance and empty restore
     handles (no fictitious recovery capability).
2. TikZ API
   - compacts once on the authoritative server path;
   - emits `agentContextCheckpoint` with a server-attested GeometryDoc basis.
3. Math/GeoGebra API
   - uses the same compactor and emits the same checkpoint schema;
   - bounds lookup and prompt history through the retained conversation only.
4. GeoGebra adapter
   - projects successful command scripts to revision-bound entities,
     dependencies, known constraints, styles, exact extension bindings and
     opaque nodes;
   - currently read-only (`writable: false`) until a GeoGebra source
     transaction broker is implemented.
5. Evaluation corpus
   - adds an independently authored circle-intersection/tangent/parallel
     fixture;
   - the external record is provenance-only and the local bytes are SHA-256
     pinned.
6. Durable TikZ Agent recovery
   - binds each recoverable run to one immutable, server-attested context and
     GeometryDoc basis before the first event is published;
   - persists the exact proposal `before -> after` basis transition in both the
     memory and Redis RunStore implementations;
   - upgrades recovery/replay to v2 and requires the browser to present its
     current document/epoch/source/revision/hash basis on every poll;
   - returns `409 STALE_GEOMETRY_BASIS` when the canvas has moved and
     `409 REPLAY_WINDOW_EXPIRED` when the cursor predates the bounded event
     window. Successful replay returns proposal identity only; the stored
     proposal body never crosses the read-only recovery boundary.
7. Long-horizon evaluation evidence
   - the local adapter now emits the same validated context-checkpoint schema
     on every turn and binds it to the pre-turn GeometryDoc basis;
   - the five-lane transaction chain and the complex circle/tangent corpus now
     require an `older-dialogue-dropped` loss receipt after the bounded
   four-message window, while still requiring the current source basis.
8. Renderer-neutral semantic evidence
   - `geometry-semantic-signature/v1` removes source record IDs and normalizes
     named dependency topology across TikZ-like and GeoGebra projections;
   - mathematical, relation and presentation hashes remain separate, and the
     comparison fails closed when an entity or required constraint has no
     portable semantic address.
9. GeoGebra command transaction broker
   - command-list patches carry document, epoch, source, revision and source
     hash preconditions plus an idempotency key;
   - the host can commit only after an exact all-success execution receipt;
     stale bases, partial execution, reused keys and projection drift leave the
     previous snapshot unchanged;
   - Math Studio restores the previous successful script if the semantic commit
     cannot be accepted, preventing the visible canvas from silently diverging
     from the durable command truth.
10. GitHub Pages geometry-board preview
    - the Pages build now publishes `/mathhub/math/` in addition to the landing
      page and TikZ preview;
    - static mode disables server-only AI controls and uses GeoGebra's official
      hosted `deployggb.js`; it does not weaken the ECS production boundary;
    - React is deduplicated across the root and `mathhub` workspaces, and the
      desktop-first board disables automatic virtual-keyboard focus so the
       construction surface is unobstructed.
11. Native GeoGebra mutation transaction bridge
    - official add/remove/update/rename/clear/client listeners mark the canvas
      dirty; high-frequency drags are debounced and `dragEnd` is the preferred
      commit boundary;
    - a live construction is serialized with non-localized command strings,
      bounded presentation commands and literal fallbacks only for genuinely
      free points or scalar values;
    - missing derived definitions make the observation incomplete. The host
      restores the previous broker snapshot instead of accepting evaluated
      coordinates as invented construction truth;
    - native observations use a separate complete-snapshot receipt, then pass
      through the same document/epoch/source/revision/hash CAS boundary as AI
      scripts. AI render, repair, step replay and reset suppress their own
      applet events so they cannot create duplicate commits;
    - clearing chat no longer clears the canvas broker. Reset canvas is itself
      a revisioned empty-snapshot transaction.

## External benchmark evidence

FormalGeo publishes dataset registry entries for `formalgeo7k_v2` and an IMO
set. The pinned registry, not live search results, is the provenance anchor:

- <https://github.com/FormalGeo/FormalGeo/blob/e7d90421e809a129109286fdb03832d8014d390f/datasets.json#L2-L14>
- Formal language examples separating construction conditions and theorem
  goals: <https://github.com/FormalGeo/FormalGeo/blob/e7d90421e809a129109286fdb03832d8014d390f/README.md#L86-L108>
- The theorem/goal workflow used to select dependency-chain stressors:
  <https://github.com/FormalGeo/FormalGeo/blob/e7d90421e809a129109286fdb03832d8014d390f/README.md#L137-L155>

AlphaGeometry provides another useful representation model: premises and
conclusion are parsed separately and constructions form a dependency graph.
The pinned sources are:

- <https://github.com/google-deepmind/alphageometry/blob/6777cb586cbb46beed28db12dc72c69770b68337/README.md#L314-L367>
- License split (Apache-2.0 software and CC-BY-4.0 for other materials/models):
  <https://github.com/google-deepmind/alphageometry/blob/6777cb586cbb46beed28db12dc72c69770b68337/README.md#L427-L446>

The new fixture copies neither competition statements nor diagrams. It is an
independently authored stress case for the class of operations that these
benchmarks expose: circle/circle intersections, a common chord, tangent and
parallel dependency chains, follow-up style/label edits, and dual-render
verification.

GeoGebra's official embedding reference documents the hosted
`https://www.geogebra.org/apps/deployggb.js` entry and the separate
`setHTML5Codebase` step required only for self-hosted bundles. Its parameter
reference also defines `preventFocus` and `showKeyboardOnFocus`, which are used
by the static preview instead of CSS-masking the applet keyboard:

- <https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_Embedding/>
- <https://geogebra.github.io/docs/reference/en/GeoGebra_App_Parameters/>

The Apps API additionally defines the listener pairs used by the native bridge,
the non-localized `getCommandString(name, false)` serialization surface and the
`dragEnd` client event used as the stable drag boundary:

- <https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/>

## Rights and admission boundary

FormalGeo is still `research-reference-only`. Its current repository notice
changes the license posture for newer releases; exact revisions and dataset
terms require review. The source catalog therefore remains restricted opt-in,
with redistribution/training blocked or review-required. The evaluation corpus
stores only our own fixture and a pinned provenance URL.

## Next increments

1. Move the neutral IR out of `lib/tikz/ir` after import-graph measurement;
   keep compatibility re-exports during the migration.
2. Promote selected GeoGebra bindings from read-only only after a bounded,
   lossless binding-to-command patch planner is available.
3. Add cross-renderer long-horizon fixtures backed by independently authored
   TikZ and GeoGebra sources, rather than the current remapped semantic unit
   fixture.
4. Add explicit expiry/renewal policy for restore handles once a durable
   transcript store exists; continue emitting an empty handle list until then.
