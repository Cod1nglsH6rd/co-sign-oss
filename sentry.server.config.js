// Server-side Sentry init. Inert when SENTRY_DSN is not set, so dev/CI builds
// run without any Sentry behavior. (PRD §8.3)
import * as Sentry from '@sentry/nextjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    environment: process.env.NODE_ENV,
  });
}
