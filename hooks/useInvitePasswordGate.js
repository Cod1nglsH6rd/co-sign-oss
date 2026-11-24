/**
 * Sends someone back from an invite link who has not chosen a password yet
 * to /enterprise/login, which shows the password form. Used by every
 * signed-in enterprise page: the layout, and the two pages without it
 * (document setup and the enterprise document viewer). It only redirects; it
 * never signs anyone out. Takes the session's user ({ id, app_metadata }) and
 * redirects only for passwordStep 'choose' (lib/invitePassword.js): once this
 * browser knows the password is saved, a mark not yet cleared lets them by.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { needsPassword } from '../lib/invitePassword';

export function useInvitePasswordGate(user) {
  const router = useRouter();
  useEffect(() => {
    if (needsPassword(user)) router.replace('/enterprise/login');
  }, [user, router]);
}
