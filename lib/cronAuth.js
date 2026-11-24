/**
 * Shared cron authentication. Vercel cron jobs send
 * `Authorization: Bearer <CRON_SECRET>`; manual triggers may use an
 * `x-cron-secret` header. We compare in constant time and only authorize when a
 * secret is actually configured (no secret → never authorized).
 *
 * Used by routes a Vercel cron drives, and by `/api/ocr` to let the OCR worker
 * be re-invoked by the cron without a user JWT (it resolves the org from the
 * document row instead).
 */
import crypto from 'crypto';

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * @param {object} req - the incoming request (needs `.headers`)
 * @param {string[]} [secrets] - override the configured secret list (tests)
 * @returns {boolean}
 */
export function isCronAuthorized(req, secrets) {
  const configured = (
    secrets || [process.env.CRON_SECRET, process.env.PROCESS_OCR_CRON_SECRET]
  ).filter(Boolean);
  if (configured.length === 0) return false;

  const headers = (req && req.headers) || {};
  const authHeader = String(headers.authorization || headers.Authorization || '');
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = String(headers['x-cron-secret'] || '').trim();
  const presented = bearer || headerSecret;
  if (!presented) return false;

  return configured.some((secret) => safeEqual(presented, secret));
}
