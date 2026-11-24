/**
 * lib/firstAdmin.js makes the first admin on a fresh host.
 *
 * createFirstAdmin({ email, password }, { supabase, env, cwd }) checks the
 * input, checks setup is still needed, claims the first-admin lock, creates
 * the Supabase user, saves the owner email to .cosign/settings.json and
 * resolves { status, body }. A failure after the claim releases the lock.
 * Every test passes its own temp folder as the working folder and a mocked
 * service Supabase client.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PASSWORD = 'correct-horse-battery';

function load() {
  const mod = require('../../lib/firstAdmin');
  expect(typeof mod.createFirstAdmin).toBe('function');
  return mod;
}

function lock() {
  return require('../../lib/setupLock');
}

function mockSupabase(result) {
  const createUser = jest.fn(async ({ email }) =>
    result || { data: { user: { id: 'user-1', email } }, error: null },
  );
  return { createUser, supabase: { auth: { admin: { createUser } } } };
}

// issue #369: a Supabase admin fake whose users live on between calls, with deleteUser.
function keepingSupabase() {
  const users = new Map();
  let next = 0;
  const createUser = jest.fn(async ({ email }) => {
    if ([...users.values()].some((user) => user.email === email)) {
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
    next += 1;
    const user = { id: `user-${next}`, email };
    users.set(user.id, user);
    return { data: { user }, error: null };
  });
  const deleteUser = jest.fn(async (id) => {
    if (!users.delete(id)) {
      return { data: null, error: { name: 'AuthApiError', message: 'User not found', status: 404, code: 'user_not_found' } };
    }
    return { data: {}, error: null };
  });
  return { users, createUser, deleteUser, supabase: { auth: { admin: { createUser, deleteUser } } } };
}

function lockFile() {
  return path.join(cwd, '.cosign', 'first-admin.lock');
}

function savedSettings() {
  return JSON.parse(fs.readFileSync(path.join(cwd, '.cosign', 'settings.json'), 'utf8'));
}

let cwd;
let logs;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-first-admin-'));
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

function expectNoPassword(result) {
  expect(JSON.stringify(result)).not.toContain(PASSWORD);
}

describe('createFirstAdmin', () => {
  test('creates the user with the normalised email, saves it as the owner and gives 201', async () => {
    const { createFirstAdmin } = load();
    const { setupNeeded } = lock();
    const { supabase, createUser } = mockSupabase();
    expect(setupNeeded({}, { cwd })).toBe(true);

    const result = await createFirstAdmin(
      { email: '  Owner@Example.COM ', password: PASSWORD },
      { supabase, env: {}, cwd },
    );

    expect(result).toEqual({ status: 201, body: { email: 'owner@example.com' } });
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: PASSWORD,
      email_confirm: true,
    });
    expect(savedSettings().ADMIN_DASHBOARD_EMAILS).toBe('owner@example.com');
    expect(setupNeeded({}, { cwd })).toBe(false);
    expectNoPassword(result);
  });

  test('bad input gives 400 with the message and touches neither the lock nor supabase', async () => {
    const { createFirstAdmin } = load();
    const { supabase, createUser } = mockSupabase();

    const badEmail = await createFirstAdmin({ email: 'not-an-email', password: PASSWORD }, { supabase, env: {}, cwd });
    expect(badEmail.status).toBe(400);
    expect(typeof badEmail.body.error).toBe('string');
    expect(badEmail.body.error.length).toBeGreaterThan(0);
    expectNoPassword(badEmail);

    const shortPassword = await createFirstAdmin({ email: 'owner@example.com', password: 'short' }, { supabase, env: {}, cwd });
    expect(shortPassword.status).toBe(400);
    expect(typeof shortPassword.body.error).toBe('string');
    expect(JSON.stringify(shortPassword)).not.toContain('"short"');

    expect(createUser).not.toHaveBeenCalled();
    expect(fs.existsSync(lockFile())).toBe(false);
  });

  test('when setup is no longer needed it gives 409 and never creates a user', async () => {
    const { createFirstAdmin } = load();
    const { supabase, createUser } = mockSupabase();

    const result = await createFirstAdmin(
      { email: 'owner@example.com', password: PASSWORD },
      { supabase, env: { ADMIN_DASHBOARD_EMAILS: 'boss@example.com' }, cwd },
    );

    expect(result.status).toBe(409);
    expect(typeof result.body.error).toBe('string');
    expect(createUser).not.toHaveBeenCalled();
    expect(fs.existsSync(lockFile())).toBe(false);
    expectNoPassword(result);
  });

  test('when the lock is already claimed it gives 409, never creates a user and keeps the lock', async () => {
    const { createFirstAdmin } = load();
    expect(await lock().claimFirstAdmin({ cwd })).toEqual({ ok: true });
    const { supabase, createUser } = mockSupabase();

    const result = await createFirstAdmin({ email: 'owner@example.com', password: PASSWORD }, { supabase, env: {}, cwd });

    expect(result.status).toBe(409);
    expect(typeof result.body.error).toBe('string');
    expect(createUser).not.toHaveBeenCalled();
    expect(fs.existsSync(lockFile())).toBe(true);
    expectNoPassword(result);
  });

  test('an existing email gives 409 and releases the lock', async () => {
    const { createFirstAdmin } = load();
    const { supabase } = mockSupabase({
      data: { user: null },
      error: {
        name: 'AuthApiError',
        message: 'A user with this email address has already been registered',
        status: 422,
        code: 'email_exists',
      },
    });

    const result = await createFirstAdmin({ email: 'owner@example.com', password: PASSWORD }, { supabase, env: {}, cwd });

    expect(result).toEqual({ status: 409, body: { error: 'An account with that email already exists' } });
    expect(fs.existsSync(lockFile())).toBe(false);
    expect(lock().setupNeeded({}, { cwd })).toBe(true);
  });

  test('another createUser error gives 500, releases the lock, and a retry gives 201', async () => {
    const { createFirstAdmin } = load();
    const failing = mockSupabase({
      data: { user: null },
      error: { name: 'AuthApiError', message: 'Database error creating new user', status: 500, code: 'unexpected_failure' },
    });

    const result = await createFirstAdmin({ email: 'owner@example.com', password: PASSWORD }, { supabase: failing.supabase, env: {}, cwd });

    expect(result.status).toBe(500);
    expect(typeof result.body.error).toBe('string');
    expect(result.body.error.length).toBeGreaterThan(0);
    expectNoPassword(result);
    expect(fs.existsSync(lockFile())).toBe(false);

    const working = mockSupabase();
    const retry = await createFirstAdmin({ email: 'owner@example.com', password: PASSWORD }, { supabase: working.supabase, env: {}, cwd });
    expect(retry).toEqual({ status: 201, body: { email: 'owner@example.com' } });
  });

  test('a createUser throw gives 500, releases the lock, and a retry gives 201', async () => {
    const { createFirstAdmin } = load();
    const createUser = jest.fn(async () => {
      throw new Error('fetch failed');
    });

    const result = await createFirstAdmin(
      { email: 'owner@example.com', password: PASSWORD },
      { supabase: { auth: { admin: { createUser } } }, env: {}, cwd },
    );

    expect(result.status).toBe(500);
    expect(typeof result.body.error).toBe('string');
    expectNoPassword(result);
    expect(fs.existsSync(lockFile())).toBe(false);

    const working = mockSupabase();
    const retry = await createFirstAdmin({ email: 'owner@example.com', password: PASSWORD }, { supabase: working.supabase, env: {}, cwd });
    expect(retry).toEqual({ status: 201, body: { email: 'owner@example.com' } });
  });

  test('a saveSettings failure gives 500, releases the lock, and a retry gives 201', async () => {
    const { createFirstAdmin } = load();
    // A folder where settings.json should be: the save's rename into place fails.
    const settingsPath = path.join(cwd, '.cosign', 'settings.json');
    fs.mkdirSync(settingsPath, { recursive: true });
    fs.writeFileSync(path.join(settingsPath, 'blocker'), 'x');
    // issue #369: one fake that keeps users for both calls, so the retry only works if the first user was deleted.
    const fake = keepingSupabase();

    const result = await createFirstAdmin({ email: 'owner@example.com', password: PASSWORD }, { supabase: fake.supabase, env: {}, cwd });

    expect(fake.createUser).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(500);
    expect(typeof result.body.error).toBe('string');
    expectNoPassword(result);
    // issue #369: the user just made is deleted by the id createUser returned, and no other id.
    const { data: made } = await fake.createUser.mock.results[0].value;
    expect(fake.deleteUser.mock.calls).toEqual([[made.user.id]]);
    expect(fake.users.size).toBe(0);
    expect(fs.existsSync(lockFile())).toBe(false);

    fs.rmSync(settingsPath, { recursive: true, force: true });
    const retry = await createFirstAdmin({ email: 'owner@example.com', password: PASSWORD }, { supabase: fake.supabase, env: {}, cwd });
    expect(retry).toEqual({ status: 201, body: { email: 'owner@example.com' } });
    expect(savedSettings().ADMIN_DASHBOARD_EMAILS).toBe('owner@example.com');
    // issue #369: the successful retry deletes nobody.
    expect(fake.deleteUser).toHaveBeenCalledTimes(1);
  });
});
