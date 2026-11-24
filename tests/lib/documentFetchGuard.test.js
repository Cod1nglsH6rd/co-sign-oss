/**
 * lib/documentFetch.js: the guard on fetching a document from documents.file_url.
 *
 * file_url is a column the document's organisation members can edit, so the
 * address is chosen by whoever edits the row and must not reach the
 * server's own network:
 * - every IPv4-mapped (::ffff:a.b.c.d, ::ffff:7f00:1), IPv4-compatible
 *   (::a.b.c.d), IPv4-translated (::ffff:0:a.b.c.d), NAT64 (64:ff9b::/96)
 *   and 6to4 (2002::/16) form of a loopback, private, link-local, CGNAT or
 *   unspecified IPv4 address is refused, as are IPv6 loopback, unspecified,
 *   unique-local, link-local, local-use NAT64 and Teredo;
 * - the name is looked up once, and the request connects to the address
 *   that passed the check (a pinned lookup on a per-request agent), so a
 *   name answering differently the second time cannot move the request;
 * - redirects are followed by hand, at most five, each hop checked the same
 *   way.
 *
 * The lookup is injected; no real DNS is used. The pinning and redirect
 * tests run two local servers on the same port, one on 127.0.0.2 (allowed
 * for these tests only through extraAllowedAddresses) and one on 127.0.0.1
 * (refused as loopback). Public example addresses are from 203.0.113.0/24.
 */

const http = require('http');

const {
  DocumentSourceNotAllowedError,
  assertSafePublicUrl,
  fetchDocumentUrl,
  isPublicAddress,
} = require('../../lib/documentFetch');

function answers(...addresses) {
  return jest.fn(async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
}

describe('isPublicAddress', () => {
  const refused = [
    // IPv4
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.255', '0.0.0.0', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    // IPv6 itself
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'fec0::1', 'ff02::1',
    '64:ff9b:1::a', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '100::1',
    // IPv4-mapped
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:7F00:0001', '0:0:0:0:0:ffff:7f00:1', '::ffff:10.0.0.1',
    '::ffff:a9fe:a9fe', '::ffff:100.64.0.1', '::ffff:0.0.0.0', '::ffff:c0a8:101',
    // IPv4-compatible
    '::127.0.0.1', '::7f00:1', '::10.0.0.1', '::a9fe:a9fe',
    // IPv4-translated
    '::ffff:0:127.0.0.1', '::ffff:0:7f00:1',
    // NAT64
    '64:ff9b::127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::a00:1', '64:ff9b::169.254.169.254', '64:ff9b::6440:1',
    // 6to4
    '2002:7f00:1::', '2002:a00:1::1', '2002:a9fe:a9fe::',
    // with a zone
    'fe80::1%eth0',
    // not an address
    '', 'example', '1.2.3', null, undefined,
  ];
  it.each(refused)('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  const allowed = ['203.0.113.10', '8.8.8.8', '::ffff:203.0.113.10', '64:ff9b::203.0.113.10', '2002:cb00:710a::', '2606:4700::1111', '172.32.0.1', '100.128.0.1'];
  it.each(allowed)('allows %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('assertSafePublicUrl', () => {
  it.each([
    'http://[::ffff:127.0.0.1]/a.pdf',
    'http://[::ffff:7f00:1]/a.pdf',
    'http://[::1]/a.pdf',
    'http://[64:ff9b::7f00:1]/a.pdf',
    'http://[fd00::1]/a.pdf',
    'http://127.0.0.1/a.pdf',
    'http://2130706433/a.pdf',
    'http://0x7f.1/a.pdf',
    'http://localhost./a.pdf',
  ])('refuses the literal %s without a lookup', async (url) => {
    const lookup = answers('203.0.113.10');
    await expect(assertSafePublicUrl(url, { lookup })).rejects.toBeInstanceOf(DocumentSourceNotAllowedError);
  });

  it.each(['::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '::127.0.0.1', 'fe80::1'])(
    'refuses a name that resolves to %s',
    async (address) => {
      await expect(assertSafePublicUrl('http://docs.example.com/a.pdf', { lookup: answers(address) }))
        .rejects.toBeInstanceOf(DocumentSourceNotAllowedError);
    },
  );

  it('refuses a name when any of its answers is private', async () => {
    await expect(assertSafePublicUrl('http://docs.example.com/a.pdf', { lookup: answers('203.0.113.10', '::ffff:10.0.0.1') }))
      .rejects.toBeInstanceOf(DocumentSourceNotAllowedError);
  });

  it('allows a name with public answers', async () => {
    const parsed = await assertSafePublicUrl('https://docs.example.com/a.pdf', { lookup: answers('203.0.113.10') });
    expect(parsed.hostname).toBe('docs.example.com');
  });
});

describe('fetchDocumentUrl over the network', () => {
  let pinned; // 127.0.0.2, the address that passed the check
  let other; // 127.0.0.1, the private address
  let port;
  let pinnedHits;
  let otherHits;
  let pinnedHandler;

  beforeAll(async () => {
    other = http.createServer((req, res) => { otherHits.push(req.url); res.end('private'); });
    await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
    ({ port } = other.address());
    pinned = http.createServer((req, res) => { pinnedHits.push(req.url); pinnedHandler(req, res); });
    await new Promise((resolve, reject) => {
      pinned.once('error', reject);
      pinned.listen(port, '127.0.0.2', resolve);
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => pinned.close(resolve));
    await new Promise((resolve) => other.close(resolve));
  });

  beforeEach(() => {
    pinnedHits = [];
    otherHits = [];
    pinnedHandler = (req, res) => { res.setHeader('content-type', 'application/pdf'); res.end('pinned'); };
  });

  const ALLOW_PINNED = ['127.0.0.2'];

  it('connects to the address that passed the check, even when the name answers differently the second time', async () => {
    const lookup = jest.fn()
      .mockResolvedValueOnce([{ address: '127.0.0.2', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    const result = await fetchDocumentUrl(`http://docs.example.com:${port}/doc.pdf`, { lookup, extraAllowedAddresses: ALLOW_PINNED });

    expect(result.buffer.toString()).toBe('pinned');
    expect(result.contentType).toBe('application/pdf');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(pinnedHits).toEqual(['/doc.pdf']);
    expect(otherHits).toEqual([]);
  });

  it('the test-only allowance does not let the private address through', async () => {
    await expect(fetchDocumentUrl(`http://docs.example.com:${port}/doc.pdf`, { lookup: answers('127.0.0.1'), extraAllowedAddresses: ALLOW_PINNED }))
      .rejects.toBeInstanceOf(DocumentSourceNotAllowedError);
    expect(otherHits).toEqual([]);
  });

  it.each([
    ['a private literal', () => `http://127.0.0.1:${port}/secret`],
    ['a mapped literal', () => `http://[::ffff:127.0.0.1]:${port}/secret`],
    ['a name that resolves privately', () => `http://inside.example.com:${port}/secret`],
  ])('refuses a redirect to %s and never requests it', async (_name, target) => {
    pinnedHandler = (req, res) => { res.statusCode = 302; res.setHeader('location', target()); res.end(); };
    const lookup = jest.fn(async (name) => [{ address: name === 'inside.example.com' ? '127.0.0.1' : '127.0.0.2', family: 4 }]);

    await expect(fetchDocumentUrl(`http://docs.example.com:${port}/doc.pdf`, { lookup, extraAllowedAddresses: ALLOW_PINNED }))
      .rejects.toBeInstanceOf(DocumentSourceNotAllowedError);
    expect(pinnedHits).toEqual(['/doc.pdf']);
    expect(otherHits).toEqual([]);
  });

  it('follows a redirect to an allowed address, checking that hop too', async () => {
    pinnedHandler = (req, res) => {
      if (req.url === '/doc.pdf') { res.statusCode = 301; res.setHeader('location', '/moved.pdf'); res.end(); return; }
      res.end('moved');
    };
    const lookup = answers('127.0.0.2');

    const result = await fetchDocumentUrl(`http://docs.example.com:${port}/doc.pdf`, { lookup, extraAllowedAddresses: ALLOW_PINNED });

    expect(result.buffer.toString()).toBe('moved');
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(pinnedHits).toEqual(['/doc.pdf', '/moved.pdf']);
  });

  it('gives up after five redirects', async () => {
    pinnedHandler = (req, res) => { res.statusCode = 302; res.setHeader('location', `/r${pinnedHits.length}`); res.end(); };
    await expect(fetchDocumentUrl(`http://docs.example.com:${port}/doc.pdf`, { lookup: answers('127.0.0.2'), extraAllowedAddresses: ALLOW_PINNED }))
      .rejects.toThrow(/redirects/);
    expect(pinnedHits).toHaveLength(6);
  });

  it('a non-2xx answer is an error', async () => {
    pinnedHandler = (req, res) => { res.statusCode = 404; res.end('no'); };
    await expect(fetchDocumentUrl(`http://docs.example.com:${port}/doc.pdf`, { lookup: answers('127.0.0.2'), extraAllowedAddresses: ALLOW_PINNED }))
      .rejects.toThrow(/404/);
  });
});
