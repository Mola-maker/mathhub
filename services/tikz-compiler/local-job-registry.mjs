const DEFAULT_SUCCESS_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FAILED_TTL_MS = 30 * 1000;
const DEFAULT_MAX_ENTRIES = 128;

function terminalStatus(job) {
  const status = job?.public?.status;
  return status === 'succeeded' || status === 'failed';
}

function completedAt(job) {
  const value = job?.public?.completedAt;
  return Number.isFinite(value) ? value : 0;
}

export class LocalJobRegistry {
  #entries = new Map();
  #successTtlMs;
  #failedTtlMs;
  #maxEntries;
  #now;

  constructor(options = {}) {
    this.#successTtlMs = options.successTtlMs ?? DEFAULT_SUCCESS_TTL_MS;
    this.#failedTtlMs = options.failedTtlMs ?? DEFAULT_FAILED_TTL_MS;
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.#now = options.now ?? Date.now;
    if (
      !Number.isFinite(this.#successTtlMs)
      || this.#successTtlMs < 0
      || !Number.isFinite(this.#failedTtlMs)
      || this.#failedTtlMs < 0
      || !Number.isSafeInteger(this.#maxEntries)
      || this.#maxEntries < 1
    ) throw new TypeError('Invalid local TikZ job registry limits.');
  }

  get size() {
    this.prune();
    return this.#entries.size;
  }

  get(id) {
    this.prune();
    return this.#entries.get(id) ?? null;
  }

  /** Failed jobs are retryable immediately; active and successful jobs remain deduplicated. */
  getForSubmission(id) {
    this.prune();
    const job = this.#entries.get(id) ?? null;
    if (job?.public?.status === 'failed') {
      this.#entries.delete(id);
      return null;
    }
    return job;
  }

  delete(id) {
    return this.#entries.delete(id);
  }

  set(id, job) {
    this.prune();
    if (!this.#entries.has(id) && this.#entries.size >= this.#maxEntries) {
      this.#evictOldestTerminal();
    }
    if (!this.#entries.has(id) && this.#entries.size >= this.#maxEntries) {
      return false;
    }
    this.#entries.set(id, job);
    return true;
  }

  prune() {
    const now = this.#now();
    for (const [id, job] of this.#entries) {
      if (!terminalStatus(job)) continue;
      const ttl = job.public.status === 'failed' ? this.#failedTtlMs : this.#successTtlMs;
      if (completedAt(job) + ttl <= now) this.#entries.delete(id);
    }
  }

  #evictOldestTerminal() {
    let oldestId = null;
    let oldestCompletedAt = Number.POSITIVE_INFINITY;
    for (const [id, job] of this.#entries) {
      if (!terminalStatus(job)) continue;
      const candidateCompletedAt = completedAt(job);
      if (candidateCompletedAt < oldestCompletedAt) {
        oldestId = id;
        oldestCompletedAt = candidateCompletedAt;
      }
    }
    if (oldestId !== null) this.#entries.delete(oldestId);
  }
}

export function createLocalJobRegistry(options) {
  return new LocalJobRegistry(options);
}
