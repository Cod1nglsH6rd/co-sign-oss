/**
 * lib/setupChecks.js checks the Anthropic key and the Resend key the owner
 * pastes, with a live call that costs nothing (list models, list domains).
 * fetch is injected, so nothing here touches the network. Each check stops
 * after 10 seconds and every answer is a plain message without the key.
 */

// Obviously fake keys: distinctive enough to spot if one leaks into a message.
const ANTHROPIC_KEY = 'fake-anthropic-key-NOT-REAL-0001';
const RESEND_KEY = 'fake-resend-key-NOT-REAL-0002';

const ANTHROPIC_REFUSED = 'Anthropic refused that key. Check it and paste it again.';
const ANTHROPIC_TIMEOUT =
  'Anthropic did not answer within 10 seconds. Check this server can reach the internet and try again.';
const RESEND_TIMEOUT =
  'Resend did not answer within 10 seconds. Check this server can reach the internet and try again.';

function checks() {
  return require('../../lib/setupChecks');
}

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function fetchAnswering(status, body) {
  return jest.fn(async () => response(status, body));
}

// A fetch that never answers until the request is aborted, like a real one.
function hangingFetch() {
  return jest.fn(
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      })
  );
}

let logSpies;
beforeEach(() => {
  logSpies = ['log', 'info', 'warn', 'error', 'debug'].map((name) =>
    jest.spyOn(console, name).mockImplementation(() => {})
  );
});
afterEach(() => {
  logSpies.forEach((spy) => spy.mockRestore());
  jest.useRealTimers();
});

function asText(part) {
  if (part instanceof Error) return `${part.message} ${part.stack}`;
  if (part && typeof part === 'object') return JSON.stringify(part);
  return String(part);
}

function expectNoKeyLogged(key) {
  for (const spy of logSpies) {
    for (const call of spy.mock.calls) {
      expect(call.map(asText).join(' ')).not.toContain(key);
    }
  }
}

describe('checkAnthropicKey', () => {
  test('lists models with a GET, the key in x-api-key, and is ok on 200', async () => {
    const fetch = fetchAnswering(200, { data: [] });
    const result = await checks().checkAnthropicKey(ANTHROPIC_KEY, { fetch });
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models');
    expect((init.method || 'GET').toUpperCase()).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers['x-api-key']).toBe(ANTHROPIC_KEY);
    expect(init.headers['anthropic-version']).toBeTruthy();
    expect(init.signal).toBeDefined();
  });

  test.each([401, 403])('a %i is a plain refusal', async (status) => {
    const fetch = fetchAnswering(status, { type: 'error', error: { type: 'authentication_error' } });
    const result = await checks().checkAnthropicKey(ANTHROPIC_KEY, { fetch });
    expect(result).toEqual({ ok: false, message: ANTHROPIC_REFUSED });
    expectNoKeyLogged(ANTHROPIC_KEY);
  });

  test('a check longer than 10 seconds is aborted with a plain message', async () => {
    jest.useFakeTimers();
    const fetch = hangingFetch();
    const pending = checks().checkAnthropicKey(ANTHROPIC_KEY, { fetch });
    await jest.advanceTimersByTimeAsync(9999);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(result).toEqual({ ok: false, message: ANTHROPIC_TIMEOUT });
    expectNoKeyLogged(ANTHROPIC_KEY);
  });

  test('a network error and a 5xx each get their own plain message, without the key', async () => {
    const networkFetch = jest.fn(async () => {
      throw new TypeError(`fetch failed for key ${ANTHROPIC_KEY}`);
    });
    const network = await checks().checkAnthropicKey(ANTHROPIC_KEY, { fetch: networkFetch });
    const server = await checks().checkAnthropicKey(ANTHROPIC_KEY, {
      fetch: fetchAnswering(503, { error: { message: `bad ${ANTHROPIC_KEY}` } }),
    });

    expect(network.ok).toBe(false);
    expect(server.ok).toBe(false);
    for (const r of [network, server]) {
      expect(typeof r.message).toBe('string');
      expect(r.message.length).toBeGreaterThan(0);
      expect(r.message).not.toContain(ANTHROPIC_KEY);
      expect([ANTHROPIC_REFUSED, ANTHROPIC_TIMEOUT]).not.toContain(r.message);
    }
    expect(network.message).not.toBe(server.message);
    expectNoKeyLogged(ANTHROPIC_KEY);
  });
});

describe('checkResendKey', () => {
  test('lists domains with a GET and a Bearer key, and is ok on 200', async () => {
    const fetch = fetchAnswering(200, { data: [] });
    const result = await checks().checkResendKey(RESEND_KEY, { fetch });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/domains');
    expect((init.method || 'GET').toUpperCase()).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers.Authorization).toBe(`Bearer ${RESEND_KEY}`);
    expect(init.signal).toBeDefined();
  });

  test('a send-only key (401 restricted_api_key) is ok', async () => {
    const fetch = fetchAnswering(401, {
      statusCode: 401,
      message: 'This API key is restricted to only send emails',
      name: 'restricted_api_key',
    });
    const result = await checks().checkResendKey(RESEND_KEY, { fetch });
    expect(result).toEqual({ ok: true });
  });

  test.each([
    [401, { statusCode: 401, message: 'API key is invalid', name: 'validation_error' }],
    [403, { statusCode: 403, message: 'Forbidden', name: 'invalid_access' }],
  ])('any other %i is a plain refusal', async (status, body) => {
    const result = await checks().checkResendKey(RESEND_KEY, { fetch: fetchAnswering(status, body) });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^Resend refused that key/);
    expect(result.message).not.toContain(RESEND_KEY);
    expectNoKeyLogged(RESEND_KEY);
  });

  test('a check longer than 10 seconds is aborted with a plain message', async () => {
    jest.useFakeTimers();
    const fetch = hangingFetch();
    const pending = checks().checkResendKey(RESEND_KEY, { fetch });
    await jest.advanceTimersByTimeAsync(10000);
    const result = await pending;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(result).toEqual({ ok: false, message: RESEND_TIMEOUT });
    expectNoKeyLogged(RESEND_KEY);
  });

  test('a network error and a 5xx each get their own plain message, without the key', async () => {
    const network = await checks().checkResendKey(RESEND_KEY, {
      fetch: jest.fn(async () => {
        throw new TypeError(`getaddrinfo ENOTFOUND ${RESEND_KEY}`);
      }),
    });
    const server = await checks().checkResendKey(RESEND_KEY, {
      fetch: fetchAnswering(500, { message: `oops ${RESEND_KEY}` }),
    });

    expect(network.ok).toBe(false);
    expect(server.ok).toBe(false);
    for (const r of [network, server]) {
      expect(r.message).toMatch(/Resend/);
      expect(r.message).not.toContain(RESEND_KEY);
      expect(r.message).not.toMatch(/refused/);
      expect(r.message).not.toBe(RESEND_TIMEOUT);
    }
    expect(network.message).not.toBe(server.message);
    expectNoKeyLogged(RESEND_KEY);
  });
});
