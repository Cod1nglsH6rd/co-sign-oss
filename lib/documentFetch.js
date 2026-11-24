/**
 * Reading a document's bytes: from storage when the row has a file_path,
 * else from the URL in file_url.
 *
 * Who sets file_url: documents rows are written by the members of the
 * document's organisation (and by the writer of a no-organisation row), so
 * the address is chosen by whoever can edit the row, and the request is made
 * by the server, from inside the host's network. The guard below lets the
 * request reach public addresses only:
 * - http and https only, no user:password in the URL, no internal names;
 * - the host name is looked up once; every answer must be public, and the
 *   request connects to the first answer that was checked (a pinned lookup on
 *   a per-request agent), so the name cannot answer differently for the
 *   connection;
 * - an address is public unless it is loopback, private, link-local, CGNAT
 *   (100.64/10), unspecified, benchmarking, multicast or reserved, in IPv4 or
 *   in any IPv6 form that carries an IPv4 address (mapped, compatible,
 *   translated, NAT64, 6to4); IPv6 loopback, unique-local, link-local,
 *   site-local, multicast, local-use NAT64 and Teredo are refused too;
 * - redirects are followed by hand, at most five, each hop checked the same
 *   way before it is requested;
 * - each request has a time limit and a size limit.
 */
import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'host.docker.internal',
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // the storage file size limit

class DocumentSourceNotAllowedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DocumentSourceNotAllowedError';
    this.errorCode = 'document_source_not_allowed';
    this.details = details;
  }
}

// The fixed message the API routes answer with; the details stay in the log.
const DOCUMENT_SOURCE_NOT_ALLOWED_MESSAGE = 'The document file could not be read from its source.';

// ---- address classification -------------------------------------------------

function parseIpv4(text) {
  if (net.isIP(text) !== 4) return null;
  return text.split('.').map((part) => Number(part));
}

function isPublicIpv4Bytes(bytes) {
  const [a, b, c] = bytes;
  if (a === 0) return false; // "this network", includes 0.0.0.0
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 192 && b === 0 && c === 0) return false; // 192.0.0.0/24, IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** Eight 16-bit groups for an IPv6 address (zone dropped), or null. */
function parseIpv6(text) {
  let value = String(text);
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);
  if (net.isIP(value) !== 6) return null;

  const toGroups = (part) => {
    if (!part) return [];
    const pieces = part.split(':');
    const out = [];
    pieces.forEach((piece, i) => {
      if (i === pieces.length - 1 && piece.includes('.')) {
        const v4 = parseIpv4(piece);
        if (!v4) throw new Error('bad embedded IPv4');
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      } else {
        out.push(Number.parseInt(piece, 16));
      }
    });
    return out;
  };

  try {
    const halves = value.split('::');
    const head = toGroups(halves[0]);
    const tail = halves.length > 1 ? toGroups(halves[1]) : [];
    const fill = 8 - head.length - tail.length;
    const groups = halves.length > 1 ? [...head, ...new Array(fill).fill(0), ...tail] : head;
    if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
    return groups;
  } catch {
    return null;
  }
}

function v4FromGroups(high, low) {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isPublicIpv6Groups(g) {
  const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);

  // ::/96 (IPv4-compatible; includes :: and ::1) and ::ffff:0:0/96 (mapped)
  if (zeros(0, 5) && (g[5] === 0 || g[5] === 0xffff)) return isPublicIpv4Bytes(v4FromGroups(g[6], g[7]));
  // ::ffff:0:0:0/96 (IPv4-translated)
  if (zeros(0, 4) && g[4] === 0xffff && g[5] === 0) return isPublicIpv4Bytes(v4FromGroups(g[6], g[7]));
  // 64:ff9b::/96 (NAT64, well-known prefix)
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return isPublicIpv4Bytes(v4FromGroups(g[6], g[7]));
  // 64:ff9b:1::/48 (local-use NAT64; where the IPv4 sits depends on the prefix)
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return false;
  // the rest of ::/8 is reserved
  if (g[0] <= 0x00ff) return false;
  // 100::/64 discard-only
  if (g[0] === 0x0100 && zeros(1, 4)) return false;
  // 2001::/32 Teredo (the client's IPv4 is hidden in the address)
  if (g[0] === 0x2001 && g[1] === 0) return false;
  // 2002::/16 6to4: the IPv4 address is groups 1 and 2
  if (g[0] === 0x2002) return isPublicIpv4Bytes(v4FromGroups(g[1], g[2]));
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}

/** Whether `address` (an IP address as text) may be fetched from. */
function isPublicAddress(address) {
  if (typeof address !== 'string' || !address) return false;
  const v4 = parseIpv4(address);
  if (v4) return isPublicIpv4Bytes(v4);
  const v6 = parseIpv6(address);
  if (v6) return isPublicIpv6Groups(v6);
  return false;
}

function isBlockedHostname(hostname) {
  if (!hostname) return true;
  const normalized = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (normalized.endsWith('.local')) return true;
  if (normalized.endsWith('.internal')) return true;
  if (normalized.endsWith('.localhost')) return true;
  return false;
}

// ---- the check ------------------------------------------------------------------

function defaultLookup(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

/**
 * Checks one URL and resolves its host once.
 * Options (tests only): `lookup(hostname)` resolving to [{ address, family }];
 * `extraAllowedAddresses`, exact addresses to treat as public.
 * @returns {Promise<{ parsed: URL, host: string, address: string, family: number }>}
 */
async function checkUrl(urlString, { lookup = defaultLookup, extraAllowedAddresses = [] } = {}) {
  const allowed = (address) => extraAllowedAddresses.includes(address) || isPublicAddress(address);

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new DocumentSourceNotAllowedError('Document source URL is invalid', { url: urlString });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new DocumentSourceNotAllowedError('Only HTTP(S) document URLs are allowed', { url: parsed.toString() });
  }

  if (parsed.username || parsed.password) {
    throw new DocumentSourceNotAllowedError('Document URL auth credentials are not allowed', { url: parsed.toString() });
  }

  // URL gives an IPv6 host in brackets; a trailing dot names the same host.
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1').replace(/\.+$/, '');
  if (isBlockedHostname(host)) {
    throw new DocumentSourceNotAllowedError('Document hostname is blocked', { hostname: host, url: parsed.toString() });
  }

  const literal = net.isIP(host);
  if (literal) {
    if (!allowed(host)) {
      throw new DocumentSourceNotAllowedError('Document IP address is private', { ip: host, url: parsed.toString() });
    }
    return { parsed, host, address: host, family: literal };
  }

  let records;
  try {
    records = await lookup(host);
  } catch (error) {
    throw new DocumentSourceNotAllowedError('Could not resolve document hostname', {
      hostname: host,
      url: parsed.toString(),
      reason: error.message,
    });
  }

  if (!Array.isArray(records) || !records.length) {
    throw new DocumentSourceNotAllowedError('Document hostname has no DNS records', { hostname: host, url: parsed.toString() });
  }

  const refused = records.find((record) => !record || !allowed(record.address));
  if (refused) {
    throw new DocumentSourceNotAllowedError('Document hostname resolved to a private IP', {
      hostname: host,
      ip: refused?.address,
      url: parsed.toString(),
    });
  }

  const [first] = records;
  return { parsed, host, address: first.address, family: first.family || net.isIP(first.address) };
}

/** Throws DocumentSourceNotAllowedError unless the URL may be fetched; returns the parsed URL. */
async function assertSafePublicUrl(urlString, options = {}) {
  return (await checkUrl(urlString, options)).parsed;
}

// ---- the request -------------------------------------------------------------

// A lookup that answers only the address that passed the check, whatever it
// is asked (net calls it with { all: true } when it tries several families).
function pinnedLookup(address, family) {
  return (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : options || {};
    if (opts.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
}

function requestOnce(target, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const { parsed, host, address, family } = target;
  const client = parsed.protocol === 'https:' ? https : http;
  const lookup = pinnedLookup(address, family);
  // A new agent per request: no pooled socket from another lookup is reused,
  // and its connections use the pinned lookup.
  const agent = new client.Agent({ keepAlive: false, maxSockets: 1, lookup });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      agent.destroy();
      fn(value);
    };

    const req = client.request({
      agent,
      lookup,
      host,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: { host: parsed.host, accept: '*/*', 'user-agent': 'co-sign-document-fetch' },
      ...(parsed.protocol === 'https:' && !net.isIP(host) ? { servername: host } : {}),
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode;
      if (REDIRECT_STATUSES.has(status)) {
        res.resume();
        finish(resolve, { status, location: res.headers.location || null });
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new Error('Document source is larger than the size limit'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(resolve, {
        status,
        statusText: res.statusMessage || '',
        contentType: res.headers['content-type'] || null,
        body: Buffer.concat(chunks),
      }));
      res.on('error', (err) => finish(reject, err));
    });
    req.on('timeout', () => req.destroy(new Error('Document source timed out')));
    req.on('error', (err) => finish(reject, err));
    req.end();
  });
}

/**
 * GET a document from a URL under the guard above. Redirects are followed by
 * hand (at most five), each hop checked before it is requested.
 * @returns {Promise<{ buffer: Buffer, contentType: string, source: 'url' }>}
 */
async function fetchDocumentUrl(urlString, options = {}) {
  let currentUrl = urlString;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const target = await checkUrl(currentUrl, options);
    const response = await requestOnce(target, options);

    if (REDIRECT_STATUSES.has(response.status)) {
      if (!response.location) {
        throw new Error('Document source redirect missing location header');
      }
      currentUrl = new URL(response.location, target.parsed).toString();
      continue;
    }

    if (response.status < 200 || response.status > 299) {
      throw new Error(`Failed to download document URL: ${response.status} ${response.statusText}`);
    }
    return {
      buffer: response.body,
      contentType: response.contentType || 'application/octet-stream',
      source: 'url',
    };
  }

  throw new Error('Document source exceeded maximum redirects');
}

async function downloadDocumentBinary({
  supabase,
  filePath,
  fileUrl,
  bucket = 'documents',
}) {
  if (filePath) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(filePath);

    if (error) {
      throw new Error(`Failed to download storage document: ${error.message}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: data.type || 'application/octet-stream',
      source: 'storage',
    };
  }

  if (!fileUrl) {
    throw new Error('No document file source available');
  }

  return fetchDocumentUrl(fileUrl);
}

export {
  DOCUMENT_SOURCE_NOT_ALLOWED_MESSAGE,
  DocumentSourceNotAllowedError,
  assertSafePublicUrl,
  downloadDocumentBinary,
  fetchDocumentUrl,
  isPublicAddress,
};
