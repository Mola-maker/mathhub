# DeepSeek Harness cache and lifecycle audit for TikZ Studio

## Scope

This audit reads `E:\deepseek\deepseek-harness` as a local architecture reference. Math GeoHub does not copy its Cordis plugin tree or UI. The reusable value is its lifecycle discipline: model-visible inputs are reconstructable, request prefixes are append-stable, projections are cached as stale-but-never-wrong shortcuts, and side effects begin only after durability checkpoints.

## High-value mechanisms

### Stable request header and append-only provider prefix

DeepSeek Harness canonicalizes the provider/model/system/tool header and appends a new `request/header` event only when it changes (`packages/core/agent-loop/src/agent.ts`, `packages/core/session/src/request-header.ts`). Its live cache test verifies that every request after the first reports `cacheReadTokens > 0` when a tool turn and the following turn only extend the prior request (`packages/core/agent-loop/tests/request-cache.e2e.ts`).

Math GeoHub previously rebuilt the system prompt from the user problem, TikZ source, Scene Manifest and GeometryDoc every turn. That destroyed the largest reusable prefix. The first adopted slice now keeps policy, tool protocol and writer contracts in `buildTikzStableSystemPrompt()`, and appends query-selected syntax, source and semantic state through `buildTikzRuntimeContext()`. `tikzAgentRequestCacheIdentity()` records the stable prefix digest separately from the revision-bound runtime digest. This is prompt-prefix caching only; no model answer is reused as geometry truth.

### Model-visible state must be replayable

The harness derives every model request from its append-only session surface. Tool calls, results, assistant messages, request headers and runtime context snapshots are durable events. Math GeoHub should converge on the same invariant for an ECS RunStore: any context sent to the model must be reproducible from a run event plus a revision-bound GeometryDoc reference. Hidden UI widget payloads and VLM observations must never silently enter model context.

The current local slice adds monotonic `sequence` to `tikz-agent-event/v1`, uses one reducer to reject duplicate/out-of-order/late events, and bounds each run projection to 64 steps. A later Redis stream provider can persist the same event vocabulary without changing the Canvas transaction boundary.

### Projection cache is a shortcut, never authority

The harness projection cache stores `{version, sequence, value}` rows bound to immutable session identity. A version mismatch or unrelated lifecycle discards the row and replays the durable tail (`packages/session/session-projection-cache`). Math GeoHub should apply this directly to expensive GeometryDoc/AI-context projections: cache keys include document id, epoch, source hash, plugin-set digest, kernel/projection hash and projection schema version. Cache failure may cost recomputation, but it must never authorize a write or outrank current TikZ source.

The adopted request-local read-tool cache follows the same rule. Only deterministic `inspect-geometry` and `validate-tikz-action` calls can reuse observations, and only inside one immutable run basis. External problem search is deliberately excluded.

### Durability checkpoints before model and tool side effects

The harness flushes the logged request before provider dispatch and the recorded top-level tool call before executing the tool body (`packages/session/session-checkpoint-policy`). For Math GeoHub, the equivalent production rule is:

1. persist `run.started`, request header, current GeometryDoc basis and admitted user turn;
2. then call the provider;
3. persist a tool call before invoking any non-local read capability;
4. persist `proposal.ready` before waiting for the browser Broker;
5. accept one commit observation only after the Browser/Broker transaction and current GeometryDoc projection agree;
6. use terminal compare-and-set so only one `run.completed` or `run.failed` lands.

The browser remains the current document owner. A server proposal is never a commit observation.

### Bounded write-behind and resource quiescence

The harness write-behind controller owns a bounded pending prefix, a fixed batching deadline, retry retention and an explicit flush barrier (`packages/session/session-persistence/src/write-behind.ts`). Its teardown rule is abort then await quiescence, not merely request cancellation (`docs/defensive-patterns.md`).

The adopted browser/server slice now caps SSE event and run bytes, aborts upstream work on reader cancellation, batches assistant deltas instead of cloning React state per token, bounds chat/run/widget history, reports provider cache usage, and keeps deterministic tool observations request-local. The next RunStore provider must add byte-bounded Redis Streams, a lease, TTL, terminal CAS and cancellation ownership; a process-global Map is not acceptable on ECS.

### Compaction preserves tool pairing and source provenance

The harness compaction engine replaces a balanced surface range with a provenance-tagged checkpoint; its tool-result pruner keeps head/tail plus a marker and logs the shadowed node price (`packages/compaction`). Math GeoHub compaction must never summarize away:

- the latest TikZ source/basis hashes;
- a pending proposal or commit observation;
- tool-call/result pairing;
- opaque-source barriers;
- construction/catalog/plugin digests;
- source attribution and licenses for problem-search results.

Old conversational prose and oversized read-tool results may be compacted. Geometry truth is reprojected from current source, not reconstructed from a language summary.

## Target framework

```text
stable policy + tool schema digest
             |
             v
append-only Agent Run events -----> bounded run projection / widgets
             |                                  |
             v                                  v
revision-bound GeometryDoc ----------> read-tool observation cache
             |
             v
typed proposal -> Browser Broker -> current GeometryDoc commit observation
             |
             v
read-only verification -> terminal CAS
```

## Gates before geometry-corpus testing

- two different geometry requests have the same stable-prefix digest and different runtime-context digests;
- provider usage reports cache hits after the first compatible request;
- no read-tool cache entry survives a basis change or external search;
- duplicate, out-of-order and post-terminal events do not alter the run projection;
- disconnect/timeout aborts provider, read tools, exact render polling and VLM work and releases readers/timers;
- a stale proposal never overwrites a newer CodeMirror/Canvas transaction;
- compaction preserves tool pairing, pending proposal state, commit observation and source attribution;
- heap and retained run data stay bounded under long answers and repeated tool turns.

MathNet and official problem libraries should be introduced only after these gates and the GeoGebra-derived interaction contracts close. Corpus runs then test the architecture rather than becoming one-off feature patches.
