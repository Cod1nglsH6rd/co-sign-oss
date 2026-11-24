import { requireServiceSupabase } from '../../../lib/supabaseClient';
import { publicStorageUrlFor } from '../../../lib/publicStorageUrl';
import { filledPdfPath } from '../../../lib/storagePaths';

/**
 * GET /api/sessions/signed-pdf?sessionId=...
 *
 * Returns a fresh signed URL for a completed session's filled PDF so staff can
 * download the signed document. (PRD §2.7)
 *
 * Auth: Supabase JWT (staff). The caller must be an active member of the org
 * that owns the session's document. Keyed by session id (tokens are not
 * exposed in client-side session lists). The filled PDF lives in the private
 * `filled-documents` bucket; a short-lived signed URL is minted on demand.
 *
 * Answers { url, sha256, bytes } for the asked-for session's own PDF only,
 * never another session of the same document. sha256 and bytes are the
 * fingerprint and size saved at completion; null for a PDF saved before they
 * were recorded.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = requireServiceSupabase();

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const { data: session, error: sessionError } = await supabase
      .from('fill_sessions')
      .select('id, document_id, metadata, documents(org_id, file_name)')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Authorize: caller must be an active member of the document's org.
    const orgId = session.documents?.org_id;
    if (!orgId) {
      return res.status(403).json({ error: 'Not authorized for this document' });
    }
    const { data: membership } = await supabase
      .from('org_memberships')
      .select('org_id')
      .eq('user_id', user.id)
      .eq('org_id', orgId)
      .eq('status', 'active')
      .maybeSingle();
    if (!membership) {
      return res.status(403).json({ error: 'Not authorized for this document' });
    }

    // metadata is editable by organisation members, so it only says whether a
    // PDF was saved; the path itself is recomputed from the ids the way
    // sessions/[token]/complete.js saves it.
    if (!session.metadata?.filled_pdf_path || !session.document_id) {
      return res.status(404).json({ error: 'No signed PDF is available for this session yet' });
    }
    const filledPath = filledPdfPath(session.document_id, session.id);

    const downloadName = `${(session.documents?.file_name || 'document').replace(/\.pdf$/i, '')} - signed.pdf`;
    const { data: signed, error: signError } = await supabase.storage
      .from('filled-documents')
      .createSignedUrl(filledPath, 5 * 60, { download: downloadName });

    if (signError || !signed?.signedUrl) {
      return res.status(500).json({ error: 'Could not generate download link' });
    }

    return res.status(200).json({
      url: publicStorageUrlFor(signed.signedUrl, req),
      sha256: session.metadata?.filled_pdf_sha256 ?? null,
      bytes: session.metadata?.filled_pdf_bytes ?? null,
    });
  } catch (err) {
    console.error('[Sessions/signed-pdf] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
