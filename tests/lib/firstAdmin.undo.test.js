/**
 * lib/firstAdmin.js undoes a half-made first admin.
 *
 * When the user is created and a later step fails (the owner email cannot be
 * saved), createFirstAdmin deletes that user with
 * supabase.auth.admin.deleteUser(id from createUser) before it releases the
 * lock, so a retry with the same email works. If that delete fails too, the
 * lock stays and the 500 says an account was left behind and how to remove
 * it. A user that existed before is never deleted.
 *
 * The fake Supabase here keeps its users between calls, like the real one.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PASSWORD = 'correct-horse-battery';

let cwd;
let logs;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-first-admin-undo-'));
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    jest.spyOn(console, level).mockImplementation((...args) => logs.push(args));
  }
});

afterEach(() => {
  expect(JSON.stringify(logs.map((args) => args.map(String)))).not.toContain(PASSWORD);
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

// A Supabase admin fake whose users live on between calls.
function keepingSupabase({ failDelete = false } = {}) {
  const users = new Map();
  let next = 0;
  const createUser = jest.fn(async ({ email }) => {
    for (const user of users.values()) {
      if (user.email === email) {
        return {
          data: { user: null },
          error: {
            name: 'AuthApiError',
            message: 'A user with this email address has already been registered',
            status: 422,
            code: 'email_exists',
          },
        };
      }
    }
    next += 1;
    const user = { id: `user-${next}`, email };
    users.set(user.id, user);
    return { data: { user }, error: null };
  });
  const deleteUser = jest.fn(async (id) => {
    if (failDelete) {
      return { data: null, error: { name: 'AuthApiError', message: 'Database error deleting user', status: 500, code: 'unexpected_failure' } };
    }
    if (!users.has(id)) {
      return { data: null, error: { name: 'AuthApiError', message: 'User not found', status: 404, code: 'user_not_found' } };
    }
    users.delete(id);
    return { data: {}, error: null };
  });
  const emails = () => [...users.values()].map((user) => user.email).sort();
  return { emails, createUser, deleteUser, supabase: { auth: { admin: { createUser, deleteUser } } } };
}

const lockFile = () => path.join(cwd, '.cosign', 'first-admin.lock');
const settingsPath = () => path.join(cwd, '.cosign', 'settings.json');

// A folder where settings.json should be: the save's rename into place fails.
function blockSave() {
  fs.mkdirSync(settingsPath(), { recursive: true });
  fs.writeFileSync(path.join(settingsPath(), 'blocker'), 'x');
}

function unblockSave() {
  fs.rmSync(settingsPath(), { recursive: true, force: true });
}

async function run(fake, email) {
  const { createFirstAdmin } = require('../../lib/firstAdmin');
  return createFirstAdmin({ email, password: PASSWORD }, { supabase: fake.supabase, env: {}, cwd });
}

test('a failed save deletes the new user, releases the lock, and a retry with the same email gives 201', async () => {
  const fake = keepingSupabase();
  blockSave();

  const result = await run(fake, 'owner@example.com');

  expect(result.status).toBe(500);
  expect(fake.deleteUser.mock.calls).toEqual([['user-1']]);
  expect(fake.emails()).toEqual([]);
  expect(fs.existsSync(lockFile())).toBe(false);
  expect(JSON.stringify(result)).not.toContain(PASSWORD);

  unblockSave();
  const retry = await run(fake, 'owner@example.com');

  expect(retry).toEqual({ status: 201, body: { email: 'owner@example.com' } });
  expect(fake.emails()).toEqual(['owner@example.com']);
});

test('a failed save and a failed delete keep the lock and say the account was left behind', async () => {
  const fake = keepingSupabase({ failDelete: true });
  blockSave();

  const result = await run(fake, 'owner@example.com');

  expect(result.status).toBe(500);
  expect(fake.deleteUser.mock.calls).toEqual([['user-1']]);
  expect(fs.existsSync(lockFile())).toBe(true);
  expect(result.body.error).toMatch(/left behind/i);
  expect(result.body.error).toContain('owner@example.com');
  expect(result.body.error).toContain('first-admin.lock');
  expect(JSON.stringify(result)).not.toContain(PASSWORD);
});

test('a deleteUser that throws also keeps the lock and gives the left-behind sentence', async () => {
  const fake = keepingSupabase();
  fake.deleteUser.mockImplementation(async () => {
    throw new Error('fetch failed');
  });
  blockSave();

  const result = await run(fake, 'owner@example.com');

  expect(result.status).toBe(500);
  expect(fs.existsSync(lockFile())).toBe(true);
  expect(result.body.error).toMatch(/left behind/i);
});

test('a failed save then a failed lock release still deletes the new user first', async () => {
  const fake = keepingSupabase();
  blockSave();
  const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  jest.spyOn(fs.promises, 'unlink').mockRejectedValue(denied);

  await expect(run(fake, 'owner@example.com')).rejects.toBe(denied);

  expect(fake.deleteUser.mock.calls).toEqual([['user-1']]);
  expect(fake.emails()).toEqual([]);
});

test('a user that existed before is never deleted', async () => {
  const fake = keepingSupabase();
  await fake.supabase.auth.admin.createUser({ email: 'old@example.com', password: 'x', email_confirm: true });

  const taken = await run(fake, 'old@example.com');
  expect(taken.status).toBe(409);
  expect(fake.deleteUser).not.toHaveBeenCalled();
  expect(fake.emails()).toEqual(['old@example.com']);

  blockSave();
  const failed = await run(fake, 'owner@example.com');
  expect(failed.status).toBe(500);
  expect(fake.deleteUser.mock.calls).toEqual([['user-2']]);
  expect(fake.emails()).toEqual(['old@example.com']);
});
