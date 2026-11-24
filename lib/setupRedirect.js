/**
 * Where a page view goes while first-run setup is still needed.
 * setupRedirectTarget(pathname, { needed }) returns '/setup' for a page, or
 * null: setup not needed, the setup page itself (with or without a locale,
 * since the middleware adds one), API routes, embeds, Next.js assets, the
 * not-found and error pages, and signer links (/{locale}/fill/*), which must
 * keep working.
 */

import { locales } from './i18n';

const LOCALE = `(?:${locales.join('|')})`;

const SKIP = [
  /^\/setup(\/|$)/,
  new RegExp(`^/${LOCALE}/setup(/|$)`),
  /^\/api(\/|$)/,
  /^\/embed(\/|$)/,
  /^\/_next(\/|$)/,
  /^\/[^/]+\/fill(\/|$)/,
  /^\/(404|500|_error)$/,
];

export function setupRedirectTarget(pathname, { needed } = {}) {
  if (needed !== true || typeof pathname !== 'string') return null;
  const path = pathname.split(/[?#]/)[0] || '/';
  if (SKIP.some((pattern) => pattern.test(path))) return null;
  return '/setup';
}
