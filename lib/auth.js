/**
 * Auth helpers for API routes.
 */

export async function requireBearerUser(req, supabase) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'missing_auth', status: 401 };
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { error: 'invalid_auth', status: 401 };
  }

  return { user };
}

/**
 * Resolve the caller's org membership. A user can belong to multiple orgs and
 * the UI lets them switch the active one — callers should pass the requested
 * org (from the X-Org-Id header) so org-scoped queries use the org the user is
 * actually working in, not just their first membership. The requested org is
 * only honored when the user really is an active member of it.
 */
export async function requireOrgMembership(userId, supabase, preferredOrgId = null) {
  if (preferredOrgId) {
    const { data: preferred } = await supabase
      .from('org_memberships')
      .select('org_id, role, status')
      .eq('user_id', userId)
      .eq('org_id', preferredOrgId)
      .eq('status', 'active')
      .maybeSingle();
    if (preferred?.org_id) {
      return { orgId: preferred.org_id, membership: preferred };
    }
    // Not a member of the requested org — fall through to the default so
    // legitimate single-org callers with a stale header still work.
  }

  const { data: membership, error } = await supabase
    .from('org_memberships')
    .select('org_id, role, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (error || !membership?.org_id) {
    return { error: 'forbidden', status: 403 };
  }

  return { orgId: membership.org_id, membership };
}

/** Read the caller-selected org from the X-Org-Id request header. */
export function requestedOrgId(req) {
  const v = req?.headers?.['x-org-id'];
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}
