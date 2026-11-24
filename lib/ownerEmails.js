/**
 * Owner allowlist, read on the server: env, then the ADMIN_DASHBOARD_EMAILS
 * saved on the host (lib/hostSettings.js). The browser asks /api/admin/me.
 * There is no built-in fallback: when nothing names anyone the list is empty
 * and nobody is an owner.
 */

export function parseOwnerEmails(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

// Server routes: ADMIN_DASHBOARD_EMAILS, then NEXT_PUBLIC_OWNER_EMAILS from
// env, then ADMIN_DASHBOARD_EMAILS saved on the host, the first that names
// someone (the same rule as lib/setupAccess.js). Pass { cwd } to choose the
// working folder.
export function getServerOwnerEmails(options) {
  const fromEnv = [process.env.ADMIN_DASHBOARD_EMAILS, process.env.NEXT_PUBLIC_OWNER_EMAILS]
    .map(parseOwnerEmails)
    .find((list) => list.length > 0);
  if (fromEnv) return fromEnv;
  // Browser pages share this module and lib/hostSettings reads files, so it is
  // required only here, never at the top. Next.js's SWC build replaces
  // typeof window with 'object' in the browser build, so this branch and its
  // require are dropped there and lib/hostSettings is never bundled for it.
  if (typeof window === 'undefined') {
    const { readSavedSettings } = require('./hostSettings');
    return parseOwnerEmails(readSavedSettings(options).ADMIN_DASHBOARD_EMAILS);
  }
  return [];
}

export function isOwnerEmail(email, ownerEmails) {
  const target = String(email || '').trim().toLowerCase();
  return Boolean(target) && ownerEmails.includes(target);
}
