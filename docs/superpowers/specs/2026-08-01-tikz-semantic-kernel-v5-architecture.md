# Math GeoHub TikZ Semantic Kernel v5

> Status: active architecture baseline  
> Date: 2026-08-01  
> Product boundary: geometry/TikZ canvas first; visual redesign follows only after this contract is closed.  
> Deployment boundary: Next.js web on ECS, static/content-addressed assets through CDN, isolated exact compiler service.  
> Upstream baseline: PGF/TikZ 3.1.11a, release commit `839974a3f895bfb86f5a8bc155f0886c918f1bff`.

## 1. Product objective

Math GeoHub is not a TikZ text box with an SVG approximation. It is an AI-native
geometry authoring system in which Code, AI, and Canvas are three input/output
surfaces over the same construction truth.

The system must:

1. preserve every unmodified byte of user TikZ/PGF source;
2. inventory every in-scope official PGF/TikZ surface from a pinned upstream;
3. understand supported geometry as typed entities, relations, constraints, and
   construction history;
4. let Code, AI, and Canvas submit the same typed mutations;
5. produce an interactive projection and a separately attested exact TeX artifact;
6. preserve unknown, dynamic, and presentation-only source even when it cannot be
   edited semantically;
7. fail closed with typed diagnostics instead of guessing, rewriting, or silently
   dropping syntax.

This architecture deliberately exceeds a traditional "full TikZ parser": TikZ is
one lossless language adapter, while geometry semantics are source-neutral and can
later support other frontends/exporters.

## 2. The five support lanes

"TikZ support" is not one boolean. Every capability is described independently in
five lanes.

| Lane | Question | Required result |
| --- | --- | --- |
| Preservation | Can untouched source be opened, saved, and round-tripped byte-for-byte? | All source, including unknown/dynamic syntax, is retained. |
| Inventory | Is the official surface statically catalogued with provenance? | Every in-scope upstream file is accounted for by entries or diagnostics. |
| Semantics | Can the system derive stable geometry/construction meaning? | Only adapter-backed syntax enters Geometry IR; uncertain meaning stays opaque. |
| Interaction | Can Canvas/AI/Inspector safely write it back? | Only typed mutation handlers with a reversible writer contract are writable. |
| Exact execution | Can a pinned compiler profile execute it? | Compile unchanged source or reject with a typed policy/profile diagnostic. |

No UI, API, prompt, or registry entry may collapse these lanes into `supported:
true`. A capability may be preserved and exactly compiled while remaining opaque
and read-only on Canvas.

## 3. Non-negotiable truth model

```text
TikZ/TeX Source bytes                     only persisted authoring truth
        |
        v
Lossless CST + SourceIndex                syntax/construction provenance
        |
        v
GeometryDoc / Construction Truth          stable semantic IDs and constraints
        |
        +-------------------+
        |                   |
        v                   v
Interactive RenderingTruth  Exact RenderingTruth
(SVG projection)            (attested TeX -> SVG/PDF artifact)
```

### 3.1 Source truth

- CodeMirror document bytes and its immutable revision are authoritative.
- Canvas, AI, solver, and inspector never persist a parallel canonical scene.
- Every semantic mutation is lowered to a CodeMirror source transaction, then the
  new revision is reparsed and reprojected.
- Untouched ranges remain byte-identical, including comments, whitespace, line
  endings, option order, and unknown macros.

### 3.2 Construction truth

- Construction truth describes mathematical intent and dependency, not TikZ
  rendering commands.
- Stable entity IDs are independent from parser nodes, offsets, array indexes,
  labels, and future CRDT item IDs.
- The construction DAG records definitions, reads, styles, scopes, constraints,
  and unknown effects.
- Invalid source yields a typed invalid projection. A last-valid projection may be
  displayed only as an explicitly stale, read-only historical view.

### 3.3 Rendering truth

- Interactive SVG is a responsive semantic projection, not official TeX truth.
- Exact output is an artifact of a pinned compiler profile, not semantic truth.
- An exact artifact is current only when document ID, epoch, revision, submitted
  source digest, compiler profile, bundle, driver, fonts, and plugin/kernel basis
  all match.

## 4. Canonical runtime architecture

```text
 CodeMirror                     AI                         Canvas
 source transaction      typed mutation proposal       typed tool intent
       |                         |                          |
       +-------------------------+--------------------------+
                                 |
                        Geometry Transaction Broker
                  revision/hash/binding/capability guards
                                 |
                     Mutation Registry + Policy Engine
                                 |
                   Writer Artifact / Source Patch Planner
                                 |
                        CodeMirror transaction
                                 |
                  Lossless parse + projection coordinator
                    /              |                  \
              TikZ CST       Geometry Kernel       Opaque regions
                    \              |                  /
                     Dependency + Constraint Graph
                              /             \
                    Interactive lane      Exact lane
```

There is one mutation path. AI does not replace arbitrary managed body text;
Canvas does not mutate a cached Scene; Code changes do not bypass revision and
projection guards.

## 5. Canonical `GeometryDoc`

```ts
interface GeometryDoc {
  schema: 'geometry-doc/v1';
  basis: {
    documentId: string;
    documentEpoch: number;
    revision: number;
    sourceHash: string;
    kernelHash: string;
    pluginSetDigest: string;
  };
  syntax: {
    roots: SyntaxNodeRef[];
    opaqueRegions: OpaqueSourceRegion[];
    expansions: ExpansionProvenance[];
  };
  construction: {
    entities: Record<string, GeometryEntity>;
    relations: GeometryRelation[];
    constraints: GeometryConstraint[];
    graph: TypedDependencyGraph;
  };
  presentation: ManagedPresentationIR;
  sourceMap: GeometrySourceMap;
  diagnostics: GeometryDiagnostic[];
}
```

Rules:

- `GeometryDoc` is a projection and is always recreatable from source plus the
  pinned plugin set.
- `kernelHash` covers semantic entities/relations/constraints, not transient UI
  selection or preview status.
- `projectionHash` covers a specific renderer projection and is never used as a
  semantic identity.
- Any mutation based on stale basis values is rejected, not rebased silently.

## 6. Lossless TikZ frontend

### 6.1 CST responsibilities

The Lezer parser is an incremental editor parser, not the permanent domain model.
It must preserve or address:

- trivia, comments, whitespace, and line endings;
- commands, environments, scopes, balanced groups, and arguments;
- nested PGF key/value lists without splitting on inner commas;
- path operations and coordinates;
- macro definitions and invocations;
- `\foreach`, graph specifications, and dynamic constructs as syntax even when
  execution meaning is unknown;
- error nodes and recovery spans;
- opaque nodes for unsupported or ambiguous regions.

Lezer `TreeFragment` reuse accelerates parsing. Parser node identity and offsets
must never become persistent entity identity.

### 6.2 Source positions and identity

- `SourceIndex` carries UTF-16 editor offsets, UTF-8 byte offsets, and line/column.
- CodeMirror `ChangeDesc` maps transaction-local ranges.
- Stable semantic IDs are reconciled through owner bindings, structural role,
  fingerprints, and explicit managed markers - not raw offsets.
- Future collaboration may use Yjs relative positions only inside the source
  adapter; geometry UUIDs remain independent.

### 6.3 Macro and expansion provenance

```ts
interface ExpansionProvenance {
  expansionId: string;
  engineProfile: string;
  definitionOrigins: SourceRange[];
  invocationOrigins: SourceRange[];
  argumentOrigins: SourceRange[];
  products: string[];
  status: 'static' | 'executed' | 'opaque' | 'stale';
}
```

A generated entity is writable only when a registered adapter can prove a
reversible definition/invocation/argument mapping. Otherwise it is visible as an
exact or opaque product and remains read-only.

## 7. Official PGF/TikZ registry

### 7.1 Scope and provenance

The registry is generated from a pinned PGF/TikZ 3.1.11a installation/source
checkout. It inventories commands, keys, handlers, libraries, effects, execution
requirements, and provenance.

The current `.code.tex` scan is not equivalent to the whole official language.
The complete inventory manifest must state:

- upstream version, repository, commit SHA, and source-root digest;
- included and excluded path rules;
- scanned file list digest and file count;
- recognized, dynamic, unrecognized, duplicate, and failed-scan counts per file;
- Lua graph drawing, driver/system, manual-only, and generated surfaces as separate
  scopes;
- generator version and schema version.

Dynamic/unrecognized is a valid result; silent omission is not.

### 7.2 Build and delivery topology

The measured `.code.tex` inventory is roughly 14,654 normalized entries and about
27 MB uncompressed, so it must never be imported into a browser or request bundle
as one TypeScript module.

```text
Pinned PGF source / installed bundle
          |
      build-time scanner
          |
  content-addressed JSON shards
          |
       manifest.json
       /          \
  CDN immutable   server-side lazy index/query
                         |
                   bounded capability slice
                   /                     \
                  AI                    Canvas/editor
```

Requirements:

- maximum 512 entries per shard;
- split by status and surface, then deterministic fixed chunks;
- SHA-256 filename and digest over exact UTF-8 shard bytes;
- descriptor includes path, digest, byte size, entry count, status, and surface;
- repeated generation from identical input produces identical filenames and bytes;
- AI and browser receive only bounded, intent-selected slices;
- the root manifest declares completeness and truncation independently.

### 7.3 Runtime capability shape

```ts
interface TikzCapabilityContract {
  id: string;
  provenance: UpstreamProvenance;
  preservation: 'lossless';
  inventory: 'recognized' | 'dynamic' | 'unrecognized';
  semantics: 'plugin' | 'partial' | 'opaque';
  interaction: 'typed-write' | 'read-only' | 'none';
  exactProfiles: ExactPolicyResult[];
}
```

## 8. Geometry semantic plugins

TikZ syntax does not define the kernel object vocabulary. Plugins map source
constructions to geometry and back.

```ts
interface GeometrySemanticPlugin {
  descriptor: PluginDescriptor;
  analyze(input: LosslessSyntaxInput): SemanticProjection;
  capabilities(input: GeometryDoc): WriteCapability[];
  validateMutation(input: GeometryMutation): MutationValidation;
  applyMutation(input: GeometryMutation): WriterArtifact;
  render(input: GeometryDoc): InteractivePrimitive[];
  explain(input: GeometryDoc): AiSemanticContext;
}
```

The active coordinator must compute `pluginSetDigest` from ordered plugin
descriptors and schemas. A plugin set change invalidates old projections and old
transactions.

`Scene` remains only a compatibility projection until all active consumers move
to `GeometryDoc`; it cannot remain a hidden authority for solver, AI, renderer, or
identity.

## 9. Managed schema v3 and Presentation IR

Schema v2 proves canonical plan recovery but cannot preserve user presentation
after semantic recompilation. Schema v3 separates plan core from presentation.

### 9.1 Stable writer-slot ABI

Every `ConstructionPlanKind` compiles to a writer artifact with stable semantic
slot IDs.

```ts
interface ConstructionWriterArtifact {
  writerId: string;
  writerRevision: 1;
  planKind: ConstructionPlanKind;
  semanticFingerprint: string;
  slots: ConstructionWriterSlot[];
}

interface ConstructionWriterSlot {
  id: string;
  role: string;
  source: string;
  semanticFingerprint: string;
}
```

Slot IDs may describe roles such as point definition, helper path, constraint, or
visible output. They must not encode line number, array index, coordinates, or
render status.

### 9.2 `ManagedPresentationIR`

```ts
interface ManagedPresentationIR {
  schema: 'managed-presentation/v1';
  writerId: string;
  writerRevision: number;
  slotPresentation: Record<string, SlotPresentation>;
  attachments: SourceAttachment[];
  opaqueSlots: OpaqueSlot[];
}
```

- `plan-core` stores validated semantic parameters.
- presentation stores options, comments, formatting, and attachments separately.
- slot markers are unique, non-nested, and bound to writer revision.
- semantic edit regenerates semantic slots and merges untouched presentation bytes.
- if an opaque slot overlaps a changed semantic fingerprint, merge rejects with a
  typed conflict; it never drops the opaque source.
- v1/v2/source-adopted migration is explicit and may remain read-only when a
  unique plan/presentation recovery cannot be proven.

AI, Canvas, and Inspector must all use the same hydrator, validator, writer
artifact, presentation merge, and Broker transaction.

## 10. Typed triad transaction protocol

```ts
interface GeometryMutationEnvelope {
  schema: 'geometry-mutation/v1';
  origin: 'code' | 'ai' | 'canvas' | 'inspector' | 'solver';
  basis: GeometryDoc['basis'];
  binding: {
    ownerId: string;
    sourceRanges: SourceRange[];
    capabilityId: string;
  };
  operation: GeometryMutation;
  idempotencyKey: string;
}
```

Broker guards:

1. current document/epoch/revision/source hash;
2. kernel hash and plugin set digest;
3. binding owner and source range integrity;
4. capability and operation compatibility;
5. namespace/name collisions;
6. presentation/opaque overlap;
7. writer self-validation and reparse/reprojection equivalence.

The output is a minimal CodeMirror transaction. After commit, all consumers use
the new projection; no consumer mutates the previous projection in place.

### 10.1 AI contract

- AI reads bounded GeometryDoc facts, capability slices, focused bindings, and
  typed diagnostics - not the entire registry or a guessed Scene.
- Managed content is created/replaced/mutated only through typed proposals.
- Previous plan data is exposed only when canonical recovery is proven.
- Names, labels, scalar expressions, options, and values pass grammar-specific
  validators; arbitrary TikZ control sequences are never interpolated by a plan
  writer.
- Raw source patches are reserved for explicitly unowned/unmanaged ranges and
  still pass Broker guards.

### 10.2 Canvas contract

- Tools emit semantic intents and preview IR, not TikZ strings.
- Pointer move is pure preview; pointer up submits one typed transaction.
- Derived points are not directly assigned coordinates. The solver patches only
  writable upstream driver slots.
- Delete operates on owner/dependency closure with a typed impact preview.

### 10.3 Code contract

- Every CodeMirror change creates a new immutable revision.
- Incremental parse may reuse syntax fragments, but semantic projection is
  revision-scoped.
- Invalid/ambiguous/opaque syntax produces diagnostics and freezes only the
  affected dependency component where possible.

## 11. Dependency graph and solver

### 11.1 Typed graph

Required edge kinds:

- `defines`
- `reads`
- `styles`
- `scope`
- `constraint`
- `unknown-effect`

The same adjacency index drives invalidation, delete impact, AI focus closure,
solver connected components, and conflict diagnostics.

### 11.2 Solver boundary

The current legacy analyze/Scene finite-difference path is transitional. The final
solver consumes Geometry IR directly.

Each constraint plugin declares residuals and either analytic/autodiff Jacobian or
an explicit unsupported status. A solve result includes:

```ts
interface GeometrySolveResult {
  status:
    | 'solved'
    | 'degenerate'
    | 'underconstrained'
    | 'redundant'
    | 'inconsistent'
    | 'non-convergent'
    | 'cancelled'
    | 'unsupported';
  residual: number;
  rank: number;
  degreesOfFreedom: number;
  conflictingConstraintIds: string[];
  iterations: number;
  elapsedMs: number;
  branchTokens: Record<string, string>;
  patches: TypedDriverPatch[];
}
```

Rules:

- solve only the affected connected component;
- determine rank/DoF numerically, not from variable counts;
- preserve intersection/root branch tokens;
- enforce time, iteration, displacement, and cancellation budgets;
- failure preserves last-valid Geometry Truth and writes no NaN/Infinity;
- Cassowary/Kiwi may serve linear UI/layout constraints, not the nonlinear
  Euclidean geometry kernel.

## 12. Exact TeX execution contract

### 12.1 Source identity

The exact entry point may reject source but may not trim, canonicalize, sanitize,
comment out, or replace it.

Attestation must distinguish:

```ts
interface ExactSourceAttestation {
  submittedSourceDigest: string;
  executedSourceDigest: string;
  wrapperDigest: string;
  compilerImageDigest: string;
  pgfBundleDigest: string;
  engine: string;
  driver: string;
  fontBundleDigest: string;
  securityProfileDigest: string;
}
```

For the ordinary exact lane, `submittedSourceDigest === executedSourceDigest`.
The standalone document wrapper is a separately attested envelope and must not be
confused with user source identity. If a future explicit migration transforms
source, that transformation is first committed as a visible CodeMirror
transaction.

### 12.2 Security policy

- security is enforced by isolated process/container policy, cached immutable
  bundles, no network, no shell escape, file-system constraints, resource limits,
  timeouts, and output validation;
- blocked operations return `blocked-by-policy` with command/family/profile;
- legal macros and `\usetikzlibrary` are not silently removed;
- profiles declare installed libraries, engine, driver, fonts, and blocked
  families;
- Lua graph drawing, externalization, file-dependent plots, drivers, and specials
  are profile-dependent and never advertised as universally exact;
- generated SVG is treated as untrusted active content and accepted only through
  the artifact safety/integrity boundary.

### 12.3 Exact artifact projection

Exact artifacts enter RenderingTruth with full basis and provenance. Stale
artifacts are historical previews only. Differences between interactive and exact
output are presented as capability/profile diagnostics rather than allowing one
lane to overwrite the other.

## 13. ECS + CDN topology

```text
CDN
  - Next static assets
  - immutable registry manifest/shards
  - public immutable exact artifacts only when policy permits

ECS web service
  - Next.js UI/API
  - auth/rate limits
  - typed AI/geometry broker
  - server-side registry query/cache

ECS exact compiler service
  - private network endpoint
  - authenticated jobs
  - immutable compiler image and PGF/font bundle
  - isolated ephemeral workers
  - artifact store + attestation
```

The browser never downloads the full PGF inventory. Compiler credentials and
provider API keys remain server-side. CDN objects are content-addressed and safe
to cache; private exact artifacts are not placed in a public cache namespace.

## 14. Failure semantics

Every lane uses typed failures. Required families include:

- `stale-basis`
- `source-conflict`
- `opaque-barrier`
- `unsupported-semantics`
- `read-only-capability`
- `invalid-plan`
- `writer-revision-mismatch`
- `presentation-conflict`
- `namespace-conflict`
- `degenerate-geometry`
- `constraint-conflict`
- `non-convergent`
- `blocked-by-policy`
- `compiler-profile-missing`
- `exact-artifact-stale`
- `registry-incomplete`

No failure path may return old geometry as if it were current, silently rewrite
source, drop unknown syntax, or let AI guess missing semantic parameters.

## 15. Implementation order and gates

### Phase A - correctness blockers

1. freeze this five-lane support vocabulary in registry, API, prompt, and UI;
2. remove exact-lane source mutation and attest submitted/executed source identity;
3. close schema-v2 AI codec string/primitive-kind validation blockers;
4. finish deterministic sharded official inventory and completeness manifest.

Gate: no silent source mutation; no managed raw-body AI write; every capability
reports all five lanes.

### Phase B - lossless managed round trip

1. finish stable writer artifacts for all ConstructionPlan kinds;
2. add schema-v3 plan-core, slot markers, reader, and self-validating writer;
3. implement ManagedPresentationIR and opaque-safe merge;
4. migrate Canvas, AI, and Inspector to the same typed mutation registry.

Gate: semantic edit preserves comments/options/CRLF/unknown attachments or rejects
with a typed conflict.

### Phase C - active semantic kernel

1. activate plugin coordinator and computed plugin-set digest;
2. make GeometryDoc primary and demote legacy Scene to compatibility projection;
3. build typed dependency graph and component invalidation;
4. connect renderer, hit-test, AI context, and delete impact to stable semantic IDs.

Gate: Code, AI, and Canvas produce equivalent kernel state for the same semantic
operation.

### Phase D - provenance and solver

1. add multi-range source map and macro expansion provenance;
2. keep non-reversible execution products opaque/read-only;
3. move nonlinear solving to Geometry IR connected components;
4. patch only writer-owned upstream driver slots.

Gate: drag/constraint failures are deterministic and never corrupt source.

### Phase E - exact truth and product validation

1. attach exact artifact to RenderingTruth and SourceMap;
2. publish compiler policy matrix and immutable profile digests;
3. execute product-owned unit/property/integration/isolation/browser/performance/
   ECS/rollback gates;
4. only then resume UI/Figma/Apple interaction and motion design.

## 16. Definition of done

The architecture goal is complete only when:

- every in-scope official upstream file is represented in the inventory manifest
  by recognized/dynamic/unrecognized/failed-scan evidence;
- any untouched TikZ/PGF source round-trips byte-for-byte;
- any dynamic/unknown region is preserved and never falsely advertised as Canvas
  editable;
- every interactive capability has a registered semantic analyzer, typed mutation,
  writer, self-validation, renderer, hit-test, AI description, and exact policy;
- AI, Canvas, Inspector, and Code converge through one Broker and one source
  transaction path;
- schema-v3 semantic edits preserve presentation or fail closed;
- solver and delete operate on the same typed dependency graph;
- exact compiler proves source identity and pinned-profile artifact provenance;
- browser validation covers create, select, drag, constrained point, delete,
  semantic AI edit, manual code edit, conflict, opaque preservation, and exact/
  interactive comparison;
- ECS/CDN deployment preserves private/public artifact separation and immutable
  registry delivery.

It is explicitly **not** required or honest to claim that arbitrary TeX macro
programs are statically invertible or that every official PGF/TikZ construct is
Canvas-draggable. The product guarantee is stronger and precise: full source
fidelity, exhaustive inventory with provenance, profile-attested exact execution,
and complete triad reversibility for every capability that declares a writable
semantic adapter.

## 17. Primary references

- PGF/TikZ upstream: <https://github.com/pgf-tikz/pgf>
- PGF/TikZ 3.1.11a release commit: <https://github.com/pgf-tikz/pgf/commit/839974a3f895bfb86f5a8bc155f0886c918f1bff>
- Official online manual: <https://tikz.dev/>
- PGF key management: <https://tikz.dev/pgfkeys>
- `foreach` execution surface: <https://tikz.dev/pgffor>
- Lezer incremental parsing: <https://lezer.codemirror.net/docs/ref/>
- CodeMirror state/transactions: <https://codemirror.net/docs/ref/>
- GeoGebra source architecture: <https://github.com/geogebra/geogebra>
- Tectonic source: <https://github.com/tectonic-typesetting/tectonic>
