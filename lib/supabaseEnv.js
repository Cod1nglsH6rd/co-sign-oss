/**
 * Server-side Supabase settings, read from process.env at call time.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` (and any other dotted read it can
 * name) into the bundle at build time, so a value changed on the host after
 * the build would never be seen. These helpers read through a computed key
 * (process.env[name]), which Next leaves alone, so the running server sees
 * the current value. A blank or whitespace-only value counts as not set; the
 * first set name wins, and no set name answers null.
 *
 * The name lists are same-file string arrays looped over directly, so the
 * env-sync check (scripts/envSync.js) still names every setting read here.
 */

const URL_NAMES = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'];
const ANON_KEY_NAMES = ['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const SERVICE_KEY_NAMES = ['SUPABASE_SERVICE_ROLE_KEY'];
// The address the browser uses; unset means the page's own origin.
const PUBLIC_URL_NAMES = ['PUBLIC_SUPABASE_URL'];

function setValue(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || null;
}

export function serverSupabaseUrl() {
  for (const name of URL_NAMES) {
    const value = setValue(process.env[name]);
    if (value) return value;
  }
  return null;
}

export function anonKey() {
  for (const name of ANON_KEY_NAMES) {
    const value = setValue(process.env[name]);
    if (value) return value;
  }
  return null;
}

export function serviceKey() {
  for (const name of SERVICE_KEY_NAMES) {
    const value = setValue(process.env[name]);
    if (value) return value;
  }
  return null;
}

export function publicSupabaseUrl() {
  for (const name of PUBLIC_URL_NAMES) {
    const value = setValue(process.env[name]);
    if (value) return value;
  }
  return null;
}
