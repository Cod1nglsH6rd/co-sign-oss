/**
 * POST /api/sessions/[token]/complete
 *
 * Customer finalizes their session — validates all required fields are filled,
 * generates a filled PDF, uploads it, marks session complete, and notifies client.
 *
 * Auth: Token in URL (anonymous access)
 *
 * Body: {
 *   generatePdf?: boolean (default true)
 * }
 */

import { createHash } from 'crypto';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { z } from 'zod';
import { validateSessionToken, isSessionVerified } from '../../../../lib/sessionAuth.js';
import { logAudit } from '../../../../lib/auditLog.js';
import { generateFilledPdf } from '../../../../lib/exportPdf.js';
import { sendCompletionNotificationEmail } from '../../../../lib/email.js';
import { rateLimitPublic } from '../../../../lib/rateLimit';
import { getRequiredFieldIdSet } from '../../../../lib/sessionFieldRules.js';
import { enforceEmbedOriginForSession } from '../../../../lib/embedOrigin.js';
import {
  downloadDocumentBinary,
  DocumentSourceNotAllowedError,
  DOCUMENT_SOURCE_NOT_ALLOWED_MESSAGE,
} from '../../../../lib/documentFetch.js';
import { buildSessionFieldLookup, normalizeSessionFieldType } from '../../../../lib/sessionFieldMapping.js';
import { validateCsrfToken } from '../../../../lib/csrf.js';
import { requireServiceSupabase } from '../../../../lib/supabaseClient';
import { publicStorageUrlFor, publicStorageUrlForEmail } from '../../../../lib/publicStorageUrl';
import { filledPdfPath, assertDocumentPathOwned } from '../../../../lib/storagePaths';
import {
  sendInvalidRequest,
  sendMethodNotAllowed,
  sendSessionError,
  sendTokenError,
} from '../../../../lib/sessionApiErrors.js';

// public/ sits in the working folder: the repo root under `next start`, and
// /app in the Docker image (its standalone server.js changes to its own
// folder, and the image copies public/ next to it).
function exportFontFile() {
  return path.join(process.cwd(), 'public', 'fonts', 'NotoSans-Regular.ttf');
}
let exportFontBytes = null;

/**
 * Read the Unicode export font (public/fonts) from disk, so the signed PDF
 * keeps Vietnamese letters. No HTTP request: the old fetch went to the
 * request's Host when no site address was saved, which let an anonymous
 * signer make the server call any host and port. Returns null on any failure:
 * the export then falls back to Helvetica and must never fail the completion
 * because of it.
 */
async function loadExportFontBytes() {
  if (exportFontBytes) return exportFontBytes;
  try {
    const bytes = await fsPromises.readFile(exportFontFile());
    exportFontBytes = new Uint8Array(bytes);
    return exportFontBytes;
  } catch (err) {
    console.warn('[Sessions] Export font unavailable, signed PDF falls back to Helvetica:', err?.code || err?.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendMethodNotAllowed(res);
  }

  try {
    const querySchema = z.object({ token: z.string().min(1) });
    const bodySchema = z.object({
      generatePdf: z.boolean().optional(),
    });
    const queryResult = querySchema.safeParse(req.query);
    const bodyResult = bodySchema.safeParse(req.body || {});
    if (!queryResult.success || !bodyResult.success) {
      return sendInvalidRequest(res);
    }

    const { token } = queryResult.data;
    const { generatePdf: shouldGeneratePdf = true } = bodyResult.data;
    const supabase = requireServiceSupabase();

    if (await rateLimitPublic(req, res, 'sessions-complete', token)) {
      return;
    }

    // 1. Validate session
    const { session, error: tokenError } = await validateSessionToken(token, supabase);
    if (tokenError) {
      return sendTokenError(res, tokenError);
    }

    const embedOriginCheck = enforceEmbedOriginForSession({
      req,
      session,
      endpoint: 'sessions-complete',
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
      return sendSessionError(res, 403, 'verification_required', 'Verification is required before submitting');
    }

    if (!validateCsrfToken(req)) {
      return sendSessionError(res, 403, 'csrf_invalid', 'Invalid CSRF token. Please refresh the page and try again.');
    }

    // 2. Fetch all document fields
    const { data: allFields } = await supabase
      .from('fields')
      .select('*')
      .eq('document_id', session.document_id)
      .order('sort_order', { ascending: true });

    if (!allFields || allFields.length === 0) {
      return sendSessionError(res, 400, 'document_has_no_fields', 'Document has no fields');
    }

    // 3. Apply field filter
    let visibleFields = allFields;
    if (session.field_filter?.ids) {
      const filterIds = new Set(session.field_filter.ids.map(String));
      visibleFields = allFields.filter(f => filterIds.has(String(f.id)));
    }
    const fieldLookup = buildSessionFieldLookup(visibleFields);

    const requiredFieldIdSet = getRequiredFieldIdSet(visibleFields, session);
    const requiredFields = visibleFields.filter((field) => requiredFieldIdSet.has(String(field.id)));

    // 4. Fetch all filled values
    const { data: sessionFields } = await supabase
      .from('session_fields')
      .select('*')
      .eq('session_id', session.id);

    const filledMap = {};
    (sessionFields || []).forEach(sf => {
      const resolvedFieldId = fieldLookup.resolveFieldId(sf.field_id);
      if (resolvedFieldId) filledMap[resolvedFieldId] = sf;
    });

    // 5. Validate all non-optional fields are filled
    const missingFields = requiredFields.filter(f => {
      const normalizedFieldType = normalizeSessionFieldType(f.field_type, f.field_name);
      if (normalizedFieldType === 'signature') {
        return !filledMap[f.id]?.signature_data_url;
      }
      const rawValue = filledMap[f.id]?.field_value;
      return rawValue === null || rawValue === undefined || String(rawValue).trim() === '';
    });

    if (missingFields.length > 0) {
      return sendSessionError(
        res,
        400,
        'missing_required_fields',
        'Please complete all required fields before submitting',
        {
          missingFields: missingFields.map(f => ({
            id: f.id,
            fieldName: f.field_name,
            fieldType: f.field_type,
          })),
        }
      );
    }

    // 6. Generate filled PDF
    let filledPdfUrl = null;
    if (shouldGeneratePdf) {
      // Outside the PDF try (which never fails completion): a file_path outside
      // the owner's folder refuses the completion (422), nothing downloaded.
      assertDocumentPathOwned(session.documents);
      try {
        const sourceBinary = await downloadDocumentBinary({
          supabase,
          filePath: session.documents?.file_path,
          fileUrl: session.documents?.file_url,
          bucket: 'documents',
        });

        // Build field data for PDF generation
        const pdfFields = allFields.map(f => {
          const filled = filledMap[f.id];
          let value = filled?.field_value || '';

          // Use signature data URL for signature fields
          const normalizedType = normalizeSessionFieldType(f.field_type, f.field_name);
          if (normalizedType === 'signature' && filled?.signature_data_url) {
            value = filled.signature_data_url;
          }

          return {
            field_name: f.field_name,
            field_type: normalizeSessionFieldType(f.field_type, f.field_name),
            field_value: value,
            position: f.position,
          };
        }).filter(f => f.field_value); // Only include fields with values

        const fontBytes = await loadExportFontBytes();

        const pdfBytes = await generateFilledPdf({
          documentName: session.documents.file_name,
          fileUrl: null,
          fileType: session.documents.file_type,
          sourceBytes: sourceBinary.buffer,
          fields: pdfFields,
          locale: session.preferred_language,
          fontBytes,
        });

        // Upload to filled-documents bucket
        const fileName = filledPdfPath(session.document_id, session.id);
        const { error: uploadError } = await supabase.storage
          .from('filled-documents')
          .upload(fileName, pdfBytes, {
            contentType: 'application/pdf',
            upsert: true,
          });

        if (!uploadError) {
          const { data: signed, error: signError } = await supabase.storage
            .from('filled-documents')
            .createSignedUrl(fileName, 15 * 60);
          if (!signError && signed?.signedUrl) {
            filledPdfUrl = signed.signedUrl;
          }
          session.metadata = {
            ...session.metadata,
            filled_pdf_path: fileName,
            filled_pdf_sha256: createHash('sha256').update(pdfBytes).digest('hex'),
            filled_pdf_bytes: pdfBytes.byteLength,
          };
        } else {
          console.error('[Sessions] PDF upload error:', uploadError);
        }
      } catch (pdfErr) {
        console.error('[Sessions] PDF generation error:', pdfErr);
        // Don't fail completion — PDF can be generated later
      }
    }

    // 7. Mark session as completed (atomic: only transition from non-completed states)
    const completedAt = new Date().toISOString();
    const { data: updatedRows, error: updateError } = await supabase
      .from('fill_sessions')
      .update({
        status: 'completed',
        completed_at: completedAt,
        metadata: {
          ...session.metadata,
          filled_pdf_url: filledPdfUrl,
          filled_field_count: Object.keys(filledMap).length,
          total_field_count: requiredFields.length,
        },
      })
      .eq('id', session.id)
      .in('status', ['pending', 'opened', 'sent', 'in_progress', 'queued'])
      .select('id');

    if (updateError) {
      console.error('[Sessions] Complete update error:', updateError);
      return sendSessionError(res, 500, 'complete_update_failed', 'Failed to mark session as completed');
    }

    if (!updatedRows || updatedRows.length === 0) {
      return sendSessionError(res, 409, 'already_completed', 'This session has already been completed');
    }

    // Recompute the document's lifecycle. This session was just marked
    // completed above, so the document is "completed" iff no other session
    // is still outstanding. Use a direct count of non-completed sessions
    // rather than re-fetching all rows and calling .every(): the previous
    // approach silently skipped the update when the read-after-write returned
    // an empty/null result, leaving a fully-signed document stuck at
    // `ready_to_send`/`sent` and absent from the Completed tab.
    const { count: pendingCount, error: pendingErr } = await supabase
      .from('fill_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', session.document_id)
      .neq('status', 'completed');

    if (!pendingErr) {
      const { error: lifecycleErr } = await supabase
        .from('documents')
        .update({ lifecycle_status: (pendingCount || 0) > 0 ? 'opened' : 'completed' })
        .eq('id', session.document_id);
      if (lifecycleErr) {
        console.error('[Sessions] Failed to update document lifecycle on completion:', lifecycleErr.message);
      }
    } else {
      console.error('[Sessions] Pending-session count failed on completion:', pendingErr.message);
    }

    // 8. Increment document completion count
    try {
      const { error: rpcErr } = await supabase.rpc('increment_completion_count', { doc_id: session.document_id });
      if (rpcErr) throw rpcErr;
    } catch (_rpcFallbackErr) {
      // Fallback if RPC doesn't exist: manual increment
      const { data: doc } = await supabase
        .from('documents')
        .select('completion_count')
        .eq('id', session.document_id)
        .single();
      await supabase
        .from('documents')
        .update({ completion_count: (doc?.completion_count || 0) + 1 })
        .eq('id', session.document_id);
    }

    // 9. Log audit event
    await logAudit(supabase, {
      action: 'completed',
      entityType: 'fill_session',
      entityId: session.id,
      actorType: 'customer',
      sessionId: session.id,
      documentId: session.document_id,
      details: {
        pdf_generated: !!filledPdfUrl,
        filled_pdf_url: filledPdfUrl,
        field_count: Object.keys(filledMap).length,
        language: session.preferred_language,
      },
      req,
    });

    // 10. Notify client by email (if available)
    if (session.client_user_id) {
      try {
        const { data: userData } = await supabase.auth.admin.getUserById(session.client_user_id);
        const clientEmail = userData?.user?.email;
        if (clientEmail) {
          await sendCompletionNotificationEmail({
            to: clientEmail,
            clientName: userData.user?.user_metadata?.full_name || clientEmail,
            recipientName: session.recipient_name,
            documentName: session.documents?.file_name,
            documentId: session.document_id,
            sessionId: session.id,
            filledPdfUrl: publicStorageUrlForEmail(filledPdfUrl),
          });
        }
      } catch (notifyErr) {
        console.error('[Sessions] Completion email failed:', notifyErr.message);
      }
    }

    // 11. Return success
    return res.status(200).json({
      success: true,
      sessionId: session.id,
      status: 'completed',
      completedAt,
      filledPdfUrl: publicStorageUrlFor(filledPdfUrl, req),
      fillSummary: {
        totalFields: requiredFields.length,
        filledFields: Object.keys(filledMap).length,
        signatureProvided: sessionFields?.some(sf => sf.signature_data_url) || false,
      },
    });
  } catch (err) {
    console.error('[Sessions] Complete error:', err);
    if (err instanceof DocumentSourceNotAllowedError) {
      // Logged in full just above; the signer gets a fixed message only.
      return sendSessionError(res, 422, err.errorCode, DOCUMENT_SOURCE_NOT_ALLOWED_MESSAGE);
    }
    return sendSessionError(res, 500, 'internal_error', 'Internal server error');
  }
}
