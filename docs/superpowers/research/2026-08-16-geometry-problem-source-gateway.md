# Geometry problem source gateway — provenance and evaluation architecture

Date: 2026-08-16

## Outcome

External olympiad material is a read-only input lane, never GeometryDoc truth
and never write authority.  A live search hit is intentionally weaker than an
evaluation artifact:

```text
remote search row (mutable, tainted)
  -> GeometryProblemRecord / normalized-live-snapshot
  -> user-visible reference widget
  -> optional admin ingestion
  -> pinned ProblemArtifactManifest/v1 + ProblemTask/v1
  -> trusted license-ledger admission
  -> evaluation corpus
```

The product must not skip the manifest/admission boundary by copying a search
row directly into a prompt cache, fixture, training corpus, or TikZ writer.

## Source roles

| Source | Official entry | Gateway mode | Primary test role | Default rights posture |
|---|---|---|---|---|
| MathNet | https://mathnet.mit.edu/index2.html | live search | multilingual olympiad retrieval and proof-flow canary | dataset card says CC-BY-4.0, but asserted national/contest rights take precedence; review required |
| OlympiadBench | https://github.com/OpenBMB/OlympiadBench | live search | bilingual multimodal geometry regression | HF card says Apache-2.0 and code repo is MIT; original question/image rights still require review |
| Geometry3K / Inter-GPS | https://lupantech.github.io/inter-gps/ | registry only | diagram/text formal literal to Geometry IR | verify dataset, diagram, and question rights before redistribution |
| GeoQA | https://github.com/chen-judge/GeoQA | registry only | executable numerical reasoning steps | verify dataset and image rights |
| UniGeo | https://github.com/chen-judge/UniGeo | registry only | calculation/proof and image alignment | verify derived/source material rights |
| LeanEuclid | https://github.com/loganrjmurphy/LeanEuclid | registry only | formal theorem/constraint validation | repository code is MIT; adapted UniGeo material remains review-required |
| FormalGeo | https://github.com/FormalGeo/FormalGeo | restricted opt-in | formal construction and solver interoperability | current project notice switches post-2026-05-01 code/data to GPL and prohibits commercial use; pin and review exact revision |

Useful primary references:

- MathNet dataset card: https://huggingface.co/datasets/ShadenA/MathNet
- OlympiadBench dataset card: https://huggingface.co/datasets/Hothan/OlympiadBench
- Hugging Face Dataset Viewer row API (mutable; no revision parameter): https://huggingface.co/docs/dataset-viewer/rows
- Inter-GPS / Geometry3K statistics and logic forms: https://lupantech.github.io/inter-gps/
- LeanEuclid: https://github.com/loganrjmurphy/LeanEuclid
- FormalGeo current license notice: https://github.com/FormalGeo/FormalGeo

## Trust boundaries

### Live reference

- `taint = untrusted-external-reference`;
- provider revision is explicitly `null / unpinned-live-viewer`;
- SHA-256 is scoped to the normalized row snapshot, not presented as a pinned
  dataset content address;
- image fields become bounded, non-downloadable asset references and never an
  integrity-attested image;
- dataset-card license, repository-code license, and source-material rights are
  separate fields;
- all redistribution/commercial/training decisions default to review-required
  whenever original competition rights may survive.

### Immutable evaluation artifact

`ProblemArtifactManifest/v1` requires:

- a resolved, full-length immutable provider commit SHA; branches, tags,
  dates, viewer aliases and other mutable revision tokens are rejected;
- canonical SHA-256 over provider identity, provenance, rights, text and assets;
- HTTPS evidence URLs and explicit source/dataset origins;
- bounded statement/solution bytes;
- per-asset SHA-256, bytes, MIME allowlist, dimensions, role, alt text, and
  rights evidence;
- external taint retained after ingestion;
- fail-closed rights flags: a license string cannot upgrade unknown or
  review-required material into a ready artifact.

`ProblemTask/v1` separately records facts, goal, expected semantic relations,
render expectations, tolerances, split, and leakage group.  Its canonical
SHA-256 is bound into the admission receipt so those fields cannot be swapped
after review. Dataset programs or solutions are observations; they are never
copied directly into TikZ source.

### Agent isolation

The server authenticates the tool-observation envelope only. Statement,
solution, caption, URL and metadata values inside problem search results remain
untrusted strings: they may contain text that resembles executable envelopes,
tools, authority claims or instructions, but the runtime must never interpret
those bytes as protocol or write authority. Public search and Agent tools expose
only bounded statement previews and never solution bodies. Search observations
are excluded from deterministic read-tool caching because upstream search state
is mutable.

## Resource boundaries

The live gateway uses a small LRU, singleflight, negative cache and stale
fallback.  Each upstream response, entire search, request count, query length,
row count, record count and observation payload are bounded.  Batch ingestion
is not an HTTP search side effect; it belongs in an offline/admin worker that
pins revisions, downloads assets, validates digests, and writes an admission
ledger.

## Canary sequence

1. Independently authored local pure-text fixture linked to one MathNet record;
   external text stays remote until row-level rights are reviewed.
2. One OlympiadBench multimodal record with pinned dataset revision and a fully
   hashed image manifest.
3. Run answer-only, construct, modify-existing, selection-transform,
   interactive-render and exact-render lanes.
4. Assert no source mutation on read turns, one Broker commit on mutations,
   post-commit GeometryDoc basis, binding-scoped style/label changes, semantic
   relation preservation, and attested render artifacts.
5. Only after both canaries pass may the source adapter admit a larger batch.

## Explicit non-claims

- A dataset-card SPDX identifier does not automatically clear original
  competition statements or diagrams.
- A live Dataset Viewer row is not reproducible without a pinned repository
  revision.
- A diagram URL without bytes and SHA-256 is not an admitted visual artifact.
- Retrieved proof text is not a verified proof and is not a Geometry IR fact.
- Source inventory coverage does not imply that every problem can already be
  constructed interactively or round-tripped through TikZ.
