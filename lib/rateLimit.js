import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { clientIp } from './clientIp';

const hasUpstashEnv = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

const redis = hasUpstashEnv ? Redis.fromEnv() : null;

// PRD §8.2: Upstash (distributed) is preferred. Without it, fall back to an
// in-memory sliding-window limiter so a single-instance deployment still has
// brute-force protection on public recipient endpoints. The fallback is
// per-instance, so it does not coordinate across serverless instances —
// configure Upstash in production for correctness at scale.
if (!hasUpstashEnv && process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line no-console
  console.warn('[rateLimit] UPSTASH_REDIS_REST_URL/TOKEN not set — using in-memory rate limiting (per-instance only). Configure Upstash for distributed limits.');
}

const publicLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '1 m'), analytics: true, prefix: 'ratelimit:public' })
  : null;

const authLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, '1 m'), analytics: true, prefix: 'ratelimit:auth' })
  : null;

const cronLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '1 m'), analytics: true, prefix: 'ratelimit:cron' })
  : null;

// ---- in-memory fallback (used only when Upstash is not configured) ----------
const MEMORY_WINDOW_MS = 60 * 1000;
const MEMORY_LIMITS = { public: 30, auth: 120, cron: 5 };
const memoryHits = new Map(); // key -> number[] (timestamps within window)
let lastSweep = 0;

function memoryLimit(kind, key) {
  const now = Date.now();
  const limit = MEMORY_LIMITS[kind] || 30;

  // Periodically drop stale keys so the map doesn't grow unbounded.
  if (now - lastSweep > MEMORY_WINDOW_MS) {
    for (const [k, times] of memoryHits) {
      const fresh = times.filter((t) => now - t < MEMORY_WINDOW_MS);
      if (fresh.length) memoryHits.set(k, fresh);
      else memoryHits.delete(k);
    }
    lastSweep = now;
  }

  const times = (memoryHits.get(key) || []).filter((t) => now - t < MEMORY_WINDOW_MS);
  if (times.length >= limit) {
    return { success: false, limit, remaining: 0, reset: Math.ceil((times[0] + MEMORY_WINDOW_MS) / 1000) };
  }
  times.push(now);
  memoryHits.set(key, times);
  return { success: true, limit, remaining: limit - times.length, reset: Math.ceil((now + MEMORY_WINDOW_MS) / 1000) };
}

// The address comes from lib/clientIp.js, which reads X-Forwarded-For only as
// far as COSIGN_TRUSTED_PROXY_HOPS (set by the host owner) trusts it; the
// left-most entries, which any client can write, never pick the bucket.
function getClientIp(req) {
  return clientIp(req) || 'unknown';
}

async function applyLimiter(res, limiter, kind, key) {
  const result = limiter
    ? await limiter.limit(key)
    : memoryLimit(kind, key);
  const { success, limit, remaining, reset } = result;
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(reset));
  if (!success) {
    res.status(429).json({ error: 'rate_limited' });
    return true;
  }
  return false;
}

export async function rateLimitPublic(req, res, routeKey, token = '') {
  const ip = getClientIp(req);
  const key = `${routeKey}:${ip}:${token}`;
  return applyLimiter(res, publicLimiter, 'public', key);
}

export async function rateLimitAuth(req, res, routeKey, userId) {
  const ip = getClientIp(req);
  const key = `${routeKey}:${userId || 'anonymous'}:${ip}`;
  return applyLimiter(res, authLimiter, 'auth', key);
}

export async function rateLimitCron(req, res) {
  const ip = getClientIp(req);
  const key = `cron:${ip}`;
  return applyLimiter(res, cronLimiter, 'cron', key);
}

// ---- daily quotas -------------------------------------------------------------
// A fixed one-day window per key (for example "sessions-chat:<session id>"),
// counted in the same store as the per-minute limits above: Upstash when it is
// configured, otherwise an in-memory map (per instance, reset on restart).
const dailyLimiters = new Map(); // limit -> Ratelimit
const DAY_MS = 24 * 60 * 60 * 1000;
const memoryDaily = new Map(); // key -> { day, count }
let lastDailySweep = 0;

function getDailyLimiter(limit) {
  if (!redis) return null;
  if (!dailyLimiters.has(limit)) {
    dailyLimiters.set(limit, new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(limit, '1 d'),
      analytics: false,
      prefix: `ratelimit:daily:${limit}`,
    }));
  }
  return dailyLimiters.get(limit);
}

function memoryDailyLimit(key, limit) {
  const now = Date.now();
  const day = Math.floor(now / DAY_MS);
  if (now - lastDailySweep > MEMORY_WINDOW_MS) {
    for (const [k, entry] of memoryDaily) {
      if (entry.day !== day) memoryDaily.delete(k);
    }
    lastDailySweep = now;
  }
  const entry = memoryDaily.get(key);
  const count = entry && entry.day === day ? entry.count : 0;
  const reset = Math.ceil(((day + 1) * DAY_MS) / 1000);
  if (count >= limit) {
    return { success: false, limit, remaining: 0, reset };
  }
  memoryDaily.set(key, { day, count: count + 1 });
  return { success: true, limit, remaining: limit - count - 1, reset };
}

/**
 * Count one use of a daily quota. Returns { success, limit, remaining, reset };
 * success is false once `limit` uses have been counted for `key` today.
 */
export async function consumeDailyQuota(routeKey, id, limit) {
  const key = `${routeKey}:${id}`;
  const limiter = getDailyLimiter(limit);
  return limiter ? limiter.limit(key) : memoryDailyLimit(key, limit);
}

export const isRateLimitConfigured = hasUpstashEnv;
