/**
 * GET/POST /api/enterprise/org-settings
 *
 * Read or update org-level security settings. Currently:
 *   - require_recipient_verification: when true, every signing link must carry a
 *     recipient email + last name (enforced in /api/sessions/create), so links
 *     can't be opened by anyone with the URL (audit L1).
 *
 * Auth: Supabase bearer JWT. POST requires an admin/owner role on the org.
 */

import { requireServiceSupabase } from '../../../lib/supabaseClient';
import { requireBearerUser, requireOrgMembership, requestedOrgId } from '../../../lib/auth';
import { rateLimitAuth } from '../../../lib/rateLimit';

export default async function handler(req, res) {
  const supabase = requireServiceSupabase();
  const auth = await requireBearerUser(req, supabase);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const user = auth.user;

  const mem = await requireOrgMembership(user.id, supabase, requestedOrgId(req));
  if (mem.error) return res.status(mem.status).json({ error: mem.error });

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('organizations')
      .select('require_recipient_verification')
      .eq('id', mem.orgId)
      .single();
    return res.status(200).json({ requireRecipientVerification: Boolean(data?.require_recipient_verification) });
  }

  if (req.method === 'POST') {
    if (await rateLimitAuth(req, res, 'org-settings', user.id)) return;
    const role = mem.membership?.role;
    if (!['admin', 'owner'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const { requireRecipientVerification } = req.body || {};
    if (typeof requireRecipientVerification !== 'boolean') {
      return res.status(400).json({ error: 'invalid_body' });
    }
    const { error } = await supabase
      .from('organizations')
      .update({ require_recipient_verification: requireRecipientVerification })
      .eq('id', mem.orgId);
    if (error) return res.status(500).json({ error: 'update_failed' });
    return res.status(200).json({ success: true, requireRecipientVerification });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
