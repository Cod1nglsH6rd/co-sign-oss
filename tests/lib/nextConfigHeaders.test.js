// The headers next.config.js sends. `next build` evaluates headers() and
// writes the result into .next/routes-manifest.json; the server only reads
// that file, so every value here is fixed when the app is built.
//
// - Access-Control-Allow-Origin on /api comes from the install's own site
//   address (NEXT_PUBLIC_APP_URL from the environment, else the one saved at
//   setup, as lib/hostSettings.js resolves it), reduced to its origin. With no
//   address, or one that is not an http(s) URL, no CORS header is sent at all.
// - Strict-Transport-Security is a plain max-age: no includeSubDomains or
//   preload, which would pin every subdomain of a self-hoster's domain.

// The saved setup answer, stood in for: env first (non-blank), then saved.
const mockSaved = { siteAddress: null };
jest.mock('../../lib/hostSettings', () => ({
  effectiveSetting: (name, env) => {
    const value = env[name];
    if (typeof value === 'string' && value.trim()) return value;
    return name === 'NEXT_PUBLIC_APP_URL' ? mockSaved.siteAddress : null;
  },
}));

const ENV_NAMES = ['SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN', 'NEXT_PUBLIC_APP_URL'];

// headers() for a given NEXT_PUBLIC_APP_URL (undefined: unset) and saved value.
async function headersWith({ env, saved = null }) {
  const before = Object.fromEntries(ENV_NAMES.map((k) => [k, process.env[k]]));
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (env === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = env;
  mockSaved.siteAddress = saved;
  try {
    let config;
    jest.isolateModules(() => {
      config = require('../../next.config.js');
    });
    return await config.headers();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const valueOf = (rule, key) => {
  const found = rule.headers.find((h) => h.key.toLowerCase() === key.toLowerCase());
  return found ? found.value : undefined;
};
const rule = (rules, source) => rules.find((r) => r.source === source);
const allHeaderKeys = (rules) => rules.flatMap((r) => r.headers.map((h) => h.key));

describe('CORS on /api', () => {
  it('allows the site address from the environment, as an origin', async () => {
    const rules = await headersWith({ env: 'https://sign.example.com/app/' });
    expect(valueOf(rule(rules, '/api/:path*'), 'Access-Control-Allow-Origin')).toBe('https://sign.example.com');
    expect(valueOf(rule(rules, '/api/:path*'), 'Access-Control-Allow-Methods')).toBe('GET,POST,PUT,DELETE,OPTIONS');
    expect(valueOf(rule(rules, '/api/:path*'), 'Access-Control-Allow-Headers')).toMatch(/Authorization, Content-Type/);
  });

  it('keeps a port in the origin', async () => {
    const rules = await headersWith({ env: 'http://localhost:3000' });
    expect(valueOf(rule(rules, '/api/:path*'), 'Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  });

  it('uses the address saved at setup when the environment has none', async () => {
    const rules = await headersWith({ env: undefined, saved: 'https://saved.example.com' });
    expect(valueOf(rule(rules, '/api/:path*'), 'Access-Control-Allow-Origin')).toBe('https://saved.example.com');
  });

  it.each([
    ['unset', undefined],
    ['blank', '   '],
    ['not a URL', 'sign.example.com'],
    ['not http(s)', 'ftp://sign.example.com'],
  ])('sends no CORS header at all when the address is %s', async (_label, env) => {
    const rules = await headersWith({ env });
    expect(allHeaderKeys(rules).filter((k) => /^access-control-/i.test(k))).toEqual([]);
  });

  it('never sends CORS headers on pages', async () => {
    const rules = await headersWith({ env: 'https://sign.example.com' });
    expect(rule(rules, '/:path*').headers.map((h) => h.key).filter((k) => /^access-control-/i.test(k))).toEqual([]);
  });
});

describe('Strict-Transport-Security', () => {
  it('is a plain two-year max-age on every rule, without includeSubDomains or preload', async () => {
    const rules = await headersWith({ env: 'https://sign.example.com' });
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(valueOf(r, 'Strict-Transport-Security')).toBe('max-age=63072000');
    }
  });
});
