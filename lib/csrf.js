/**
 * CSRF Protection — Double-Submit Cookie Pattern
 *
 * No server-side session required. A random token is issued per-session-token
 * and must be echoed back in the x-csrf-token header on state-changing requests.
 */

import { randomBytes } from 'crypto';

const CSRF_TOKEN_COOKIE = 'x-csrf-token';
const CSRF_TOKEN_HEADER = 'x-csrf-token';

/**
 * Generate a secure random CSRF token
 * @returns {string}
 */
export function generateCsrfToken() {
  return randomBytes(32).toString('hex');
}

/**
 * Read the expected CSRF token from request cookies
 * @param {import('http').IncomingMessage} req
 * @returns {string | null}
 */
export function getCsrfCookieToken(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );

  return cookies[CSRF_TOKEN_COOKIE] || null;
}

/**
 * Validate a CSRF token from request headers against the cookie value.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
export function validateCsrfToken(req) {
  const expected = getCsrfCookieToken(req);
  const received = req.headers[CSRF_TOKEN_HEADER];

  if (!expected || !received) return false;
  if (typeof received !== 'string') return false;

  // Timing-safe comparison (constant-time)
  if (expected.length !== received.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Whether the request itself came over https: the first x-forwarded-proto
 * value is https, or the socket is encrypted.
 *
 * @param {import('http').IncomingMessage} [req]
 * @returns {boolean}
 */
function isHttpsRequest(req) {
  if (!req) return false;
  const proto = req.headers?.['x-forwarded-proto'];
  const first = String(Array.isArray(proto) ? proto[0] : proto || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (first === 'https') return true;
  return Boolean(req.socket?.encrypted || req.connection?.encrypted);
}

/**
 * Set the CSRF token cookie on the response.
 * Call this before sending the response body.
 * Marked Secure only for a production request that came over https, so a
 * signer on a plain-http home address (e.g. http://192.168.1.20:3000) keeps it.
 *
 * @param {import('http').ServerResponse} res
 * @param {string} token
 * @param {import('http').IncomingMessage} [req]
 */
export function setCsrfCookie(res, token, req) {
  const isProduction = process.env.NODE_ENV === 'production';
  const secureFlag = isProduction && isHttpsRequest(req) ? ' Secure;' : '';
  res.setHeader(
    'Set-Cookie',
    `${CSRF_TOKEN_COOKIE}=${token};${secureFlag} SameSite=Strict; Path=/; Max-Age=3600`
  );
}
