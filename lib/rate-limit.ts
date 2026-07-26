type RateResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
};

type Bucket = {
  resetAt: number;
  count: number;
};

const buckets = new Map<string, Bucket>();
const PRUNE_INTERVAL_MS = 60_000;
export const RATE_LIMIT_MAX_BUCKETS = 5_000;

let lastPrunedAt = 0;

function pruneExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function pruneOverflowBuckets(): void {
  if (buckets.size <= RATE_LIMIT_MAX_BUCKETS) return;

  const overflow = buckets.size - RATE_LIMIT_MAX_BUCKETS;
  const oldestKeys = [...buckets.entries()]
    .sort((a, b) => a[1].resetAt - b[1].resetAt)
    .slice(0, overflow)
    .map(([key]) => key);

  for (const key of oldestKeys) buckets.delete(key);
}

function pruneBucketsIfNeeded(now: number): void {
  if (now - lastPrunedAt >= PRUNE_INTERVAL_MS || buckets.size > RATE_LIMIT_MAX_BUCKETS) {
    pruneExpiredBuckets(now);
    pruneOverflowBuckets();
    lastPrunedAt = now;
  }
}

export async function checkRate(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateResult> {
  const now = Date.now();
  pruneBucketsIfNeeded(now);

  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    pruneOverflowBuckets();
    return { allowed: true, remaining: Math.max(0, limit - 1), resetMs: windowMs };
  }

  if (current.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, current.resetAt - now),
    };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    resetMs: Math.max(0, current.resetAt - now),
  };
}

export function getRateLimitBucketCount(): number {
  return buckets.size;
}

export function resetRateLimitBuckets(): void {
  buckets.clear();
  lastPrunedAt = 0;
}
