/**
 * OCR worker boot: starts the in-process OCR loop from settings and
 * dispatches each claimed job to the app's own `/api/ocr` on 127.0.0.1 with
 * the per-process internal token (lib/internalAuth), so no cron secret or
 * public URL is needed.
 *
 * Settings come only from the `env` argument the caller passes in:
 *   OCR_WORKER=off           starts nothing
 *   NEXT_RUNTIME             must be 'nodejs', otherwise nothing starts
 *   OCR_WORKER_INTERVAL_MS   tick interval (default 30000)
 *   PORT                     local port for the dispatch (default 3000)
 *
 * Returns the loop's { stop }, or null when nothing was started. Never throws
 * when Supabase is not configured: it logs one line and returns null.
 */
import { requireServiceSupabase } from './supabaseClient';
import { getInternalToken } from './internalAuth';
import { runOcrTick } from './ocrWorker';
import { startOcrWorkerLoop } from './ocrWorkerLoop';

export const DEFAULT_INTERVAL_MS = 30000;
export const DEFAULT_DISPATCH_GRACE_MS = 8000;

export function buildLocalOcrDispatch({
  port,
  token,
  fetchImpl,
  graceMs = DEFAULT_DISPATCH_GRACE_MS,
  log = console,
}) {
  const url = `http://127.0.0.1:${port || 3000}/api/ocr`;

  // Fire-and-forget like the cron route: wait only a short grace so the
  // request reaches /api/ocr, which then runs on its own.
  return async (job, ocr) => {
    const doFetch = fetchImpl || globalThis.fetch;
    const body = JSON.stringify({
      documentId: job.id,
      userId: String(job.user_id || job.created_by || 'cron-worker'),
      mode: (ocr && ocr.mode) || 'full',
      preferredLanguage: job.preferred_language || 'en',
    });
    const ocrCall = Promise.resolve()
      .then(() => doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
        body,
      }))
      .then((res) => {
        // A refused or failed answer (e.g. 401 from a token mismatch) is a
        // failed dispatch, logged like a fetch error. Never log the token.
        if (res && !res.ok) {
          log.warn('[ocrWorkerBoot] dispatch refused', { id: job.id, status: res.status });
        }
      })
      .catch((e) => log.warn('[ocrWorkerBoot] dispatch fetch error', { id: job.id, error: e && e.message }));
    let timer;
    const grace = new Promise((r) => { timer = setTimeout(r, graceMs); });
    await Promise.race([ocrCall, grace]);
    clearTimeout(timer);
  };
}

export function startOcrWorkerFromEnv({
  env = {},
  getSupabase = requireServiceSupabase,
  fetchImpl,
  startLoop = startOcrWorkerLoop,
  log = console,
} = {}) {
  if (env.OCR_WORKER === 'off') return null;
  if (env.NEXT_RUNTIME !== 'nodejs') return null;

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    try {
      log.warn(`[ocrWorkerBoot] OCR worker not started: ${err && err.message}`);
    } catch (e) {
      // A broken logger must not break boot.
    }
    return null;
  }

  const dispatch = buildLocalOcrDispatch({
    port: env.PORT,
    token: getInternalToken(),
    fetchImpl,
    log,
  });
  const intervalMs = Number(env.OCR_WORKER_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const loop = startLoop({
    intervalMs,
    tick: () => runOcrTick({ supabase, dispatch }),
    log,
  });
  return { stop: loop.stop };
}
