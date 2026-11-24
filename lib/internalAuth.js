/**
 * Per-process internal token. Lets the app re-invoke its own `/api/ocr`
 * without a user JWT and without `CRON_SECRET`: the caller sends the token in
 * an `x-internal-token` header. The token is 32 random bytes made once when
 * this module first loads; it is never read from the environment and never
 * logged, so it only ever authorizes calls made from this same process.
 *
 * Next builds instrumentation.js and pages/api/* as separate bundles, so this
 * module can load more than once in one process. The token is kept on
 * globalThis under Symbol.for('cosign.internalToken'): the first load creates
 * it, every later load reads the same one.
 */
import crypto from 'crypto';
import { safeEqual } from './cronAuth.js';

const TOKEN_KEY = Symbol.for('cosign.internalToken');

if (typeof globalThis[TOKEN_KEY] !== 'string') {
  Object.defineProperty(globalThis, TOKEN_KEY, {
    value: crypto.randomBytes(32).toString('hex'),
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

const INTERNAL_TOKEN = globalThis[TOKEN_KEY];

export function getInternalToken() {
  return INTERNAL_TOKEN;
}

/**
 * @param {object} req - the incoming request (needs `.headers`)
 * @returns {boolean}
 */
export function isInternalAuthorized(req) {
  const headers = (req && req.headers) || {};
  const presented = String(headers['x-internal-token'] || '').trim();
  if (!presented) return false;
  return safeEqual(presented, INTERNAL_TOKEN);
}
