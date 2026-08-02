# Exact TikZ attestation third static review

- Review date: 2026-07-29
- Baselines:
  - `.omo/evidence/exact-attestation-review.md`
  - `.omo/evidence/exact-attestation-second-review.md`
- Scope: latest compiler provenance, artifact storage, Docker/Compose packaging, attestation client/routes/hook, docs, retention policy, and newly added tests.
- Execution boundary: static inspection only. No tests, build, lint, Docker, Redis, OSS, compiler, or browser command was run.
- Skill perspective: `remove-ai-slops` and `programming` are not available in the exposed skill catalog. I manually applied the requested criteria. The new boundary tests are relevant, but `packaging.test.mjs` is a brittle text-count assertion and it omits the local Compose/runtime compatibility that currently fails.

## Verdict

- `codeQualityStatus`: **BLOCK**
- `recommendation`: **REQUEST_CHANGES**

The production ECS attestation design is now coherent: one immutable Worker image reference selects the actual image and supplies the proof input; source/cache/job/artifact bindings remain intact; public/private content namespaces and create-only OSS writes are correct; existing-object bytes and publication metadata are checked; delivered SVG bytes are not transformed after attestation.

However, the repository's local compiler Compose cannot start in the reviewed state. Both final images set `NODE_ENV=production`, while local Compose supplies a `dev-*` image identifier that production provenance parsing explicitly rejects. This is a deterministic runtime blocker and prevents approval of the complete compiler delivery.

## Previous finding status

| Finding | Status | Evidence |
|---|---|---|
| First review H1 / second review H1 actual Worker provenance | **CLOSED for production Compose** | `COMPILER_WORKER_IMAGE_REF` is the single value used by `image:` and both API/Worker environments; production parsing accepts only `repository@sha256:<64 hex>` and derives the attested digest. |
| First review H2 public/private OSS collision | **CLOSED** | Visibility namespaces, visibility checks, create-only OSS/local writes, byte equality, and metadata/ACL equality are enforced. |
| First review M1 source/cache/job binding | **CLOSED** | Web source digest check, response-ID equality, visibility in attestation, and cache-key recomputation remain present. |
| First review M2 second SVG transformation | **CLOSED** | Web performs fail-closed canonical-safety comparison and returns the decoded attested bytes unchanged. |
| First review M3 test evidence | **PARTIALLY CLOSED** | Provenance parsing, packaging text, cache mutation, namespace, create-only behavior, and metadata mismatch cases were added. Local Compose compatibility and real image startup remain uncovered; none of the tests were executed in this review. |
| First review L1 browser cast | **CLOSED with LOW residual** | Full field/format validation is present; server remains the byte-integrity boundary. |
| First review L2 error code loss | **CLOSED** | Both routes preserve typed error codes. |
| Second review H3 missing `provenance.mjs` in images | **CLOSED** | Both Docker stages copy `provenance.mjs`. |
| Second review M4 existing OSS metadata unchecked | **CLOSED** | Conflict path now checks content type, cache-control, and ACL after byte equality. |
| Second review M5 stale CDN path docs | **CLOSED** | Docs now restrict CDN caching to `/tikz/v1/public/<sha256>.svg` and explicitly exclude `/private/`. |
| Second review L3 duplicate Worker checks | **CLOSED** | Worker uses one shared `assertWorkerProvenance` call. |

## CRITICAL

None.

## HIGH

### H4. Local compiler Compose is incompatible with production-only provenance parsing

**References**

- `services/tikz-compiler/Dockerfile:25-32,83-90`
- `services/tikz-compiler/compose.yaml:20-28,50-57`
- `services/tikz-compiler/provenance.mjs:8-24,27-39`
- `services/tikz-compiler/README.md` local Compose instructions

Both final compiler images set `NODE_ENV=production`. Local Compose does not override that value and supplies:

```yaml
COMPILER_WORKER_IMAGE_REF: dev-tectonic-0.17.0-dvisvgm
```

At startup, both `server.mjs` and `worker.mjs` call `compilerWorkerImageDigest()`. In production mode, `workerImageDigestFromReference()` accepts only `repository@sha256:<64 hex>`, so both processes throw before connecting to Redis or listening.

This is not an unverified Docker concern; it follows directly from the environment and parser branches. The documented local compiler startup path is unusable.

**Required correction**

For the local development Compose only, explicitly set `NODE_ENV=development` for API and Worker, or provide a separate explicit development-mode provenance switch that cannot be enabled by production Compose. Add a static/local-config test that covers the Dockerfile default plus Compose override, then let the product owner run the actual container startup gate.

## MEDIUM

### M6. Packaging test is implementation-mirroring and misses runtime compatibility

**References**

- `services/tikz-compiler/packaging.test.mjs:5-33`

The test counts textual occurrences of `provenance.mjs` and `${COMPILER_WORKER_IMAGE_REF...}`. It caught the previous omission conceptually, but it can pass if occurrences move into comments or the wrong stage, and it does not evaluate inherited Docker `ENV` values against either Compose file. The current local startup blocker demonstrates the false-confidence gap.

Keep a lightweight static test if Docker execution remains product-owner-only, but parse stage/service blocks or assert the exact local/production environment contracts rather than only counting substrings.

### M7. OSS conflict validation adds an operational permission dependency

**References**

- `services/tikz-compiler/artifact-store.mjs:199-238`
- `services/tikz-compiler/README.md:66-82`

The duplicate-object path now calls both `head()` and `getACL()`. That correctly fails closed on wrong metadata, but production RAM/STS policy must include the corresponding object metadata and ACL read permissions. The docs discuss least privilege and STS but do not enumerate this new requirement. A policy that previously allowed only Put/Get object operations will fail whenever an identical content-addressed object already exists.

Document the exact OSS actions required by API and Worker separately, and include duplicate-object behavior in the product-owner OSS smoke checklist.

## LOW

### L4. Browser validator remains a second, weaker attestation implementation

**References**

- `components/tikz/use-exact-tikz-render.ts:32-60`
- `lib/tikz/exact/compile-tikz.ts:157-201`

The hook validates schema and digest formats but does not recompute the cache formula as the server does. This is acceptable because the Next server verifies artifact bytes and attestation semantics, but a shared browser-safe schema would reduce drift.

### L5. Exact OSS metadata equality may be provider-normalization sensitive

**References**

- `services/tikz-compiler/artifact-store.mjs:215-238`

Content type and cache-control are compared as exact strings. This is safe and fail-closed, but an OSS SDK/service that normalizes case, whitespace, or omits `charset=utf-8` could reject a correctly created object on the duplicate path. Product-owner OSS verification should confirm the actual `head()` response shape and normalization for `ali-oss 6.23.0`.

## Positive observations

- Production Compose now makes divergent Worker image and proof inputs unrepresentable: the same immutable reference drives all three uses.
- Production provenance parsing extracts only a valid `sha256:<64 hex>` from a complete immutable repository reference.
- API and Worker Redis queues remain image-digest namespaced.
- Worker source provenance is checked once through the shared helper; completion again guards source/image values before attestation construction.
- `provenance.mjs` is copied into both final Docker stages.
- Public/private object namespaces and `x-oss-forbid-overwrite: true` eliminate the earlier last-writer metadata race.
- Existing OSS objects are accepted only after byte, content-type, cache-control, and ACL equality.
- Documentation now separates public/private CDN paths and records artifact retention/garbage-collection policy.
- Cache-input mutation, source mismatch, response-ID mismatch, header/content/size mismatch, unsafe artifact, provenance mismatch, namespace separation, immutable conflict, and OSS policy mismatch all have focused static test cases.
- Web returns the exact decoded bytes whose digest was verified; canonical sanitization is now a rejection check rather than a transformation.

## Blockers

1. Make local `services/tikz-compiler/compose.yaml` compatible with the provenance mode inherited from the final images.
2. Add static coverage for the local Compose/Docker environment contract.
3. The product owner must still execute the registered suites and final API/Worker startup checks; this static review did not run them.

## Evidence snapshots

- `services/tikz-compiler/Dockerfile` — `e1e597514bf6bc51ef6fda2c5649b84afb7638b7ec9c379f186b9b4a172f5090`
- `services/tikz-compiler/provenance.mjs` — `8568634350bc59b3e50d62d962a27211886dbcdb56265022a8556756c3539e3f`
- `services/tikz-compiler/worker.mjs` — `7f0a21cbba4c5b406c6081434dc4d69b7b1780f3ea211a859c732950b86b5f9a`
- `services/tikz-compiler/artifact-store.mjs` — `4cd0f141f68d3e33cd5969f2b38ebd1baa958aff941b42a1b3eed2be0d36d4f2`
- `deploy/ecs/compose.production.yaml` — `d6158312af0172200c22207a90e449e9a42eee34b10fc07155e482d48f9ead7c`
- `services/tikz-compiler/compose.yaml` — `13a904c920a502636b143447e9ba6a9f5eab0d4fb0ed8f201b7810a5f6939633`
- `services/tikz-compiler/provenance.test.mjs` — `8fae4563340bc2fe1fa65af7e321c5963006aecbd6c6154f632890248408a489`
- `services/tikz-compiler/artifact-store.test.mjs` — `64a550c5fb720e94617b17269e04ddd4431ac3bdfa3f0a47614f72905c1e7483`
- `services/tikz-compiler/packaging.test.mjs` — `9e9f28b365c3887491ccfb75f0beae19024b7ae52e836d0f67e9abe02e5423bf`
- `lib/tikz/exact/compile-tikz.test.ts` — `21b3a3b826e493715d172c812c421759dd668336ba29baed6ec29648dc1f7f5b`
- `deploy/ecs/README.md` — `584c05cfc856ceec6a161ac0f9ebf3f7e012b128fabf93cf811a8fd3852d6561`
- `services/tikz-compiler/README.md` — `d39ef931d22f6ecc42c93ecb08cc93deadae04571acf202fb889442f12035d3b`
