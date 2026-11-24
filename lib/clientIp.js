/**
 * The address of the client that sent a request, for rate limits and the
 * audit trail. This is the only place that reads the forwarding headers.
 *
 * Who can set what:
 * - X-Forwarded-For is a comma-separated list. Every proxy appends the
 *   address of whoever connected to it, so the right-most entry is written by
 *   the proxy nearest the app, the next one by the proxy before it, and so on.
 *   Everything left of the proxies we trust was sent by the client and can be
 *   any text it likes.
 * - X-Real-IP is passed through unchanged by the Docker stack's gateway
 *   (Caddy does not set it), so any client can set it. It is never read.
 * - The socket address is the peer of the TCP connection: the nearest proxy,
 *   or the client itself when nothing is in front. No header changes it.
 *
 * COSIGN_TRUSTED_PROXY_HOPS is how many proxies in front of the app append to
 * X-Forwarded-For (default 1). Only the host owner sets it. The address is the
 * entry that many places from the right. With 0 no header is trusted and the
 * socket address is used. A header with fewer entries than the hops, no
 * header, or something other than an address where the trusted entry should
 * be gives the socket address, never text from the header.
 *
 * The Docker stack (docker-compose.yml) has one proxy, the gateway (Caddy
 * 2.8). Caddy replaces X-Forwarded-For with the address of whoever connected
 * to it unless that peer is in its trusted_proxies, which the stack's
 * Caddyfile does not set, so the app sees one entry: the client's address as
 * the gateway saw it. One hop is right for it. Behind another reverse proxy
 * of your own, the gateway still writes one entry (your proxy's address)
 * until Caddy is told to trust that proxy; then the hops become 2.
 * With no proxy in front of `next start`, set 0: with 1 a client could write
 * the right-most entry itself.
 */
import net from 'net';

const DEFAULT_HOPS = 1;
let warnedBadHops = false;

/** The number of trusted proxies, from COSIGN_TRUSTED_PROXY_HOPS. */
export function trustedProxyHops() {
  const raw = process.env.COSIGN_TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_HOPS;
  const text = String(raw).trim();
  if (/^\d{1,2}$/.test(text)) return Number(text);
  if (!warnedBadHops) {
    warnedBadHops = true;
    // eslint-disable-next-line no-console
    console.warn('[clientIp] COSIGN_TRUSTED_PROXY_HOPS is not a whole number from 0 to 99; using 1');
  }
  return DEFAULT_HOPS;
}

/**
 * One address in canonical form, or null when the text is not an address.
 * Accepts `[v6]`, `[v6]:port`, `v4:port`, a v6 zone (`%eth0`, dropped) and
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`, given as `a.b.c.d`).
 */
export function normalizeIp(value) {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (!text || text.length > 64) return null;

  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(text);
  if (bracketed) {
    [, text] = bracketed;
  } else {
    const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(text);
    if (v4WithPort) [, text] = v4WithPort;
  }

  const zone = text.indexOf('%');
  if (zone !== -1 && text.includes(':')) text = text.slice(0, zone);

  const version = net.isIP(text);
  if (version === 4) return text;
  if (version !== 6) return null;

  const lower = text.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped && net.isIP(mapped[1]) === 4) return mapped[1];
  return lower;
}

function socketAddress(req) {
  return normalizeIp(req?.socket?.remoteAddress ?? req?.connection?.remoteAddress);
}

/**
 * The client's address for `req`, or null when none is known.
 * @param {import('http').IncomingMessage} req
 */
export function clientIp(req) {
  if (!req) return null;
  const fallback = socketAddress(req);
  const hops = trustedProxyHops();
  if (hops === 0) return fallback;

  let header = req.headers?.['x-forwarded-for'];
  if (Array.isArray(header)) header = header.join(',');
  if (typeof header !== 'string' || !header.trim()) return fallback;

  const entries = header.split(',').map((part) => part.trim());
  if (entries.length < hops) return fallback;
  return normalizeIp(entries[entries.length - hops]) || fallback;
}
