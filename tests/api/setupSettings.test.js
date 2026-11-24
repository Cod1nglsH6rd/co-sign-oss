/**
 * GET/POST /api/setup/settings.
 * - Access goes through lib/setupAccess.js: while setup is needed, the
 *   x-setup-code header; after setup, a signed-in owner (anonymous: 401).
 * - GET answers { settings: settingsView } with the API keys masked.
 * - POST checks each answer (keys live, through lib/setupChecks.js, mocked
 *   here), then saves to .cosign/settings.json only if every answer passed;
 *   otherwise 400 { errors: { NAME: message } } and nothing is saved.
 * - A name set in env is never saved over and comes back as source 'env'.
 * Every test runs in its own temp working folder. The key values are made-up
 * placeholders, not shaped like any real provider's key.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/setupChecks', () => ({
  checkAnthropicKey: jest.fn(),
  checkResendKey: jest.fn(),
}));

const CODE = '0123456789abcdef0123456789abcdef';
const ANTHROPIC_KEY = 'placeholder-anthropic-key-0000-wxyz';
const RESEND_KEY = 'placeholder-resend-key-1111-abcd';
const VARS = [
  'ADMIN_DASHBOARD_EMAILS',
  'NEXT_PUBLIC_OWNER_EMAILS',
  'VERCEL',
  'ANTHROPIC_API_KEY',
  'EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'NEXT_PUBLIC_APP_URL',
];
const saved = {};
let cwd;
let ipCounter = 0;
let ip;
let consoleSpies;

function checks() {
  return require('../../lib/setupChecks');
}

beforeEach(() => {
  VARS.forEach((name) => { saved[name] = process.env[name]; delete process.env[name]; });
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-setupsettings-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map(
    (level) => jest.spyOn(console, level).mockImplementation(() => {}),
  );
  checks().checkAnthropicKey.mockReset().mockResolvedValue({ ok: true });
  checks().checkResendKey.mockReset().mockResolvedValue({ ok: true });
  ipCounter += 1;
  ip = `10.1.0.${ipCounter}`;
  // Setup is needed and this is the host's code.
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(cwd, '.cosign', 'setup-code'), `${CODE}\n`, { mode: 0o600 });
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
  VARS.forEach((name) => {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  });
});

const settingsFile = () => path.join(cwd, '.cosign', 'settings.json');

function readSaved() {
  return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
}

async function call(method, body, headers = { 'x-setup-code': CODE }) {
  const handler = require('../../pages/api/setup/settings').default;
  const { req, res } = createMocks({
    method,
    headers: { 'x-forwarded-for': ip, 'content-type': 'application/json', ...headers },
    body,
  });
  await handler(req, res);
  return res;
}

describe('access', () => {
  test('an anonymous request after setup gets 401 and saves nothing', async () => {
    process.env.ADMIN_DASHBOARD_EMAILS = 'owner@example.com';
    const get = await call('GET', undefined, {});
    expect(get._getStatusCode()).toBe(401);
    const post = await call('POST', { EMAIL_FROM: 'from@example.com' }, {});
    expect(post._getStatusCode()).toBe(401);
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  test('a wrong setup code gets 401 while setup is needed', async () => {
    const res = await call('POST', { EMAIL_FROM: 'from@example.com' }, { 'x-setup-code': 'wrong' });
    expect(res._getStatusCode()).toBe(401);
    expect(fs.existsSync(settingsFile())).toBe(false);
  });
});

describe('GET', () => {
  test('returns the settings view with the keys masked', async () => {
    fs.writeFileSync(settingsFile(), JSON.stringify({
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      RESEND_API_KEY: RESEND_KEY,
      EMAIL_PROVIDER: 'resend',
    }));
    const res = await call('GET');
    expect(res._getStatusCode()).toBe(200);
    const { settings } = res._getJSONData();
    expect(settings.ANTHROPIC_API_KEY).toEqual({ set: true, source: 'saved', value: '••••wxyz' });
    expect(settings.RESEND_API_KEY).toEqual({ set: true, source: 'saved', value: '••••abcd' });
    expect(settings.EMAIL_PROVIDER).toEqual({ set: true, source: 'saved', value: 'resend' });
    expect(settings.EMAIL_FROM).toEqual({ set: false, source: null, value: null });
    expect(res._getData()).not.toContain(ANTHROPIC_KEY);
    expect(res._getData()).not.toContain(RESEND_KEY);
  });
});

describe('POST', () => {
  test('a bad Anthropic key answers 400 with the check message and saves nothing', async () => {
    const refused = 'Anthropic refused that key. Check it and paste it again.';
    checks().checkAnthropicKey.mockResolvedValue({ ok: false, message: refused });
    const res = await call('POST', {
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      EMAIL_PROVIDER: 'none',
      NEXT_PUBLIC_APP_URL: 'https://sign.example.com',
    });
    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ errors: { ANTHROPIC_API_KEY: refused } });
    expect(checks().checkAnthropicKey).toHaveBeenCalledWith(ANTHROPIC_KEY);
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  test('a provider check that times out answers 400 with the timeout message and saves nothing', async () => {
    const timeout = 'Resend did not answer within 10 seconds. Check this server can reach the internet and try again.';
    checks().checkResendKey.mockResolvedValue({ ok: false, message: timeout });
    const res = await call('POST', {
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: RESEND_KEY,
    });
    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ errors: { RESEND_API_KEY: timeout } });
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  test("mail 'none' saves EMAIL_PROVIDER blank and needs no Resend key", async () => {
    const res = await call('POST', { ANTHROPIC_API_KEY: ANTHROPIC_KEY, EMAIL_PROVIDER: 'none' });
    expect(res._getStatusCode()).toBe(200);
    expect(checks().checkResendKey).not.toHaveBeenCalled();
    const file = readSaved();
    expect(file.EMAIL_PROVIDER).toBe('');
    expect(file.RESEND_API_KEY).toBeUndefined();
    expect(file.ANTHROPIC_API_KEY).toBe(ANTHROPIC_KEY);
  });

  test("mail 'resend' with no key is refused and saves nothing", async () => {
    const res = await call('POST', { ANTHROPIC_API_KEY: ANTHROPIC_KEY, EMAIL_PROVIDER: 'resend' });
    expect(res._getStatusCode()).toBe(400);
    expect(typeof res._getJSONData().errors.RESEND_API_KEY).toBe('string');
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  test("mail 'resend' with a key Resend refuses answers 400 and saves nothing", async () => {
    const refused = 'Resend refused that key. Check it and paste it again.';
    checks().checkResendKey.mockResolvedValue({ ok: false, message: refused });
    const res = await call('POST', { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: RESEND_KEY });
    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({ errors: { RESEND_API_KEY: refused } });
    expect(checks().checkResendKey).toHaveBeenCalledWith(RESEND_KEY);
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  test("mail 'resend' with a key that passes is saved", async () => {
    const res = await call('POST', { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: RESEND_KEY });
    expect(res._getStatusCode()).toBe(200);
    expect(checks().checkResendKey).toHaveBeenCalledWith(RESEND_KEY);
    const file = readSaved();
    expect(file.EMAIL_PROVIDER).toBe('resend');
    expect(file.RESEND_API_KEY).toBe(RESEND_KEY);
  });

  test('an unknown mail choice is refused and saves nothing', async () => {
    const res = await call('POST', { EMAIL_PROVIDER: 'carrier-pigeon' });
    expect(res._getStatusCode()).toBe(400);
    expect(typeof res._getJSONData().errors.EMAIL_PROVIDER).toBe('string');
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  test('the site address is saved as cleaned', async () => {
    const res = await call('POST', { NEXT_PUBLIC_APP_URL: '  Sign.Example.com/ ' });
    expect(res._getStatusCode()).toBe(200);
    expect(readSaved().NEXT_PUBLIC_APP_URL).toBe('https://sign.example.com');
    expect(res._getJSONData().settings.NEXT_PUBLIC_APP_URL).toEqual({
      set: true, source: 'saved', value: 'https://sign.example.com',
    });
  });

  test('a site address with a path is refused with its message and saves nothing', async () => {
    const res = await call('POST', {
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      NEXT_PUBLIC_APP_URL: 'https://sign.example.com/login',
    });
    expect(res._getStatusCode()).toBe(400);
    expect(res._getJSONData()).toEqual({
      errors: { NEXT_PUBLIC_APP_URL: 'Use just the address, like https://sign.example.com' },
    });
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  test("a name set in env is not overwritten and comes back as source 'env'", async () => {
    process.env.EMAIL_FROM = 'env-sender@example.com';
    const res = await call('POST', {
      EMAIL_FROM: 'typed-sender@example.com',
      NEXT_PUBLIC_APP_URL: 'https://sign.example.com',
    });
    expect(res._getStatusCode()).toBe(200);
    const file = readSaved();
    expect(file.EMAIL_FROM).toBeUndefined();
    expect(file.NEXT_PUBLIC_APP_URL).toBe('https://sign.example.com');
    expect(res._getJSONData().settings.EMAIL_FROM).toEqual({
      set: true, source: 'env', value: 'env-sender@example.com',
    });
  });

  test('after a good save, the full keys appear in no response body, header or console line', async () => {
    const res = await call('POST', {
      ANTHROPIC_API_KEY: ANTHROPIC_KEY,
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: RESEND_KEY,
      EMAIL_FROM: 'sender@example.com',
      NEXT_PUBLIC_APP_URL: 'https://sign.example.com',
    });
    expect(res._getStatusCode()).toBe(200);
    // The keys were saved, so the route really handled them.
    const file = readSaved();
    expect(file.ANTHROPIC_API_KEY).toBe(ANTHROPIC_KEY);
    expect(file.RESEND_API_KEY).toBe(RESEND_KEY);
    const { settings } = res._getJSONData();
    expect(settings.ANTHROPIC_API_KEY).toEqual({ set: true, source: 'saved', value: '••••wxyz' });
    expect(settings.RESEND_API_KEY).toEqual({ set: true, source: 'saved', value: '••••abcd' });

    const body = String(res._getData());
    const headers = JSON.stringify(res._getHeaders());
    const consoleLines = consoleSpies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
      .join('\n');
    for (const key of [ANTHROPIC_KEY, RESEND_KEY]) {
      expect(body).not.toContain(key);
      expect(headers).not.toContain(key);
      expect(consoleLines).not.toContain(key);
    }
  });

  test('other methods get 405', async () => {
    const res = await call('PUT', {});
    expect(res._getStatusCode()).toBe(405);
  });
});
