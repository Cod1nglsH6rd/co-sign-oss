import { locales } from '../../lib/i18n';

const { pathToRegexp } = require('next/dist/compiled/path-to-regexp');

// Issues co-sign-204/205 (finished by hand in co-sign-209): the pricing and
// billing pages are removed, so next.config.js sends their old paths home with
// a permanent redirect: /pricing and /billing to /, and /<locale>/pricing and
// /<locale>/billing to that locale's home page.

function loadConfig() {
  let config;
  const saved = { SENTRY_DSN: process.env.SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN };
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  try {
    jest.isolateModules(() => {
      config = require('../../next.config.js');
    });
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
  return config;
}

// The first redirect whose source matches `url`, resolved to its destination.
function redirectFor(redirects, url) {
  for (const r of redirects) {
    const keys = [];
    const m = pathToRegexp(r.source, keys).exec(url);
    if (!m) continue;
    let destination = r.destination;
    keys.forEach((key, i) => {
      destination = destination.replace(`:${key.name}`, m[i + 1]);
    });
    return { destination, permanent: r.permanent };
  }
  return null;
}

describe('redirects for the removed pricing and billing pages', () => {
  let redirects;

  beforeAll(async () => {
    redirects = await loadConfig().redirects();
  });

  it.each(['/pricing', '/billing'])('%s goes to / for good', (url) => {
    expect(redirectFor(redirects, url)).toEqual({ destination: '/', permanent: true });
  });

  it.each(locales.flatMap((l) => [[`/${l}/pricing`, `/${l}`], [`/${l}/billing`, `/${l}`]]))(
    '%s goes to %s for good',
    (url, home) => {
      expect(redirectFor(redirects, url)).toEqual({ destination: home, permanent: true });
    },
  );

  it('leaves other paths alone', () => {
    for (const url of ['/', '/en', '/en/dashboard', '/xx/pricing', '/pricing-faq', '/en/pricing/extra', '/api/billing']) {
      expect(redirectFor(redirects, url)).toBeNull();
    }
  });
});
