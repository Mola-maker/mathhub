# Exact TikZ attestation second static review

- Review date: 2026-07-29
- Baseline: `.omo/evidence/exact-attestation-review.md`
- Scope: current working-tree versions of compiler artifact/provenance/worker/API/job store, Web compiler client, render routes, browser hook, compose/Docker packaging, and related tests.
- Execution boundary: static inspection only. No test, build, lint, Docker, compiler, browser, Redis, or OSS command was run.
- Skill perspective: `remove-ai-slops` and `programming` are still not available in the exposed skill catalog. I manually applied their requested criteria. The new tests are substantially more relevant than the first version, but the production Worker duplicates both provenance checks around the shared helper, and the test suite does not cover runtime image packaging or actual-image binding.

## Verdict

- `codeQualityStatus`: **BLOCK**
- `recommendation`: **REQUEST_CHANGES**

H2, M1, M2, and L2 are closed in the current source. L1's original unchecked-cast problem is closed, with a small residual validation-drift risk. H1 remains open because the claimed image digest is still an operator-provided environment string rather than the actual container image reference. A new packaging blocker also prevents both compiler images from starting: `provenance.mjs` is imported but not copied into either Docker stage.

## Previous finding status

| Finding | Status | Static evidence |
|---|---|---|
| H1 Worker/source provenance binding | **OPEN** | Worker now verifies `result.sourceHash` and uses digest-namespaced Redis, but its “observed” image digest is only `COMPILER_WORKER_IMAGE_DIGEST`; it is not bound to the actual `image:` reference. `provenance.mjs` is also absent from both Docker stages. |
| H2 public/private OSS metadata collision | **CLOSED** | Keys are `tikz/v1/{public|private}/<artifactDigest>.svg`, visibility is checked, local publishing uses link/create-only semantics, and OSS sends `x-oss-forbid-overwrite: true`. |
| M1 source/cache/job binding | **CLOSED** | POST responses are checked against the Web-computed source digest, status response IDs must equal the requested ID, visibility is attested, and cache/job digest is recomputed. |
| M2 attested bytes transformed after verification | **CLOSED** | Web now verifies that canonical sanitization is idempotent and returns the decoded attested bytes unchanged. |
| M3 negative test coverage | **PARTIALLY CLOSED** | Source/job/header/content/size/unsafe-artifact, provenance, namespace, local immutability, and OSS create-only cases were added. Runtime packaging, actual-image binding, cache-key mutation, stale completion, and OSS metadata validation are still uncovered. None were run in this review. |
| L1 unchecked browser attestation cast | **CLOSED with LOW residual** | Hook now validates the full schema shape and digest formats before storing the attestation. It does not recompute the cache formula or bind source digest to the local code, but the server remains the integrity boundary. |
| L2 lost route error codes | **CLOSED** | Both render routes return a safe typed `code` field from `TikzCompileError`. |

## CRITICAL

None.

## HIGH

### H1. The claimed Worker image digest is still not the actual runtime image identity

**References**

- `services/tikz-compiler/provenance.mjs:7-24,36-50`
- `services/tikz-compiler/worker.mjs:11-14,51-59,82-83`
- `deploy/ecs/compose.production.yaml:43,75,79`

The new Worker check proves only that the API job and Worker process received the same `COMPILER_WORKER_DIGEST` environment value. `COMPILER_WORKER_IMAGE` independently chooses the actual container image. A deployment can still set:

```text
COMPILER_WORKER_IMAGE=repo@sha256:<B>
COMPILER_WORKER_DIGEST=sha256:<A>
```

Both API and Worker will route, compile, and attest image A while code from image B executes. Digest-namespaced Redis prevents API/Worker environment mismatches, and the Worker-observed source check is correct, but actual image provenance remains an operator convention rather than an enforced invariant.

**Required correction**

Use one immutable image-reference value as the source for both `image:` and the in-container provenance value, with parsing/normalization of its `@sha256:` suffix, or add a deployment-generation/entrypoint gate that compares the configured claim against trusted ECS/task-definition metadata. The production deployment artifact must make a divergent image reference and claimed digest unrepresentable or fail before accepting jobs.

### H3. `provenance.mjs` is missing from both compiler Docker images

**References**

- `services/tikz-compiler/server.mjs:6-9`
- `services/tikz-compiler/worker.mjs:5-9`
- `services/tikz-compiler/Dockerfile:17-22,63-68`

Both runtime entrypoints import `./provenance.mjs`, but neither the API-stage `COPY` nor Worker-stage `COPY` includes that file. The images can build because the entrypoints are not executed during those copy steps, but both containers will fail at startup with module resolution failure. Consequently the exact compiler is not deployable in the reviewed state.

**Required correction**

Copy `services/tikz-compiler/provenance.mjs` into both stages and add a packaging/startup smoke gate that imports or starts each final stage. This must be verified by the product owner under the no-Docker-testing instruction.

## MEDIUM

### M3. Tests improved materially but still miss the production failure surfaces

**References**

- `lib/tikz/exact/compile-tikz.test.ts:117-219`
- `services/tikz-compiler/provenance.test.mjs:7-35`
- `services/tikz-compiler/artifact-store.test.mjs:13-74`
- `package.json` script `test:compiler`

The new tests are not deletion-only, tautological, or prompt-string tests; they target real boundaries. However:

- the provenance helper test cannot detect that `provenance.mjs` is omitted from the images;
- no test/assertion binds `COMPILER_WORKER_IMAGE` to `COMPILER_WORKER_DIGEST`;
- no attestation case mutates visibility/image/source while preserving a stale cache key to prove cache formula rejection;
- no Redis/job-store test covers stale-attempt completion or the second provenance guard in `completeJob`;
- the OSS test mocks a 409 with matching bytes but does not cover mismatched existing bytes or metadata.

This is incomplete evidence rather than useless test volume. Add the missing high-value gates; do not add more tests that merely mirror constants.

### M4. OSS duplicate handling validates bytes but not publication metadata

**References**

- `services/tikz-compiler/artifact-store.mjs:168-201`

`x-oss-forbid-overwrite: true` correctly prevents replacement. On `FileAlreadyExists`, the code fetches and compares bytes, but it does not validate existing `Cache-Control`, content type, or ACL. Namespace isolation prevents the former public/private race during normal writes, but a pre-existing or manually created object with correct bytes and wrong public/private metadata will be accepted and returned as successfully published.

Use `HEAD`/metadata inspection on the conflict path and fail closed when cache/ACL/content-type policy does not match the namespace.

### M5. ECS/CDN documentation still describes the obsolete key layout

**References**

- `deploy/ecs/README.md:51`
- `services/tikz-compiler/README.md:88,137`
- current implementation: `services/tikz-compiler/worker.mjs:74-77`

Documentation still names `/tikz/v1/<sha256>.svg`, while the implementation now uses `/tikz/v1/public/<sha256>.svg` and `/tikz/v1/private/<sha256>.svg`. A CDN configured from the documented wildcard can either miss public artifacts or accidentally include the private namespace in a public cache rule.

Update the deployment contract so only `/tikz/v1/public/<sha256>.svg` is CDN-cacheable and the private namespace is never a public CDN behavior.

## LOW

### L1. Browser validation is structural but weaker than the server validator

**References**

- `components/tikz/use-exact-tikz-render.ts:32-60`
- `lib/tikz/exact/compile-tikz.ts:157-201`

The hook validates fields and formats, closing the original unchecked cast. Unlike the server validator, it does not recompute the cache-key digest. This is acceptable while Next.js is the integrity boundary, but the duplicated validators can drift. Prefer a shared browser-safe schema plus an explicit statement that artifact byte verification occurs server-side.

### L3. Worker repeats the shared provenance checks

**References**

- `services/tikz-compiler/worker.mjs:51-66`
- `services/tikz-compiler/provenance.mjs:36-50`

The Worker checks image and source both inline and through `assertWorkerProvenance`. This is needless production duplication and makes the helper tests less representative of the actual path. Keep one post-render helper call; the digest-namespaced queue already handles pre-render image routing.

## Positive observations

- Source, cache-key, job, and artifact digests now form a consistent formula at the API and Web boundaries.
- The Worker passes its observed source hash into terminal completion, and `completeJob` rejects provenance disagreement before constructing the attestation.
- Redis prefixes are image-digest namespaced, preventing mixed Worker versions from consuming the same queue when their configured digests differ.
- Public/private object namespaces and create-only OSS writes close the prior cache metadata overwrite race.
- Local artifact publication no longer uses replace-on-rename semantics.
- The Web verifies header digest, raw bytes, size, and canonical safety, then returns the exact decoded attested bytes rather than a transformed payload.
- Error codes are preserved through both Next routes.
- New negative tests focus on actual boundary failures and are registered by the existing compiler/Vitest scripts.

## Blockers

1. Include `provenance.mjs` in both final compiler images.
2. Bind the attested Worker digest to the actual immutable runtime image reference, not merely a second environment variable.
3. Product-owner verification must cover final-stage startup/import and the new negative suites; no such commands were run during this static review.

## Evidence snapshots

- `services/tikz-compiler/artifact-store.mjs` — `db207557c6af1766257a59058504e4be6bc5b692ecda2b0751d79a6cd82350db`
- `services/tikz-compiler/provenance.mjs` — `cb1ee5f2728f4868cf31b953ac349bdedeffd689778f85de6906b7b1bcf0431e`
- `services/tikz-compiler/worker.mjs` — `6e970322d4cd444be99df3a42bac0f5f6aa24b2d8348199c6596899f92163b49`
- `services/tikz-compiler/server.mjs` — `8e98dc4ca2204afdaf1ca386f817ca1cfd620bb78bc31e76475b92dd295db1bd`
- `services/tikz-compiler/job-store.mjs` — `76b20ba156d924449458d2755c15f7e9161147aa2bc3d685233fa911cd5367d6`
- `lib/tikz/exact/compile-tikz.ts` — `4ed6ecb249e9d42d7df04689f0f1bbc34b1b13a0c17109601623cf4e8d4eca79`
- `components/tikz/use-exact-tikz-render.ts` — `14cfe4c9d0fdc5c314dc7745122910bd92db839a40a0731b118d32fee079f3ab`
- `deploy/ecs/compose.production.yaml` — `09efdd957e28ddd0456fc1dad4aeaeeb32a248b2e21917697395b14414ce1d56`
- `lib/tikz/exact/compile-tikz.test.ts` — `edc085c663d1753a8110188e2819aee7c85f968920698e415430de0374cfc5f1`
- `services/tikz-compiler/provenance.test.mjs` — `28c69bcd4d7435f7f660353d7f1b0956946d7e37506fa9a37b6d0b7c333c4707`
- `services/tikz-compiler/artifact-store.test.mjs` — `e4d0d1af15f817ed8475d80e7e10c7fa2bca90802628ef3b9c32f2984b9b62bf`
