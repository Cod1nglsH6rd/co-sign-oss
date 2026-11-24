/**
 * The client address for rate limits and the audit trail (lib/clientIp.js).
 *
 * X-Forwarded-For is a list each proxy appends to: the right-most entry was
 * written by the proxy nearest the app, the left-most by whoever sent the
 * request first, which may be the client itself. The address is the entry
 * COSIGN_TRUSTED_PROXY_HOPS places from the right (default 1: the Docker
 * stack's gateway); 0 trusts no header and uses the socket address. A header
 * shorter than the hops, missing, or holding no address where the trusted
 * entry should be gives the socket address, never text from the header.
 *
 * lib/rateLimit.js and lib/auditLog.js take their address from here, so a
 * client sending its own X-Forwarded-For neither gets a fresh rate-limit
 * bucket nor writes the address in the signing audit trail.
 *
 * Every address is from the documentation ranges (203.0.113.0/24,
 * 198.51.100.0/24, 192.0.2.0/24, 2001:db8::/32).
 */

const { createMocks } = require('node-mocks-http');

const { clientIp, trustedProxyHops } = require('../../lib/clientIp');

const saved = process.env.COSIGN_TRUSTED_PROXY_HOPS;

afterEach(() => {
  if (saved === undefined) delete process.env.COSIGN_TRUSTED_PROXY_HOPS;
  else process.env.COSIGN_TRUSTED_PROXY_HOPS = saved;
  jest.restoreAllMocks();
});

function req(headers = {}, remoteAddress = '192.0.2.10') {
  return { headers, socket: { remoteAddress } };
}

describe('clientIp', () => {
  it('ignores a spoofed left-most value: the right-most entry is the one the proxy wrote', () => {
    delete process.env.COSIGN_TRUSTED_PROXY_HOPS;
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66, 203.0.113.5' }))).toBe('203.0.113.5');
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66,198.51.100.67,203.0.113.5' }))).toBe('203.0.113.5');
  });

  it('defaults to one hop when the setting is blank or not a whole number', () => {
    for (const value of [undefined, '', '  ', 'two', '-1', '1.5']) {
      if (value === undefined) delete process.env.COSIGN_TRUSTED_PROXY_HOPS;
      else process.env.COSIGN_TRUSTED_PROXY_HOPS = value;
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(trustedProxyHops()).toBe(1);
      expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66, 203.0.113.5' }))).toBe('203.0.113.5');
    }
  });

  it('two proxies with hops 2: the second entry from the right', () => {
    process.env.COSIGN_TRUSTED_PROXY_HOPS = '2';
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66, 203.0.113.5, 192.0.2.44' }))).toBe('203.0.113.5');
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.5, 192.0.2.44' }))).toBe('203.0.113.5');
  });

  it('hops 0 trusts no header and uses the socket address', () => {
    process.env.COSIGN_TRUSTED_PROXY_HOPS = '0';
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66, 203.0.113.5', 'x-real-ip': '198.51.100.67' }, '192.0.2.10')))
      .toBe('192.0.2.10');
  });

  it('a header shorter than the hops gives the socket address, not the header text', () => {
    process.env.COSIGN_TRUSTED_PROXY_HOPS = '3';
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66, 203.0.113.5' }, '192.0.2.10'))).toBe('192.0.2.10');
    process.env.COSIGN_TRUSTED_PROXY_HOPS = '2';
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66' }, '192.0.2.10'))).toBe('192.0.2.10');
  });

  it('a missing or empty header gives the socket address; no socket address gives null', () => {
    delete process.env.COSIGN_TRUSTED_PROXY_HOPS;
    expect(clientIp(req({}, '192.0.2.10'))).toBe('192.0.2.10');
    expect(clientIp(req({ 'x-forwarded-for': '' }, '192.0.2.10'))).toBe('192.0.2.10');
    expect(clientIp(req({ 'x-forwarded-for': '   ' }, '192.0.2.10'))).toBe('192.0.2.10');
    expect(clientIp({ headers: {}, socket: {} })).toBeNull();
    expect(clientIp({ headers: {} })).toBeNull();
    expect(clientIp(null)).toBeNull();
  });

  it('never reads X-Real-IP: a client can send it straight through the gateway', () => {
    delete process.env.COSIGN_TRUSTED_PROXY_HOPS;
    expect(clientIp(req({ 'x-real-ip': '198.51.100.67' }, '192.0.2.10'))).toBe('192.0.2.10');
  });

  it('a malformed trusted entry gives the socket address', () => {
    delete process.env.COSIGN_TRUSTED_PROXY_HOPS;
    for (const header of ['198.51.100.66, not-an-address', '198.51.100.66,', '<script>', '203.0.113.5 extra', '999.1.1.1', 'unknown']) {
      expect(clientIp(req({ 'x-forwarded-for': header }, '192.0.2.10'))).toBe('192.0.2.10');
    }
  });

  it('handles IPv6, brackets, a port suffix, a zone, and IPv4-mapped forms', () => {
    delete process.env.COSIGN_TRUSTED_PROXY_HOPS;
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66, 2001:DB8::5' }))).toBe('2001:db8::5');
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66, [2001:db8::5]:4430' }))).toBe('2001:db8::5');
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66, [2001:db8::5]' }))).toBe('2001:db8::5');
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66, 203.0.113.5:51234' }))).toBe('203.0.113.5');
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66, fe80::1%eth0' }))).toBe('fe80::1');
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.66, ::ffff:203.0.113.5' }))).toBe('203.0.113.5');
    expect(clientIp(req({}, '::ffff:192.0.2.10'))).toBe('192.0.2.10');
    expect(clientIp(req({}, '2001:db8::10'))).toBe('2001:db8::10');
  });

  it('folds repeated headers (an array) into one list', () => {
    delete process.env.COSIGN_TRUSTED_PROXY_HOPS;
    expect(clientIp(req({ 'x-forwarded-for': ['198.51.100.66', '203.0.113.5'] }))).toBe('203.0.113.5');
  });
});

describe('lib/rateLimit.js uses the trusted address', () => {
  it('a client changing its left-most X-Forwarded-For is still limited (30 a minute)', async () => {
    delete process.env.COSIGN_TRUSTED_PROXY_HOPS;
    const { rateLimitPublic } = require('../../lib/rateLimit');
    let blocked = 0;
    for (let i = 0; i < 31; i += 1) {
      const { req: r, res } = createMocks({
        method: 'POST',
        headers: { 'x-forwarded-for': `198.51.100.${i + 1}, 203.0.113.77` },
      });
      // eslint-disable-next-line no-await-in-loop
      if (await rateLimitPublic(r, res, 'client-ip-test', 'tok')) blocked += 1;
    }
    expect(blocked).toBe(1);
  });
});

describe('lib/auditLog.js uses the trusted address', () => {
  function supabaseRecorder() {
    const rows = [];
    return { rows, from: () => ({ insert: async (r) => { rows.push(...r); return { error: null }; } }) };
  }

  it('records the proxy-written address, not a forged left-most or X-Real-IP value', async () => {
    delete process.env.COSIGN_TRUSTED_PROXY_HOPS;
    const { logAudit } = require('../../lib/auditLog');
    const sb = supabaseRecorder();
    await logAudit(sb, {
      action: 'signed',
      entityType: 'fill_session',
      actorType: 'customer',
      req: req({ 'x-forwarded-for': '198.51.100.66, 203.0.113.5', 'x-real-ip': '198.51.100.67', 'user-agent': 'test' }),
    });
    expect(sb.rows[0].ip_address).toBe('203.0.113.5');
  });

  it('records null rather than header text when nothing trusted is known', async () => {
    process.env.COSIGN_TRUSTED_PROXY_HOPS = '2';
    const { logAudit } = require('../../lib/auditLog');
    const sb = supabaseRecorder();
    await logAudit(sb, {
      action: 'signed',
      entityType: 'fill_session',
      actorType: 'customer',
      req: { headers: { 'x-forwarded-for': '198.51.100.66', 'x-real-ip': '198.51.100.67' }, socket: {} },
    });
    expect(sb.rows[0].ip_address).toBeNull();
  });
});
