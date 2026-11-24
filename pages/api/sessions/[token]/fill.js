/**
 * PUT /api/sessions/[token]/fill
 *
 * Customer saves filled field values for their session.
 * Supports saving as draft (partial) or pre-submission saves.
 *
 * Auth: Token in URL (anonymous access)
 *
 * Body: {
 *   fieldValues: { [fieldId]: value },
 *   saveAsDraft?: boolean
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

function isFilledFieldValue(fieldType, fieldValue, signatureDataUrl) {
  if (fieldType === 'signature') return Boolean(signatureDataUrl);
  if (fieldType === 'checkbox') return fieldValue === 'true' || fieldValue === true;
  return fieldValue !== null && fieldValue !== undefined && String(fieldValue).trim() !== '';
}

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return sendMethodNotAllowed(res);
  }

  try {
    const querySchema = z.object({ token: z.string().min(1) });
    const bodySchema = z.object({
      fieldValues: z.record(z.any()),
      saveAsDraft: z.boolean().optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    const bodyResult = bodySchema.safeParse(req.body || {});
    if (!queryResult.success || !bodyResult.success) {
      return sendInvalidRequest(res);
    }

    const { token } = queryResult.data;
    const { fieldValues, saveAsDraft = true } = bodyResult.data;

    if (!fieldValues || typeof fieldValues !== 'object') {
      return sendSessionError(res, 400, 'field_values_required', 'fieldValues object is required');
    }

    const MAX_FIELDS_PER_REQUEST = 200;
    const MAX_FIELD_VALUE_LENGTH = 10000;
    const fieldEntries = Object.entries(fieldValues);
    if (fieldEntries.length > MAX_FIELDS_PER_REQUEST) {
      return sendInvalidRequest(res, `Too many fields (max ${MAX_FIELDS_PER_REQUEST})`);
    }
    const oversizedField = fieldEntries.find(
      ([_, v]) => typeof v === 'string' && v.length > MAX_FIELD_VALUE_LENGTH
    );
    if (oversizedField) {
      return sendInvalidRequest(res, `Field value too large (max ${MAX_FIELD_VALUE_LENGTH} characters)`);
    }

    if (await rateLimitPublic(req, res, 'sessions-fill', token)) {
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
      endpoint: 'sessions-fill',
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
      return sendSessionError(res, 403, 'verification_required', 'Verification is required before saving');
    }

    // CSRF validation — require token echo for state-changing operations
    if (!validateCsrfToken(req)) {
      return sendSessionError(res, 403, 'csrf_invalid', 'Invalid CSRF token. Please refresh the page and try again.');
    }

    // 2. Validate field IDs belong to this document
    const { data: docFields } = await supabase
      .from('fields')
      .select('id, field_type, sort_order, field_name')
      .eq('document_id', session.document_id);

    const fieldLookup = buildSessionFieldLookup(docFields || []);
    const validFieldIds = new Set((docFields || []).map(f => String(f.id)));

    // Apply field filter if exists
    const allowedFieldIds = session.field_filter?.ids
      ? new Set(session.field_filter.ids.map(String))
      : validFieldIds;

    const invalidIds = Object.keys(fieldValues).filter(id =>
      !validFieldIds.has(String(id)) || !allowedFieldIds.has(String(id))
    );

    if (invalidIds.length > 0) {
      return sendSessionError(
        res,
        400,
        'invalid_field_ids',
        'Some fields are invalid for this session',
        { invalidIds }
      );
    }

    // 3. Upsert field values
    const now = new Date().toISOString();
    const upsertData = Object.entries(fieldValues)
      .filter(([_, value]) => value !== undefined)
      .map(([fieldId, value]) => {
        const storageFieldId = fieldLookup.resolveStorageId(fieldId);
        if (!storageFieldId) return null;
        return {
          session_id: session.id,
          field_id: storageFieldId,
          field_value: String(value),
          filled_at: now,
        };
      })
      .filter(Boolean);

    if (upsertData.length === 0) {
      return sendSessionError(res, 400, 'no_valid_values', 'No valid field values to save');
    }

    const { data: saved, error: upsertError } = await supabase
      .from('session_fields')
      .upsert(upsertData, { onConflict: 'session_id,field_id' })
      .select();

    if (upsertError) {
      console.error('[Sessions] Fill upsert error:', upsertError);
      return sendSessionError(res, 500, 'save_failed', 'Failed to save field values');
    }

    // 4. Update session status to in_progress
    if (session.status === 'pending' || session.status === 'opened' || session.status === 'sent') {
      await supabase
        .from('fill_sessions')
        .update({ status: 'in_progress' })
        .eq('id', session.id);
    }

    // 5. Log audit event
    await logAudit(supabase, {
      action: 'filled',
      entityType: 'fill_session',
      entityId: session.id,
      actorType: 'customer',
      sessionId: session.id,
      documentId: session.document_id,
      details: {
        field_count: upsertData.length,
        save_as_draft: saveAsDraft,
      },
      req,
    });

    // 6. Calculate updated progress
    const { data: allFilled } = await supabase
      .from('session_fields')
      .select('field_id, field_value, signature_data_url')
      .eq('session_id', session.id);

    const fieldTypeById = new Map((docFields || []).map((field) => {
      const storageId = fieldLookup.resolveStorageId(field.id);
      return [String(storageId), normalizeSessionFieldType(field.field_type, field.field_name)];
    }));
    const filledCount = (allFilled || []).filter((item) => {
      const fieldType = fieldTypeById.get(String(item.field_id)) || 'text';
      return isFilledFieldValue(fieldType, item.field_value, item.signature_data_url);
    }).length;
    const signedCount = (allFilled || []).filter(f => f.signature_data_url).length;

    // Total fields visible to this session
    const totalFields = session.field_filter?.ids
      ? session.field_filter.ids.length
      : (docFields || []).length;

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      savedCount: saved.length,
      fillProgress: {
        total: totalFields,
        filled: filledCount,
        signed: signedCount > 0,
      },
    });
  } catch (err) {
    console.error('[Sessions] Fill error:', err);
    return sendSessionError(res, 500, 'internal_error', 'Internal server error');
  }
}
