/**
 * lib/setupLock.js keeps a one-time setup code on the host.
 *
 * getSetupCode({ cwd, log }) makes a random code (at least 128 bits, from
 * crypto.randomBytes) once, saves it to .cosign/setup-code (file 0600,
 * folder 0700, also when the file or folder was already there with looser
 * modes), logs exactly one line naming the code and that file, and returns
 * the same code on every later call, also from a fresh load that reads it
 * back from the file, without logging again.
 *
 * verifySetupCode(input, env, { cwd }) compares with crypto.timingSafeEqual,
 * returns false for wrong, empty, non-string or different-length input
 * without throwing, and false for the right code once setup is no longer
 * needed. Every test passes its own temp folder as the working folder.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function load() {
  const mod = require('../../lib/setupLock');
  expect(typeof mod.getSetupCode).toBe('function');
  expect(typeof mod.verifySetupCode).toBe('function');
  return mod;
}

function stubLogger() {
  return { log: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function logCalls(log) {
  return Object.values(log).flatMap((fn) => fn.mock.calls);
}

let cwd;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-setupcode-'));
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

function codeDir() {
  return path.join(cwd, '.cosign');
}

function codeFile() {
  return path.join(cwd, '.cosign', 'setup-code');
}

function modeOf(p) {
  return fs.statSync(p).mode & 0o777;
}

const posixTest = process.platform === 'win32' ? test.skip : test;

describe('getSetupCode', () => {
  test('makes the code from at least 128 random bits', () => {
    const spy = jest.spyOn(crypto, 'randomBytes');
    const code = load().getSetupCode({ cwd, log: stubLogger() });
    expect(spy).toHaveBeenCalledTimes(1);
    const size = spy.mock.calls[0][0];
    expect(size).toBeGreaterThanOrEqual(16);
    const bytes = spy.mock.results[0].value;
    expect([bytes.toString('hex'), bytes.toString('base64url')]).toContain(code);
  });

  test('two folders get two different codes', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-setupcode-other-'));
    try {
      const a = load().getSetupCode({ cwd, log: stubLogger() });
      const b = load().getSetupCode({ cwd: other, log: stubLogger() });
      expect(typeof a).toBe('string');
      expect(a.length).toBeGreaterThanOrEqual(22);
      expect(a).not.toBe(b);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test('saves the code to .cosign/setup-code', () => {
    const code = load().getSetupCode({ cwd, log: stubLogger() });
    expect(fs.readFileSync(codeFile(), 'utf8').trim()).toBe(code);
  });

  posixTest('the file is 0600 and the folder 0700', () => {
    load().getSetupCode({ cwd, log: stubLogger() });
    expect(modeOf(codeFile())).toBe(0o600);
    expect(modeOf(codeDir())).toBe(0o700);
  });

  posixTest('a folder that was already there with looser modes is made 0700', () => {
    fs.mkdirSync(codeDir(), { mode: 0o755 });
    fs.chmodSync(codeDir(), 0o755);
    load().getSetupCode({ cwd, log: stubLogger() });
    expect(modeOf(codeFile())).toBe(0o600);
    expect(modeOf(codeDir())).toBe(0o700);
  });

  posixTest('a saved code with looser modes is kept and made 0600 in a 0700 folder', () => {
    const saved = '0123456789abcdef0123456789abcdef';
    fs.mkdirSync(codeDir());
    fs.chmodSync(codeDir(), 0o755);
    fs.writeFileSync(codeFile(), saved + '\n');
    fs.chmodSync(codeFile(), 0o644);
    const log = stubLogger();
    expect(load().getSetupCode({ cwd, log })).toBe(saved);
    expect(logCalls(log)).toHaveLength(0);
    expect(modeOf(codeFile())).toBe(0o600);
    expect(modeOf(codeDir())).toBe(0o700);
  });

  test('logs exactly one line naming the code and the file path', () => {
    const log = stubLogger();
    const code = load().getSetupCode({ cwd, log });
    const calls = logCalls(log);
    expect(calls).toHaveLength(1);
    const line = calls[0].map(String).join(' ');
    expect(line).not.toContain('\n');
    expect(line).toContain(code);
    expect(line).toContain(codeFile());
  });

  test('later calls return the same code, make no new one and log nothing', () => {
    const { getSetupCode } = load();
    const first = getSetupCode({ cwd, log: stubLogger() });
    const spy = jest.spyOn(crypto, 'randomBytes');
    const log = stubLogger();
    expect(getSetupCode({ cwd, log })).toBe(first);
    expect(getSetupCode({ cwd, log })).toBe(first);
    expect(logCalls(log)).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
    expect(fs.readFileSync(codeFile(), 'utf8').trim()).toBe(first);
  });

  test('a fresh load reads the same code back from the file without logging', () => {
    const first = load().getSetupCode({ cwd, log: stubLogger() });
    jest.resetModules();
    const log = stubLogger();
    expect(load().getSetupCode({ cwd, log })).toBe(first);
    expect(logCalls(log)).toHaveLength(0);
  });
});

describe('verifySetupCode', () => {
  test('the right code is accepted while setup is needed, using timingSafeEqual', () => {
    const { getSetupCode, verifySetupCode } = load();
    const code = getSetupCode({ cwd, log: stubLogger() });
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    expect(verifySetupCode(code, {}, { cwd })).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  test('a wrong code of the same length is refused, using timingSafeEqual', () => {
    const { getSetupCode, verifySetupCode } = load();
    const code = getSetupCode({ cwd, log: stubLogger() });
    const wrong = (code[0] === 'a' ? 'b' : 'a') + code.slice(1);
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    expect(verifySetupCode(wrong, {}, { cwd })).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  test('empty, non-string and different-length input is refused without throwing', () => {
    const { getSetupCode, verifySetupCode } = load();
    const code = getSetupCode({ cwd, log: stubLogger() });
    const inputs = ['', undefined, null, 0, 123, {}, [], [code], { toString: () => code }, code.slice(1), code + 'a', ` ${code}`];
    for (const input of inputs) {
      expect(() => verifySetupCode(input, {}, { cwd })).not.toThrow();
      expect(verifySetupCode(input, {}, { cwd })).toBe(false);
    }
  });

  test('the right code is refused once setup is no longer needed', () => {
    const { getSetupCode, verifySetupCode, setupNeeded } = load();
    const code = getSetupCode({ cwd, log: stubLogger() });
    const env = { ADMIN_DASHBOARD_EMAILS: 'owner@example.com' };
    expect(setupNeeded(env, { cwd })).toBe(false);
    expect(verifySetupCode(code, env, { cwd })).toBe(false);

    fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify({ ADMIN_DASHBOARD_EMAILS: 'owner@example.com' }));
    expect(setupNeeded({}, { cwd })).toBe(false);
    expect(verifySetupCode(code, {}, { cwd })).toBe(false);
  });

  test('with no code file, nothing is accepted and no file is made', () => {
    const { verifySetupCode } = load();
    expect(verifySetupCode('a'.repeat(32), {}, { cwd })).toBe(false);
    expect(fs.existsSync(codeFile())).toBe(false);
  });
});
