/**
 * POST /api/setup/admin when the first-admin lock itself breaks.
 *
 * A claimFirstAdmin or releaseFirstAdmin error that is not "already exists"
 * or "not found" (a disk or permission error) is caught by the route and
 * answered with a plain 500 sentence naming the .cosign folder, not thrown.
 * lib/supabaseClient is mocked; the lock's file calls (fs.promises.open for
 * the claim, fs.promises.unlink for the release) are made to fail.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));

const CODE = '0123456789abcdef0123456789abcdef';
const PASSWORD = 'placeholder-password-5182';
const VARS = ['ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'VERCEL'];
const saved = {};
let cwd;
let ipCounter = 0;
let ip;
let createUser;

function diskError() {
  return Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
}

beforeEach(() => {
  VARS.forEach((name) => { saved[name] = process.env[name]; delete process.env[name]; });
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-setupadmin-lock-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  ['log', 'info', 'warn', 'error', 'debug'].forEach((level) => jest.spyOn(console, level).mockImplementation(() => {}));
  createUser = jest.fn(async () => ({ data: { user: { id: 'new-admin' } }, error: null }));
  require('../../lib/supabaseClient').requireServiceSupabase.mockReset().mockReturnValue({
    auth: { getUser: jest.fn(), admin: { createUser, deleteUser: jest.fn(async () => ({ data: {}, error: null })) } },
  });
  ipCounter += 1;
  ip = `10.3.0.${ipCounter}`;
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

async function postAdmin() {
  const handler = require('../../pages/api/setup/admin').default;
  const { req, res } = createMocks({
    method: 'POST',
    headers: { 'x-forwarded-for': ip, 'content-type': 'application/json', 'x-setup-code': CODE },
    body: { email: 'admin@example.com', password: PASSWORD },
  });
  let thrown = null;
  await handler(req, res).catch((error) => { thrown = error; });
  return { res, thrown };
}

function expectCosignSentence({ res, thrown }) {
  expect(thrown).toBeNull();
  expect(res._getStatusCode()).toBe(500);
  const { error } = res._getJSONData();
  expect(typeof error).toBe('string');
  expect(error).toContain('.cosign');
  expect(error).not.toContain('EACCES');
  expect(String(res._getData())).not.toContain(PASSWORD);
}

test('a claimFirstAdmin disk error gives a plain 500 naming the .cosign folder', async () => {
  jest.spyOn(fs.promises, 'open').mockRejectedValue(diskError());

  const answer = await postAdmin();

  expectCosignSentence(answer);
  expect(createUser).not.toHaveBeenCalled();
});

test('a releaseFirstAdmin disk error gives a plain 500 naming the .cosign folder', async () => {
  createUser.mockResolvedValue({
    data: { user: null },
    error: { name: 'AuthApiError', message: 'Database error creating new user', status: 500, code: 'unexpected_failure' },
  });
  jest.spyOn(fs.promises, 'unlink').mockRejectedValue(diskError());

  const answer = await postAdmin();

  expectCosignSentence(answer);
  expect(createUser).toHaveBeenCalledTimes(1);
});
