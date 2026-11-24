import { requireServiceSupabase } from '../../../lib/supabaseClient';
/**
 * POST /api/account/update
 *
 * Updates organization fields for the authenticated user.
 * Currently supports: organization name (admin role only).
 *
 * Body: { orgId: string, name: string }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const { orgId, name } = req.body || {};
    if (!orgId || typeof orgId !== 'string') {
      return res.status(400).json({ error: 'orgId is required' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const trimmedName = name.trim();
    if (trimmedName.length > 200) {
      return res.status(400).json({ error: 'name must be 200 characters or fewer' });
    }

    const supabase = requireServiceSupabase();
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Verify active membership + admin role on this org
    const { data: membership, error: memberError } = await supabase
      .from('org_memberships')
      .select('role, status')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (memberError || !membership) {
      return res.status(403).json({ error: 'Not a member of this organization' });
    }

    const role = (membership.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'owner') {
      return res.status(403).json({ error: 'Only admins can update organization details' });
    }

    const { data: updated, error: updateError } = await supabase
      .from('organizations')
      .update({ name: trimmedName })
      .eq('id', orgId)
      .select('id, name')
      .single();

    if (updateError || !updated) {
      console.error('[account/update] update error:', updateError);
      return res.status(500).json({ error: 'Failed to update organization' });
    }

    return res.status(200).json({
      id: updated.id,
      name: updated.name,
    });
  } catch (err) {
    console.error('[account/update] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
