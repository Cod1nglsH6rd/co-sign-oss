/**
 * GET /api/setup/state answers { needed } with no auth.
 * lib/setupAccess.js authorizeSetupRequest(req, res): while setup is needed,
 * only the right x-setup-code header gets in (wrong or missing: 401, and
 * code attempts are rate-limited through lib/rateLimit.js); once setup is not
 * needed, only a signed-in owner gets in (no Bearer: 401, non-owner: 403) and
 * a setup code alone is refused.
 * Supabase is mocked; every test runs in its own temp working folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');
const { createClient } = require('@supabase/supabase-js');

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const CODE = '0123456789abcdef0123456789abcdef';
const VARS = ['ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'VERCEL'];
const saved = {};
let cwd;
let ipCounter = 0;
let ip;

beforeEach(() => {
  VARS.forEach((name) => { saved[name] = process.env[name]; delete process.env[name]; });
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-setupaccess-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  createClient.mockReset();
  // A fresh client address per test, so rate-limit counts never carry over.
  ipCounter += 1;
  ip = `10.0.0.${ipCounter}`;
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
  VARS.forEach((name) => {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  });
});

function writeCode() {
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(cwd, '.cosign', 'setup-code'), `${CODE}\n`, { mode: 0o600 });
}

function signedInAs(email) {
  const getUser = jest.fn(async (token) => (token === 'good-jwt'
    ? { data: { user: { id: 'user-1', email } }, error: null }
    : { data: { user: null }, error: new Error('bad jwt') }));
  createClient.mockReturnValue({ auth: { getUser } });
  return getUser;
}

function makeRequest(headers = {}, method = 'POST') {
  return createMocks({ method, headers: { 'x-forwarded-for': ip, ...headers } });
}

async function authorize(headers) {
  const { authorizeSetupRequest } = require('../../lib/setupAccess');
  const { req, res } = makeRequest(headers);
  const result = await authorizeSetupRequest(req, res);
  return { result, res };
}

describe('GET /api/setup/state', () => {
  async function getState(headers = {}) {
    const handler = require('../../pages/api/setup/state').default;
    const { req, res } = makeRequest(headers, 'GET');
    await handler(req, res);
    return res;
  }

  test('fresh host, no auth: answers exactly { needed: true }', async () => {
    const res = await getState();
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({ needed: true });
  });

  test('owner list in env: answers exactly { needed: false }', async () => {
    process.env.ADMIN_DASHBOARD_EMAILS = 'owner@example.com';
    const res = await getState();
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({ needed: false });
  });

  test('owner list saved on the host: answers exactly { needed: false }', async () => {
    fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.cosign', 'settings.json'),
      JSON.stringify({ ADMIN_DASHBOARD_EMAILS: 'owner@example.com' }),
    );
    const res = await getState();
    expect(res._getJSONData()).toEqual({ needed: false });
  });

  test('never returns the setup code, even with a code file on the host', async () => {
    writeCode();
    const res = await getState();
    expect(res._getJSONData()).toEqual({ needed: true });
    expect(res._getData()).not.toContain(CODE);
  });

  test('other methods get 405', async () => {
    const handler = require('../../pages/api/setup/state').default;
    const { req, res } = makeRequest({}, 'POST');
    await handler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });
});

describe('authorizeSetupRequest while setup is needed', () => {
  test('the right x-setup-code is allowed', async () => {
    writeCode();
    const { result, res } = await authorize({ 'x-setup-code': CODE });
    expect(result).toBeTruthy();
    expect(res._isEndCalled()).toBe(false);
  });

  test('a wrong code is refused with 401 and a plain message', async () => {
    writeCode();
    const { result, res } = await authorize({ 'x-setup-code': 'fedcba9876543210fedcba9876543210' });
    expect(result).toBeNull();
    expect(res._getStatusCode()).toBe(401);
    expect(typeof res._getJSONData().error).toBe('string');
    expect(res._getJSONData().error.length).toBeGreaterThan(0);
  });

  test('a missing code is refused with 401 and a plain message', async () => {
    writeCode();
    const { result, res } = await authorize({});
    expect(result).toBeNull();
    expect(res._getStatusCode()).toBe(401);
    expect(typeof res._getJSONData().error).toBe('string');
  });

  test('a Bearer token is not a substitute for the code', async () => {
    writeCode();
    signedInAs('anyone@example.com');
    const { result, res } = await authorize({ authorization: 'Bearer good-jwt' });
    expect(result).toBeNull();
    expect(res._getStatusCode()).toBe(401);
  });

  test('wrong codes are rate-limited: 429 after 30, and then even the right code waits', async () => {
    writeCode();
    for (let i = 0; i < 30; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { res } = await authorize({ 'x-setup-code': 'wrong' });
      expect(res._getStatusCode()).toBe(401);
    }
    const limited = await authorize({ 'x-setup-code': 'wrong' });
    expect(limited.result).toBeNull();
    expect(limited.res._getStatusCode()).toBe(429);

    const right = await authorize({ 'x-setup-code': CODE });
    expect(right.result).toBeNull();
    expect(right.res._getStatusCode()).toBe(429);
  });
});

describe('authorizeSetupRequest once setup is not needed', () => {
  beforeEach(() => {
    process.env.ADMIN_DASHBOARD_EMAILS = 'owner@example.com';
    writeCode();
  });

  test('no Bearer token gets 401', async () => {
    const { result, res } = await authorize({});
    expect(result).toBeNull();
    expect(res._getStatusCode()).toBe(401);
  });

  test('an invalid Bearer token gets 401', async () => {
    signedInAs('owner@example.com');
    const { result, res } = await authorize({ authorization: 'Bearer bad-jwt' });
    expect(result).toBeNull();
    expect(res._getStatusCode()).toBe(401);
  });

  test('a signed-in non-owner gets 403', async () => {
    signedInAs('someone@example.com');
    const { result, res } = await authorize({ authorization: 'Bearer good-jwt' });
    expect(result).toBeNull();
    expect(res._getStatusCode()).toBe(403);
  });

  test('an owner is allowed', async () => {
    const getUser = signedInAs('Owner@Example.com');
    const { result, res } = await authorize({ authorization: 'Bearer good-jwt' });
    expect(result).toBeTruthy();
    expect(result.user.email).toBe('Owner@Example.com');
    expect(getUser).toHaveBeenCalledWith('good-jwt');
    expect(res._isEndCalled()).toBe(false);
  });

  test('an owner saved only on the host is allowed', async () => {
    delete process.env.ADMIN_DASHBOARD_EMAILS;
    fs.writeFileSync(
      path.join(cwd, '.cosign', 'settings.json'),
      JSON.stringify({ ADMIN_DASHBOARD_EMAILS: 'saved-owner@example.com' }),
    );
    signedInAs('saved-owner@example.com');
    const { result } = await authorize({ authorization: 'Bearer good-jwt' });
    expect(result).toBeTruthy();
  });

  test('the setup code alone is refused', async () => {
    const { result, res } = await authorize({ 'x-setup-code': CODE });
    expect(result).toBeNull();
    expect(res._getStatusCode()).toBe(401);
  });
});
