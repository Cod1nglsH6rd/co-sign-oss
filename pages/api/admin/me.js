import { requireServiceSupabase } from '../../../lib/supabaseClient';
import { getServerOwnerEmails, isOwnerEmail } from '../../../lib/ownerEmails';

// Tells the signed-in caller only whether they are an owner, by the same rule
// as /api/admin/users, so the browser need not carry the owner list.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
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

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ owner: isOwnerEmail(user.email, getServerOwnerEmails()) });
  } catch (err) {
    console.error('Admin me API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
