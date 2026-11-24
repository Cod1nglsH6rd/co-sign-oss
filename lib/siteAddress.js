/**
 * The site address the owner types, in one form: scheme, host and port, with
 * no trailing slash (https://sign.example.com, http://localhost:3000).
 *
 * - Spaces around the address are trimmed.
 * - With no scheme, localhost and IP addresses get http; any other host gets
 *   https.
 * - Only http and https are accepted. A path, a query, a #, a user name or
 *   nothing at all is refused.
 *
 * cleanSiteAddress(input) returns { ok: true, address } or
 * { ok: false, message } with a plain message for the owner.
 */

const MESSAGE = 'Use just the address, like https://sign.example.com';

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

function refuse() {
  return { ok: false, message: MESSAGE };
}

function isLocalHost(hostname) {
  return (
    hostname === 'localhost' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.startsWith('[')
  );
}

export function cleanSiteAddress(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return refuse();

  let scheme = null;
  let rest = text;
  const withSlashes = text.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (withSlashes) {
    scheme = withSlashes[1].toLowerCase();
    rest = text.slice(withSlashes[0].length);
  } else if (SCHEME.test(text) && !/^[^:]+:\d+\/?$/.test(text)) {
    // A scheme without slashes (mailto:, javascript:), not host:port.
    return refuse();
  }
  if (scheme && scheme !== 'http' && scheme !== 'https') return refuse();

  // Host and port only, with at most one trailing slash.
  if (!/^[^/?#@\s]+\/?$/.test(rest)) return refuse();
  const hostPort = rest.replace(/\/$/, '');

  let url;
  try {
    url = new URL(`${scheme || 'http'}://${hostPort}`);
  } catch {
    return refuse();
  }
  if (!scheme) scheme = isLocalHost(url.hostname) ? 'http' : 'https';

  const port = url.port ? `:${url.port}` : '';
  return { ok: true, address: `${scheme}://${url.hostname}${port}` };
}
