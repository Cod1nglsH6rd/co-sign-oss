/**
 * GET /api/sessions/[token]/document-url
 *
 * Returns a fresh signed document URL on demand.
 * The signed URL is only issued if the session is verified — preventing
 * unauthenticated access to documents via exposed URLs.
 *
 * Auth: Token in URL + verified session (x-session-verify header)
 */

import { z } from 'zod';
import { validateSessionToken, isSessionVerified } from '../../../../lib/sessionAuth.js';
import { rateLimitPublic } from '../../../../lib/rateLimit';
import { enforceEmbedOriginForSession } from '../../../../lib/embedOrigin.js';
import { requireServiceSupabase } from '../../../../lib/supabaseClient';
import { publicStorageUrlFor } from '../../../../lib/publicStorageUrl';
import { isDocumentPathOwnedBy } from '../../../../lib/storagePaths';
import {
  sendInvalidRequest,
  sendMethodNotAllowed,
  sendSessionError,
  sendTokenError,
} from '../../../../lib/sessionApiErrors.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendMethodNotAllowed(res);
  }

  try {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const querySchema = z.object({ token: z.string().min(1) });
    const parseResult = querySchema.safeParse(req.query);
    if (!parseResult.success) {
      return sendInvalidRequest(res, 'Invalid token');
    }

    const { token } = parseResult.data;

    if (await rateLimitPublic(req, res, 'sessions-doc-url', token)) {
      return;
    }

    const supabase = requireServiceSupabase();

    const { session, error: tokenError } = await validateSessionToken(token, supabase, {
      allowCompleted: true,
    });

    if (tokenError) {
      return sendTokenError(res, tokenError);
    }

    const embedOriginCheck = enforceEmbedOriginForSession({
      req,
      session,
      endpoint: 'sessions-doc-url',
    });
    if (!embedOriginCheck.ok) {
      return sendSessionError(
        res,
        embedOriginCheck.status,
        embedOriginCheck.errorCode,
        embedOriginCheck.message
      );
    }

    // Require verification if email-gated
    if (session.recipient_email) {
      const verificationToken = req.headers['x-session-verify'];
      if (!isSessionVerified(session, verificationToken)) {
        return sendSessionError(
          res,
          403,
          'verification_required',
          'Session must be verified before accessing the document'
        );
      }
    }

    if (!session.documents?.file_path) {
      return sendSessionError(
        res,
        404,
        'document_not_found',
        'No document file found for this session'
      );
    }

    // file_path is editable by the document's organisation members, and the
    // URL below is signed with the service role: only a path inside the
    // document owner's own folder is signed.
    if (!isDocumentPathOwnedBy(session.documents.file_path, session.documents)) {
      console.warn('[Sessions] Document URL refused: file path outside the owner folder', {
        sessionId: session.id,
        documentId: session.document_id,
      });
      return sendSessionError(
        res,
        403,
        'document_path_not_allowed',
        'This document file cannot be served'
      );
    }

    const SIGNED_URL_TTL_SECONDS = 15 * 60;
    const { data: signed, error: signError } = await supabase.storage
      .from('documents')
      .createSignedUrl(session.documents.file_path, SIGNED_URL_TTL_SECONDS);

    if (signError || !signed?.signedUrl) {
      console.error('[Sessions] Document URL sign error:', signError?.message);
      return sendSessionError(
        res,
        500,
        'document_url_failed',
        'Could not generate document access URL'
      );
    }

    return res.status(200).json({
      success: true,
      documentUrl: publicStorageUrlFor(signed.signedUrl, req),
      expiresAt: signed.expiresAt || null,
    });
  } catch (err) {
    console.error('[Sessions] Document URL error:', err);
    return sendSessionError(res, 500, 'internal_error', 'Internal server error');
  }
}
