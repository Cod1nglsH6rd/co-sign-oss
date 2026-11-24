/**
 * GET /api/runtime-config.js hands the browser the database address and the
 * public (anon) key the running server has now, as a script that sets
 * window.__COSIGN_PUBLIC__. It never carries the service key, is never
 * cached, and a crafted value cannot break out of its string.
 *
 * In the browser, lib/supabaseClient.js prefers those runtime values over the
 * build-time NEXT_PUBLIC_* ones. A null runtime url means the page's origin,
 * unless the build carries its own url (the Vercel/cloud setup), which then
 * still wins so that setup works unchanged.
 */

import vm from 'vm';
import { createMocks } from 'node-mocks-http';

const VARS = [
  'PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const saved = {};

beforeEach(() => {
  for (const name of VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  delete global.window;
  jest.resetModules();
});

// The file Next serves at /api/runtime-config.js.
function loadHandler() {
  return require('../../pages/api/runtime-config.js.js').default;
}

async function get(method = 'GET') {
  const handler = loadHandler();
  const { req, res } = createMocks({ method });
  await handler(req, res);
  return res;
}

// Run the served script the way a browser would and return what it set.
function runInPage(body) {
  const sandbox = { window: {}, alert: jest.fn() };
  vm.runInNewContext(body, sandbox);
  return sandbox;
}

describe('GET /api/runtime-config.js', () => {
  test('sets the anon key and the public url, and never sends the service key', async () => {
    process.env.PUBLIC_SUPABASE_URL = 'https://db.example.org';
    process.env.SUPABASE_ANON_KEY = 'anon-abc';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret-xyz';

    const res = await get();

    expect(res._getStatusCode()).toBe(200);
    const body = String(res._getData());
    expect(body).toContain('anon-abc');
    expect(body).not.toContain('service-secret-xyz');
    expect(runInPage(body).window.__COSIGN_PUBLIC__).toEqual({
      supabaseUrl: 'https://db.example.org',
      anonKey: 'anon-abc',
    });
  });

  test('supabaseUrl is null when PUBLIC_SUPABASE_URL is not set, even if the server url is', async () => {
    process.env.SUPABASE_URL = 'http://kong:8000';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-def';

    const res = await get();

    const body = String(res._getData());
    expect(body).not.toContain('kong');
    expect(runInPage(body).window.__COSIGN_PUBLIC__).toEqual({
      supabaseUrl: null,
      anonKey: 'anon-def',
    });
  });

  test('is served as JavaScript and never cached', async () => {
    process.env.SUPABASE_ANON_KEY = 'anon-abc';

    const res = await get();

    expect(res.getHeader('Content-Type')).toMatch(/^application\/javascript\b/);
    expect(res.getHeader('Cache-Control')).toBe('no-store');
  });

  // U+2028 ends a line in older JS engines, so it must be escaped too.
  const LINE_SEPARATOR = String.fromCharCode(0x2028);

  test('a crafted value stays inside its string', async () => {
    const crafted = `x";alert(1);//${LINE_SEPARATOR}</script><script>alert(2)</script>`;
    process.env.PUBLIC_SUPABASE_URL = crafted;
    process.env.SUPABASE_ANON_KEY = crafted;

    const res = await get();

    const body = String(res._getData());
    expect(body).not.toContain('</script>');
    expect(body).not.toContain(LINE_SEPARATOR);
    const page = runInPage(body);
    expect(page.alert).not.toHaveBeenCalled();
    expect(page.window.__COSIGN_PUBLIC__).toEqual({ supabaseUrl: crafted, anonKey: crafted });
  });

  test('refuses a POST', async () => {
    process.env.SUPABASE_ANON_KEY = 'anon-abc';

    const res = await get('POST');

    expect(res._getStatusCode()).toBe(405);
    expect(String(res._getData())).not.toContain('anon-abc');
  });
});

describe('lib/supabaseClient.js in the browser', () => {
  function clientArgs({ runtime, buildUrl, buildKey }) {
    if (buildUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = buildUrl;
    if (buildKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = buildKey;
    global.window = { location: { origin: 'https://app.example.org' } };
    if (runtime) global.window.__COSIGN_PUBLIC__ = runtime;
    jest.doMock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({})) }));
    const { createClient } = require('@supabase/supabase-js');
    require('../../lib/supabaseClient');
    return createClient.mock.calls[0].slice(0, 2);
  }

  test('uses the runtime url and key before the build-time ones', () => {
    expect(clientArgs({
      runtime: { supabaseUrl: 'https://db.example.org', anonKey: 'anon-run' },
      buildUrl: 'https://build.supabase.co',
      buildKey: 'anon-build',
    })).toEqual(['https://db.example.org', 'anon-run']);
  });

  test('a null runtime url means the page origin when the build has no url', () => {
    expect(clientArgs({
      runtime: { supabaseUrl: null, anonKey: 'anon-run' },
    })).toEqual(['https://app.example.org', 'anon-run']);
  });

  test('a null runtime url keeps the build-time url (Vercel/cloud), with the runtime key', () => {
    expect(clientArgs({
      runtime: { supabaseUrl: null, anonKey: 'anon-run' },
      buildUrl: 'https://build.supabase.co',
      buildKey: 'anon-build',
    })).toEqual(['https://build.supabase.co', 'anon-run']);
  });

  test('a null runtime key falls back to the build-time key', () => {
    expect(clientArgs({
      runtime: { supabaseUrl: null, anonKey: null },
      buildUrl: 'https://build.supabase.co',
      buildKey: 'anon-build',
    })).toEqual(['https://build.supabase.co', 'anon-build']);
  });

  test('without runtime values the build-time ones still work', () => {
    expect(clientArgs({
      buildUrl: 'https://build.supabase.co',
      buildKey: 'anon-build',
    })).toEqual(['https://build.supabase.co', 'anon-build']);
  });
});
