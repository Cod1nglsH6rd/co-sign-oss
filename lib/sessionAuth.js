/**
 * Session Authentication Utilities
 * Token-based auth for anonymous customer access to fill sessions
 */

import { createHash, randomBytes } from 'crypto';

const STRICT_SESSION_TOKEN_HASH_FLAG = 'COSIGN_SESSION_TOKEN_HASH_STRICT';

/**
 * Generate a secure random token and its SHA-256 hash
 * @returns {{ token: string, tokenHash: string }}
 */
export function generateSessionToken() {
  const token = randomBytes(32).toString('hex'); // 64 hex chars
  const tokenHash = hashToken(token);
  return { token, tokenHash };
}

/**
 * Hash a token using SHA-256
 * @param {string} token - Raw token
 * @returns {string} SHA-256 hex hash
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function isSessionTokenHashStrictEnabled() {
  // Strict by default: never fall back to a plaintext `token` lookup. We no
  // longer store plaintext tokens, so the fallback can only ever match legacy
  // rows — and silently allowing it weakens the at-rest guarantee. Set the flag
  // to "false" only to temporarily support un-migrated legacy rows.
  return String(process.env[STRICT_SESSION_TOKEN_HASH_FLAG] ?? 'true').toLowerCase() !== 'false';
}

async function enforceSessionState(session, supabase, options = {}) {
  if (!session) {
    return { error: 'not_found' };
  }

  if (session.status === 'revoked') {
    return { error: 'revoked' };
  }

  if (session.status === 'completed' && !options.allowCompleted) {
    return { error: 'already_completed' };
  }

  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    await supabase
      .from('fill_sessions')
      .update({ status: 'expired' })
      .eq('id', session.id);
    return { error: 'expired' };
  }

  return { session };
}

/**
 * Validate a session token against the database
 * Uses service role to bypass RLS (customers are anonymous)
 *
 * @param {string} token - Raw token from URL
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - Service role client
 * @param {object} [options]
 * @param {boolean} [options.allowCompleted] - If true, don't reject completed sessions
 * @returns {Promise<{ session?: object, error?: string }>}
 */
export async function validateSessionToken(token, supabase, options = {}) {
  if (!token || typeof token !== 'string' || token.length < 32) {
    return { error: 'invalid_token' };
  }

  const tokenHash = hashToken(token);

  const { data: session, error: dbError } = await supabase
    .from('fill_sessions')
    .select(`
      *,
      documents:document_id (
        id, org_id, user_id, created_by, file_name, file_url, file_path, file_type,
        page_count, status, is_multi_party, document_type,
        processing_status, metadata
      )
    `)
    .eq('token_hash', tokenHash)
    .single();

  if (dbError || !session) {
    if (isSessionTokenHashStrictEnabled()) {
      return { error: 'not_found' };
    }

    // Fallback for legacy rows or hash mismatch: attempt raw token lookup.
    const { data: legacySession, error: legacyError } = await supabase
      .from('fill_sessions')
      .select(`
        *,
        documents:document_id (
          id, org_id, user_id, created_by, file_name, file_url, file_path, file_type,
          page_count, status, is_multi_party, document_type,
          processing_status, metadata
        )
      `)
      .eq('token', token)
      .single();

    if (legacyError || !legacySession) {
      return { error: 'not_found' };
    }

    console.warn('[SessionAuth] Legacy plaintext token fallback used', {
      sessionId: legacySession.id,
    });

    return enforceSessionState(legacySession, supabase, options);
  }

  return enforceSessionState(session, supabase, options);
}

/**
 * Check if a session requires verification and if the verification token matches.
 * @param {object} session
 * @param {string | undefined} verificationToken
 * @returns {boolean}
 */
export function isSessionVerified(session, verificationToken) {
  if (!session?.recipient_email) return true;
  if (!verificationToken || !session.verification_token_hash) return false;
  const verificationHash = hashToken(verificationToken);
  return verificationHash === session.verification_token_hash;
}

/**
 * Extract client user from Supabase JWT in request headers
 * @param {import('http').IncomingMessage} req
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{ user?: object, error?: string }>}
 */
export async function authenticateClient(req, supabase) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'missing_auth' };
  }

  const token = authHeader.replace('Bearer ', '');

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { error: 'invalid_auth' };
  }

  return { user };
}
