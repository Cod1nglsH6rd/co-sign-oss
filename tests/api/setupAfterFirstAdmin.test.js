/**
 * The setup code after the first admin.
 *
 * - After POST /api/setup/admin answers 201, the old setup code no longer
 *   works, even once the settings file is removed and setup looks needed.
 * - With .cosign/first-admin.lock present and the settings file removed, the
 *   old code is refused on POST /api/setup/admin and POST /api/setup/settings:
 *   401, no user made, nothing saved.
 * lib/supabaseClient is mocked; every test runs in its own temp working folder.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMocks } from 'node-mocks-http';
import adminHandler from '../../pages/api/setup/admin';
import settingsHandler from '../../pages/api/setup/settings';
import { requireServiceSupabase } from '../../lib/supabaseClient';

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));

const CODE = '0123456789abcdef0123456789abcdef';
const PASSWORD = 'placeholder-password-5182';
const VARS = ['ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'VERCEL', 'EMAIL_FROM'];
const saved = {};
let cwd;
let ipCounter = 0;
let ip;
let createUser;

const cosign = (name) => path.join(cwd, '.cosign', name);

beforeEach(() => {
  VARS.forEach((name) => { saved[name] = process.env[name]; delete process.env[name]; });
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-after-first-admin-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  ['log', 'info', 'warn', 'error', 'debug'].forEach((level) => jest.spyOn(console, level).mockImplementation(() => {}));
  createUser = jest.fn(async ({ email }) => ({ data: { user: { id: 'new-admin', email } }, error: null }));
  requireServiceSupabase.mockReset().mockReturnValue({ auth: { admin: { createUser } } });
  ipCounter += 1;
  ip = `10.3.0.${ipCounter}`;
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(cosign('setup-code'), `${CODE}\n`, { mode: 0o600 });
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
  VARS.forEach((name) => {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  });
});

async function post(handler, body) {
  const { req, res } = createMocks({
    method: 'POST',
    headers: { 'x-forwarded-for': ip, 'content-type': 'application/json', 'x-setup-code': CODE },
    body,
  });
  await handler(req, res);
  return res;
}

test('after a 201 the setup code file is gone and the old code stops working', async () => {
  const made = await post(adminHandler, { email: 'owner@example.com', password: PASSWORD });
  expect(made._getStatusCode()).toBe(201);
  expect(fs.existsSync(cosign('setup-code'))).toBe(false);

  // Losing the settings file makes setup look needed again.
  fs.rmSync(cosign('settings.json'), { force: true });
  const res = await post(settingsHandler, { EMAIL_FROM: 'intruder@example.com' });

  expect(res._getStatusCode()).toBe(401);
  expect(fs.existsSync(cosign('settings.json'))).toBe(false);
});

describe('with the lock present and the settings file removed', () => {
  beforeEach(() => {
    fs.writeFileSync(cosign('first-admin.lock'), '', { mode: 0o600 });
    fs.rmSync(cosign('settings.json'), { force: true });
  });

  test('the old code is refused on /api/setup/admin and no user is made', async () => {
    const res = await post(adminHandler, { email: 'intruder@example.com', password: PASSWORD });
    expect(res._getStatusCode()).toBe(401);
    expect(createUser).not.toHaveBeenCalled();
  });

  test('the old code is refused on /api/setup/settings and nothing is saved', async () => {
    const res = await post(settingsHandler, { EMAIL_FROM: 'intruder@example.com' });
    expect(res._getStatusCode()).toBe(401);
    expect(fs.existsSync(cosign('settings.json'))).toBe(false);
  });
});
