/**
 * lib/setupLock.js lets a failed first-admin claim be released.
 *
 * releaseFirstAdmin({ cwd }) removes .cosign/first-admin.lock, so the next
 * claimFirstAdmin({ cwd }) succeeds again. With no lock file it resolves
 * without throwing. Any other filesystem error is thrown as it is.
 * Every test passes its own temp folder as the working folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function load() {
  const mod = require('../../lib/setupLock');
  expect(typeof mod.releaseFirstAdmin).toBe('function');
  return mod;
}

let cwd;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-release-'));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function lockFile() {
  return path.join(cwd, '.cosign', 'first-admin.lock');
}

const posixTest = process.platform === 'win32' ? test.skip : test;

describe('releaseFirstAdmin', () => {
  test('after a successful claim it removes the lock file', async () => {
    const { claimFirstAdmin, releaseFirstAdmin } = load();
    expect(await claimFirstAdmin({ cwd })).toEqual({ ok: true });
    expect(fs.existsSync(lockFile())).toBe(true);
    await releaseFirstAdmin({ cwd });
    expect(fs.existsSync(lockFile())).toBe(false);
  });

  test('after a release the next claim succeeds again', async () => {
    const { claimFirstAdmin, releaseFirstAdmin } = load();
    expect(await claimFirstAdmin({ cwd })).toEqual({ ok: true });
    await releaseFirstAdmin({ cwd });
    expect(await claimFirstAdmin({ cwd })).toEqual({ ok: true });
    expect(fs.existsSync(lockFile())).toBe(true);
  });

  test('with no lock file it resolves without throwing', async () => {
    const { releaseFirstAdmin } = load();
    await expect(releaseFirstAdmin({ cwd })).resolves.toBeUndefined();
    fs.mkdirSync(path.join(cwd, '.cosign'));
    await expect(releaseFirstAdmin({ cwd })).resolves.toBeUndefined();
  });

  posixTest('any other filesystem error is thrown as it is', async () => {
    const { releaseFirstAdmin } = load();
    // .cosign is a plain file, so the lock path under it cannot be reached.
    fs.writeFileSync(path.join(cwd, '.cosign'), 'not a folder');
    await expect(releaseFirstAdmin({ cwd })).rejects.toMatchObject({ code: 'ENOTDIR' });
  });
});
