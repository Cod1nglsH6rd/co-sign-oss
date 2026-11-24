/**
 * useAuth Hook
 * Uses Supabase Auth sessions and org memberships
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabaseClient';

export function useAuth({ redirectTo = null, redirectIfFound = false } = {}) {
  const router = useRouter();
  const locale = router.query?.locale || 'en';
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [orgRole, setOrgRole] = useState(null);
  // PRD §2.9: a user may belong to multiple orgs. We load all active
  // memberships and let them switch; the chosen org is `orgId`.
  const [memberships, setMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  // True until org membership has been resolved (or confirmed absent). Lets
  // callers avoid org-scoped queries during the window where orgId is still
  // null only because the membership lookup hasn't returned yet.
  const [orgLoading, setOrgLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      setUser(session?.user || null);
      setLoading(false);
    };

    init();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user || null);
      if (!session?.user) {
        setOrgId(null);
        setOrgRole(null);
        setMemberships([]);
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const storageKey = user?.id ? `cosign_active_org_${user.id}` : null;

    const loadMembership = async () => {
      if (!user?.id) {
        // No user yet (or signed out): keep orgLoading true so org-scoped
        // pages wait rather than firing a query with a stale null orgId in
        // the brief window before the user-present reload resolves.
        setOrgId(null);
        setOrgRole(null);
        setMemberships([]);
        return;
      }

      setOrgLoading(true);
      const { data, error } = await supabase
        .from('org_memberships')
        .select('org_id, role, created_at, organizations(name)')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      const rows = !error && Array.isArray(data) ? data : [];

      if (rows.length === 0) {
        // No membership exists — bootstrap one.
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch('/api/orgs/bootstrap', {
            method: 'POST',
            headers: session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : undefined,
          });
          const json = await res.json();
          if (res.ok && json?.orgId) {
            setMemberships([{ orgId: json.orgId, role: json.role || 'admin', name: json.name || 'Your organization' }]);
            setOrgId(json.orgId);
            setOrgRole(json.role || 'admin');
            return;
          }
        } catch (bootstrapErr) {
          console.warn('Bootstrap org failed:', bootstrapErr.message);
        }
        setOrgId(null);
        setOrgRole(null);
        setMemberships([]);
        return;
      }

      const list = rows.map((r) => ({
        orgId: r.org_id,
        role: r.role,
        name: r.organizations?.name || 'Organization',
      }));
      setMemberships(list);

      // Restore the previously selected org if the user is still a member;
      // otherwise default to the first.
      let saved = null;
      try { saved = storageKey ? window.localStorage.getItem(storageKey) : null; } catch { /* noop */ }
      const active = list.find((m) => m.orgId === saved) || list[0];
      setOrgId(active.orgId);
      setOrgRole(active.role);
    };

    // Only flip orgLoading to false once a real resolution runs (user present).
    // The no-user path returns early and must leave orgLoading untouched.
    if (user?.id) {
      loadMembership().finally(() => setOrgLoading(false));
    } else {
      loadMembership();
    }
  }, [user?.id]);

  useEffect(() => {
    if (loading) return;

    const getRedirectPath = () => {
      if (!redirectTo) return null;
      // Enterprise routes are intentionally non-localized.
      if (redirectTo.startsWith('/enterprise')) return redirectTo;
      return `/${locale}${redirectTo}`;
    };
    const redirectPath = getRedirectPath();

    // Redirect if no user and redirectTo is set
    if (!user && redirectPath && !redirectIfFound) {
      router.push(redirectPath);
    }

    // Redirect if user found and redirectIfFound is true
    if (user && redirectIfFound && redirectPath) {
      router.push(redirectPath);
    }
  }, [user, loading, redirectTo, redirectIfFound, router, locale]);

  const switchOrg = (nextOrgId) => {
    const match = memberships.find((m) => m.orgId === nextOrgId);
    if (!match) return;
    setOrgId(match.orgId);
    setOrgRole(match.role);
    try {
      if (user?.id) window.localStorage.setItem(`cosign_active_org_${user.id}`, match.orgId);
    } catch { /* noop */ }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    router.push(`/${locale}`);
  };

  return { user, orgId, orgRole, memberships, switchOrg, loading, orgLoading, signOut };
}
