/**
 * lib/setupLock.js after the first admin is made.
 *
 * - verifySetupCode is false whenever .cosign/first-admin.lock exists, also
 *   when the settings file is gone and setupNeeded is true again.
 * - removeSetupCode({ cwd }) deletes .cosign/setup-code; with no code file
 *   it does nothing.
 * - createFirstAdmin's 201 leaves no setup code file behind.
 * Every test runs in its own temp working folder.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import * as setupLock from '../../lib/setupLock';
import { createFirstAdmin } from '../../lib/firstAdmin';

const CODE = '0123456789abcdef0123456789abcdef';
let cwd;

const cosign = (name) => path.join(cwd, '.cosign', name);

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-after-setup-'));
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(cosign('setup-code'), `${CODE}\n`, { mode: 0o600 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('the right code is still good before any lock is taken', () => {
  expect(setupLock.setupNeeded({}, { cwd })).toBe(true);
  expect(setupLock.verifySetupCode(CODE, {}, { cwd })).toBe(true);
});

test('with the lock present and no settings file the right code is refused', () => {
  fs.writeFileSync(cosign('first-admin.lock'), '', { mode: 0o600 });
  expect(fs.existsSync(cosign('settings.json'))).toBe(false);
  expect(setupLock.setupNeeded({}, { cwd })).toBe(true);

  expect(setupLock.verifySetupCode(CODE, {}, { cwd })).toBe(false);
});

test('removeSetupCode deletes the code file, and does nothing when it is gone', () => {
  expect(typeof setupLock.removeSetupCode).toBe('function');

  setupLock.removeSetupCode({ cwd });
  expect(fs.existsSync(cosign('setup-code'))).toBe(false);
  expect(setupLock.verifySetupCode(CODE, {}, { cwd })).toBe(false);

  expect(() => setupLock.removeSetupCode({ cwd })).not.toThrow();
});

test('a 201 from createFirstAdmin deletes the setup code file', async () => {
  const createUser = jest.fn(async ({ email }) => ({ data: { user: { id: 'admin-1', email } }, error: null }));
  const supabase = { auth: { admin: { createUser } } };

  const result = await createFirstAdmin(
    { email: 'owner@example.com', password: 'correct-horse-battery' },
    { supabase, env: {}, cwd },
  );

  expect(result.status).toBe(201);
  expect(fs.existsSync(cosign('setup-code'))).toBe(false);
});
