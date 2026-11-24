/**
 * lib/siteAddress.js turns whatever the owner types as the site address into
 * one form: scheme, host and port, no trailing slash. Anything that is more
 * than an address (a path, a query, a #), a scheme other than http or https,
 * or nothing at all is refused with a plain message.
 */

function clean(input) {
  const { cleanSiteAddress } = require('../../lib/siteAddress');
  return cleanSiteAddress(input);
}

describe('cleanSiteAddress', () => {
  test('a bare domain gets https', () => {
    expect(clean('example.com')).toEqual({ ok: true, address: 'https://example.com' });
  });

  test('a trailing slash is dropped', () => {
    expect(clean('https://example.com/')).toEqual({ ok: true, address: 'https://example.com' });
  });

  test('http on localhost with a port is kept as http', () => {
    expect(clean('http://localhost:3000/')).toEqual({ ok: true, address: 'http://localhost:3000' });
  });

  test('a bare IP address with a port gets http', () => {
    expect(clean('192.168.1.5:8080')).toEqual({ ok: true, address: 'http://192.168.1.5:8080' });
  });

  test('spaces around the address are trimmed', () => {
    expect(clean('   https://example.com/  ')).toEqual({ ok: true, address: 'https://example.com' });
    expect(clean('\texample.com \n')).toEqual({ ok: true, address: 'https://example.com' });
  });

  test.each([
    ['a path', 'https://example.com/sign'],
    ['a path on a bare domain', 'example.com/app/'],
    ['a query', 'https://example.com?x=1'],
    ['a query after a slash', 'example.com/?x=1'],
    ['a #', 'https://example.com/#top'],
    ['a non-http scheme', 'ftp://example.com'],
    ['a javascript scheme', 'javascript:alert(1)'],
    ['nothing at all', ''],
    ['only spaces', '   '],
    ['no value', undefined],
    ['null', null],
  ])('%s is refused with a plain message', (_label, input) => {
    const result = clean(input);
    expect(result.ok).toBe(false);
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('address');
  });
});
