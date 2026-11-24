/**
 * PUT /api/sessions/[token]/language
 *
 * Customer changes their preferred language for the fill session.
 *
 * Auth: Token in URL (anonymous access)
 *
 * Body: {
 *   language: 'en' | 'vi' | 'es'
 * }
 */

import { z } from 'zod';
import { validateSessionToken, isSessionVerified } from '../../../../lib/sessionAuth.js';
import { rateLimitPublic } from '../../../../lib/rateLimit';
import { enforceEmbedOriginForSession } from '../../../../lib/embedOrigin.js';
import { requireServiceSupabase } from '../../../../lib/supabaseClient';
import {
  sendInvalidRequest,
  sendMethodNotAllowed,
  sendSessionError,
  sendTokenError,
} from '../../../../lib/sessionApiErrors.js';

const SUPPORTED_LANGUAGES = ['en', 'vi', 'es', 'pt', 'fr', 'zh', 'yue', 'ht', 'ne'];

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return sendMethodNotAllowed(res);
  }

  try {
    const querySchema = z.object({ token: z.string().min(1) });
    const bodySchema = z.object({ language: z.string().min(2) });
    const queryResult = querySchema.safeParse(req.query);
    const bodyResult = bodySchema.safeParse(req.body || {});
    if (!queryResult.success || !bodyResult.success) {
      return sendInvalidRequest(res);
    }

    const { token } = queryResult.data;
    const { language } = bodyResult.data;

    if (!language || !SUPPORTED_LANGUAGES.includes(language)) {
      return sendInvalidRequest(
        res,
        `Invalid language. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`
      );
    }

    if (await rateLimitPublic(req, res, 'sessions-language', token)) {
      return;
    }

    const supabase = requireServiceSupabase();

    // 1. Validate session
    const { session, error: tokenError } = await validateSessionToken(token, supabase);
    if (tokenError) {
      return sendTokenError(res, tokenError);
    }

    const embedOriginCheck = enforceEmbedOriginForSession({
      req,
      session,
      endpoint: 'sessions-language',
    });
    if (!embedOriginCheck.ok) {
      return sendSessionError(
        res,
        embedOriginCheck.status,
        embedOriginCheck.errorCode,
        embedOriginCheck.message
      );
    }

    if (session.status === 'queued') {
      return sendSessionError(res, 409, 'not_ready', 'Document is still being prepared');
    }

    const verificationToken = req.headers['x-session-verify'];
    if (!isSessionVerified(session, verificationToken)) {
      return sendSessionError(res, 403, 'verification_required', 'Verification is required before changing language');
    }

    const allowedLanguages = ['en'];
    if (session.preferred_language && session.preferred_language !== 'en') {
      allowedLanguages.push(session.preferred_language);
    }

    if (!allowedLanguages.includes(language)) {
      return sendInvalidRequest(res, 'Language not available for this session');
    }

    // 2. Update language
    const { error: updateError } = await supabase
      .from('fill_sessions')
      .update({ preferred_language: language })
      .eq('id', session.id);

    if (updateError) {
      return sendSessionError(res, 500, 'language_update_failed', 'Failed to update language');
    }

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      language,
    });
  } catch (err) {
    console.error('[Sessions] Language update error:', err);
    return sendSessionError(res, 500, 'internal_error', 'Internal server error');
  }
}
