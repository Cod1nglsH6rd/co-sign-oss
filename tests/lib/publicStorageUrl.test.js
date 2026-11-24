/**
 * toPublicUrl(signedUrl, { serverUrl, publicUrl, requestOrigin }): a signed
 * storage link minted on the server's internal Supabase address (at home,
 * http://gateway:3000) is rewritten to the address the browser can open: the
 * public Supabase URL, else the request's own origin. Any other link is
 * returned untouched.
 */

const SIGNED = 'http://gateway:3000/storage/v1/object/sign/filled-documents/d1/s1-filled.pdf?token=abc.def&download=Lease%20-%20signed.pdf';
const PATH_AND_QUERY = '/storage/v1/object/sign/filled-documents/d1/s1-filled.pdf?token=abc.def&download=Lease%20-%20signed.pdf';

function load() {
  return require('../../lib/publicStorageUrl').toPublicUrl;
}

describe('toPublicUrl', () => {
  test('swaps the internal origin for the public Supabase URL', () => {
    const toPublicUrl = load();
    expect(toPublicUrl(SIGNED, {
      serverUrl: 'http://gateway:3000',
      publicUrl: 'https://db.example.com',
      requestOrigin: 'http://localhost:3000',
    })).toBe(`https://db.example.com${PATH_AND_QUERY}`);
  });

  test('uses the request origin when there is no public Supabase URL', () => {
    const toPublicUrl = load();
    expect(toPublicUrl(SIGNED, {
      serverUrl: 'http://gateway:3000',
      publicUrl: null,
      requestOrigin: 'http://192.168.1.20:3000',
    })).toBe(`http://192.168.1.20:3000${PATH_AND_QUERY}`);
  });

  test('accepts a server URL with a trailing slash', () => {
    const toPublicUrl = load();
    expect(toPublicUrl(SIGNED, {
      serverUrl: 'http://gateway:3000/',
      publicUrl: '',
      requestOrigin: 'https://sign.example.com',
    })).toBe(`https://sign.example.com${PATH_AND_QUERY}`);
  });

  test('swaps a server URL path prefix for the public URL path', () => {
    const toPublicUrl = load();
    expect(toPublicUrl('http://gateway:3000/base/storage/v1/object/sign/x.pdf?token=t', {
      serverUrl: 'http://gateway:3000/base',
      publicUrl: 'https://db.example.com/supa',
      requestOrigin: null,
    })).toBe('https://db.example.com/supa/storage/v1/object/sign/x.pdf?token=t');
  });

  test('keeps a path that only starts with the same letters as the server path', () => {
    const toPublicUrl = load();
    expect(toPublicUrl('http://gateway:3000/baseball/storage/v1/object/sign/x.pdf?token=t', {
      serverUrl: 'http://gateway:3000/base',
      publicUrl: 'https://db.example.com',
      requestOrigin: null,
    })).toBe('https://db.example.com/baseball/storage/v1/object/sign/x.pdf?token=t');
  });

  test('leaves a link on another origin alone', () => {
    const toPublicUrl = load();
    const cloud = 'https://abc.supabase.co/storage/v1/object/sign/documents/x.pdf?token=t';
    expect(toPublicUrl(cloud, {
      serverUrl: 'http://gateway:3000',
      publicUrl: 'https://db.example.com',
      requestOrigin: 'http://localhost:3000',
    })).toBe(cloud);
  });

  test('leaves the link alone when the public URL is the server URL', () => {
    const toPublicUrl = load();
    const cloud = 'https://abc.supabase.co/storage/v1/object/sign/documents/x.pdf?token=t';
    expect(toPublicUrl(cloud, {
      serverUrl: 'https://abc.supabase.co',
      publicUrl: 'https://abc.supabase.co',
      requestOrigin: 'https://sign.example.com',
    })).toBe(cloud);
  });

  test('leaves the link alone when there is nowhere to send it', () => {
    const toPublicUrl = load();
    expect(toPublicUrl(SIGNED, {
      serverUrl: 'http://gateway:3000',
      publicUrl: null,
      requestOrigin: null,
    })).toBe(SIGNED);
  });

  test('leaves the link alone when the server URL is unknown', () => {
    const toPublicUrl = load();
    expect(toPublicUrl(SIGNED, {
      serverUrl: null,
      publicUrl: 'https://db.example.com',
      requestOrigin: 'http://localhost:3000',
    })).toBe(SIGNED);
  });

  test('returns a missing or malformed link as it came', () => {
    const toPublicUrl = load();
    const opts = { serverUrl: 'http://gateway:3000', publicUrl: 'https://db.example.com', requestOrigin: null };
    expect(toPublicUrl(null, opts)).toBe(null);
    expect(toPublicUrl('not a url', opts)).toBe('not a url');
  });
});
