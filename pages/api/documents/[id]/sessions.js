import { requireServiceSupabase } from '../../../../lib/supabaseClient';
import { requireBearerUser, requireOrgMembership, requestedOrgId } from '../../../../lib/auth';
/**
 * GET /api/documents/[id]/sessions
 *
 * Client lists all fill sessions for a document.
 * Shows status, recipient info, and fill progress for each session.
 *
 * Auth: Supabase JWT (authenticated client)
 *
 * Query params:
 *   status?: 'pending' | 'opened' | 'in_progress' | 'completed' | 'expired' | 'revoked'
 *   limit?: number (default 50)
 *   offset?: number (default 0)
 */

function isFilledFieldValue(fieldType, fieldValue, signatureDataUrl) {
  if (fieldType === 'signature') return Boolean(signatureDataUrl);
  if (fieldType === 'checkbox') return fieldValue === 'true' || fieldValue === true;
  return fieldValue !== null && fieldValue !== undefined && String(fieldValue).trim() !== '';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = requireServiceSupabase();

    // 1. Authenticate client
    const auth = await requireBearerUser(req, supabase);
    if (auth.error) {
      return res.status(401).json({
        error: auth.error === 'missing_auth' ? 'Missing authorization header' : 'Invalid or expired token',
      });
    }
    const { user } = auth;

    // 2. Parse params
    const { id: documentId, status, limit: limitStr, offset: offsetStr } = req.query;
    const limit = Math.min(parseInt(limitStr, 10) || 50, 100);
    const offset = parseInt(offsetStr, 10) || 0;

    if (!documentId) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    // 3. Verify client owns the document (in the org they selected, if any)
    const { membership, error: membershipError } = await requireOrgMembership(
      user.id,
      supabase,
      requestedOrgId(req)
    );

    if (membershipError) {
      return res.status(403).json({ error: 'User is not a member of any organization' });
    }

    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('id, file_name, completion_count')
      .eq('id', documentId)
      .eq('org_id', membership.org_id)
      .single();

    if (docError || !doc) {
      return res.status(404).json({ error: 'Document not found or access denied' });
    }

    // 4. Fetch sessions
    let query = supabase
      .from('fill_sessions')
      .select('*', { count: 'exact' })
      .eq('document_id', documentId)
      .eq('client_user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: sessions, error: sessionsError, count } = await query;

    if (sessionsError) {
      console.error('[Sessions] List error:', sessionsError);
      return res.status(500).json({ error: 'Failed to fetch sessions' });
    }

    // 5. Fetch fill progress for each session
    const sessionIds = (sessions || []).map(s => s.id);
    let fieldCounts = {};

    // 6. Get total field count + types for this document
    const { data: docFields } = await supabase
      .from('fields')
      .select('id, field_type')
      .eq('document_id', documentId);

    const fieldTypeById = new Map((docFields || []).map((field) => [String(field.id), field.field_type || 'text']));

    if (sessionIds.length > 0) {
      const { data: filledData } = await supabase
        .from('session_fields')
        .select('session_id, field_id, field_value, signature_data_url')
        .in('session_id', sessionIds);

      // Aggregate per session
      (filledData || []).forEach(sf => {
        if (!fieldCounts[sf.session_id]) {
          fieldCounts[sf.session_id] = { filled: 0, signed: 0 };
        }
        const fieldType = fieldTypeById.get(String(sf.field_id)) || 'text';
        if (isFilledFieldValue(fieldType, sf.field_value, sf.signature_data_url)) {
          fieldCounts[sf.session_id].filled++;
        }
        if (sf.signature_data_url) fieldCounts[sf.session_id].signed++;
      });
    }

    const totalFields = (docFields || []).length;

    // 7. Build response
    const responseSessions = (sessions || []).map(s => ({
      id: s.id,
      recipientEmail: s.recipient_email,
      recipientName: s.recipient_name,
      status: s.status,
      assignedRole: s.assigned_role,
      preferredLanguage: s.preferred_language,
      requireSignature: s.require_signature,
      sendMethod: s.send_method,
      createdAt: s.created_at,
      sentAt: s.sent_at,
      firstOpenedAt: s.first_opened_at,
      completedAt: s.completed_at,
      expiresAt: s.expires_at,
      filledPdfUrl: s.metadata?.filled_pdf_url || null,
      fillProgress: {
        total: s.field_filter?.ids ? s.field_filter.ids.length : totalFields,
        filled: fieldCounts[s.id]?.filled || 0,
        signed: (fieldCounts[s.id]?.signed || 0) > 0,
      },
    }));

    return res.status(200).json({
      success: true,
      documentId,
      documentName: doc.file_name,
      completionCount: doc.completion_count,
      sessions: responseSessions,
      total: count,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[Sessions] List error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
