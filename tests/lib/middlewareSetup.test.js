/**
 * middleware() serves /setup as-is: no locale redirect, but the framing
 * headers (X-Frame-Options DENY and the CSP) are still set. Other pages such
 * as /about still redirect to their /en/ form.
 */

function requestFor(path) {
  const { NextRequest } = require('next/server');
  return new NextRequest(new URL(path, 'http://localhost:3000'));
}

async function run(path) {
  const { middleware } = require('../../middleware');
  return middleware(requestFor(path));
}

describe('middleware and /setup', () => {
  it('does not redirect /setup', async () => {
    const res = await run('/setup');
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).not.toBe(307);
  });

  it('still denies framing on /setup', async () => {
    const res = await run('/setup');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('still redirects /about to /en/about', async () => {
    const res = await run('/about');
    expect(res.headers.get('location')).toBe('http://localhost:3000/en/about');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
