import { createClient } from 'redis';
import { CompilerError } from './compiler-core.mjs';

const JOB_TTL_SECONDS = 60 * 60;
const FAILED_JOB_TTL_SECONDS = 30;
const DEFAULT_LEASE_MS = 90_000;

function parseJob(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class RedisJobStore {
  constructor(options = {}) {
    this.url = options.url ?? process.env.REDIS_URL ?? '';
    this.prefix = options.prefix ?? process.env.REDIS_PREFIX ?? 'math-geohub:tikz';
    this.maxQueue = Number(options.maxQueue ?? process.env.MAX_QUEUE_DEPTH ?? 64);
    this.leaseDurationMs = Number(
      options.leaseDurationMs
        ?? process.env.JOB_LEASE_MS
        ?? DEFAULT_LEASE_MS,
    );
    this.client = null;
  }

  jobKey(jobId) {
    return `${this.prefix}:job:${jobId}`;
  }

  get queueKey() {
    return `${this.prefix}:queue`;
  }

  get processingKey() {
    return `${this.prefix}:processing`;
  }

  get runningKey() {
    return `${this.prefix}:running`;
  }

  async connect() {
    if (!this.url) {
      throw new CompilerError('REDIS_URL is required', 503, 'REDIS_NOT_CONFIGURED');
    }
    const client = createClient({ url: this.url });
    client.on('error', (error) => {
      process.stderr.write(`redis error: ${error.message}\n`);
    });
    await client.connect();
    this.client = client;
    return this;
  }

  requireClient() {
    if (!this.client?.isReady) {
      throw new CompilerError('Redis is unavailable', 503, 'REDIS_UNAVAILABLE');
    }
    return this.client;
  }

  async ping() {
    return (await this.requireClient().ping()) === 'PONG';
  }

  async createJob({
    jobId,
    sourceDigest,
    submittedSourceDigest,
    cacheKeyVersion,
    cacheKeyDigest,
    compilerImageDigest,
    source,
    profile,
    visibility,
    sourcePolicy,
    wrapperId,
    wrapperDigest,
    bundleIdentity,
    profileManifestDigest,
  }) {
    const client = this.requireClient();
    const key = this.jobKey(jobId);
    const existing = parseJob(await client.get(key));
    if (existing) return { job: existing, created: false };

    const now = Date.now();
    const job = {
      id: jobId,
      sourceDigest,
      submittedSourceDigest,
      cacheKeyVersion,
      cacheKeyDigest,
      compilerImageDigest,
      source,
      profile,
      visibility,
      sourcePolicy,
      wrapperId,
      wrapperDigest,
      bundleIdentity,
      profileManifestDigest,
      status: 'queued',
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    };
    const created = await client.eval(`
      if redis.call('EXISTS', KEYS[1]) == 1 then
        return 0
      end
      if tonumber(redis.call('LLEN', KEYS[2])) >= tonumber(ARGV[3]) then
        return -1
      end
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
      redis.call('LPUSH', KEYS[2], ARGV[4])
      return 1
    `, {
      keys: [key, this.queueKey],
      arguments: [
        JSON.stringify(job),
        String(JOB_TTL_SECONDS),
        String(this.maxQueue),
        jobId,
      ],
    });

    if (Number(created) === -1) {
      throw new CompilerError('TikZ 编译队列已满，请稍后重试', 429, 'QUEUE_FULL');
    }
    if (Number(created) === 1) {
      return { job, created: true };
    }
    const raced = parseJob(await client.get(key));
    if (!raced) {
      throw new CompilerError('无法创建编译任务', 503, 'JOB_CREATE_RACE');
    }
    return { job: raced, created: false };
  }

  async getJob(jobId) {
    return parseJob(await this.requireClient().get(this.jobKey(jobId)));
  }

  async takeJob(timeoutSeconds = 5) {
    const client = this.requireClient();
    for (;;) {
      const jobId = await client.blMove(
        this.queueKey,
        this.processingKey,
        'RIGHT',
        'LEFT',
        timeoutSeconds,
      );
      if (!jobId) return null;

      const now = Date.now();
      const claimed = await client.eval(`
        local raw = redis.call('GET', KEYS[1])
        if not raw then
          redis.call('LREM', KEYS[3], 1, ARGV[4])
          return false
        end
        local job = cjson.decode(raw)
        if job.status ~= 'queued' then
          redis.call('LREM', KEYS[3], 1, ARGV[4])
          return false
        end
        job.status = 'running'
        job.updatedAt = tonumber(ARGV[1])
        job.leaseUntil = tonumber(ARGV[1]) + tonumber(ARGV[2])
        job.attempt = (job.attempt or 0) + 1
        local encoded = cjson.encode(job)
        redis.call('SET', KEYS[1], encoded, 'EX', ARGV[3])
        redis.call('ZADD', KEYS[2], job.leaseUntil, ARGV[4])
        return encoded
      `, {
        keys: [this.jobKey(jobId), this.runningKey, this.processingKey],
        arguments: [
          String(now),
          String(this.leaseDurationMs),
          String(JOB_TTL_SECONDS),
          jobId,
        ],
      });
      const running = parseJob(claimed);
      if (running) return running;
    }
  }

  async extendLease(jobId, attempt, durationMs = this.leaseDurationMs) {
    const client = this.requireClient();
    const extended = await client.eval(`
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local job = cjson.decode(raw)
      if job.status ~= 'running' or tonumber(job.attempt or -1) ~= tonumber(ARGV[1]) then
        return 0
      end
      job.leaseUntil = tonumber(ARGV[2]) + tonumber(ARGV[3])
      job.updatedAt = tonumber(ARGV[2])
      local encoded = cjson.encode(job)
      redis.call('SET', KEYS[1], encoded, 'EX', ARGV[4])
      redis.call('ZADD', KEYS[2], job.leaseUntil, ARGV[5])
      return 1
    `, {
      keys: [this.jobKey(jobId), this.runningKey],
      arguments: [
        String(attempt),
        String(Date.now()),
        String(durationMs),
        String(JOB_TTL_SECONDS),
        jobId,
      ],
    });
    return Number(extended) === 1;
  }

  async requeueExpiredJobs(limit = 256) {
    const client = this.requireClient();
    const now = Date.now();
    const expired = await client.zRangeByScore(
      this.runningKey,
      0,
      now,
      { LIMIT: { offset: 0, count: limit } },
    );
    let requeued = 0;
    for (const jobId of expired) {
      requeued += await this.requeueJobIfExpired(jobId, now);
    }

    // BLMOVE first moves an id to this list. This scan recovers the tiny
    // crash window before the worker was able to establish its running lease.
    const processing = await client.lRange(this.processingKey, 0, limit - 1);
    for (const jobId of processing) {
      const result = await client.eval(`
        local raw = redis.call('GET', KEYS[1])
        if not raw then
          redis.call('LREM', KEYS[2], 1, ARGV[3])
          redis.call('ZREM', KEYS[3], ARGV[3])
          return 0
        end
        local job = cjson.decode(raw)
        if job.status == 'queued' then
          if redis.call('LREM', KEYS[2], 1, ARGV[3]) > 0 then
            redis.call('LPUSH', KEYS[4], ARGV[3])
            return 1
          end
          return 0
        end
        if job.status == 'running' and tonumber(job.leaseUntil or 0) <= tonumber(ARGV[1]) then
          job.status = 'queued'
          job.updatedAt = tonumber(ARGV[1])
          job.leaseUntil = nil
          redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[2])
          redis.call('ZREM', KEYS[3], ARGV[3])
          redis.call('LREM', KEYS[2], 1, ARGV[3])
          redis.call('LPUSH', KEYS[4], ARGV[3])
          return 1
        end
        if job.status ~= 'running' then
          redis.call('LREM', KEYS[2], 1, ARGV[3])
          redis.call('ZREM', KEYS[3], ARGV[3])
        end
        return 0
      `, {
        keys: [
          this.jobKey(jobId),
          this.processingKey,
          this.runningKey,
          this.queueKey,
        ],
        arguments: [String(now), String(JOB_TTL_SECONDS), jobId],
      });
      requeued += Number(result);
    }
    return requeued;
  }

  async requeueJobIfExpired(jobId, now = Date.now()) {
    const client = this.requireClient();
    const result = await client.eval(`
      local raw = redis.call('GET', KEYS[1])
      if not raw then
        redis.call('ZREM', KEYS[2], ARGV[3])
        redis.call('LREM', KEYS[3], 1, ARGV[3])
        return 0
      end
      local job = cjson.decode(raw)
      if job.status == 'running' and tonumber(job.leaseUntil or 0) <= tonumber(ARGV[1]) then
        job.status = 'queued'
        job.updatedAt = tonumber(ARGV[1])
        job.leaseUntil = nil
        redis.call('SET', KEYS[1], cjson.encode(job), 'EX', ARGV[2])
        redis.call('ZREM', KEYS[2], ARGV[3])
        redis.call('LREM', KEYS[3], 1, ARGV[3])
        redis.call('LPUSH', KEYS[4], ARGV[3])
        return 1
      end
      if job.status ~= 'running' then
        redis.call('ZREM', KEYS[2], ARGV[3])
        redis.call('LREM', KEYS[3], 1, ARGV[3])
      end
      return 0
    `, {
      keys: [
        this.jobKey(jobId),
        this.runningKey,
        this.processingKey,
        this.queueKey,
      ],
      arguments: [String(now), String(JOB_TTL_SECONDS), jobId],
    });
    return Number(result);
  }

  async completeJob(jobId, attempt, result) {
    const job = await this.getJob(jobId);
    if (!job) return false;
    if (
      job.sourceDigest !== job.submittedSourceDigest
      || result.sourceDigest !== job.submittedSourceDigest
      || result.executedSourceDigest !== job.submittedSourceDigest
      || result.compilerImageDigest !== job.compilerImageDigest
      || result.cacheKeyVersion !== job.cacheKeyVersion
      || result.profile !== job.profile
      || result.sourcePolicy !== job.sourcePolicy
      || result.wrapperId !== job.wrapperId
      || result.wrapperDigest !== job.wrapperDigest
      || result.bundleIdentity !== job.bundleIdentity
      || result.profileManifestDigest !== job.profileManifestDigest
      || typeof result.executedDocumentDigest !== 'string'
      || !/^[a-f0-9]{64}$/.test(result.executedDocumentDigest)
    ) {
      throw new CompilerError(
        'Worker provenance does not match the claimed compile job',
        409,
        'WORKER_PROVENANCE_MISMATCH',
      );
    }
    const completedAt = Date.now();
    const attestation = {
      schemaVersion: 'tikz-artifact-attestation/v1',
      jobId,
      // Compatibility alias. It is required to equal both explicit digests.
      sourceDigest: job.submittedSourceDigest,
      submittedSourceDigest: job.submittedSourceDigest,
      executedSourceDigest: result.executedSourceDigest,
      executedDocumentDigest: result.executedDocumentDigest,
      cacheKeyVersion: job.cacheKeyVersion,
      cacheKeyDigest: job.cacheKeyDigest,
      artifactDigest: result.artifactDigest,
      profile: job.profile,
      sourcePolicy: job.sourcePolicy,
      wrapperId: job.wrapperId,
      wrapperDigest: job.wrapperDigest,
      bundleIdentity: job.bundleIdentity,
      profileManifestDigest: job.profileManifestDigest,
      renderer: result.renderer,
      compilerImageDigest: result.compilerImageDigest,
      visibility: job.visibility,
      mediaType: 'image/svg+xml',
      svgBytes: result.svgBytes,
      completedAt,
    };
    const completed = {
      ...job,
      source: undefined,
      status: 'succeeded',
      updatedAt: completedAt,
      completedAt,
      artifactKey: result.artifactKey,
      artifactUrl: result.artifactUrl ?? null,
      artifactDigest: result.artifactDigest,
      attestation,
      executedSourceDigest: result.executedSourceDigest,
      executedDocumentDigest: result.executedDocumentDigest,
      renderer: result.renderer,
      compileMs: result.compileMs,
      convertMs: result.convertMs,
      svgBytes: result.svgBytes,
    };
    delete completed.source;
    return this.storeTerminalJob(jobId, attempt, completed, JOB_TTL_SECONDS);
  }

  async failJob(jobId, attempt, error) {
    const job = await this.getJob(jobId);
    if (!job) return false;
    const failed = {
      ...job,
      source: undefined,
      status: 'failed',
      updatedAt: Date.now(),
      completedAt: Date.now(),
      error: error.message,
      errorCode: error.code ?? 'COMPILE_FAILED',
      diagnostics: Array.isArray(error.diagnostics)
        ? error.diagnostics
        : [],
    };
    delete failed.source;
    return this.storeTerminalJob(
      jobId,
      attempt,
      failed,
      FAILED_JOB_TTL_SECONDS,
    );
  }

  async storeTerminalJob(jobId, attempt, terminalJob, ttlSeconds) {
    const client = this.requireClient();
    const stored = await client.eval(`
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local current = cjson.decode(raw)
      if current.status ~= 'running' or tonumber(current.attempt or -1) ~= tonumber(ARGV[1]) then
        return 0
      end
      redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
      redis.call('ZREM', KEYS[2], ARGV[4])
      redis.call('LREM', KEYS[3], 1, ARGV[4])
      return 1
    `, {
      keys: [this.jobKey(jobId), this.runningKey, this.processingKey],
      arguments: [
        String(attempt),
        JSON.stringify(terminalJob),
        String(ttlSeconds),
        jobId,
      ],
    });
    return Number(stored) === 1;
  }

  async stats() {
    const client = this.requireClient();
    const [queueDepth, processingDepth] = await Promise.all([
      client.lLen(this.queueKey),
      client.lLen(this.processingKey),
    ]);
    return { queueDepth, processingDepth };
  }

  async close() {
    if (this.client?.isOpen) await this.client.quit();
    this.client = null;
  }
}
