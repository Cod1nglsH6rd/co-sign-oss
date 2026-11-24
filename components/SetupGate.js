/**
 * On a fresh install, sends visitors to /setup. Asks GET /api/setup/state once
 * per app load; a failed or error answer leaves the visitor where they are.
 * Client side only: the edge middleware cannot read the host settings file.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { setupRedirectTarget } from '../lib/setupRedirect';

export async function checkSetup(router, fetchImpl = fetch) {
  let state;
  try {
    const res = await fetchImpl('/api/setup/state');
    if (!res.ok) return;
    state = await res.json();
  } catch {
    return;
  }
  const needed = Boolean(state) && state.needed === true;
  // Both the route (catches /404 and /_error) and the address must be pages.
  if (!setupRedirectTarget(router.pathname, { needed })) return;
  const target = setupRedirectTarget(router.asPath, { needed });
  if (target) router.replace(target);
}

export default function SetupGate() {
  const router = useRouter();
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    checkSetup(router);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
