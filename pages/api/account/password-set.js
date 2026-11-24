import { requireServiceSupabase } from '../../../lib/supabaseClient';

/**
 * POST /api/account/password-set
 *
 * Clears app_metadata.password_pending (set by /api/admin/users on a new
 * invited account) for the signed-in caller's own user, keeping the rest of
 * their app_metadata. Takes nothing from the body.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  try {
    const supabase = requireServiceSupabase();
    const { data, error } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    const user = data?.user;
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // null removes the key in the auth service's app_metadata merge.
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      app_metadata: { ...(user.app_metadata || {}), password_pending: null },
    });
    if (updateError) {
      console.error('[Password Set] Could not clear password pending for user', user.id, updateError.message || '');
      return res.status(500).json({ error: 'Failed to update account' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Password Set] Error:', err?.message || err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
