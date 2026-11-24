import { requireServiceSupabase } from '../../../../lib/supabaseClient';
import { requireBearerUser, requireOrgMembership, requestedOrgId } from '../../../../lib/auth';
/**
 * POST /api/documents/[id]/restore
 *
 * Un-archives a document by clearing archived_at.
 * Verifies the caller is an active member of the owning org.
 *
 * Auth: Supabase JWT (authenticated client)
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = requireServiceSupabase();

    // 1. Authenticate client via JWT
    const auth = await requireBearerUser(req, supabase);
    if (auth.error) {
      return res.status(401).json({
        error: auth.error === 'missing_auth' ? 'Missing authorization header' : 'Invalid or expired token',
      });
    }
    const { user } = auth;

    const { id: documentId } = req.query;
    if (!documentId) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    // 2. Verify caller is in an active org (the one they selected, if any)
    const { membership, error: membershipError } = await requireOrgMembership(
      user.id,
      supabase,
      requestedOrgId(req)
    );

    if (membershipError) {
      return res.status(403).json({ error: 'User is not a member of any organization' });
    }

    // 3. Verify the document belongs to that org
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('id, org_id, archived_at')
      .eq('id', documentId)
      .eq('org_id', membership.org_id)
      .single();

    if (docError || !doc) {
      return res.status(404).json({ error: 'Document not found or access denied' });
    }

    // 4. Restore (idempotent)
    const { data: updated, error: updateError } = await supabase
      .from('documents')
      .update({ archived_at: null })
      .eq('id', documentId)
      .eq('org_id', membership.org_id)
      .select()
      .single();

    if (updateError || !updated) {
      console.error('[Documents/restore] Update error:', updateError);
      return res.status(500).json({ error: 'Failed to restore document' });
    }

    return res.status(200).json({ success: true, document: updated });
  } catch (err) {
    console.error('[Documents/restore] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
