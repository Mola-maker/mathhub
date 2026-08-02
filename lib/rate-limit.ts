import { createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

export type RateResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  /** Production requests fail closed when the shared limiter is unavailable. */
  unavailable?: boolean;
};

type Bucket = {
  resetAt: number;
  count: number;
};

const buckets = new Map<string, Bucket>();
const PRUNE_INTERVAL_MS = 60_000;
export const RATE_LIMIT_MAX_BUCKETS = 5_000;

const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

let lastPrunedAt = 0;
let redisClient: RedisClientType | null = null;
let redisConnectPromise: Promise<RedisClientType> | null = null;

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

function checkMemoryRate(key: string, limit: number, windowMs: number): RateResult {
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

function redisRateKey(key: string): string {
  const prefix = (process.env.RATE_LIMIT_REDIS_PREFIX || 'math-geohub:rate')
    .replace(/[^a-zA-Z0-9:_-]/g, '')
    .slice(0, 80) || 'math-geohub:rate';
  const digest = createHash('sha256').update(key).digest('hex');
  return `${prefix}:${digest}`;
}

async function getRedisClient(url: string): Promise<RedisClientType> {
  if (redisClient?.isReady) return redisClient;
  if (redisConnectPromise) return redisConnectPromise;

  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 1_500,
      reconnectStrategy: false,
    },
  });
  // The request path reports availability explicitly; suppress unhandled emitter errors.
  client.on('error', () => undefined);
  redisClient = client;
  redisConnectPromise = client.connect()
    .then(() => client)
    .catch((error: unknown) => {
      redisConnectPromise = null;
      redisClient = null;
      client.destroy();
      throw error;
    });
  return redisConnectPromise;
}

async function checkRedisRate(
  url: string,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateResult> {
  const client = await getRedisClient(url);
  const raw = await client.eval(RATE_LIMIT_SCRIPT, {
    keys: [redisRateKey(key)],
    arguments: [String(windowMs)],
  });
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error('invalid rate limit response');
  }

  const count = Number(raw[0]);
  const ttl = Number(raw[1]);
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(ttl)) {
    throw new Error('invalid rate limit counter');
  }

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetMs: Math.max(1, ttl > 0 ? ttl : windowMs),
  };
}

export async function checkRate(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateResult> {
  const url = process.env.RATE_LIMIT_REDIS_URL?.trim();
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      return { allowed: false, remaining: 0, resetMs: 1_000, unavailable: true };
    }
    return checkMemoryRate(key, limit, windowMs);
  }

  try {
    return await checkRedisRate(url, key, limit, windowMs);
  } catch {
    // A shared limiter outage must not silently multiply paid API capacity by
    // the number of ECS replicas. Fail closed and let the route return 503.
    return { allowed: false, remaining: 0, resetMs: 1_000, unavailable: true };
  }
}

export function getRateLimitBucketCount(): number {
  return buckets.size;
}

export function resetRateLimitBuckets(): void {
  buckets.clear();
  lastPrunedAt = 0;
}
