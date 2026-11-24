/**
 * POST /api/sessions/[token]/sign
 *
 * Customer submits a signature for a signature-type field.
 *
 * Auth: Token in URL (anonymous access)
 *
 * Body: {
 *   fieldId: string (required),
 *   signatureDataUrl: string | null (required)
 *     - base64 PNG data URL to save signature
 *     - null/empty string to clear existing signature
 * }
 */

import { z } from 'zod';
import { validateSessionToken, isSessionVerified } from '../../../../lib/sessionAuth.js';
import { logAudit } from '../../../../lib/auditLog.js';
import { rateLimitPublic } from '../../../../lib/rateLimit';
import { enforceEmbedOriginForSession } from '../../../../lib/embedOrigin.js';
import { buildSessionFieldLookup, normalizeSessionFieldType } from '../../../../lib/sessionFieldMapping.js';
import { validateCsrfToken } from '../../../../lib/csrf.js';
import { requireServiceSupabase } from '../../../../lib/supabaseClient';
import {
  sendInvalidRequest,
  sendMethodNotAllowed,
  sendSessionError,
  sendTokenError,
} from '../../../../lib/sessionApiErrors.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendMethodNotAllowed(res);
  }

  try {
    const querySchema = z.object({ token: z.string().min(1) });
    const bodySchema = z.object({
      fieldId: z.union([z.string().min(1), z.number()]),
      signatureDataUrl: z.union([z.string(), z.null()]),
    });
    const queryResult = querySchema.safeParse(req.query);
    const bodyResult = bodySchema.safeParse(req.body || {});
    if (!queryResult.success || !bodyResult.success) {
      return sendInvalidRequest(res);
    }

    const { token } = queryResult.data;
    const { fieldId, signatureDataUrl } = bodyResult.data;

    if (!fieldId) {
      return sendInvalidRequest(res, 'fieldId is required');
    }
    const normalizedSignature = typeof signatureDataUrl === 'string'
      ? signatureDataUrl.trim()
      : signatureDataUrl;
    const isClearingSignature = normalizedSignature === '' || normalizedSignature === null;

    if (!isClearingSignature && !normalizedSignature.startsWith('data:image/')) {
      return sendInvalidRequest(res, 'Valid signature data URL is required');
    }

    // Reject oversized signature payloads (max ~500KB base64 ≈ ~375KB image)
    const MAX_SIGNATURE_BYTES = 512 * 1024;
    if (!isClearingSignature && normalizedSignature.length > MAX_SIGNATURE_BYTES) {
      return sendInvalidRequest(res, 'Signature image is too large (max 500KB)');
    }

    if (await rateLimitPublic(req, res, 'sessions-sign', token)) {
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
      endpoint: 'sessions-sign',
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
      return sendSessionError(res, 403, 'verification_required', 'Verification is required before signing');
    }

    if (!validateCsrfToken(req)) {
      return sendSessionError(res, 403, 'csrf_invalid', 'Invalid CSRF token. Please refresh the page and try again.');
    }

    // 2. Validate the field belongs to this document and is a signature type
    const { data: field, error: fieldError } = await supabase
      .from('fields')
      .select('id, field_name, field_type, sort_order')
      .eq('id', fieldId)
      .eq('document_id', session.document_id)
      .single();

    if (fieldError || !field) {
      return sendSessionError(res, 404, 'field_not_found', 'Field not found for this document');
    }

    const normalizedFieldType = normalizeSessionFieldType(field.field_type, field.field_name);
    if (normalizedFieldType !== 'signature') {
      return sendInvalidRequest(
        res,
        `Field "${field.field_name}" is not a signature field (type: ${field.field_type})`
      );
    }

    // 3. Check field is accessible to this session (field filter)
    if (session.field_filter?.ids) {
      const allowedIds = new Set(session.field_filter.ids.map(String));
      if (!allowedIds.has(String(fieldId))) {
        return sendSessionError(res, 403, 'field_not_assigned', 'Field not assigned to this session');
      }
    }

    const fieldLookup = buildSessionFieldLookup([field]);
    const storageFieldId = fieldLookup.resolveStorageId(field.id);
    if (!storageFieldId) {
      return sendSessionError(res, 400, 'field_not_mappable', 'Field could not be mapped for this session');
    }

    // 4. Save or clear signature
    const now = new Date().toISOString();
    if (isClearingSignature) {
      const { error: clearError } = await supabase
        .from('session_fields')
        .delete()
        .eq('session_id', session.id)
        .eq('field_id', storageFieldId);

      if (clearError) {
        console.error('[Sessions] Sign clear error:', clearError);
        return sendSessionError(res, 500, 'signature_clear_failed', 'Failed to clear signature');
      }

      await logAudit(supabase, {
        action: 'signature_cleared',
        entityType: 'fill_session',
        entityId: session.id,
        actorType: 'customer',
        sessionId: session.id,
        documentId: session.document_id,
        details: {
          field_id: fieldId,
          field_name: field.field_name,
          cleared_at: now,
        },
        req,
      });

      return res.status(200).json({
        success: true,
        fieldId: field.id,
        fieldName: field.field_name,
        clearedAt: now,
      });
    }

    const { data: saved, error: upsertError } = await supabase
      .from('session_fields')
      .upsert([{
        session_id: session.id,
        field_id: storageFieldId,
        field_value: '[signature]',
        signature_data_url: normalizedSignature,
        signature_timestamp: now,
        filled_at: now,
      }], { onConflict: 'session_id,field_id' })
      .select()
      .single();

    if (upsertError) {
      console.error('[Sessions] Sign upsert error:', upsertError);
      return sendSessionError(res, 500, 'signature_save_failed', 'Failed to save signature');
    }

    // 5. Update session status
    if (session.status === 'pending' || session.status === 'opened' || session.status === 'sent') {
      await supabase
        .from('fill_sessions')
        .update({ status: 'in_progress' })
        .eq('id', session.id);
    }

    // 6. Log audit event
    await logAudit(supabase, {
      action: 'signed',
      entityType: 'fill_session',
      entityId: session.id,
      actorType: 'customer',
      sessionId: session.id,
      documentId: session.document_id,
      details: {
        field_id: fieldId,
        field_name: field.field_name,
        signature_timestamp: now,
      },
      req,
    });

    return res.status(200).json({
      success: true,
      fieldId: field.id,
      fieldName: field.field_name,
      signedAt: now,
    });
  } catch (err) {
    console.error('[Sessions] Sign error:', err);
    return sendSessionError(res, 500, 'internal_error', 'Internal server error');
  }
}
