/**
 * @jest-environment node
 */

/**
 * lib/setupClient.js is what the setup page calls to load and save the
 * owner's answers. fetch is passed in, so no network is used here.
 *
 * - loadSettings(code, fetchImpl) GETs /api/setup/settings with the code in
 *   the x-setup-code header (never in the URL).
 * - saveSettings(code, answers, fetchImpl) POSTs the answers as JSON with
 *   the same header.
 * Each answer comes back as { kind: 'ok', settings },
 * { kind: 'errors', errors } or { kind: 'failed', message }; neither call
 * ever rejects.
 */

const REACH = 'Could not reach the server, try again.';
const CODE = 'abcd-1234';

function load() {
  const mod = require('../../lib/setupClient');
  expect(typeof mod.loadSettings).toBe('function');
  expect(typeof mod.saveSettings).toBe('function');
  return mod;
}

// A stand-in for what fetch resolves: status, ok, headers and json().
function reply(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  };
}

function fakeFetch(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  fn.calls = calls;
  return fn;
}

function headerOf(init, name) {
  const headers = (init && init.headers) || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

const settings = {
  ANTHROPIC_API_KEY: { set: true, source: 'saved', value: 'sk-a…wxyz' },
  EMAIL_PROVIDER: { set: false, source: null, value: null },
};

describe('loadSettings', () => {
  it('GETs /api/setup/settings with the code in the x-setup-code header, not the URL', async () => {
    const { loadSettings } = load();
    const fetchImpl = fakeFetch(reply(200, { settings }));
    await loadSettings(CODE, fetchImpl);
    expect(fetchImpl.calls).toHaveLength(1);
    const { url, init } = fetchImpl.calls[0];
    expect(url).toBe('/api/setup/settings');
    expect(url).not.toContain(CODE);
    expect(((init && init.method) || 'GET').toUpperCase()).toBe('GET');
    expect(headerOf(init, 'x-setup-code')).toBe(CODE);
  });

  it('resolves { kind: ok, settings } on 200', async () => {
    const { loadSettings } = load();
    const result = await loadSettings(CODE, fakeFetch(reply(200, { settings })));
    expect(result).toEqual({ kind: 'ok', settings });
  });

  it('resolves failed with the API error text on 500', async () => {
    const { loadSettings } = load();
    const result = await loadSettings(CODE, fakeFetch(reply(500, { error: 'Server broke.' })));
    expect(result).toEqual({ kind: 'failed', message: 'Server broke.' });
  });

  it('resolves failed with the reach message when fetch throws', async () => {
    const { loadSettings } = load();
    const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    await expect(loadSettings(CODE, fetchImpl)).resolves.toEqual({ kind: 'failed', message: REACH });
  });

  it('resolves failed with the reach message when the body cannot be read', async () => {
    const { loadSettings } = load();
    const response = reply(200, null);
    response.json = async () => { throw new SyntaxError('Unexpected token <'); };
    await expect(loadSettings(CODE, fakeFetch(response))).resolves.toEqual({ kind: 'failed', message: REACH });
  });
});

describe('saveSettings', () => {
  const answers = { EMAIL_PROVIDER: 'none', NEXT_PUBLIC_APP_URL: 'https://sign.example.org' };

  it('POSTs the answers as JSON with the x-setup-code header', async () => {
    const { saveSettings } = load();
    const fetchImpl = fakeFetch(reply(200, { settings }));
    await saveSettings(CODE, answers, fetchImpl);
    expect(fetchImpl.calls).toHaveLength(1);
    const { url, init } = fetchImpl.calls[0];
    expect(url).toBe('/api/setup/settings');
    expect(init.method.toUpperCase()).toBe('POST');
    expect(headerOf(init, 'content-type')).toBe('application/json');
    expect(headerOf(init, 'x-setup-code')).toBe(CODE);
    expect(JSON.parse(init.body)).toEqual({
      EMAIL_PROVIDER: 'none',
      NEXT_PUBLIC_APP_URL: 'https://sign.example.org',
    });
  });

  it('resolves { kind: ok, settings } on 200', async () => {
    const { saveSettings } = load();
    const result = await saveSettings(CODE, answers, fakeFetch(reply(200, { settings })));
    expect(result).toEqual({ kind: 'ok', settings });
  });

  it('resolves { kind: errors, errors } on 400 with errors', async () => {
    const { saveSettings } = load();
    const errors = { ANTHROPIC_API_KEY: 'That key was refused.' };
    const result = await saveSettings(CODE, answers, fakeFetch(reply(400, { errors })));
    expect(result).toEqual({ kind: 'errors', errors });
  });

  it('resolves failed with the error text on 400 with error and no errors', async () => {
    const { saveSettings } = load();
    const result = await saveSettings(
      CODE,
      answers,
      fakeFetch(reply(400, { error: 'Send the settings as a JSON object.' })),
    );
    expect(result).toEqual({ kind: 'failed', message: 'Send the settings as a JSON object.' });
  });

  it('resolves failed with the API error text on 500', async () => {
    const { saveSettings } = load();
    const result = await saveSettings(
      CODE,
      answers,
      fakeFetch(reply(500, { error: 'Could not save the settings on this server.' })),
    );
    expect(result).toEqual({ kind: 'failed', message: 'Could not save the settings on this server.' });
  });

  it('resolves failed with the reach message when fetch throws', async () => {
    const { saveSettings } = load();
    const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    await expect(saveSettings(CODE, answers, fetchImpl)).resolves.toEqual({ kind: 'failed', message: REACH });
  });

  it('resolves failed with the reach message when the body cannot be read', async () => {
    const { saveSettings } = load();
    const response = reply(500, null);
    response.json = async () => { throw new SyntaxError('Unexpected end of JSON input'); };
    await expect(saveSettings(CODE, answers, fakeFetch(response))).resolves.toEqual({ kind: 'failed', message: REACH });
  });
});
