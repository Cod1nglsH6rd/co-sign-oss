/**
 * lib/setupLock.js lets only one first-admin claim ever succeed.
 *
 * claimFirstAdmin({ cwd }) opens .cosign/first-admin.lock with an exclusive
 * 'wx' open (mode 0600). The first call gets { ok: true }; every later call,
 * also ten started together, gets { ok: false } with a plain reason and does
 * not throw. Any other filesystem error is thrown, not reported as claimed.
 * Every test passes its own temp folder as the working folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function load() {
  const mod = require('../../lib/setupLock');
  expect(typeof mod.claimFirstAdmin).toBe('function');
  return mod;
}

let cwd;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-claim-'));
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

function lockFile() {
  return path.join(cwd, '.cosign', 'first-admin.lock');
}

const posixTest = process.platform === 'win32' ? test.skip : test;

describe('claimFirstAdmin', () => {
  test('the first call succeeds and makes .cosign/first-admin.lock', async () => {
    const result = await load().claimFirstAdmin({ cwd });
    expect(result).toEqual({ ok: true });
    expect(fs.existsSync(lockFile())).toBe(true);
  });

  test('the lock is opened exclusively with mode 0600', async () => {
    const spy = jest.spyOn(fs.promises, 'open');
    await load().claimFirstAdmin({ cwd });
    expect(spy).toHaveBeenCalledWith(lockFile(), 'wx', 0o600);
  });

  posixTest('the lock file is 0600', async () => {
    await load().claimFirstAdmin({ cwd });
    expect(fs.statSync(lockFile()).mode & 0o777).toBe(0o600);
  });

  test('a second call returns ok false with a plain reason and does not throw', async () => {
    const { claimFirstAdmin } = load();
    await claimFirstAdmin({ cwd });
    const second = await claimFirstAdmin({ cwd });
    expect(second.ok).toBe(false);
    expect(typeof second.reason).toBe('string');
    expect(second.reason.length).toBeGreaterThan(0);
  });

  test('ten calls started together yield exactly one ok', async () => {
    const { claimFirstAdmin } = load();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimFirstAdmin({ cwd })),
    );
    expect(results.filter((r) => r.ok === true)).toHaveLength(1);
    expect(results.filter((r) => r.ok === false)).toHaveLength(9);
  });

  test('a filesystem error other than EEXIST is thrown, not reported as claimed', async () => {
    const { claimFirstAdmin } = load();
    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    jest.spyOn(fs.promises, 'open').mockRejectedValue(denied);
    await expect(claimFirstAdmin({ cwd })).rejects.toMatchObject({ code: 'EACCES' });
  });
});
