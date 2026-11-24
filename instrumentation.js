export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');

    // In-process OCR worker: resumes parked OCR jobs (replaces the old Vercel
    // cron). lib/ocrWorkerBoot.js decides whether to start: OCR_WORKER=off, a
    // runtime other than nodejs, or service Supabase not configured starts
    // nothing (the last logs one line). A failure here never stops boot.
    try {
      const { startOcrWorkerFromEnv } = await import('./lib/ocrWorkerBoot');
      startOcrWorkerFromEnv({
        env: {
          NEXT_RUNTIME: process.env.NEXT_RUNTIME,
          OCR_WORKER: process.env.OCR_WORKER,
          OCR_WORKER_INTERVAL_MS: process.env.OCR_WORKER_INTERVAL_MS,
          PORT: process.env.PORT,
        },
      });
    } catch (err) {
      console.warn(`[instrumentation] OCR worker not started: ${err && err.message}`);
    }

    // First-run setup code: while setup is needed (no owner list in env or in
    // .cosign/settings.json, and not on Vercel) lib/setupBoot.js makes the
    // one-time code, so it is in the server log and .cosign/setup-code before
    // anyone opens /setup. Only the helper logs the code. The settings are
    // passed by name, exactly the ones setupNeeded reads. A failure here never
    // stops boot.
    try {
      const { ensureSetupCodeAtBoot } = await import('./lib/setupBoot');
      ensureSetupCodeAtBoot({
        env: {
          VERCEL: process.env.VERCEL,
          ADMIN_DASHBOARD_EMAILS: process.env.ADMIN_DASHBOARD_EMAILS,
          NEXT_PUBLIC_OWNER_EMAILS: process.env.NEXT_PUBLIC_OWNER_EMAILS,
        },
        cwd: process.cwd(),
      });
    } catch (err) {
      console.warn(`[instrumentation] Setup code not made: ${err && err.message}`);
    }
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export async function onRequestError(...args) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
}
