import { requireServiceSupabase } from '../../../lib/supabaseClient';
/**
 * POST /api/orgs/bootstrap
 *
 * Ensures the authenticated user has an organization + membership.
 * Creates a default org on first login.
 */

function deriveOrgName(email) {
  if (!email) return 'My Organization';
  const domain = email.split('@')[1] || '';
  if (!domain) return 'My Organization';
  const base = domain.split('.')[0];
  if (!base) return 'My Organization';
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
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

    // Check existing membership
    const { data: existing } = await supabase
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existing?.org_id) {
      return res.status(200).json({ orgId: existing.org_id, role: existing.role });
    }

    // Create org + membership
    const orgName = deriveOrgName(user.email);
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert([{ name: orgName }])
      .select()
      .single();

    if (orgError || !org) {
      return res.status(500).json({ error: 'Failed to create organization' });
    }

    const { error: memberError } = await supabase
      .from('org_memberships')
      .insert([{
        org_id: org.id,
        user_id: user.id,
        role: 'admin',
        status: 'active',
      }]);

    if (memberError) {
      return res.status(500).json({ error: 'Failed to create membership' });
    }

    return res.status(201).json({ orgId: org.id, role: 'admin' });
  } catch (err) {
    console.error('[Org Bootstrap] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
