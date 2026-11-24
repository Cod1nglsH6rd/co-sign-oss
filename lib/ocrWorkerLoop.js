/**
 * OCR worker loop: runs an injected `tick` once right away and then every
 * `intervalMs` on an unref'd timer, so the loop never keeps the process alive.
 *
 * A tick that is still running when the next one is due is not overlapped:
 * the due tick is skipped. A tick that throws or rejects is logged once
 * through `log.error` (default console) and the loop keeps going; nothing is
 * thrown out of the loop. `stop()` clears the timer and no tick starts after.
 *
 * Settings (interval, Supabase client, dispatch) are the caller's job.
 */
export function startOcrWorkerLoop({ intervalMs, tick, log = console }) {
  let running = false;
  let stopped = false;

  function runOnce() {
    if (stopped || running) return;
    running = true;
    let result;
    try {
      result = tick();
    } catch (err) {
      result = Promise.reject(err);
    }
    Promise.resolve(result)
      .catch((err) => {
        try {
          log.error('[ocrWorkerLoop] tick failed', err);
        } catch (e) {
          // A broken logger must not break the loop.
        }
      })
      .finally(() => {
        running = false;
      });
  }

  const timer = setInterval(runOnce, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  runOnce();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
