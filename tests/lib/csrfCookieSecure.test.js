import { setCsrfCookie } from '../../lib/csrf';

function fakeRes() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
  };
}

function cookieFor(req) {
  const res = fakeRes();
  setCsrfCookie(res, 'tok123', req);
  return res.headers['set-cookie'];
}

function attrs(cookie) {
  return cookie.split(';').map((p) => p.trim()).filter(Boolean);
}

describe('setCsrfCookie Secure flag in production', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('omits Secure for a plain http request', () => {
    const cookie = cookieFor({ headers: {}, socket: {} });
    expect(attrs(cookie)).not.toContain('Secure');
    expect(attrs(cookie)).toEqual(['x-csrf-token=tok123', 'SameSite=Strict', 'Path=/', 'Max-Age=3600']);
  });

  it('omits Secure when x-forwarded-proto is http', () => {
    const cookie = cookieFor({ headers: { 'x-forwarded-proto': 'http' }, socket: {} });
    expect(attrs(cookie)).not.toContain('Secure');
  });

  it('sets Secure when x-forwarded-proto is https', () => {
    const cookie = cookieFor({ headers: { 'x-forwarded-proto': 'https' }, socket: {} });
    expect(attrs(cookie)).toEqual(['x-csrf-token=tok123', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=3600']);
  });

  it('sets Secure when the socket is encrypted', () => {
    const cookie = cookieFor({ headers: {}, socket: { encrypted: true } });
    expect(attrs(cookie)).toContain('Secure');
  });

  it('uses the first value of a comma-separated x-forwarded-proto', () => {
    expect(attrs(cookieFor({ headers: { 'x-forwarded-proto': 'http, https' }, socket: {} }))).not.toContain('Secure');
    expect(attrs(cookieFor({ headers: { 'x-forwarded-proto': 'https, http' }, socket: {} }))).toContain('Secure');
  });
});
