/**
 * @jest-environment node
 */

/**
 * When /api/setup/settings refuses the setup code (401), lib/setupClient.js
 * asks GET /api/setup/state whether setup is still needed:
 *   { needed: true }  -> { kind: 'code', message: <the 401's error text> }
 *   { needed: false } -> { kind: 'signin' }
 *   throws / not 200  -> { kind: 'failed', message: REACH }
 * The state call carries no setup code, and no URL ever does.
 */

const REACH = 'Could not reach the server, try again.';
const CODE = 'abcd-1234';
// A made-up stand-in for a full saved key; not shaped like any real key.
const FULL_KEY = 'test-only-full-key-FULLVALUE0123456789wxyz';
const MASKED = 'test…wxyz';
const REFUSED = 'That setup code is not right.';

function load() {
  return require('../../lib/setupClient');
}

function reply(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  };
}

// routes: { '/api/setup/settings': response, '/api/setup/state': response | Error }
function routedFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const answer = routes[url];
    if (answer instanceof Error) throw answer;
    if (!answer) throw new Error(`unexpected url ${url}`);
    return answer;
  };
  fn.calls = calls;
  return fn;
}

function headerNames(init) {
  return Object.keys((init && init.headers) || {}).map((k) => k.toLowerCase());
}

const callers = [
  ['loadSettings', (mod, f) => mod.loadSettings(CODE, f)],
  ['saveSettings', (mod, f) => mod.saveSettings(CODE, { EMAIL_PROVIDER: 'resend' }, f)],
];

describe.each(callers)('%s on 401', (name, call) => {
  it('GETs /api/setup/state without the setup-code header', async () => {
    const f = routedFetch({
      '/api/setup/settings': reply(401, { error: REFUSED }),
      '/api/setup/state': reply(200, { needed: true }),
    });
    await call(load(), f);
    const stateCalls = f.calls.filter((c) => c.url === '/api/setup/state');
    expect(stateCalls).toHaveLength(1);
    const method = (stateCalls[0].init && stateCalls[0].init.method) || 'GET';
    expect(method).toBe('GET');
    expect(headerNames(stateCalls[0].init)).not.toContain('x-setup-code');
    expect(JSON.stringify(stateCalls[0].init || {})).not.toContain(CODE);
  });

  it("resolves { kind: 'code', message } with the 401's error text when setup is needed", async () => {
    const f = routedFetch({
      '/api/setup/settings': reply(401, { error: REFUSED }),
      '/api/setup/state': reply(200, { needed: true }),
    });
    await expect(call(load(), f)).resolves.toEqual({ kind: 'code', message: REFUSED });
  });

  it("resolves { kind: 'signin' } when setup is no longer needed", async () => {
    const f = routedFetch({
      '/api/setup/settings': reply(401, { error: REFUSED }),
      '/api/setup/state': reply(200, { needed: false }),
    });
    await expect(call(load(), f)).resolves.toEqual({ kind: 'signin' });
  });

  it('resolves failed with the reach message when the state call throws', async () => {
    const f = routedFetch({
      '/api/setup/settings': reply(401, { error: REFUSED }),
      '/api/setup/state': new Error('offline'),
    });
    await expect(call(load(), f)).resolves.toEqual({ kind: 'failed', message: REACH });
  });

  it('resolves failed with the reach message when the state call is not 200', async () => {
    const f = routedFetch({
      '/api/setup/settings': reply(401, { error: REFUSED }),
      '/api/setup/state': reply(500, { error: 'boom' }),
    });
    await expect(call(load(), f)).resolves.toEqual({ kind: 'failed', message: REACH });
  });

  it('never puts the code in any requested URL', async () => {
    const f = routedFetch({
      '/api/setup/settings': reply(401, { error: REFUSED }),
      '/api/setup/state': reply(200, { needed: true }),
    });
    await call(load(), f);
    expect(f.calls.length).toBe(2);
    for (const c of f.calls) expect(String(c.url)).not.toContain(CODE);
  });
});

describe('a full key in error or extra fields never reaches an outcome', () => {
  const masked = {
    ANTHROPIC_API_KEY: { set: true, source: 'saved', value: MASKED },
  };

  it.each(callers)('%s: 401 and state answers carrying the key', async (name, call) => {
    const mod = load();
    const cases = [
      [reply(401, { error: REFUSED, key: FULL_KEY }), reply(200, { needed: true, key: FULL_KEY })],
      [reply(401, { error: REFUSED, extra: { value: FULL_KEY } }), reply(200, { needed: false, value: FULL_KEY })],
      [reply(401, { error: REFUSED }), reply(500, { error: FULL_KEY, key: FULL_KEY })],
      [reply(401, { error: REFUSED }), reply(200, { needed: 'maybe', error: FULL_KEY })],
    ];
    for (const [settingsReply, stateReply] of cases) {
      const f = routedFetch({ '/api/setup/settings': settingsReply, '/api/setup/state': stateReply });
      const outcome = await call(mod, f);
      expect(['code', 'signin', 'failed']).toContain(outcome.kind);
      expect(JSON.stringify(outcome)).not.toContain(FULL_KEY);
    }
  });

  it.each(callers)('%s: a 200 with the key in an extra field keeps only the masked settings', async (name, call) => {
    const f = routedFetch({
      '/api/setup/settings': reply(200, { settings: masked, key: FULL_KEY, raw: { ANTHROPIC_API_KEY: FULL_KEY } }),
    });
    const outcome = await call(load(), f);
    expect(outcome).toEqual({ kind: 'ok', settings: masked });
    expect(JSON.stringify(outcome)).not.toContain(FULL_KEY);
    expect(JSON.stringify(outcome)).toContain(MASKED);
  });
});
