/**
 * A fresh install sends visitors to /setup.
 * lib/setupRedirect.js setupRedirectTarget(pathname, { needed }) decides where
 * a page view goes; components/SetupGate.js (rendered by pages/_app.js) asks
 * GET /api/setup/state once and calls router.replace('/setup') when needed.
 * The gate's work is its exported checkSetup(router, fetchImpl), called here
 * with a fake router and fetch; pages/_app.js is rendered on the server.
 */

jest.mock('next/router', () => ({
  useRouter: () => ({ asPath: '/en', pathname: '/[locale]', query: { locale: 'en' }, replace() {}, push() {} }),
}));
jest.mock('next-intl', () => ({
  NextIntlClientProvider: function NextIntlClientProvider(props) { return props.children; },
}));
jest.mock('react-hot-toast', () => ({ Toaster: function Toaster() { return null; } }));
jest.mock('../../lib/supabaseClient', () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
}));

function stateResponse(body, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
}

function fakeRouter(asPath, pathname) {
  return { asPath, pathname, query: {}, replace: jest.fn(), push: jest.fn() };
}

describe('setupRedirectTarget', () => {
  const target = (p, needed) => require('../../lib/setupRedirect').setupRedirectTarget(p, { needed });

  it.each(['/', '/en', '/en/dashboard', '/en/login', '/enterprise/dashboard', '/enterprise/setup', '/es/settings'])(
    'sends the page %s to /setup when setup is needed',
    (p) => {
      expect(target(p, true)).toBe('/setup');
    },
  );

  it.each([
    '/setup',
    '/en/setup',
    '/vi/setup',
    '/api/setup/state',
    '/api/sessions/abc',
    '/embed/tok123',
    '/_next/static/chunks/main.js',
    '/en/fill/tok123',
    '/vi/fill/abc/def',
    '/[locale]/fill/[token]',
    '/404',
    '/_error',
  ])('leaves %s alone even when setup is needed', (p) => {
    expect(target(p, true)).toBeNull();
  });

  it.each(['/', '/en/dashboard', '/setup'])('leaves %s alone when setup is not needed', (p) => {
    expect(target(p, false)).toBeNull();
  });
});

describe('SetupGate checkSetup', () => {
  const checkSetup = (router, fetchImpl) => require('../../components/SetupGate').checkSetup(router, fetchImpl);

  it('fetches /api/setup/state once and redirects to /setup on a fresh install', async () => {
    const router = fakeRouter('/en/dashboard', '/[locale]/dashboard');
    const fetchImpl = jest.fn(() => stateResponse({ needed: true }));
    await checkSetup(router, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/setup/state');
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/setup');
  });

  it('does not redirect once setup is done', async () => {
    const router = fakeRouter('/en/dashboard', '/[locale]/dashboard');
    const fetchImpl = jest.fn(() => stateResponse({ needed: false }));
    await checkSetup(router, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not redirect a signer on a fill page, even on a fresh install', async () => {
    const router = fakeRouter('/en/fill/tok123?x=1', '/[locale]/fill/[token]');
    await checkSetup(router, jest.fn(() => stateResponse({ needed: true })));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not redirect from the not-found page (no setup page to land on yet)', async () => {
    const router = fakeRouter('/en/no-such-page', '/404');
    await checkSetup(router, jest.fn(() => stateResponse({ needed: true })));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not redirect when the state fetch fails', async () => {
    const router = fakeRouter('/en/dashboard', '/[locale]/dashboard');
    const fetchImpl = jest.fn(() => Promise.reject(new Error('offline')));
    await checkSetup(router, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not redirect when the state endpoint answers with an error', async () => {
    const router = fakeRouter('/en/dashboard', '/[locale]/dashboard');
    await checkSetup(router, jest.fn(() => stateResponse({ needed: true }, false)));
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('pages/_app.js', () => {
  it('renders SetupGate around every page', () => {
    const fs = require('fs');
    const path = require('path');
    expect(fs.existsSync(path.join(__dirname, '../../components/SetupGate.js'))).toBe(true);
    jest.doMock('../../components/SetupGate', () => ({
      __esModule: true,
      default: function SetupGateStub() { return 'setup-gate-rendered'; },
      checkSetup: () => Promise.resolve(),
    }));
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const MyApp = require('../../pages/_app').default;
    function Page() { return 'the-page'; }
    const html = renderToStaticMarkup(React.createElement(MyApp, { Component: Page, pageProps: {} }));
    expect(html).toContain('the-page');
    expect(html).toContain('setup-gate-rendered');
  });
});
