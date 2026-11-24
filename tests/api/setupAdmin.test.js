/**
 * POST /api/setup/admin: create the first admin through the setup code.
 * - Any other method gets 405 with Allow: POST.
 * - Access goes through lib/setupAccess.js: while setup is needed only the
 *   right x-setup-code gets in (401 otherwise, nothing created).
 * - Once setup is not needed it is refused: 401 anonymous, and 409 'Setup is
 *   already finished' even for a signed-in owner. No second admin is made.
 * - A body that is not an object gets 400.
 * - A good code and body answer 201 { email } with Cache-Control no-store;
 *   after that GET /api/setup/state says needed false and an anonymous POST
 *   gets 401.
 * - The password is in no response and no console line.
 * lib/supabaseClient is mocked; every test runs in its own temp working folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));

const CODE = '0123456789abcdef0123456789abcdef';
const PASSWORD = 'placeholder-password-7391';
const VARS = ['ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'VERCEL'];
const saved = {};
let cwd;
let ipCounter = 0;
let ip;
let consoleSpies;
let createUser;
let getUser;

function supabaseClient() {
  return require('../../lib/supabaseClient');
}

beforeEach(() => {
  VARS.forEach((name) => { saved[name] = process.env[name]; delete process.env[name]; });
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-setupadmin-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map(
    (level) => jest.spyOn(console, level).mockImplementation(() => {}),
  );
  createUser = jest.fn(async () => ({ data: { user: { id: 'new-admin' } }, error: null }));
  getUser = jest.fn(async (token) => (token === 'good-jwt'
    ? { data: { user: { id: 'owner-1', email: 'owner@example.com' } }, error: null }
    : { data: { user: null }, error: new Error('bad jwt') }));
  supabaseClient().requireServiceSupabase.mockReset().mockReturnValue({
    auth: { getUser, admin: { createUser } },
  });
  ipCounter += 1;
  ip = `10.2.0.${ipCounter}`;
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

async function postAdmin(body, headers = { 'x-setup-code': CODE }, method = 'POST') {
  const handler = require('../../pages/api/setup/admin').default;
  const { req, res } = createMocks({
    method,
    headers: { 'x-forwarded-for': ip, 'content-type': 'application/json', ...headers },
    body,
  });
  await handler(req, res);
  return res;
}

async function getState() {
  const handler = require('../../pages/api/setup/state').default;
  const { req, res } = createMocks({ method: 'GET', headers: { 'x-forwarded-for': ip } });
  await handler(req, res);
  return res;
}

const goodBody = () => ({ email: 'Admin@Example.com', password: PASSWORD });

test('other methods get 405 with Allow: POST', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await postAdmin(goodBody(), { 'x-setup-code': CODE }, method);
    expect(res._getStatusCode()).toBe(405);
    expect(res.getHeader('Allow')).toBe('POST');
  }
  expect(createUser).not.toHaveBeenCalled();
});

test('a missing or wrong setup code gets 401 and creates nothing', async () => {
  const missing = await postAdmin(goodBody(), {});
  expect(missing._getStatusCode()).toBe(401);
  const wrong = await postAdmin(goodBody(), { 'x-setup-code': 'fedcba9876543210fedcba9876543210' });
  expect(wrong._getStatusCode()).toBe(401);
  expect(createUser).not.toHaveBeenCalled();
  expect(fs.existsSync(settingsFile())).toBe(false);
  expect((await getState())._getJSONData()).toEqual({ needed: true });
});

test('once setup is not needed: anonymous 401, signed-in owner 409, no admin created', async () => {
  process.env.ADMIN_DASHBOARD_EMAILS = 'owner@example.com';
  const anonymous = await postAdmin(goodBody(), { 'x-setup-code': CODE });
  expect(anonymous._getStatusCode()).toBe(401);
  const owner = await postAdmin(goodBody(), { authorization: 'Bearer good-jwt' });
  expect(owner._getStatusCode()).toBe(409);
  expect(owner._getJSONData()).toEqual({ error: 'Setup is already finished' });
  expect(createUser).not.toHaveBeenCalled();
  expect(fs.existsSync(settingsFile())).toBe(false);
});

test('a body that is not an object gets 400 and creates nothing', async () => {
  for (const body of ['admin@example.com', ['admin@example.com', PASSWORD], 42]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await postAdmin(body);
    expect(res._getStatusCode()).toBe(400);
  }
  expect(createUser).not.toHaveBeenCalled();
  expect((await getState())._getJSONData()).toEqual({ needed: true });
});

test('a good code and body answer 201 { email }, then setup is locked', async () => {
  const res = await postAdmin(goodBody());
  expect(res._getStatusCode()).toBe(201);
  expect(res._getJSONData()).toEqual({ email: 'admin@example.com' });
  expect(res.getHeader('Cache-Control')).toBe('no-store');
  expect(createUser).toHaveBeenCalledTimes(1);
  expect(createUser).toHaveBeenCalledWith({
    email: 'admin@example.com', password: PASSWORD, email_confirm: true,
  });

  const state = await getState();
  expect(state._getJSONData()).toEqual({ needed: false });

  const again = await postAdmin({ email: 'second@example.com', password: PASSWORD });
  expect(again._getStatusCode()).toBe(401);
  expect(createUser).toHaveBeenCalledTimes(1);

  const body = String(res._getData()) + String(again._getData());
  const headers = JSON.stringify(res._getHeaders()) + JSON.stringify(again._getHeaders());
  const consoleLines = consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
    .join('\n');
  expect(body).not.toContain(PASSWORD);
  expect(headers).not.toContain(PASSWORD);
  expect(consoleLines).not.toContain(PASSWORD);
});

test('a failed create keeps the password out of the response and the console', async () => {
  createUser.mockResolvedValue({ data: null, error: { name: 'AuthApiError', status: 500, message: `bad ${PASSWORD}` } });
  const res = await postAdmin(goodBody());
  expect(res._getStatusCode()).toBe(500);
  expect(String(res._getData())).not.toContain(PASSWORD);
  const consoleLines = consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
    .join('\n');
  expect(consoleLines).not.toContain(PASSWORD);
  expect((await getState())._getJSONData()).toEqual({ needed: true });
});
