import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * Asks the server (GET /api/admin/me) whether the signed-in user is an owner.
 * null while the answer is loading (or with no user), then true or false; any
 * failure counts as false. The answer is kept with the email it was asked for,
 * so a newly signed-in user never sees the last user's answer.
 */
export function useIsOwner(user) {
  const email = user?.email;
  const [answer, setAnswer] = useState({ email: null, owner: null });

  useEffect(() => {
    if (!email) return undefined;
    let cancelled = false;

    (async () => {
      let owner = false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch('/api/admin/me', {
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
        });
        const json = response.ok ? await response.json() : null;
        owner = json?.owner === true;
      } catch {
        owner = false;
      }
      if (!cancelled) setAnswer({ email, owner });
    })();

    return () => { cancelled = true; };
  }, [email]);

  return email && answer.email === email ? answer.owner : null;
}
