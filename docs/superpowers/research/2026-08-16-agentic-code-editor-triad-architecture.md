# Agentic code-editor architecture for the TikZ triad

Date: 2026-08-16
Status: research-backed implementation direction
Scope: agent harness, semantic comprehension, Canvas interaction, exact compiler

## Conclusion

There is no single accepted “AI code editor specification”. The mature pattern is
a composition of narrower, well-tested contracts:

1. an immutable action/observation event log for the agent run;
2. a language-server-like semantic index for retrieval and diagnostics;
3. a versioned, atomic workspace edit protocol for writes;
4. an editor interaction state machine for pointer gestures and previews;
5. a compiler profile and artifact attestation for exact output.

This composition directly addresses Math GeoHub's recurring conflict. AI, TikZ
source and Canvas must not each maintain a competing interpretation of the
document. They must read one revision-bound source/semantic snapshot, propose a
typed intent, and commit one source transaction before any consumer claims the
change succeeded.

There is now a real interoperability standard for the editor/agent boundary:
the Agent Client Protocol (ACP). ACP is useful for session lifecycle, streamed
updates, plans, tool-call presentation, permission requests, document change
notifications and cancellation. It does **not** define TikZ semantics,
dependency-aware geometry edits, source ownership or exact-render truth. Math
GeoHub should therefore make its Agent Run transport ACP-shaped while retaining
GeometryDoc, the semantic intent compiler and Broker replay as stricter domain
contracts.

## Primary-source evidence

### Editor/agent interoperability

ACP standardizes editor-to-coding-agent communication over a negotiated,
capability-driven JSON-RPC protocol. Its stable protocol version is negotiated
independently of generated SDK/schema artifact versions. The current SDK
surface includes session start/resume/close, prompt/cancel, streamed session
updates, permission requests, document open/change/save/focus notifications and
explicit disposal of update routing.

- [Agent Client Protocol repository and versioning](https://github.com/agentclientprotocol/agent-client-protocol)
- [ACP introduction and local/remote transport](https://agentclientprotocol.com/get-started/introduction)
- [ACP TypeScript session lifecycle](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/acp.ts)

Consequence: Math GeoHub should not invent another untyped chat stream. Its
public Agent harness should expose ACP-compatible lifecycle concepts and rich
updates, while geometry-specific update payloads remain closed schemas. A
`proposal.ready` update is not a successful edit; only a Broker commit
observation followed by post-commit verification may terminate a mutation run.

### Agent harness and durable events

OpenHands separates the SDK, agent server and client applications. Its SDK owns
agents, tools, workspaces, events and policies; clients consume those interfaces
rather than embedding agent behavior in the chat UI. Events are frozen typed
records with unique IDs, parent IDs and source attribution. Its event log is
persistent, indexed, append-only, locked against concurrent writes, validates
parents, and can reconstruct the active branch.

- [OpenHands SDK architecture](https://docs.openhands.dev/sdk/arch/overview)
- [immutable event base, pinned source](https://github.com/OpenHands/software-agent-sdk/blob/23ee276f1c68f08123349d103754380f627d20c8/openhands-sdk/openhands/sdk/event/base.py)
- [persistent event log, pinned source](https://github.com/OpenHands/software-agent-sdk/blob/23ee276f1c68f08123349d103754380f627d20c8/openhands-sdk/openhands/sdk/conversation/event_store.py)

Consequence: Math GeoHub's `run.started`, tool calls, observations,
`proposal.ready`, commit observation, verification and terminal outcome are the
run. Chat prose and widgets are projections of the run, not the durable state.

Cline independently demonstrates the same execution shape in an IDE: a task
loops over streamed model output, presents typed blocks, asks for approval,
executes tools, saves a checkpoint and returns the observation to the model.
Its extension separates webview, controller, task, storage and checkpoint
responsibilities.

- [Cline architecture and task loop, pinned source](https://github.com/cline/cline/blob/8bbdde2a5c1f972864fe1b954f639c21fac61a40/.clinerules/cline-overview.md)

Consequence: a write-capable geometry request must be a multi-step run, not
“one model response followed by regex extraction”. The model must be able to
inspect, propose, receive validation/commit observations and then answer.

### Semantic retrieval instead of whole-document prompting

Aider builds a repository map from definitions and references, ranks the graph,
and selects the highest-value symbols under a token budget. The LLM receives a
compact structural overview and asks for full detail only when necessary.

- [Aider repository map](https://aider.chat/docs/repomap.html)
- [RepoMap implementation, pinned source](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py)
- [Aider edit formats](https://aider.chat/docs/more/edit-formats.html)

Consequence: GeometryDoc needs a geometry repo map, not a flat dump. Its nodes
are entities, constraints, relations, managed constructions, source bindings
and presentation slots. Retrieval is personalized by selected objects and the
user's named references, ranked by dependency role and graph distance, and
bounded by tokens. Full managed plans are fetched on demand through a read tool.

### Atomic, versioned edit protocol

LSP `WorkspaceEdit` supports ordered document/resource changes, optional
document versions, change annotations and explicit client failure-handling
capabilities. This is a better model than treating model-produced text as a
write command.

- [LSP 3.17 WorkspaceEdit, pinned specification](https://github.com/microsoft/language-server-protocol/blob/8b9fab8f0912b694c795d05c1d5e9d357bee0193/_specifications/lsp/3.17/types/workspaceEdit.md)

Continue's Apply manager similarly isolates model generation from IDE
application, supports cancellation, computes a diff and applies it through the
editor integration instead of making the chat message the document.

- [Continue ApplyManager, pinned source](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/vscode/src/apply/ApplyManager.ts)

Consequence: every AI/Canvas/Inspector mutation should compile to one annotated
geometry workspace edit with current document epoch/revision/hash, ordered
patches, affected semantic IDs, user-readable change annotations and an atomic
failure policy. The existing Broker is the correct enforcement point.

### Canvas interaction and dynamic geometry

tldraw's state package makes transactions explicit and keeps reactive updates
inside a controlled transaction boundary. Its Editor centralizes selection,
tools, history and input state instead of distributing pointer behavior among
independent React components.

- [tldraw transaction implementation, pinned source](https://github.com/tldraw/tldraw/blob/8e63aef78f97befc3f7fd711f9a803453f7d0a76/packages/state/src/lib/transactions.ts)
- [tldraw state specification, pinned source](https://github.com/tldraw/tldraw/blob/8e63aef78f97befc3f7fd711f9a803453f7d0a76/packages/state/SPEC.md)
- [tldraw Editor API](https://tldraw.dev/reference/editor/Editor)

GeoGebra makes free, dependent and auxiliary objects explicit and exposes a
construction protocol. Adding a tool requires coordinated selection rectangle,
mouse release, controller mode, kernel operation, toolbar and help changes;
adding an object requires separate geometry and draw types plus dependency and
moveable-input behavior.

- [GeoGebra free/dependent/auxiliary objects](https://geogebra.github.io/docs/manual/en/Free_Dependent_and_Auxiliary_Objects/)
- [GeoGebra construction protocol](https://geogebra.github.io/docs/manual/en/Construction_Protocol/)
- [GeoGebra tool integration checklist, pinned source](https://github.com/geogebra/geogebra/blob/c840cb6c75217082afb7651eb3f4d0d1c3203f49/doc/dev/HowToAddANewTool.md)
- [GeoGebra object integration checklist, pinned source](https://github.com/geogebra/geogebra/blob/c840cb6c75217082afb7651eb3f4d0d1c3203f49/doc/dev/HowToAddANewObjectType.md)

Consequence: Canvas gestures need one state machine and one capability analysis.
A dependent point is not draggable merely because it has coordinates. A drag
resolves writable drivers, previews the derived construction, discloses external
impact, captures the pointer, and commits one Broker transaction on release.

### TikZ execution and exact compilation

PGF graph drawing deliberately separates the display, binding and algorithm
layers. The display layer supplies syntactic graph/events/collections; the
binding adapts a display system; the algorithm receives a graph model rather
than raw TikZ, runs transformations/layout and writes positions back through the
binding. PGF's system layer separately abstracts backend drivers.

- [PGF graph display layer](https://tikz.dev/gd-display-layer)
- [PGF graph binding layer](https://tikz.dev/gd-binding-layer)
- [PGF graph algorithm layer](https://tikz.dev/gd-algorithm-layer)
- [PGF driver contracts](https://tikz.dev/drivers)

Consequence: interactive rendering is a display adapter, not an imitation TeX
compiler. Exact output is a separate execution artifact. A compiler profile must
pin engine, PGF bundle, loaded libraries, driver, fonts, security policy and
resource limits. Lua graph drawing belongs to a LuaTeX-capable profile and must
not be advertised by a Tectonic profile that cannot execute it.

Upstream released PGF/TikZ 3.1.12 on 2026-08-01. The repository intentionally
continues to advertise the evidenced 3.1.11a profile: 3.1.12 raises the TeX
engine baseline to Web2C 2020/braced-input support and changes scaling output,
so the upgrade requires registry regeneration, engine probes, refreshed image
digests and exact differential fixtures. `PGF_TIKZ_UPSTREAM_AUDIT_2026_08_23`
records that migration gap without turning an observed release into a false
capability claim.

- [Official PGF/TikZ 3.1.12 release](https://github.com/pgf-tikz/pgf/releases/tag/3.1.12)
- [CTAN current PGF package record](https://ctan.org/pkg/pgf)

## Target architecture

```text
User / AI / Canvas gesture
          |
          v
Agent Run event log ---------------------------------------------+
  observe -> retrieve -> plan -> clarify/tool -> propose         |
          |                                                       |
          v                                                       |
Geometry RepoMap (ranked, evidence-backed, token bounded)         |
          |                                                       |
          v                                                       |
Semantic Intent                                                   |
 answer | construct DAG | style | label | transform | delete      |
          |                                                       |
          v                                                       |
Host intent compiler -> annotated GeometryWorkspaceEdit           |
          |                                                       |
          v                                                       |
Broker: revision CAS + scope + writer proof + atomic replay        |
          |                                                       |
          v                                                       |
CodeMirror source transaction (persistent truth)                  |
          |                                                       |
          +--> lossless CST -> GeometryDoc -> interactive Canvas --+
          |
          +--> exact compiler profile -> attested SVG/PDF artifact
                                      |
                                      v
                         post-commit semantic/exact verification
                                      |
                                      v
                              final answer + widgets
```

## Standards compatibility matrix

| Boundary | Adopt | Keep domain-specific | Do not copy |
| --- | --- | --- | --- |
| Editor ↔ Agent | ACP session lifecycle, capability negotiation, streaming updates, permission requests, cancel/resume and document notifications | geometry plan/tool updates, revision-bound semantic basis, Broker commit observation | treating a tool call or streamed diff as proof that geometry changed |
| Semantic intelligence | LSP-style immutable document versions, diagnostics and ordered workspace edits; Aider-style ranked structural map | GeometryRepoMap evidence, dependency roles, construction ownership and theorem claims | dumping the entire GeometryDoc/source into every prompt |
| Agent execution | OpenHands action/observation log; Cline-like checkpoint, approval and observation loop | read/write scopes, construction catalog, exact verification and post-commit GeometryDoc | regex extraction from prose and client-only terminal events |
| Canvas | tldraw-style central input/selection/history state; GeoGebra free/dependent object and construction protocol | writable-driver analysis, external-impact disclosure and Broker-authored source patches | giving every rendered coordinate a draggable write handle |
| TikZ/PGF | official PGF display/binding/algorithm/system layer separation and ordered `pgfkeys` semantics | lossless CST, bounded semantic adapters, capability manifest and exact-only opaque nodes | claiming a subset parser implements TeX macro expansion or every library |
| Exact compiler | pinned PGF 3.1.11a bundle/profile, engine/driver/font/security/resource identities and artifact attestation | interactive/exact differential fixtures and semantic capability probes | advertising Lua graph drawing under a non-Lua engine profile |

ACP therefore solves the transport/UI interoperability problem, not the
three-lane truth problem. GeometryRepoMap + GeometryIntent + Broker replay are
the missing domain layer that conventional coding-agent protocols do not have.

### ACP adoption decision for the current codebase

The present RunStore already supplies durable run IDs, ordered events, resume
capabilities, proposal checkpoints and exactly-once terminal compare-and-set.
Those map cleanly to an ACP session/update projection. The browser already
cancels streams and reports document revisions, but the public protocol still
lacks four ACP-grade boundaries:

1. negotiated protocol/capability versions instead of assuming every client
   renders every widget/tool update;
2. an explicit permission-request/response update for write, external-impact
   confirmation and exact compiler/VLM calls;
3. versioned document `didOpen/didChange/didSave/didFocus` notifications that
   share the GeometryDoc revision/source hash;
4. session modes/configuration (`answer`, `plan`, `act`, compiler profile) that
   are state, not phrases inferred from natural language.

The upgrade should be an adapter over the existing event/RunStore types, not a
rewrite of Broker transactions. ACP file-system/terminal write calls must never
be allowed to mutate TikZ source directly; they may only produce a closed
GeometryIntent or read-only observation which the host recompiles and replays.

### 2026-08-22 protocol cross-check

The latest primary-source review reinforces that decision and makes the split
between interoperability and document truth more precise.

ACP v2 treats `session/prompt` as acceptance of foreground work, not as the
completion response. Running, user/agent messages, plans, tool calls,
`requires_action`, cancellation and the final idle state are streamed as
`session/update` records. Message updates are upserts keyed by an opaque
`messageId`; tool calls are likewise upserts keyed by `toolCallId`. Permission
is a separate `session/request_permission` request with a structured subject
and explicit allow/reject/cancel outcome. Unknown future permission outcomes
must never be interpreted as approval.

- [ACP v2 prompt lifecycle, pinned source](https://github.com/agentclientprotocol/agent-client-protocol/blob/788fdeda3adfc7c710665a91149793b65ad2e73c/docs/protocol/v2/prompt-lifecycle.mdx)
- [ACP v2 tool calls and permission requests, pinned source](https://github.com/agentclientprotocol/agent-client-protocol/blob/788fdeda3adfc7c710665a91149793b65ad2e73c/docs/protocol/v2/tool-calls.mdx)

LSP 3.18 makes the edit boundary equally explicit. `documentChanges` can bind
edits to document versions, operations are ordered, clients declare their
failure handling, and `transactional` means every operation succeeds or none
is retained. Change annotations are review metadata and may be grouped by
label; they do not become another source of patch text.

- [LSP 3.18 WorkspaceEdit, pinned source](https://github.com/microsoft/language-server-protocol/blob/c1d8565c5b19236e718d2df979108f2eccf0834f/_specifications/lsp/3.18/types/workspaceEdit.md)

Aider, OpenHands, Cline and Continue supply implementation patterns rather than
a shared write protocol:

- Aider extracts definitions/references with Tree-sitter, persists a versioned
  tag cache and renders a ranked map within a token budget. Exact search/replace
  blocks still require a source match; a plausible-looking model edit is not
  considered applied merely because it was generated.
- OpenHands events are frozen closed records with unique IDs, parent IDs and
  source attribution. Its persistent event log is the reconstructable run,
  rather than a sequence of React messages.
- Cline separates Webview, Controller and Task state. Its task loop presents a
  typed tool request, obtains approval, executes it, saves a checkpoint and
  sends the observation back to the model before continuing.
- Continue separates suggested content from the editor apply manager, captures
  the current document, supports cancellation and applies a computed diff
  through the IDE integration.

These systems therefore validate the existing Math GeoHub direction, but none
of them provides a substitute for GeometryDoc or Broker replay.

### Runtime terminal decision adopted on 2026-08-22

The editor-protocol comparison also changes how model-format failures are
classified. ACP separates an agent's final session state from the transport
request that accepted the prompt. A model can finish without producing a valid
tool or edit, while the session transport, RunStore and document remain
healthy. Math GeoHub therefore uses two different terminal families:

- malformed, mixed or missing model actions are retried within the bounded
  model-step budget and then end as `run.completed` with
  `outcome=unapplied-candidate`;
- provider transport, durable RunStore, trusted tool-observation integrity,
  compiler service and Broker failures end as `run.failed`;
- an unapplied terminal always reports that the Canvas and TikZ source were
  unchanged and never reinterprets hidden reasoning as an executable action.

This closes the recurring two-turn failure in which a reasoning-capable relay
returned only `reasoning_content`. The internal channel remains quarantined;
the runtime asks for a visible decision twice, then safely stops rather than
presenting a false infrastructure failure. The protocol-conflict classifier is
a single host function shared by every model step, so tool/write mixing,
multiple typed writes, read-only verification writes, missing widgets and
ordinary non-executable TikZ examples cannot acquire different meanings on a
later retry.

This is deliberately narrower than accepting whatever code the model emitted.
Aider's exact-match edit blocks and LSP's versioned transactional edits both
support the same negative rule: generation is not application. Only a
host-compiled, current-basis transaction observed through Broker commit may
advance the document revision.

### AHP/ACP/LSP adoption profile for Math GeoHub

The 2026-08-22 review also covered Microsoft's Agent Host Protocol (AHP). AHP
is a useful state-synchronization reference because it separates chat turns,
tool-call confirmation, changesets, annotations and large referenced resources
into distinct channels. Its client actions are write-ahead: a client may apply
an optimistic reducer action, but the server echoes an accepted or rejected
action envelope. Its changeset and annotation types are review projections,
not an alternate file system. This fits Math GeoHub's RunStore and
`GeometryWorkspaceEdit` direction, but AHP is still a draft and does not define
geometry semantics, TikZ source ownership or exact-render attestation.

- [AHP repository: immutable state, reducers and write-ahead reconciliation](https://github.com/microsoft/agent-host-protocol)
- [AHP chat/tool confirmation state](https://microsoft.github.io/agent-host-protocol/reference/chat.html)
- [AHP protocol overview and changeset channel](https://microsoft.github.io/agent-host-protocol/specification/overview.html)
- [ACP v1 tool-call lifecycle and diff content](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.json)

The resulting adoption profile is intentionally compositional:

1. **ACP-shaped session transport:** prompt, cancel/resume, message upserts,
   plan and tool-call lifecycle, explicit permission requests.
2. **AHP-shaped durable projection:** reducer-backed run state, changeset and
   annotation widgets, pending-input state and resource references for large
   artifacts.
3. **LSP-shaped write container:** ordered, version-bound, annotated and atomic
   edits, rejected when the document version no longer matches.
4. **CodeMirror transaction application:** one transaction may contain several
   changes and carries origin/history annotations; the editor is an application
   surface, not mutation authority.
5. **Geometry-specific authority:** GeometryIntent, GeometryDoc, writer proofs,
   impact closure and Broker replay remain stricter than all generic editor
   protocols.

No protocol layer may infer success from another layer's progress event.
`tool.completed`, `proposal.ready`, `changeset available` and `diff rendered`
are observational states. Only an accepted Broker transaction followed by a
current-basis GeometryDoc projection can report a semantic mutation; exact
fidelity additionally requires a matching compiler artifact attestation.

### Canvas interaction application on 2026-08-22

The same evidence was applied to pointer interaction. `CanvasInteractionSession`
now owns one revision-bound gesture before any mutable tool adapter selects,
captures, previews, invokes the solver or writes. While active, only the owning
pointer can move, finish or cancel the session. A multi-tap construction may
transfer pointer ownership only when it continues the same construction tool;
a competing pointer cannot steal an existing drag, pan or transform.

Derived-drag solver work is now a child resource of that interaction. Escape,
pointer cancellation, source/tool invalidation and commit rejection abort the
solver signal; the browser adapter also applies a bounded solve timeout. The
component-level simulated-pointer specification checks that a second pointer
cannot replace an active interaction ID or terminate the first pointer's
session. This brings Canvas input in line with the same action/observation and
cancellation model used by the Agent harness.

## Three-lane conflict model

The recurring failures can be classified instead of being repaired with more
prompt rules:

| Conflict | Observable failure | Applicable standard | Math GeoHub authority |
| --- | --- | --- | --- |
| Lifecycle | model says “done” before the Canvas changed; second turn has no recoverable terminal state | ACP state updates, tool upserts, permission and cancellation | durable RunStore event + Broker commit observation + post-commit verification |
| Snapshot | AI edits revision N after Code/Canvas reached N+1 | LSP versioned document edits | document epoch, revision, source/kernel/projection hashes and source-slice preconditions |
| Scope | a named point, raw range or copied capability enlarges what the model may modify | ACP permission is necessary but not sufficient | server-attested focus closure and Broker-recomputed read/write capability fingerprints |
| Intent | “change the circle” becomes append-only TikZ or multiple incompatible fences | no general editor standard | closed GeometryIntent resolved against unique semantic IDs and Catalog contracts |
| Representation | Canvas drags one visual object while source or dependent constructions describe another | editor transactions alone do not model geometry | lossless source + GeometryDoc dependency graph + writable-driver analysis |
| Review | a card claims “change A” while the patch changes B | LSP change annotations | canonical GeometryWorkspaceEdit rebuilt by the Broker from the compiled transaction |
| Fidelity | interactive SVG and TeX artifact differ, or an unsupported key is presented as editable | compiler/build protocols only identify artifacts | capability truth manifest and exact compiler profile/attestation |

The important negative result is that ACP cannot solve snapshot, geometry or
compiler truth, and LSP cannot infer geometry intent. They solve the transport
and edit-container layers only. Conversely, GeometryDoc should not acquire its
own chat/session transport or generic file-edit API.

## Architecture decision: one model-facing semantic write language

The current compatibility surface still exposes several executable fences:
raw patch, managed-plan replacement, construction intent, managed presentation
and plain TikZ action. This is the main protocol-comprehension tax behind mixed
write responses and multi-turn repair failures. Those schemas are valuable as
internal compiler/Broker ABIs, but they should no longer all be model-facing.

The model-facing protocol should converge on one closed
`tikz-geometry-intent` envelope carrying `GeometryIntent/v2`:

```text
decision: answer | clarify | act | verify

act:
  construct(toolId, semantic input refs, parameters)
  construct-dag(items, local output refs, atomic=true)
  present(target refs, style and/or label)
  transform(target refs, similarity transform and pivot policy)
  delete(target refs, block|cascade)

verify:
  claim(type, semantic refs, tolerance/profile)
```

The model never supplies document hashes, source ranges, binding IDs, managed
construction IDs, writer slots, capability fingerprints or transaction IDs.
The host resolves semantic references against the immutable current
GeometryRepoMap and compiles the decision into the existing internal intent,
plan and source-patch protocols. The Broker independently repeats that lowering
from the current GeometryDoc and compares the complete transaction and
GeometryWorkspaceEdit.

Legacy executable fences remain temporarily readable for stored runs and test
fixtures, but the system prompt should advertise only GeometryIntent plus
read-only tools. A compatibility proposal is quarantined and converted by host
code; it is never mixed with a GeometryIntent in the same model turn.

Implementation status on 2026-08-22: the first closed vertical slice now
defines and extracts `GeometryIntent/v2`, resolves unique focus-scoped entity
references on the host, and lowers `construct` plus managed `present`
(style/label or their atomic combination) into the existing trusted internal
protocols. The second vertical slice adds `transform`: the model supplies only
semantic target references and a translate/rotate/uniform-scale/reflect
operation; the host resolves pivot or axis points, lowers to a host-only
`ai-selection-transform-intent/v1`, and reuses the Canvas writable-driver and
parameter-slot planner. The Broker independently rebuilds the current
GeometryDoc, authorization scope, complete impact closure, patches and
GeometryWorkspaceEdit. The compiler also requires the intent basis, request
basis and GeometryDoc basis to be identical, so a current source cannot be
combined with a stale semantic projection. Model-authored impact
acknowledgements are impossible;
a transform with collateral dependents remains unapplied until a future ACP
permission receipt carries the exact host-computed impact set. `simulate-intent`
uses the same lowering path before constructing a candidate GeometryDoc.
The third vertical slice adds block-only `delete`: the model names semantic
roots, while a host-only `ai-semantic-delete-intent/v1` reuses the
GeometryDoc-authoritative Canvas deletion planner. Statement ownership,
dependent closure, managed whole-block ranges and source patches are all
recomputed by the Broker. The model cannot request cascade; a dependent object
therefore turns deletion into an unapplied clarification until a future ACP
permission receipt attests the exact host-computed cascade set.

The fourth vertical slice implements `construct-dag`. The model supplies only
source-ordered Catalog tool IDs, current semantic entity references and stable
keys from each producer's advertised `outputSlots`; it cannot supply TikZ
names, managed IDs, bindings, ranges, compact plans or writer fields. Host code
resolves external bindings, shares one identity allocator across all steps,
evaluates earlier outputs for later inputs, validates every Catalog footprint
and emits one Canvas construction batch. The Broker rebuilds the current
GeometryDoc, repeats the complete Catalog DAG compilation and compares both the
patches and compact batch proof before one atomic commit. Composite tools such
as nine-point-circle, Fermat point and Simson line remain one Catalog step;
`construct-dag` is for constructions which genuinely require several existing
Catalog tools.

Catalog discovery now separates contract visibility from immediate input
readiness. Every supported tool and its stable output ABI is visible to DAG
planning, while `currentInputReady` only reports whether the current authorized
focus can satisfy all inputs without an earlier step. This distinction is
required for chains such as “construct the circumcircle, then construct a point
on that new circle”: hiding circle-consuming tools merely because no circle
exists in the pre-edit GeometryDoc would make the semantic DAG impossible.
The batch compiler independently resolves and evaluates a circle produced by an
earlier step rather than pretending it already has a current source binding.

### Why this improves complex geometry rather than merely cleaning syntax

Complex constructions fail when the model must simultaneously reason about a
theorem, choose a Catalog construction, copy revision authority, select a
writer protocol and format an exact JSON envelope. Removing the last four
tasks gives the model token and reasoning budget for the geometry itself.
`construct-dag` also makes a proof construction one atomic semantic object:
local outputs from an earlier item can feed a later item without requiring
intermediate source commits or model-generated names.

The host compiler remains responsible for:

1. resolving each reference uniquely from ranked semantic evidence;
2. checking Catalog input kinds, degeneracy and branch choices;
3. allocating all point/construction/source identities;
4. compiling the complete DAG in memory;
5. verifying constraint footprints and candidate GeometryDoc;
6. emitting one annotated atomic WorkspaceEdit;
7. committing once and returning the new semantic/exact observations.

## Implementation sequence

1. **Intent convergence.** Introduce `GeometryIntent/v2` and a host-only
   compiler that delegates to existing trusted construction, presentation,
   transform and delete compilers. Keep existing Broker proof paths; do not
   weaken them into a generic patch executor.
2. **ACP projection.** Project RunStore events to ACP-shaped session/message,
   plan, tool and state updates. Add explicit permission requests for source
   mutation, external-impact transforms, exact compilation, VLM calls and
   external problem retrieval. A proposal remains `requires_action`; only the
   verified commit transitions mutation work to idle.
3. **Document notifications.** Emit versioned didOpen/didChange/didSave/didFocus
   observations from the same StudioDocument snapshot. These notifications
   invalidate semantic/tool caches but never mutate source themselves.
4. **Canvas convergence.** Finish routing snapping, construction preview,
   selection transforms and pointer cancellation through
   CanvasInteractionSession. Preview and commit must invoke the same semantic
   planner with different effects.
5. **Compiler profiles.** Negotiate standard-TikZ and Lua-graph profiles by
   immutable capability manifest; cache keys include PGF, engine, driver,
   fonts, wrapper and policy digests.

### Cache policy inherited from editor-agent implementations

Only stable observations are cacheable:

- static system policy by policy digest;
- GeometryRepoMap structure by kernel hash, plugin digest and retrieval policy;
- ranked focus results additionally by explicit focus IDs and depth;
- read-tool observations by tool schema, arguments and immutable basis;
- exact artifacts by full compiler-profile and executed-source digests.

Authority is never cacheable across revisions. Writable bindings, source
ranges, permissions, external-impact acknowledgements and transaction proofs
must be recomputed from the current document even when the semantic structure
appears unchanged.

## Required contracts

### 1. `GeometryRepoMap/v1`

The map is a retrieval projection, never authority. Each result includes:

- semantic entity/constraint/relation IDs and kinds;
- directed dependency roles and evidence record IDs;
- source binding IDs without source-write capability;
- graph distance from explicit focus;
- relevance score and reason;
- managed construction summaries;
- truncation counts and retrieval cursor.

Ranking is personalized to explicit selection/names. Dependency ancestors,
dependents, theorem-critical constraints and managed-construction ownership have
different edge weights. Lexicographic truncation is prohibited because it drops
semantically central auxiliary geometry. The allowed read/write scope remains a
separate server-attested set; ranking cannot enlarge it.

### 2. `GeometryIntent/v2`

The model selects semantics, not source ranges:

```text
answer
clarify(question, choices)
construct(toolId, input refs, parameters)
construct-dag(items, local output refs, atomic=true)
present(target refs, style/label intent)
transform(target refs, canonical transform intent)
delete(target refs, mode)
verify(claim refs, method)
```

Host code resolves names, bindings, writer slots and IDs from the current
GeometryDoc. Multiple semantic actions become one host-compiled batch rather
than multiple executable fences.

### 3. `GeometryWorkspaceEdit/v1`

Like LSP WorkspaceEdit, it carries:

- document ID, epoch, revision, source hash and plugin/compiler digests;
- ordered source patches whose ranges address the same starting source;
- semantic read/write sets and source binding preconditions;
- change annotations suitable for a review widget;
- atomic failure handling;
- transaction and idempotency IDs;
- replay/attestation proof.

The UI previews the semantic change and affected geometry. It never applies a
subset of a failed batch.

### 4. `CanvasInteractionSession/v1`

The central state machine is:

```text
idle -> hover -> pressed -> dragging/box-selecting/constructing/transforming
                                      |              |
                                      +--> preview --+
                                                |
                                      commit | cancel | stale
```

Every session owns pointer ID/capture, starting revision, hit candidates,
selection, snapping context, writable-driver analysis, external-impact set,
preview projection and cancellation. The same analysis drives handles, numeric
Inspector controls and Broker proof; there is no document-wide “writable” flag.

### 5. `ExactCompilerProfile/v2`

The immutable manifest contains:

- TeX engine and version;
- PGF/TikZ bundle digest and library probe results;
- output driver and exact arguments;
- font bundle digest;
- wrapper template digest;
- source/security policy;
- CPU/time/memory/source/log/artifact limits;
- semantic capability profile digest.

Artifacts attest the complete identity plus submitted/executed source digests.
Interactive/exact parity is evaluated per supported primitive; arbitrary TikZ
remains exact-only without fabricated reversible semantics.

## Current codebase gap matrix

| Area | Existing strength | Remaining conflict | Next implementation |
| --- | --- | --- | --- |
| Run lifecycle | typed events, RunStore, resume token, proposal/terminal CAS | model loop is still only three steps and has few semantic tools | durable Observe/Plan/Propose/Verify phases with per-phase budgets |
| Semantic retrieval | GeometryDoc, source map, bounded managed-plan retrieval, ranked `GeometryRepoMap/v1` | relation/explanation tools do not yet expose theorem-specific proof obligations | add proof-query and construction-inspection tools without widening authority |
| Writes | typed proposals, transaction attestation, Broker replay | intent schemas remain fragmented; combined complex edits can trigger envelope conflicts | host-only semantic batch compiler and annotated review model |
| Canvas | pointer capture, marquee, selection transform capability, preview projection | tool behavior is spread across component/tool adapters; some modes still differ in preview/pivot/impact UX | central CanvasInteractionSession reducer and simulated pointer corpus |
| Exact compiler | immutable profile, source/artifact digests, bounded private compiler | most official libraries are conditional; Lua graph drawing requires a distinct engine profile | capability probes and separate standard/Lua graph profiles |
| Complex geometry | trusted construction catalog and managed plans | model context lacks theorem/role-aware ranking and proof-query tools | geometry ranker, construction DAG intent, relation/explain/verify tools |

## 2026-08-22 research verdict: which standards actually solve the conflict

The latest GitHub, Tavily and upstream-documentation sweep confirms that there
is still no single specification that can make AI, TikZ source and an
interactive geometry Canvas agree. The useful standards form a stack, and each
must be prevented from claiming authority owned by the layer below it.

| Existing contract | What it solves | What it cannot solve here |
| --- | --- | --- |
| ACP | session lifecycle, streamed message/tool upserts, cancellation, capability negotiation and permission UI | whether a geometric construction is valid, which TikZ bytes own an entity, or whether a Canvas drag is reversible |
| LSP `WorkspaceEdit` | versioned ordered edits, review annotations and declared failure handling | semantic geometry targets, dependency closure and TeX execution truth |
| CodeMirror transaction/`ChangeSet` | one local editor transaction with mapped selections/effects and undo isolation | cross-process replay, model authorization and semantic correctness |
| Tree-sitter/incremental CST | fast error-tolerant source structure and local reparsing | complete TeX expansion; LaTeX grammars explicitly cannot model arbitrary catcode/macro execution |
| Aider architect/editor split | separates high-level reasoning from exact edit production and uses a ranked dependency map under a token budget | it does not make architect output trusted, nor provide domain geometry verification |
| GeoGebra construction model | free versus dependent objects, construction order and driver-based movement | lossless TikZ ownership and exact TeX rendering |
| AlphaGeometry-style neuro-symbolic loop | lets a model propose auxiliary constructions while a symbolic engine performs deductions and checks proof state | interactive source mapping, presentation edits and compiler artifact identity |
| PGF graph drawing layers | separates display, binding and algorithm layers; algorithms consume an object graph rather than raw display syntax | browser-side reversible editing of arbitrary TeX macros and libraries |

Primary references for this decision:

- [ACP v1 overview and capability-oriented client/agent methods](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/overview.mdx)
- [ACP schema tool lifecycle and permission requests](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.json)
- [LSP 3.17 versioned and annotated WorkspaceEdit](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification)
- [CodeMirror transaction and ChangeSet contracts](https://codemirror.net/docs/ref/)
- [Tree-sitter incremental CST goals](https://tree-sitter.github.io/tree-sitter/index.html)
- [tree-sitter-latex limitation: TeX is not completely parseable by a grammar](https://github.com/latex-lsp/tree-sitter-latex)
- [Typst incremental parse/evaluate/layout/export architecture](https://github.com/typst/typst/blob/main/docs/dev/architecture.md)
- [Aider ranked repository map](https://github.com/Aider-AI/aider/blob/main/aider/website/docs/repomap.md)
- [Aider ask/code/architect/editor modes](https://github.com/Aider-AI/aider/blob/main/aider/website/docs/usage/modes.md)
- [GeoGebra free and dependent object contract](https://geogebra.github.io/docs/manual/en/Free_Dependent_and_Auxiliary_Objects/)
- [AlphaGeometry neuro-symbolic auxiliary-construction loop](https://www.nature.com/articles/s41586-023-06747-5)
- [PGF graph display/binding/algorithm separation](https://tikz.dev/gd-overview)

### Consequent authority order

Every operation must follow one direction and may only become truth after the
next layer has attested it:

```text
agent decision
  -> semantic intent (no ranges or writer IDs)
  -> host GeometryDoc resolution and proof obligations
  -> Broker-replayable annotated workspace edit
  -> one CodeMirror/source transaction
  -> new lossless CST + GeometryDoc projection
  -> interactive rendering + exact artifact comparison
  -> commit observation returned to the agent
  -> final natural-language answer/widgets
```

Reverse IO is allowed only through an explicit adapter: Canvas gestures submit
a semantic interaction intent, and exact/VLM output submits a read-only
observation. Neither may directly replace source or semantic truth.

### Highest-value next architecture slices

1. **ACP-shaped run modes and permissions.** Make `answer`, `plan`, `act` and
   `verify` explicit session state. Add a real `requires_action` permission
   receipt for mutation, external-impact transforms, exact compilation, VLM
   observation and external problem retrieval. Natural-language intent
   classification must not itself grant write authority.
2. **`GeometryProofState/v1`.** Represent givens, goal, proven relations,
   unresolved obligations, auxiliary-construction candidates and evidence IDs.
   The model proposes one Catalog/DAG construction; the symbolic kernel expands
   deductions and returns an observation. This is the direct AlphaGeometry
   lesson and the missing layer for olympiad-grade comprehension.
3. **Selection-specific Canvas capability.** Derive draggable drivers,
   dependent preview, snapping, external impact and writable slots from the
   same current GeometryDoc. The UI must not expose a handle that the Broker
   will later reject.
4. **Differential render truth.** Classify interactive-versus-exact differences
   by entity/source binding and capability profile. A visual mismatch is a
   diagnostic/evaluation artifact, not permission for the VLM to rewrite code.
5. **Compiler-profile negotiation.** Keep the standard Tectonic profile honest
   and add a separately sandboxed LuaTeX graph-drawing profile. Official graph
   syntax can be preserved today, but algorithmic layout must remain
   `exact-only/blocked` until the companion profile is available and attested.

## Checkpoint implementation

This research checkpoint closes the first semantic retrieval slice:

1. `focusClosure` now treats `GeometryEntity.parameters.references` as graph
   edges, so a path selected through point `A` also exposes its path entity and
   connected point `B`.
2. `inspect-geometry` now returns the complete bounded, server-attested focus
   neighborhood instead of discarding it and returning only literal requested
   entities.
3. Read authority remains unchanged: returned entities are intersected with the
   immutable `allowedEntityIds`; retrieval depth cannot enlarge scope.
4. `GeometryRepoMap/v1` ranks the current, bounded semantic neighborhood using
   directed definition/dependency edges, constraint strength, graph distance
   and a deterministic personalized PageRank pass.
5. Each ranked entry carries retrieval reasons and semantic evidence record
   IDs. Exact entity IDs override ambiguous aliases; ambiguous names fail
   closed instead of silently selecting an object.
6. Ranking is now returned by `inspect-geometry`, so the model can distinguish
   the explicit focus from supporting constructions without receiving any new
   binding capability.
7. The bounded read-tool layer now includes `explain-relation`,
   `inspect-construction`, `simulate-intent` and `verify-geometry-claim`.
   Relationship explanations return deterministic evidence paths; construction
   inspection returns canonical managed plans; simulations rebuild an in-memory
   candidate GeometryDoc but expose no transaction; claim verification reports
   normalized numeric residuals against the immutable current basis.
8. `CanvasInteractionSession/v1` is now a central reducer for pointer ownership,
   capture lifecycle, marquee selection, selection transforms, construction,
   panning, commit and cancellation phases. Every interaction records the
   starting revision/source hash and optional kernel/projection hashes.
9. Source revision changes, source hash drift, tool switches and Escape cancel
   the active session deterministically. A competing pointer cannot move or
   finish another pointer's gesture, and the SVG exposes the current interaction
   phase/id for browser-level assertions and accessibility state.
10. Existing Broker commit paths remain the only mutation boundary. The reducer
    now keeps a multi-click construction under one interaction id, including
    touch devices that assign a fresh pointer id to each tap. Derived drags stay
    in `committing` until the constraint solver and Broker actually complete or
    reject; pointer-up is no longer treated as a successful semantic commit.
    Detailed snapping and anchor acquisition remain a compatibility child state
    and must migrate without creating a second Canvas truth.
11. `GeometryWorkspaceEdit/v1` now adds LSP-style, bounded review annotations
    to the existing Geometry transaction without duplicating source patches.
    It references the compiled operation/patch order, declares atomic failure
    handling, canonical semantic targets and confirmation requirements.
12. Raw AI patches and Canvas selection transforms emit this descriptor. The
    transaction attestation binds it, the Broker validates its closed shape,
    and typed Broker replay independently rebuilds the canonical descriptor so
    forged review text cannot misrepresent the actual mutation.
13. The exact compiler manifest is now `tikz-exact-profile/v2`. It explicitly
    declares the current Tectonic `only-cached` runtime, `luaExecution=false`
    and `graphDrawing=syntax-only`. Static `graphs`/`graphs.standard` syntax is
    verified under the standard profile, while official Lua graph-drawing
    algorithms are preserved but blocked until the separately attested
    `tikz-luatex-graphdrawing-v1` companion profile exists. The manifest digest
    already participates in the v3 cache key, so this contract change cannot
    reuse an artifact compiled under the old runtime claim.
14. Post-commit verification now separates the Broker commit result from the
    provider's ability to produce a natural-language summary. Reasoning-only,
    tool-budget exhaustion, or provider failure after a proven commit produces
    a bounded host-authored summary plus `commit.verified`; it can no longer
    regress the same run to `unapplied-candidate`, claim that the Canvas stayed
    unchanged, or replay the write.
15. Exact preview and asynchronous VLM audit now share one browser exact-render
    client. The client binds the returned SVG attestation to the exact UTF-8
    source digest. The VLM audit emits a host-issued
    `tikz-render-comparison-artifact/v1` containing the revision basis,
    interactive raster digest, optional exact raster digest, and exact artifact
    digest. This artifact is observational evidence only and grants no source
    capability.
16. `GeometryProofState/v1` is now a bounded, revision-bound read model over
    the current GeometryDoc. It separates required semantic constraint evidence
    (`formally-proven`) from coordinate residual checks
    (`numerically-satisfied`), exposes contradictions explicitly, keeps facts
    and auxiliary Catalog candidates inside the existing read scope, and never
    returns source bindings or write authority. The single-claim verifier now
    uses the same status vocabulary, so a visually accurate drawing can no
    longer be reported as a completed proof merely because its residual is
    small.
17. Host-projected geometry-flow widgets now attach proof-state obligations to
    their matching construction steps. Nine-point-circle concyclicity is
    formally witnessed only when all nine points have required `on-circle`
    constraints to the same semantic circle; Simson collinearity is tied to the
    required collinear constraint. Raw midpoint/altitude diagrams remain
    `numerically-satisfied` unless their current GeometryDoc carries matching
    required evidence. Proof badges are admitted only at the same-origin host
    SSE boundary, are basis-bound, and never accept model-authored status or
    evidence IDs. The same immutable flow drives the chat card and dynamic
    sidebar, where mathematical explanations use the shared KaTeX renderer.
18. `GeometryIntent/v2` construction and construction-DAG operations can now
    cite a closed proof-planning context containing only a theorem role, one
    same-run `build-proof-state` call ID and bounded obligation IDs. The Agent
    runtime retains successful read-tool receipts internally; the route accepts
    only a current `GeometryProofState/v1` receipt whose document, epoch,
    revision, source, kernel, projection and plugin basis match the current
    GeometryDoc. Missing, stale, ambiguous or contradicted obligations reject
    the construction before source lowering. The model cannot copy evidence,
    residuals, statuses, ranges, bindings or transaction authority into this
    context. Direct requests such as “画一个九点圆” remain one-step Catalog
    construction; proof/derive/olympiad requests must first observe proof state.
19. The model-facing protocol gate now distinguishes `GeometryIntent/v2` from
    legacy typed proposals. A model-authored `tikz-patch`, construction plan,
    construction intent, or managed-presentation envelope is quarantined and
    repaired instead of being accepted merely because it is a single typed
    fence. Those schemas remain available only to deterministic Host lowering,
    stored-run compatibility and Broker replay. The only model write choices
    are one GeometryIntent or an explicitly bounded `tikz-action` compatibility
    batch for exact-source additions not yet represented by the Catalog.
20. Interactive/exact visual comparison now uses a canonical comparison
    viewport. The browser removes editor overlays and zoom-only non-scaling
    stroke behavior, fits the Geometry Truth document layer to the same inset
    used for the exact dvisvgm SVG, and only then produces raster digests. This
    prevents pan/zoom state from being misreported as renderer fidelity drift;
    the resulting comparison artifact remains observational and read-only.
21. The static `graphs` adapter now implements the official chain-group
    entry/exit rule. A group such as `a -> {b -> c, d -> e} -> f` lowers to a
    bounded object graph with the six expected cross/inner edges, read-only
    graph-node entities and graph-edge relations. Nested groups are bounded by
    depth, node and edge budgets. Quoted/anonymous nodes, graph macros,
    `foreach`, subgraphs and Lua graph-drawing algorithms still become
    lossless exact-only source. This follows the PGF design boundary: static
    topology can be understood without pretending the browser executes TeX or
    a Lua layout algorithm.

### Editor protocol findings applied to the next harness version

The current primary-source cross-check yields four concrete protocol rules:

1. ACP v2 treats a prompt response as acceptance only. The durable work is a
   sequence of `session/update` records, and foreground work terminates only
   when state returns to `idle` with a stop reason. Agent messages and tool
   calls are upserts keyed by stable `messageId` and `toolCallId`; progress is
   not an append-only pile of chat strings.
2. Codex app-server independently uses the same hierarchy: thread, turn and
   item, followed by `turn/started`, item lifecycle/deltas and one
   `turn/completed`. It also uses bounded transport queues and rejects overload
   explicitly. Math GeoHub should map RunStore events to this lifecycle rather
   than letting React own run truth.
3. MCP progress tokens belong only to active requests, progress must be
   monotonic, and notifications stop at terminal state. Cancellation must free
   associated resources and late responses are ignored. The same invariant
   applies to solver, exact compiler, VLM audit and GeometryIntent simulation.
4. Tree-sitter's edit contract updates the old concrete syntax tree with the
   exact source edit before incremental reparse, and unchanged structure is
   shared with the new tree. Geometry semantic caches must therefore be keyed
   by changed CST ranges plus the source revision; stable entity IDs are not a
   license to reuse stale ranges or write authority.
5. No general AI editor protocol solves geometric meaning. ACP/Codex lifecycle
   IDs solve event correlation; incremental CSTs solve source locality; neither
   decides whether a midpoint may move, which upstream point owns a derived
   coordinate, or whether interactive output matches TeX. Those decisions stay
   in GeometryDoc, writable-driver analysis, the Broker and exact verification.
6. GeoGebra's maintained movement implementation confirms the driver rule: a
   selected dependent object is resolved to deduplicated free input points,
   then one common movement/update cascade is applied. Math GeoHub should adopt
   that algorithmic contract through its own typed graph, without copying the
   GPL implementation or making numeric Canvas state authoritative.

### Current client projection closure

The browser projection now follows the protocol hierarchy instead of treating
the newest chat bubble as the current run:

- every user/assistant pair receives stable client message IDs;
- the first accepted Agent event binds its `runId` to the intended assistant
  message, and later/replayed events resolve by run before using the client turn
  target;
- token buffers, commit verification, recovery, mutation cards and asynchronous
  VLM audit widgets update that same message ID;
- a callback whose message was evicted is discarded; it may not create a new
  assistant message or fall through to a newer turn;
- the run reducer remains the terminal/sequence/idempotency gate, so a second
  run cannot replace the first run attached to one assistant message;
- `tool.started`, `tool.completed` and `tool.rejected` now project to one
  stable tool card keyed by `toolCallId`; raw events remain in the audit log,
  while tool-name conflicts, post-terminal regressions and duplicate terminals
  are quarantined instead of appearing as additional actions;
- foreground turn admission now uses a synchronous client-turn ownership cell,
  not delayed React render state, so double click/key repeat cannot create two
  requests before the `streaming` UI commits. Only the owning turn may release
  that cell, preventing an older aborted `finally` from unlocking a newer run;
- the composer exposes an explicit stop action. User/Studio cancellation flows
  through the request signal; the server persists one `run.completed`/
  `unapplied-candidate` terminal before attempting a final SSE frame, and the
  client replays that terminal through the original message/run binding;
- cancellation during post-commit verification never reclassifies or rolls
  back an already committed source transaction. It records a degraded
  `commit.verified` plus the mutation terminal from the trusted host
  observation, while suppressing the cancelled model-summary transport;
- a run terminal settles every still-running tool projection, so cancellation
  cannot leave permanent “运行中” cards. Exact compile, VLM and Canvas solver
  requests already consume AbortSignals; their caller-owned cleanup remains
  separate from semantic/source truth.

This closes the concrete two-turn UI contamination path. The next harness slice
must expose solver/compiler/VLM cancellation as the same typed item lifecycle
instead of only hook-local state, and bind exact-compile artifacts to the Agent
turn/revision that requested them.

### Compiler compatibility decision

“All TikZ/PGF syntax” is an exact-lane compatibility promise, not a claim that
the browser can semantically execute arbitrary TeX macros. Each capability must
advertise separate `parse`, `preserve`, `understand`, `edit`, `interactive` and
`exact` states. Unknown or macro-expanded source remains lossless and exact-only;
typed geometry is editable only when its source binding and driver ownership are
reversible. Exact acceptance requires the declared engine, format, package set,
shell/network policy, artifact digest and compiler log. This prevents a browser
preview from being presented as proof that official TikZ compilation succeeds.

### Exact-render item closure

The exact surface now projects an `exact-render` specialization of the shared
`tikz-async-work-item/v1` envelope instead of anonymous hook-local loading
state. The item owns a stable ID, document/epoch/
source identity, source revision/hash, plugin-set digest, compiler profile and
queued/running/ready/failed lifecycle. Source edits and retries create a new
item; callbacks from an older item must match both the active ID and the full
current basis before they can update state. The displayed SVG, DOM audit
attributes and attestation must all belong to that same ready item. The browser
object URL is itself tagged with the item ID, so an effect-cleanup frame cannot
pair a new revision's metadata with the previous revision's SVG.

The browser also re-hashes the returned SVG bytes and checks their UTF-8 byte
length against `artifactDigest` and `svgBytes`; validating only the source
digest is insufficient. VLM capture may reuse a mounted exact surface only when
its SHA-256 source digest and local source revision match the audit request;
otherwise it requests a new isolated exact artifact. This keeps VLM
observational and prevents a visually plausible stale SVG from acquiring
semantic authority.

### Terminal presentation and shared asynchronous work

A host-browser reproduction against the configured relay showed that two
successive turns already retained separate message/run ownership and performed
zero source writes when the provider was unavailable. The remaining visible
failure was a projection bug: the server durably emitted `run.failed` with a
useful provider diagnostic, while the empty chat body rendered as “completed”.
The client now projects terminal-only failures into readable chat and explicitly
labels a terminal-only answer as missing displayable model output. It applies
the same rule to normal SSE, commit verification and durable replay terminals.

Exact rendering and post-commit VLM audit now share the same revision-bound
work-item basis and monotonic lifecycle. A visual audit first renders one
pending card, then upserts that card by `itemId`; late running states cannot
replace ready/failed/cancelled terminals. Each VLM request has its own retained
AbortController, is cancelled on run abort, Studio teardown or source-basis
change, and is removed from the controller registry on settlement. This closes
the previous fire-and-forget request leak and prevents permanent “checking”
widgets.

Constraint-derived dragging now uses the same work-item basis. Each solve owns
one item ID, point name, source revision/hash and semantic hashes; only the
active item on the same current basis may become ready. Tool/source changes,
AbortSignal cancellation and timeouts settle it as cancelled or failed. When a
cancelled synchronous Worker owns no other request, the host terminates it
instead of retaining obsolete CPU/heap until the calculation returns. A real
pointer drag of derived foot `H` completed as one ready revision-0 solve,
patched upstream driver coordinates `A/B/C` through the Broker, advanced the
source, and preserved `H` as the projection expression rather than freezing it
to a literal point.

### Live two-turn relay and exact-lane audit (2026-08-23)

A fresh host-browser session reproduced the configured relay failure with real
clicks. The model catalog fell back to the explicitly configured `MiniMax-M3`
after its live request timed out. Two consecutive prompts then produced two
separate messages/runs, each received an independently owned terminal failure,
and neither changed the source or Canvas. Server timings were approximately
21.8 seconds per failed POST. DNS resolved `api.molamaker.cn` to
`101.42.109.43`, while a direct HTTPS connection timed out before TCP/TLS, so
the observed terminal is a host-to-relay transport failure rather than the old
mixed-write/missing-visible-output protocol defect.

The relay client now has one process-shared, origin-keyed transport circuit
breaker. Only DNS/TCP/TLS/timeout exceptions count; any HTTP response clears
the failure state because it proves reachability. Two consecutive transport
failures open a 30-second cooling window, after which the next request probes
normally. A post-change browser check measured the first failed Agent POST at
21.8 seconds and the immediately following independent run at 62ms server time;
the UI displayed the cooling-window diagnosis in about 1.5 seconds and retained
the unchanged source/Canvas. This bounds repeated outage cost without treating
an HTTP model/authentication error as network downtime.

The same browser session enabled exact preview without a compiler service. The
exact lane returned `COMPILER_UNAVAILABLE` visibly while the interactive SVG
and source editor remained usable. Static inspection also confirmed that the
current exact wrapper loads `calc`, `angles`, `quotes`, `through`,
`intersections`, `graphs` and the other verified standard-profile libraries,
so the default midpoint/projection/right-angle source is not missing its basic
library declarations. Lua graph drawing remains truthfully blocked by the
Tectonic profile and names `tikz-luatex-graphdrawing-v1` as the required future
companion profile; it is not falsely advertised as executable.

- [ACP v2 prompt lifecycle](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle)
- [Codex app-server lifecycle and bounded transport](https://github.com/openai/codex/blob/343074d4207d572809bd8cea15f4be1d09d98e0b/codex-rs/app-server/README.md)
- [MCP progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress)
- [MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)
- [Tree-sitter incremental edit contract](https://tree-sitter.github.io/tree-sitter/using-parsers/3-advanced-parsing.html)
- [Official TikZ graph chain groups](https://tikz.dev/tikz-graphs)
- [GeoGebra `MoveGeos` driver resolution, pinned source](https://github.com/geogebra/geogebra/blob/7625bc0588d346069ff4532e8062136302346db6/source/shared/common/src/main/java/org/geogebra/common/kernel/geos/MoveGeos.java)

### Proof-plan and simulated-postcondition closure

The proof boundary now has a separate `GeometryProofPlan/v1` artifact. A
successful `build-proof-state` observation returns both the proof state and one
deterministic plan bound to the host-owned run ID, tool-call ID, source ID,
document epoch/revision/source hash and semantic hashes. The plan records goals,
semantic deductions and requested auxiliary-tool decisions, but contains no
source ranges or write capabilities. A proof-solving `GeometryIntent/v2` is
accepted only when its referenced call resolves to exactly one current,
authoritative plan from the same run. This is the proof analogue of an LSP
versioned document edit: the model names intent; the host owns the snapshot.

`simulate-intent` now accepts optional postcondition claims. It compiles the
candidate transaction in memory, projects a candidate `GeometryDoc`, and builds
the post-simulation proof state and plan. That plan is explicitly
`authoritativeForWrite=false`; it helps the model decide whether the proposed
construction actually advances the goal without allowing a simulation to grant
commit authority. Formal deductions currently cover direct required
constraints/source definitions, midpoint-implies-collinear,
perpendicular-foot-implies-perpendicular, shared on-circle concyclicity and
circle-definition equal-radius witnesses. A coordinate residual remains a
measurement unless one of those bounded semantic rules supplies premises.

Ordinary user-authored TikZ no longer needs a managed-construction metadata
comment to participate in that proof boundary. The lossless TikZ adapter
already normalizes `($(A)!0.5!(B)$)` to a midpoint entity definition and
`($(B)!(A)!(C)$)` to a perpendicular-foot definition. The proof-state builder
now preserves those definitions as first-class evidence, distinguishes
`direct-source-definition` from `direct-required-constraint`, and applies the
same bounded theorem rules to both. The MathNet nine-point-circle canary checks
that source parsing, GeometryDoc, proof state and a run/call/revision-bound plan
agree on midpoint collinearity, altitude perpendicularity and the midpoint of
the circumcenter/orthocenter. This closes a concrete code-to-AI semantic gap
without granting a coordinate-only coincidence formal status.

The durable `tool.completed` event stores a bounded artifact reference
(`artifactId`, run/call ownership and source revision basis). Replay therefore
retains an audit pointer without copying the full fact graph into every event;
same-turn lowering still consumes the authenticated full tool receipt.

This follows the architecture seen in maintained formal-geometry systems—keep
construction state, formal conditions and deductions distinct—without copying
their implementation. FormalGeo is useful as a research reference for a
unified construction/reasoning/solution pipeline, but its repository announces
a 2026 license change and commercial-use restrictions; Math GeoHub must treat
it as an external design reference unless a separate license review approves
reuse.

- [FormalGeo maintained repository and license notice](https://github.com/FormalGeo/FormalGeo)
- [LeanEuclid benchmark repository](https://github.com/loganrjmurphy/LeanEuclid)
- [MathNet dataset card, provenance and rights policy](https://huggingface.co/datasets/ShadenA/MathNet)
- [Official TikZ top-level syntax architecture](https://tikz.dev/tikz)
- [Official TikZ coordinate/intersections semantics](https://tikz.dev/tikz-coordinates)
- [Official TikZ graph syntax](https://tikz.dev/tikz-graphs)

Tavily research/search was invoked for this review but returned HTTP 432 for
the configured account usage limit. Exa was registered outside the repository
but exposed no callable tool in this session. Those connectors therefore
contributed no unverified claims; the implementation decisions above use the
linked primary sources and repository inspection.

The GitHub connector was also used for a current, SHA-pinned code audit. The
review reconfirmed four implementation patterns: OpenHands locks append-only
events, rejects duplicate/missing-parent records and reconstructs the active
branch; Aider caches Tree-sitter definition/reference tags and budgets the
ranked map; tldraw centralizes input, selection, history and transactions in
its Editor/store boundary; GeoGebra resolves dependent drags to free or
moveable input objects and updates their algorithms once as a shared cascade.
None of those projects supplies geometry theorem semantics or TikZ compiler
truth, so their patterns remain below GeometryDoc/Broker rather than replacing
them.

- [OpenHands current event store, pinned source](https://github.com/OpenHands/software-agent-sdk/blob/9421149592da215066f58cb68cb04599d896ae74/openhands-sdk/openhands/sdk/conversation/event_store.py)
- [Aider current RepoMap, pinned source](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py)
- [tldraw current Editor boundary, pinned source](https://github.com/tldraw/tldraw/blob/91878fe7dfc46de584606e32c2a71aec883ebca0/packages/editor/src/lib/editor/Editor.ts)
- [GeoGebra current dependent-move resolution, pinned source](https://github.com/geogebra/geogebra/blob/7625bc0588d346069ff4532e8062136302346db6/source/shared/common/src/main/java/org/geogebra/common/kernel/geos/MoveGeos.java)

`CanvasInteractionSession/v1` now owns preview visibility as well as the
pointer and revision basis. Drag-source and construction previews carry the
producing `interactionId`, `toolId` and source/semantic hashes. Multi-tap touch
construction retains that owner while transferring pointer IDs; tool switch,
source change, cancellation, completion or a replacement interaction makes a
late preview ineligible for display and releases the retained preview body.

The next implementation slice should add a content-addressed artifact store if
cross-process proof-plan body recovery becomes necessary, and run the successful
two-turn answer/modify browser gate once the relay is reachable before
increasing autonomous write depth.

### 2026-08-23 editor-protocol delta

The current ACP v2 overview makes the foreground boundary explicit: a prompt is
accepted first, all message/plan/tool progress is delivered as keyed session
updates, cancellation is a separate notification, and the agent returns to an
idle state with a stop reason. Microsoft's newer Agent Host Protocol (AHP)
adds channel-scoped, reducer-backed chat, session, changeset and annotation
views. Its changeset reference is already marked 1.2 release candidate, but it
also explicitly states that files in a changeset have **no protocol content
version**. AHP is therefore suitable for review widgets, not for GeometryDoc
write authority. Math GeoHub must retain epoch + revision + source/kernel/
projection hashes on every executable edit.

MCP's current tool contract independently validates the other side of the
split: tools may advertise JSON-Schema input/output and return
`structuredContent`, but the specification explicitly distinguishes that from
schema-constrained model generation. Thus a typed tool receipt can be an
observation; it still cannot become a TikZ write until the host validates a
closed GeometryIntent and the Broker independently replays it.

- [ACP v2 communication and prompt lifecycle](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/overview.mdx)
- [AHP protocol overview and channel correlation](https://microsoft.github.io/agent-host-protocol/specification/overview.html)
- [AHP 1.2 changeset reference and content-version limitation](https://microsoft.github.io/agent-host-protocol/reference/changeset.html)
- [MCP tool input/output schemas and structured content](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP request-correlated cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)
- [Continue edit apply is completion-driven, pinned source](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/gui/src/util/clientTools/editImpl.ts)
- [Continue revalidates multi-edit inputs after pending time, pinned source](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/gui/src/util/clientTools/multiEditImpl.ts)

This review also exposed a geometry-specific failure generic editor standards
cannot see: the construction DAG previously shared one positional
`requestedNames` queue. A name intended for a later intersection or circle
point could be consumed by an earlier auxiliary construction. The allocator is
now step-local for requested names while sharing one revision-wide collision
namespace. Catalog contracts expose ordered, optional names only for semantic
outputs; internal writer identities remain host-owned. Consequently a staged
problem may create perpendicular bisectors, name their actual intersection
`P`, construct a circle point `L`, consume both in a later polygon, and retain
stable label/style targets after commit.

The model-facing lowering boundary now also validates those names against the
**current advertised tool contract**, before it creates a host-authorized
proposal. TikZ-unsafe names and duplicate values fail the closed GeometryIntent
shape; undeclared keys and DAG-wide duplicate requested names fail lowering.
The Catalog compiler and revision-wide allocator repeat the validation as an
independent replay fence. This removes a misleading intermediate state in which
the harness could cache or display a successful proposal that the compiler was
guaranteed to reject later.

The Canvas review found the same category of premature UI success in selection:
marquee completion, Select All and modifier-click each opened the transform card
even though they had only changed selection. Those implicit openings are
removed. A warning card is now opened only after the user explicitly attempts a
transform whose dependency impact requires acknowledgement. Entity and
statement selection targets carry their producing source revision; stale
targets cannot contribute semantic IDs to transform capability or commit and
are re-attested against the next complete GeometryDoc before becoming writable
again. This applies the LSP versioned-edit lesson to pointer state without
turning LSP itself into a geometry authority.

### Exact compiler routing: standard TikZ versus Lua graph drawing (2026-08-23)

PGF's graph drawing subsystem is not merely another parser keyword set. Its
display layer, binding layer and algorithms cross the TeX/Lua boundary; official
examples combine `graphdrawing` with `\usegdlibrary`, and PGF recommends LuaTeX
for the broadest graph drawing support. A standard Tectonic lane therefore
cannot truthfully advertise runtime graph layout just because the interactive
parser recognizes `\graph`.

The exact lane now has two content-addressed profiles:

- `tikz-standard-v1` retains the pinned Tectonic-only-cached wrapper for normal
  TikZ plus static `graphs`/`graphs.standard` syntax;
- `tikz-luatex-graphdrawing-v1` binds a separate LuaLaTeX wrapper, TeX Live
  package tree, graph-drawing library set, Worker image and compiler endpoint.

The browser-safe selector keeps an ordinary `\graph [grow right]` on the
standard lane. `\usegdlibrary`, an explicit `graphdrawing` library, or a known
Lua layout key selects the companion lane. That profile ID is carried through
submission, polling, cache-key recomputation, wrapper/manifest digests, bundle
identity and artifact attestation. A missing companion endpoint terminates with
`GRAPHDRAWING_COMPILER_NOT_CONFIGURED` before any request reaches the standard
compiler. This is a capability error, not a TikZ syntax error.

The companion Worker image has a build-time `spring layout` LuaLaTeX → DVI →
dvisvgm warmup. Arbitrary user Lua (`\directlua`, `\latelua`, function-table
entry points and constructed control sequences) remains blocked by source
policy; Lua execution is granted only to the immutable PGF packages in that
profile. The UI's revision-bound exact work item selects the same profile before
the job starts, so it no longer labels an in-flight Lua render as standard.

- [Official graph-drawing binding layer](https://tikz.dev/gd-binding-layer)
- [Official graph-drawing display layer](https://tikz.dev/gd-display-layer)
- [TeX Live runtime documentation](https://tug.org/texlive/doc/texlive-en/texlive-en.html)

The complex MathNet follow-up gate also exposed a harness cardinality bug: the
previous host batch could atomically lower one style intent and only one label
intent. A request such as “make the quadrilateral purple and label P, L, N” was
therefore likely to become multiple typed writes and collide with the one-write
turn rule. `HostSemanticActionSet/v1` now keeps the model-facing operations
semantic while host-lowering one style rewrite plus up to 16 label intents into
exactly two non-overlapping source patches: one managed whole-block rewrite and
one deterministic merged insertion. Every label intent retains its own Catalog
identity and writer proof. The Broker rebuilds GeometryDoc, replays every label
intent, regenerates every managed block, verifies the merged insertion bytes and
rejects a modified or stale member with zero committed bytes. The MathNet staged
evaluation now exercises answer-only → atomic auxiliary construction → one
purple-style/three-label action set → read-only interactive/exact receipts.

## Acceptance gates

1. Asking about one vertex of a triangle returns the connected sides,
   constraints, derived centers and owning constructions within budget.
2. The same request on two revisions yields different runtime digests but the
   same stable policy prefix, and never reuses stale authority.
3. A model cannot enlarge read/write scope by naming an entity outside the
   server-attested closure.
4. A construction/style/label batch either commits one revision or zero bytes.
5. Pointer cancel, tool switch, source edit or stale revision cancels the Canvas
   preview and releases pointer/solver resources.
   A released derived drag remains busy until the last coalesced solver request
   and Broker result has reached a terminal state.
6. Drag preview and committed projection use the same semantic planner; the
   visible object and its handles never diverge.
7. Every `interactive: edit` capability has parser, semantic adapter, writer,
   renderer, hit-test, AI descriptor and simulated pointer test evidence.
8. Every `exact: compiled` capability has a real compiler fixture under the
   exact engine/driver/profile manifest advertised to the UI and AI.
9. A committed run reaches exactly one `commit.verified` terminal even when the
   provider emits only hidden reasoning or the post-commit summary transport
   fails; the host fallback never claims unproven geometry details.
10. A VLM fidelity claim is accepted only when both raster digests, the exact
    artifact digest, document identity, epoch, revision, and source hash match
    the current comparison artifact.
11. A claim with a small coordinate residual but no required semantic
    constraint is reported as `numerically-satisfied`, never
    `formally-proven`; a semantic constraint that disagrees with evaluated
    geometry is reported as `inconsistent` and blocks proof completion.
12. A model-authored geometry-flow cannot display a formal-proof badge. A host
    flow may display it only when its revision basis matches the current
    GeometryDoc and its evidence IDs were re-derived from in-scope required
    constraints; source edits immediately invalidate and hide the stale flow.
13. A proof-solving construction cannot reach `proposal.ready` without a
    successful same-run proof-state receipt on the current GeometryDoc basis.
    Referencing an absent obligation, a stale call ID, a counterexample or an
    inconsistent semantic claim produces one unapplied terminal and zero source
    bytes; a current non-contradicted obligation may continue through the same
    Catalog compiler, transaction attestation and Broker replay as every other
    construction.
14. A single legacy typed envelope returned by a model is never executed. It
    must be repaired to one GeometryIntent or terminate unapplied; Host-created
    internal proposals continue through the same attestation and Broker replay.
15. Visual parity capture is invariant under equivalent interactive pan/zoom:
    equal source/Geometry Truth must yield the same canonical document framing
    before the interactive and exact rasters are presented to the VLM.
16. Starting turn B before a delayed token, event, replay result or VLM audit
    from turn A arrives cannot change B's message, run, widgets or terminal.
    The delayed update either upserts A by stable identity or is discarded when
    A is no longer retained.
17. An exact SVG is visible only when one ready exact item matches the current
    document, epoch, source ID, revision, source hash and plugin set, and the
    browser-recomputed SVG digest/byte count match its compiler attestation.
    VLM capture must reject or recompile a mounted exact surface from another
    revision even when its DOM node is still present.
18. A terminal-only provider failure produces a readable failure answer in its
    owning message, never an empty “completed” placeholder. Two consecutive
    failed turns retain separate run/message identities and commit zero bytes.
19. Every VLM audit has one stable work-item/card. Run cancellation, Studio
    teardown or source-basis change makes it terminal-cancelled and releases its
    controller; a late callback cannot regress or duplicate that terminal.
20. A proof-solving write references exactly one `GeometryProofPlan/v1` whose
    run ID, tool-call ID, source ID, revision and semantic hashes match the
    current GeometryDoc. A missing, stale, simulated or cross-run plan produces
    zero source bytes.
21. `simulate-intent` may verify claims against newly created candidate entities
    and report formal/numeric/unresolved/contradicted deltas, but its proof plan
    is always non-authoritative and cannot satisfy a later write fence.
22. A theorem-specific formal status contains a deduction rule and premise
    evidence IDs. Midpoint collinearity, altitude perpendicularity and
    equal-radius/concyclic claims must remain numerical unless their required
    constraints or losslessly parsed source definitions provide the
    corresponding semantic premises.
23. Raw TikZ `calc` midpoint and projection syntax must project to definition
    facts whose evidence IDs survive the current GeometryDoc basis. The
    MathNet nine-point canary must produce a same-run proof plan for midpoint
    collinearity and altitude perpendicularity without relying on managed
    metadata comments.
24. Every drag/construction preview is visible only while its interaction ID,
    tool ID and revision/hash basis match the active Canvas session. Pointer
    transfer within one multi-tap construction preserves ownership; a stale
    solver callback, source edit, tool switch, completion or cancellation
    cannot resurrect the preview.
25. Consecutive DNS/TCP/TLS/timeout failures open a bounded provider transport
    cooling window shared by catalog and chat calls. The next Agent turn still
    receives its own run/message terminal and writes zero source bytes, but it
    must not repeat a known-slow network attempt until the probe window opens.
    Any HTTP response immediately closes the circuit.
26. Exact-compiler unavailability never hides or disables the interactive
    Canvas. The default `calc` and right-angle source is compiled only under a
    profile whose wrapper manifest attests the required libraries; Lua graph
    drawing requires a separate LuaTeX companion profile and cannot silently
    fall through to Tectonic.
27. Plain `\graph` syntax remains on `tikz-standard-v1`; `\usegdlibrary`, the
    `graphdrawing` TikZ library or an algorithm layout key selects
    `tikz-luatex-graphdrawing-v1` before network submission.
28. Job polling and artifact retrieval use the profile selected at submission.
    A response whose profile, wrapper, bundle prefix, manifest digest or cache
    key belongs to the other compiler is rejected before SVG display.
29. Lua graph drawing can be enabled only by a separately attested companion
    image whose build-time warmup exercised a real Lua layout. User-authored Lua
    control sequences remain source-policy violations in both profiles.
30. A follow-up request that combines one uniquely resolved managed style target
    with several named label anchors lowers to one `HostSemanticActionSet/v1`,
    one Broker commit and one revision. Tampering with any label intent, writer
    proof, shared insertion bytes or basis rejects the entire set and commits
    zero source bytes.
31. Requested geometry names are scoped to one Catalog DAG step while collision
    reservation is shared across the full revision. Missing optional names
    consume their own positional slot; a later step's `P` or `L` can never be
    stolen by an earlier helper allocation.
32. The MathNet cyclic-nine-point construction canary must derive `P` from the
    two requested perpendicular-bisector lines, derive `L` from a same-batch
    circumcircle output, consume `L` in polygon `ANDL`, and only then perform
    the atomic style-plus-three-label follow-up.
33. GeometryIntent lowering rejects an undeclared requested-name key before
    producing a host-authorized proposal. A requested TikZ name may occur only
    once across a Catalog DAG, and the compiler independently repeats the same
    contract/collision checks.
34. Marquee selection, modifier-click and Select All update selection only; they
    never open a transform review card. The card opens from an explicit command
    or from an explicit handle attempt that needs dependency-impact consent.
35. Every entity/statement SelectionTarget is tagged with its source revision.
    A stale target contributes no semantic ID, binding or source range to a
    transform/Inspector write and must be re-attested against one complete
    current GeometryDoc before write capability returns.
