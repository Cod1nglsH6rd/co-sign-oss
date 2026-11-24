/**
 * GET /api/sessions/[token]
 *
 * Customer loads their fill session — returns document info,
 * translated fields, and current fill progress.
 *
 * Auth: Token in URL (anonymous access)
 */

import { z } from 'zod';
import { validateSessionToken, isSessionVerified } from '../../../../lib/sessionAuth.js';
import { logAudit } from '../../../../lib/auditLog.js';
import { rateLimitPublic } from '../../../../lib/rateLimit';
import { getRequiredFieldIdSet } from '../../../../lib/sessionFieldRules.js';
import { enforceEmbedOriginForSession } from '../../../../lib/embedOrigin.js';
import { buildSessionFieldLookup, normalizeSessionFieldType } from '../../../../lib/sessionFieldMapping.js';
import { getExplanation, getPositionHint, getAllTranslations } from '../../../../lib/fieldTranslations.js';
import { generateCsrfToken, setCsrfCookie } from '../../../../lib/csrf.js';
import { requireServiceSupabase } from '../../../../lib/supabaseClient';
import {
  sendInvalidRequest,
  sendMethodNotAllowed,
  sendSessionError,
  sendTokenError,
} from '../../../../lib/sessionApiErrors.js';

function toFiniteNumber(value) {
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeFieldPosition(position) {
  if (!position || typeof position !== 'object') return null;

  let x = toFiniteNumber(position.x);
  let y = toFiniteNumber(position.y);
  let width = toFiniteNumber(position.width ?? position.w);
  let height = toFiniteNumber(position.height ?? position.h);
  const page = toFiniteNumber(position.page) || 1;

  if ((x === null || y === null || width === null || height === null) && Array.isArray(position.rect) && position.rect.length === 4) {
    const [left, top, right, bottom] = position.rect.map(toFiniteNumber);
    if ([left, top, right, bottom].every((v) => v !== null)) {
      x = left;
      y = top;
      width = right - left;
      height = bottom - top;
    }
  }

  if (x === null || y === null || width === null || height === null) return null;

  if (width <= 0 || height <= 0) return null;

  // Fractional coordinates (0..1)
  if (x >= 0 && x <= 1 && y >= 0 && y <= 1 && width > 0 && width <= 1 && height > 0 && height <= 1) {
    x *= 100;
    y *= 100;
    width *= 100;
    height *= 100;
  }

  // Absolute point coordinates fallback (legacy)
  if (x > 100 || y > 100 || width > 100 || height > 100) {
    const DEFAULT_PAGE_WIDTH = 612;
    const DEFAULT_PAGE_HEIGHT = 792;
    x = (x / DEFAULT_PAGE_WIDTH) * 100;
    y = (y / DEFAULT_PAGE_HEIGHT) * 100;
    width = (width / DEFAULT_PAGE_WIDTH) * 100;
    height = (height / DEFAULT_PAGE_HEIGHT) * 100;
  }

  x = clamp(x, 0, 100);
  y = clamp(y, 0, 100);
  width = clamp(width, 0.5, 100);
  height = clamp(height, 0.5, 100);

  return {
    page,
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10,
    source: position.source || 'unknown',
  };
}

function isFieldFilled(field) {
  const value = field.currentValue;
  if (field.fieldType === 'signature') {
    return Boolean(field.signature);
  }
  if (field.fieldType === 'checkbox') {
    return value === 'true' || value === true;
  }
  return value !== null && value !== undefined && String(value).trim() !== '';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendMethodNotAllowed(res);
  }

  try {
    // Session payload contains access-sensitive state (verification gate, signed file URL).
    // Prevent browser/proxy caching to avoid stale 304 responses in fill flow.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const querySchema = z.object({ token: z.string().min(1) });
    const parseResult = querySchema.safeParse(req.query);
    if (!parseResult.success) {
      return sendInvalidRequest(res, 'Invalid token');
    }

    const { token } = parseResult.data;

    if (await rateLimitPublic(req, res, 'sessions-index', token)) {
      return;
    }

    const supabase = requireServiceSupabase();

    // 1. Validate token
    const { session, error: tokenError } = await validateSessionToken(token, supabase, {
      allowCompleted: true, // Allow viewing completed sessions (read-only)
    });

    if (tokenError) {
      return sendTokenError(res, tokenError);
    }

    const embedOriginCheck = enforceEmbedOriginForSession({
      req,
      session,
      endpoint: 'sessions-index',
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
    const verified = isSessionVerified(session, verificationToken);

    // Anyone holding the link gets this answer, so it carries nothing derived
    // from the recipient's address (it used to send a masked email with the
    // whole domain). The fill page asks for "the email this link was sent to".
    if (session.recipient_email && !verified) {
      return res.status(200).json({
        success: true,
        requiresVerification: true,
        requiresLastName: Boolean(session.recipient_last_name),
      });
    }

    const preferredLanguage = session.preferred_language || 'en';
    const isNonEnglishSession = preferredLanguage !== 'en';
    const documentStillFinalizing = session.documents?.processing_status === 'finalizing'
      || Boolean(session.documents?.metadata?.post_setup);

    // If recipient selected non-English and post-setup language enrichment is still running,
    // keep the fill experience on the loading screen until language data is ready.
    if (isNonEnglishSession && documentStillFinalizing) {
      return sendSessionError(res, 409, 'not_ready', 'Not ready yet');
    }

    // 2. Mark as opened if first visit
    if (!session.first_opened_at) {
      await supabase
        .from('fill_sessions')
        .update({
          status: 'opened',
          first_opened_at: new Date().toISOString(),
        })
        .eq('id', session.id);

      if (session.status !== 'completed' && !session.completed_at) {
        await supabase
          .from('documents')
          .update({ lifecycle_status: 'opened' })
          .eq('id', session.document_id);
      }

      await logAudit(supabase, {
        action: 'opened',
        entityType: 'fill_session',
        entityId: session.id,
        actorType: 'customer',
        sessionId: session.id,
        documentId: session.document_id,
        req,
      });
    }

    // 3. Fetch all fields for the document
    const { data: allFields, error: fieldsError } = await supabase
      .from('fields')
      .select('*')
      .eq('document_id', session.document_id)
      .order('sort_order', { ascending: true });

    if (fieldsError) {
      return sendSessionError(res, 500, 'fields_load_failed', 'Failed to load fields');
    }

    // 4. Apply role-based field filter if set
    let visibleFields = allFields || [];
    if (session.field_filter?.ids) {
      const filterIds = new Set(session.field_filter.ids.map(String));
      visibleFields = visibleFields.filter(f => filterIds.has(String(f.id)));
    }

    const fieldLookup = buildSessionFieldLookup(visibleFields);

    // 5. Fetch existing filled values for this session
    const { data: sessionFields } = await supabase
      .from('session_fields')
      .select('field_id, field_value, signature_data_url, signature_timestamp, filled_at')
      .eq('session_id', session.id);

    const filledMap = {};
    (sessionFields || []).forEach(sf => {
      const resolvedFieldId = fieldLookup.resolveFieldId(sf.field_id);
      if (resolvedFieldId) filledMap[resolvedFieldId] = sf;
    });

    // 6. Build translated field response
    const lang = session.preferred_language || 'en';
    const availableLanguages = ['en'];
    if (session.preferred_language && session.preferred_language !== 'en') {
      availableLanguages.push(session.preferred_language);
    }
    const requiredFieldIds = getRequiredFieldIdSet(visibleFields, session);

    const responseFields = visibleFields.map(f => {
      const filled = filledMap[f.id];
      const normalizedPosition = normalizeFieldPosition(f.position);
      const normalizedFieldType = normalizeSessionFieldType(f.field_type, f.field_name);
      return {
        id: f.id,
        fieldName: f.field_name,
        fieldType: normalizedFieldType,
        sortOrder: f.sort_order,
        position: normalizedPosition,
        hasPosition: !!normalizedPosition,
        translations: getAllTranslations(f),
        explanation: getExplanation(f, lang),
        positionHint: getPositionHint(f, lang),
        currentValue: filled?.field_value || null,
        signature: filled?.signature_data_url || null,
        signatureTimestamp: filled?.signature_timestamp || null,
        filledAt: filled?.filled_at || null,
        required: requiredFieldIds.has(String(f.id)),
      };
    });

    // 7. Calculate progress
    const requiredResponseFields = responseFields.filter((f) => f.required !== false);
    const filledCount = requiredResponseFields.filter((f) => isFieldFilled(f)).length;
    const signatureFields = responseFields.filter(f => f.fieldType === 'signature');
    const signedCount = signatureFields.filter(f => f.signature).length;

    // Issue CSRF token cookie for this session — client echoes it back on state-changing requests
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken, req);

    return res.status(200).json({
      success: true,
      session: {
        id: session.id,
        documentId: session.document_id,
        documentName: session.documents?.file_name,
        fileType: session.documents?.file_type,
        pageCount: session.documents?.page_count,
        status: session.status,
        preferredLanguage: session.preferred_language,
        availableLanguages,
        assignedRole: session.assigned_role,
        requireSignature: session.require_signature,
        expiresAt: session.expires_at,
        createdAt: session.created_at,
        completedAt: session.completed_at,
        embedOrigin: session.embed_origin || null,
      },
      fields: responseFields,
      fillProgress: {
        total: requiredResponseFields.length,
        filled: filledCount,
        signatureRequired: session.require_signature,
        signatureCount: signatureFields.length,
        signed: signedCount,
        isComplete: filledCount === requiredResponseFields.length
          && (!session.require_signature || signedCount >= signatureFields.length),
      },
    });
  } catch (err) {
    console.error('[Sessions] Load error:', err);
    return sendSessionError(res, 500, 'internal_error', 'Internal server error');
  }
}
