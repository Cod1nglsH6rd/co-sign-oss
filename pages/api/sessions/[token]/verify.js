/**
 * POST /api/sessions/[token]/verify
 *
 * Customer confirms the recipient email + last name before accessing the session.
 *
 * Body: { email, lastName }
 */

import { z } from 'zod';
import { timingSafeEqual } from 'crypto';
import { validateSessionToken, generateSessionToken, hashToken } from '../../../../lib/sessionAuth.js';
import { rateLimitPublic } from '../../../../lib/rateLimit';
import { enforceEmbedOriginForSession } from '../../../../lib/embedOrigin.js';
import { requireServiceSupabase } from '../../../../lib/supabaseClient';
import {
  sendInvalidRequest,
  sendMethodNotAllowed,
  sendSessionError,
  sendTokenError,
} from '../../../../lib/sessionApiErrors.js';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

// Constant-time equality on the normalized values so an attacker can't use
// response timing to confirm a partially-correct email / last name.
function safeMatch(a, b) {
  const aBuf = Buffer.from(normalize(a), 'utf8');
  const bBuf = Buffer.from(normalize(b), 'utf8');
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

const MAX_VERIFY_ATTEMPTS = 5;
const LOCKOUT_SECONDS = [0, 30, 60, 300, 900, 3600]; // 0s, 30s, 1m, 5m, 15m, 1h
// Tries at counting one attempt while other requests change the count.
const MAX_COUNT_TRIES = 5;

// The 429 for a count of `attempts` failed attempts, the last at `lastAt`,
// or null when another attempt may be made now.
function lockoutFor(attempts, lastAt) {
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    return {
      message: 'Too many failed verification attempts. Please request a new session link.',
      extra: {},
    };
  }
  if (attempts > 0 && lastAt) {
    const lastAttempt = new Date(lastAt).getTime();
    const lockoutIndex = Math.min(attempts, LOCKOUT_SECONDS.length - 1);
    const lockoutMs = LOCKOUT_SECONDS[lockoutIndex] * 1000;
    if (Date.now() - lastAttempt < lockoutMs) {
      const remaining = Math.ceil((lockoutMs - (Date.now() - lastAttempt)) / 1000);
      return {
        message: `Too many failed attempts. Try again in ${remaining} seconds.`,
        extra: { retryAfter: remaining },
      };
    }
  }
  return null;
}

/**
 * Count this attempt before its details are compared, so that every
 * comparison is counted however many requests arrive together.
 *
 * Who sets the count: fill_sessions.verification_attempts and
 * last_verify_attempt_at are written by this route with the service role
 * and can also be edited by the session's own client (staff of its
 * organisation) under RLS; the signer cannot write them. The value read
 * with the session is only a starting point: the update below is a
 * compare-and-set (where id = X and verification_attempts = N, set N + 1,
 * returning the row), and an update that changed no row means another
 * request counted first, so the count is read again and the lockout checked
 * again, at most MAX_COUNT_TRIES times. The lockout decision uses the count
 * the update returned.
 *
 * @returns {Promise<{ counted: number } | { lockout: { message: string, extra: object } } | { error: string }>}
 */
async function countAttempt(supabase, session) {
  let seen = session.verification_attempts;
  let lastAt = session.last_verify_attempt_at;

  for (let attempt = 0; attempt < MAX_COUNT_TRIES; attempt += 1) {
    const attempts = Number(seen) || 0;
    const lockout = lockoutFor(attempts, lastAt);
    if (lockout) return { lockout };

    let update = supabase
      .from('fill_sessions')
      .update({
        verification_attempts: attempts + 1,
        last_verify_attempt_at: new Date().toISOString(),
      })
      .eq('id', session.id);
    update = seen === null || seen === undefined
      ? update.is('verification_attempts', null)
      : update.eq('verification_attempts', seen);
    const { data, error } = await update.select('verification_attempts');
    if (error) return { error: error.message };

    if (Array.isArray(data) && data.length > 0) {
      const counted = Number(data[0].verification_attempts);
      if (!Number.isFinite(counted) || counted > MAX_VERIFY_ATTEMPTS) {
        return { lockout: lockoutFor(MAX_VERIFY_ATTEMPTS, null) };
      }
      return { counted };
    }

    const { data: fresh, error: readError } = await supabase
      .from('fill_sessions')
      .select('verification_attempts, last_verify_attempt_at')
      .eq('id', session.id)
      .maybeSingle();
    if (readError || !fresh) return { error: readError?.message || 'session row not found' };
    seen = fresh.verification_attempts;
    lastAt = fresh.last_verify_attempt_at;
  }

  return {
    lockout: {
      message: 'Too many verification attempts at once. Try again in a few seconds.',
      extra: { retryAfter: 5 },
    },
  };
}

function maskEmail(email) {
  if (!email) return '';
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  const maskedName = `${name[0]}***${name[name.length - 1] || ''}`;
  return `${maskedName}@${domain}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendMethodNotAllowed(res);
  }

  try {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const querySchema = z.object({ token: z.string().min(1) });
    const bodySchema = z.object({
      email: z.string().min(3).max(320),
      lastName: z.string().optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    const bodyResult = bodySchema.safeParse(req.body || {});
    if (!queryResult.success || !bodyResult.success) {
      return sendInvalidRequest(res);
    }

    const { token } = queryResult.data;
    const { email, lastName } = bodyResult.data;

    if (!email) {
      return sendInvalidRequest(res, 'email is required');
    }

    if (await rateLimitPublic(req, res, 'sessions-verify', token)) {
      return;
    }

    const supabase = requireServiceSupabase();
    const { session, error: tokenError } = await validateSessionToken(token, supabase, {
      allowCompleted: true,
    });

    if (tokenError) {
      return sendTokenError(res, tokenError);
    }

    // Per-token progressive lockout. A first look with the count read along
    // with the session; countAttempt below decides with the count it wrote.
    const early = lockoutFor(Number(session.verification_attempts) || 0, session.last_verify_attempt_at);
    if (early) {
      return sendSessionError(res, 429, 'verify_locked', early.message, early.extra);
    }

    const embedOriginCheck = enforceEmbedOriginForSession({
      req,
      session,
      endpoint: 'sessions-verify',
    });
    if (!embedOriginCheck.ok) {
      return sendSessionError(
        res,
        embedOriginCheck.status,
        embedOriginCheck.errorCode,
        embedOriginCheck.message
      );
    }

    // Counted before the comparison: the details are compared only once this
    // attempt's own increment has landed (a right answer resets it below).
    const count = await countAttempt(supabase, session);
    if (count.error) {
      console.error('[Sessions] Verify attempt could not be counted', {
        sessionId: session.id,
        message: count.error,
      });
      return sendSessionError(res, 500, 'verification_update_failed', 'Could not complete verification');
    }
    if (count.lockout) {
      return sendSessionError(res, 429, 'verify_locked', count.lockout.message, count.lockout.extra);
    }

    const matchesEmail = safeMatch(email, session.recipient_email);
    const hasLastName = Boolean(normalize(session.recipient_last_name));
    const matchesLast = hasLastName ? safeMatch(lastName, session.recipient_last_name) : true;

    if (!matchesEmail || !matchesLast) {
      // Do NOT echo the masked email on a failed attempt — that would confirm a
      // valid token and leak the recipient's email domain to a guesser.
      return sendSessionError(
        res,
        403,
        'verification_failed',
        'Verification details did not match'
      );
    }

    const { token: verificationToken } = generateSessionToken();
    const verificationHash = hashToken(verificationToken);

    const verifiedAt = new Date().toISOString();
    let { error: updateError } = await supabase
      .from('fill_sessions')
      .update({
        verification_token_hash: verificationHash,
        verified_at: verifiedAt,
        verification_attempts: 0,
        last_verify_attempt_at: null,
      })
      .eq('id', session.id);

    // Backward-compatible fallback for environments where `verified_at` is not present yet.
    if (updateError && /verified_at|column/i.test(updateError.message || '')) {
      console.warn('[Sessions] Verify update fallback (without verified_at)', {
        sessionId: session.id,
        message: updateError.message,
      });
      const fallback = await supabase
        .from('fill_sessions')
        .update({
          verification_token_hash: verificationHash,
        })
        .eq('id', session.id);
      updateError = fallback.error || null;
    }

    if (updateError) {
      console.error('[Sessions] Verify update failed', {
        sessionId: session.id,
        message: updateError.message,
      });
      return sendSessionError(res, 500, 'verification_update_failed', 'Could not complete verification');
    }

    return res.status(200).json({
      success: true,
      verificationToken,
      maskedEmail: maskEmail(session.recipient_email),
    });
  } catch (err) {
    console.error('[Sessions] Verify error:', err);
    return sendSessionError(res, 500, 'internal_error', 'Internal server error');
  }
}
