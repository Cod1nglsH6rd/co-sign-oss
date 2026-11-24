/**
 * Which outside services are on. Every adapter is off by default and the app
 * falls back to a local behaviour while it is off:
 *
 * - supabaseCloud: on when the Supabase URL (SUPABASE_URL, else
 *   NEXT_PUBLIC_SUPABASE_URL) is a *.supabase.co host; off means a local or
 *   self-hosted Supabase.
 * - sentry: on when SENTRY_DSN is set; off means errors go to the logs only.
 * - resend: on when EMAIL_PROVIDER=resend and RESEND_API_KEY are both set;
 *   off means lib/email.js sends nothing and logs one line instead.
 * - upstash: on when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are
 *   both set; off means in-memory, per-instance rate limits.
 * - vercel: on when VERCEL is set (the platform sets it); off means a plain
 *   `next start` host.
 *
 * adapterStatus(env) takes the env object (usually process.env) and reads it
 * at call time. A blank or whitespace-only value counts as not set.
 */

function set(env, name) {
  const raw = env[name];
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || null;
}

function onOff(value) {
  return value ? 'on' : 'off';
}

function isSupabaseCloud(url) {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

export function adapterStatus(env = {}) {
  const supabaseUrl = set(env, 'SUPABASE_URL') || set(env, 'NEXT_PUBLIC_SUPABASE_URL');
  return {
    supabaseCloud: onOff(isSupabaseCloud(supabaseUrl)),
    sentry: onOff(set(env, 'SENTRY_DSN')),
    resend: onOff(set(env, 'EMAIL_PROVIDER') === 'resend' && set(env, 'RESEND_API_KEY')),
    upstash: onOff(set(env, 'UPSTASH_REDIS_REST_URL') && set(env, 'UPSTASH_REDIS_REST_TOKEN')),
    vercel: onOff(set(env, 'VERCEL')),
  };
}
