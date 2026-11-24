/**
 * Signed storage links the browser can open.
 *
 * The server signs on its own Supabase address, which at home is internal
 * (http://gateway:3000) and unreachable from the browser. toPublicUrl swaps
 * that origin for the public Supabase URL, else the request's own origin, and
 * keeps the path and query. A link on any other origin, or with nowhere to
 * send it, is returned as it came.
 */

import { publicSupabaseUrl, serverSupabaseUrl } from './supabaseEnv';

function parse(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

export function toPublicUrl(signedUrl, { serverUrl, publicUrl, requestOrigin } = {}) {
  const signed = parse(signedUrl);
  const server = parse(serverUrl);
  const target = parse(publicUrl) || parse(requestOrigin);
  if (!signed || !server || !target) return signedUrl;
  if (signed.origin !== server.origin) return signedUrl;

  // Strip the server's path prefix only on a whole segment, so /base does not
  // eat the start of /baseball.
  const serverPath = server.pathname.replace(/\/$/, '');
  const targetPath = target.pathname.replace(/\/$/, '');
  const onServerPath = serverPath
    && (signed.pathname === serverPath || signed.pathname.startsWith(`${serverPath}/`));
  const rest = onServerPath ? signed.pathname.slice(serverPath.length) : signed.pathname;
  return `${target.origin}${targetPath}${rest}${signed.search}${signed.hash}`;
}

// The origin the browser used to reach this app. A proxy's forwarded host and
// scheme win; without them the scheme is https only on a TLS socket, so a
// plain home address such as http://192.168.1.20:3000 stays http.
export function requestOriginOf(req) {
  const first = (value) => (Array.isArray(value) ? value[0] : value || '').toString().split(',')[0].trim();
  const host = first(req?.headers?.['x-forwarded-host']) || first(req?.headers?.host);
  if (!host) return null;
  const proto = first(req?.headers?.['x-forwarded-proto']) || (req?.socket?.encrypted ? 'https' : 'http');
  return `${proto}://${host}`;
}

// toPublicUrl with this server's settings. The public address is
// PUBLIC_SUPABASE_URL, else NEXT_PUBLIC_SUPABASE_URL as the app was built
// with it (the cloud setup; the browser client falls back the same way),
// else the page's own origin.
export function publicStorageUrlFor(signedUrl, req) {
  return toPublicUrl(signedUrl, {
    serverUrl: serverSupabaseUrl(),
    publicUrl: publicSupabaseUrl() || process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    requestOrigin: requestOriginOf(req),
  });
}

// For a link read later and elsewhere, such as in an email: the configured
// public address only (PUBLIC_SUPABASE_URL, else NEXT_PUBLIC_SUPABASE_URL),
// never the request's own origin. With neither set the link is unchanged.
export function publicStorageUrlForEmail(signedUrl) {
  return toPublicUrl(signedUrl, {
    serverUrl: serverSupabaseUrl(),
    publicUrl: publicSupabaseUrl() || process.env.NEXT_PUBLIC_SUPABASE_URL || null,
  });
}
