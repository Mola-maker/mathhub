# Exact TikZ compiler attestation code review

- Review date: 2026-07-29
- Scope: `services/tikz-compiler/{server,worker,job-store,artifact-store}.mjs`, `lib/tikz/exact/compile-tikz.ts`, both `/api/tikz/render` routes, `components/tikz/use-exact-tikz-render.ts`, and ECS/compiler compose/runtime configuration.
- Review mode: static, read-only review. No tests, build, lint, compiler process, Docker, or browser verification was run, per task constraints.
- Diff caveat: the reviewed attestation files are untracked in the current dirty worktree, so Git cannot provide a meaningful base diff. Findings apply to the current file snapshots listed under Evidence.
- `remove-ai-slops` / `programming` perspective: the named skills were not available in the exposed skill catalog. I manually applied the requested criteria. The production design is generally purposeful, but the single happy-path attestation test mirrors implementation constants and gives false confidence about source/provenance validation; the duplicated SVG sanitizer is also needless drift risk. These are recorded below.

## Verdict

- `codeQualityStatus`: **BLOCK**
- `recommendation`: **REQUEST_CHANGES**

The source digest, cache-key digest, and artifact-content digest are separated coherently, and raw artifact bytes are hashed both at compiler egress and Web ingress. However, the attestation currently proves only that the API copied its own configuration into a Redis record. It does not bind the claimed compiler image or claimed source digest to what the Worker actually executed. Public and private publications can also overwrite the same OSS key with conflicting cache metadata. Those defects block approval for ECS/OSS/CDN production use.

## CRITICAL

None.

## HIGH

### H1. Worker-observed provenance is not bound to the attestation

**References**

- `services/tikz-compiler/server.mjs:10-14,123-141`
- `services/tikz-compiler/worker.mjs:43-63`
- `services/tikz-compiler/job-store.mjs:308-324`
- `services/tikz-compiler/compiler-core.mjs:339-343`
- `deploy/ecs/compose.production.yaml:36-43,74-83`

The API derives the job/cache identity from `COMPILER_WORKER_IMAGE_DIGEST`, stores that string on the job, and `completeJob` later copies it into the attestation. The Worker neither receives nor verifies that claimed digest. The production compose separately selects `COMPILER_WORKER_IMAGE` and supplies `COMPILER_WORKER_DIGEST`; nothing enforces that they identify the same image. A typo, stale deployment variable, mixed Worker pool, or rolling deployment can therefore compile with image B while the attestation claims image A and while the cache key remains in image A's namespace.

There is a second missing binding in the same path: `createCompiler().render()` returns its Worker-observed `sourceHash`, but `worker.mjs` ignores it and the attestation uses the API-side `job.sourceDigest`. If API and Worker validation/normalization versions drift, the attestation can name source bytes different from those actually compiled.

This is a provenance correctness failure, not merely missing hardening.

**Required correction**

Bind queue routing and completion to Worker-observed identity. At minimum:

1. give each Worker its immutable image digest and reject jobs whose claimed digest differs;
2. validate a production digest format and remove the production-capable `dev-*` fallback;
3. compare `result.sourceHash` with `job.sourceDigest` before artifact publication;
4. make completion store the Worker-observed compiler/source values, with the atomic attempt check still authoritative;
5. define rollout behavior for heterogeneous Worker versions, preferably digest-namespaced queues.

### H2. Public and private artifacts mutate the same OSS object metadata

**References**

- `services/tikz-compiler/worker.mjs:48-55`
- `services/tikz-compiler/artifact-store.mjs:16-18,138-158`
- `services/tikz-compiler/server.mjs:122-132,189-199`

The job/cache key includes `visibility`, but the object key is only `tikz/v1/<artifactDigest>.svg`. `OssArtifactStore.put()` unconditionally uploads that key and chooses `Cache-Control` and ACL from the current job's visibility.

For equal SVG bytes, a private job and public job address the same object. The last upload wins:

- a private render can replace a public object's immutable cache metadata with `private, no-store`;
- a public render can replace private object metadata and, when public ACL is enabled, its ACL;
- concurrent uploads make publication policy nondeterministic even though the path is presented as immutable.

Identical content does not resolve the cache-policy race. An immutable content object must not be rewritten to change its publication class.

**Required correction**

Use separate immutable publication namespaces (for example, private and public keys containing the same artifact digest), or keep one private canonical object and create a distinct, immutable public publication/copy record. Use conditional create/metadata semantics rather than unconditional overwrite. CDN paths must map only to the public namespace; private retrieval must remain authenticated and `no-store`.

## MEDIUM

### M1. Web validation does not bind a succeeded job to the source requested by the Web layer

**References**

- `lib/tikz/exact/compile-tikz.ts:153-181,251-275,278-293`
- `app/api/tikz/render/[jobId]/route.ts:40-80`

`validAttestation()` checks only the shape of `sourceDigest`; it never compares it with a digest calculated from `safeSource`. It also cannot recompute `cacheKeyDigest`, because visibility is absent from the attestation and the function merely checks `jobId === j_<cacheKeyDigest>`. `getTikzCompileJob()` does not require the returned job ID to equal the requested ID.

The Redis/API implementation currently makes these values agree in the happy path, but the Web boundary does not verify the claimed source-to-job relationship. A stale/misrouted/malformed compiler response can pass all existing checks and render a valid, correctly hashed artifact for the wrong source.

Add visibility to the attested inputs, recompute the expected source digest at job creation, preserve that expectation through polling, require response ID equality, and recompute the cache-key formula from the attested inputs.

### M2. The attested bytes and browser-delivered bytes are maintained by two sanitizer copies

**References**

- `services/tikz-compiler/compiler-core.mjs:90-109,310-329`
- `lib/tikz/exact/compile-tikz.ts:113-143,325-349`

The Worker sanitizes SVG before hashing and storing it. The Web service hashes those stored bytes, then sanitizes the string again and returns the second result with the original attestation. The two sanitizer implementations are currently equivalent, so this is likely byte-stable today, but future drift can make the payload returned to the browser differ from the bytes named by `artifactDigest`.

Keep one canonical sanitizer before hashing/storage. The Web layer should validate without transforming, or it should generate and expose a distinct delivered-payload digest. Sharing one tested sanitizer implementation is preferable to duplicated regex policy.

### M3. Current tests do not exercise the attestation's failure properties

**References**

- `lib/tikz/exact/compile-tikz.test.ts:17-80`

The only attestation test is a mocked happy path. Its `sourceDigest` is computed correctly, but production code never checks it; therefore that assertion-like setup creates false confidence. The fake `compilerImageDigest` (`sha256:test-worker`) also passes because production validation requires only a nonempty string.

No inspected test covers:

- wrong source digest;
- recomputed cache-key mismatch;
- returned job ID mismatch;
- artifact header/content/size mismatch;
- Worker source-hash mismatch;
- Worker image mismatch;
- stale lease completion;
- public/private same-content publication races.

This is not a deletion-only or tautological suite, but it mirrors the permissive implementation and misses the core negative cases. Add focused boundary tests rather than more prompt/string-constant assertions.

### M4. “Private” job retrieval is a bearer-URL policy, not user/request ownership

**References**

- `lib/tikz/exact/compile-tikz.ts:251-263`
- `app/api/tikz/render/[jobId]/route.ts:13-80`

The Web always creates `private` jobs, but the public status route accepts any valid job ID and has no association with the request that created it. A leaked job ID allows retrieval of the private SVG. In the current anonymous product this may be an intentional high-entropy capability URL, but then “private” means cache/OSS visibility only and must be documented as such. If private is intended to mean per-user/private-document access, bind jobs to an authenticated principal or short-lived signed polling capability.

## LOW

### L1. Browser attestation is unchecked unknown data

**References**

- `components/tikz/use-exact-tikz-render.ts:81-87,106-123`

The hook verifies only that `attestation` is an object and then casts it to a narrower interface. The server is the current trust boundary, so this is not independently exploitable in the normal path, but any UI that displays provenance should validate schema/version/digests rather than rely on a cast.

### L2. Integrity error codes are dropped by the Next routes

**References**

- `app/api/tikz/render/route.ts:87-92`
- `app/api/tikz/render/[jobId]/route.ts:84-89`

The compiler client has useful typed codes such as `ARTIFACT_DIGEST_MISMATCH`, but route catch blocks return only `{ error }`. Preserve a safe `code` field so browser behavior and production telemetry can distinguish compilation failures from integrity failures.

### L3. Artifact retention/garbage collection is undefined

**References**

- `services/tikz-compiler/job-store.mjs:4-6,325-341`
- `services/tikz-compiler/artifact-store.mjs:138-168`

Redis success records expire after one hour while OSS content-addressed objects persist indefinitely. Stale-attempt writes can also leave unreferenced objects. This does not break digest correctness, but production needs an explicit retention/reference policy to avoid silent OSS accumulation.

## Positive observations

- `sourceDigest`, `cacheKeyDigest`, and `artifactDigest` have distinct intended meanings.
- Artifact keys use the digest of the exact UTF-8 SVG string written by the Worker.
- The compiler API re-hashes bytes read from storage before serving them.
- The Web client verifies the response digest header, artifact bytes, and byte length before using the SVG.
- Redis terminal writes retain the attempt/status guard, so a stale Worker cannot overwrite a newer attempt's job record.
- Public API/job responses are `no-store`; private artifact responses are `private, no-store`.
- The compiler API image defines a healthcheck, so `depends_on: condition: service_healthy` in production compose is supported by the image.

## Blockers

1. Bind attestation provenance to Worker-observed image identity and Worker-observed source hash.
2. Eliminate public/private metadata races on the shared content-addressed OSS key.
3. Add negative evidence for both blockers and the end-to-end digest mismatch paths before claiming attestation completion.

## Evidence

Reviewed file snapshots:

- `services/tikz-compiler/server.mjs` — SHA-256 `d9f4a7dc09529710b107c177f1261b714383127632dc4646ac81442cd5575978`
- `services/tikz-compiler/worker.mjs` — SHA-256 `64d25a0fcc166b96d2ea6cbfa844d6403b4cdeba6f13bbd05288566833378f4e`
- `services/tikz-compiler/job-store.mjs` — SHA-256 `210880408275a21665df17dbd4b5a8bffc7d7ccff9bd1d11e366a9ce8537d3f9`
- `services/tikz-compiler/artifact-store.mjs` — SHA-256 `d1e1da1e7cec49539618c2638f5af919037eaebda01b4bf3e03b351d722675b1`
- `lib/tikz/exact/compile-tikz.ts` — SHA-256 `19c98db3878f4614ed30e9a8de91340f67c3063faa2c2822048c691e3330fa63`
- `app/api/tikz/render/route.ts` — SHA-256 `a0d654f6590cfdbfa73e89af7bb84bde551c78af5872940a3ab7fb6b4544aa9e`
- `app/api/tikz/render/[jobId]/route.ts` — SHA-256 `f04e8bae400f01bdf8bf26294e247307ff7e40a182f401bbcfd7806388a312e4`
- `components/tikz/use-exact-tikz-render.ts` — SHA-256 `284a924657df32b90dbd51c81490fd2d8c2c6adfb97df15a795928a396a71c17`
- `deploy/ecs/compose.production.yaml` — SHA-256 `0c61047af7b1a6aa755621b5283e5b8d22b86a3bdc3998172b73530e9f862a23`

The requested `omo ulw-loop status --json` command returned `The syntax of the command is incorrect.` in this environment, so the fallback report location was used.
