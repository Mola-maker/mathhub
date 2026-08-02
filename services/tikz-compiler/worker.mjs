import { createHash } from 'node:crypto';
import {
  compilerInputIdentity,
  createCompiler,
  CompilerError,
  TIKZ_CACHE_KEY_VERSION,
} from './compiler-core.mjs';
import { createArtifactStore } from './artifact-store.mjs';
import { RedisJobStore } from './job-store.mjs';
import {
  assertWorkerProvenance,
  compilerRedisPrefix,
  compilerWorkerImageDigest,
} from './provenance.mjs';

const workerImageDigest = compilerWorkerImageDigest();
const inputIdentity = compilerInputIdentity(workerImageDigest);
const store = await new RedisJobStore({
  prefix: compilerRedisPrefix(workerImageDigest),
}).connect();
const artifacts = createArtifactStore();
const compiler = createCompiler();
let stopping = false;

function startLeaseHeartbeat(job) {
  let leaseLost = false;
  const intervalMs = Math.max(5_000, Math.floor(store.leaseDurationMs / 3));
  const timer = setInterval(() => {
    void store.extendLease(job.id, job.attempt).then((extended) => {
      if (!extended) leaseLost = true;
    }).catch((error) => {
      leaseLost = true;
      process.stderr.write(
        `lease heartbeat failed for ${job.id}: ${error.message}\n`,
      );
    });
  }, intervalMs);
  timer.unref();

  return {
    get lost() {
      return leaseLost;
    },
    stop() {
      clearInterval(timer);
    },
  };
}

async function run() {
  process.stdout.write(
    `tikz-compiler worker ready (${workerImageDigest})\n`,
  );
  while (!stopping) {
    await store.requeueExpiredJobs();
    const job = await store.takeJob(5);
    if (!job) continue;

    const heartbeat = startLeaseHeartbeat(job);
    try {
      const compilerResult = await compiler.render(job.source);
      const result = {
        ...compilerResult,
        ...inputIdentity,
        cacheKeyVersion: TIKZ_CACHE_KEY_VERSION,
      };
      assertWorkerProvenance(job, result, workerImageDigest);
      if (heartbeat.lost || !await store.extendLease(job.id, job.attempt)) {
        throw new CompilerError(
          'Compile job lease was lost',
          409,
          'JOB_LEASE_LOST',
        );
      }

      const artifactDigest = createHash('sha256')
        .update(result.svg, 'utf8')
        .digest('hex');
      const artifact = await artifacts.put({
        key: `tikz/v1/${job.visibility}/${artifactDigest}.svg`,
        svg: result.svg,
        visibility: job.visibility,
      });
      await store.completeJob(job.id, job.attempt, {
        ...artifact,
        artifactDigest,
        sourceDigest: result.executedSourceDigest,
        executedSourceDigest: result.executedSourceDigest,
        executedDocumentDigest: result.executedDocumentDigest,
        cacheKeyVersion: result.cacheKeyVersion,
        compilerImageDigest: workerImageDigest,
        profile: result.profile,
        sourcePolicy: result.sourcePolicy,
        wrapperId: result.wrapperId,
        wrapperDigest: result.wrapperDigest,
        bundleIdentity: result.bundleIdentity,
        renderer: result.renderer,
        compileMs: result.compileMs,
        convertMs: result.convertMs,
        svgBytes: Buffer.byteLength(result.svg, 'utf8'),
      });
    } catch (error) {
      const normalized = error instanceof CompilerError
        ? error
        : new CompilerError(
          error instanceof Error ? error.message : 'TikZ compile failed',
          500,
          'WORKER_FAILED',
        );
      await store.failJob(job.id, job.attempt, normalized);
    } finally {
      heartbeat.stop();
    }
  }
}

function requestShutdown() {
  stopping = true;
}

process.on('SIGTERM', requestShutdown);
process.on('SIGINT', requestShutdown);

try {
  await run();
} finally {
  await store.close();
}
