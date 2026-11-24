/**
 * lib/setupBoot.js makes the setup code when a fresh install starts.
 *
 * ensureSetupCodeAtBoot({ env, cwd, log }) calls getSetupCode only while
 * setupNeeded(env) is true, returns true when a code exists afterwards, and
 * never throws: a failure logs one line (without a code) and returns false.
 * When setup is not needed it does nothing and makes no file.
 * Every test passes its own temp folder as the working folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function load() {
  const mod = require('../../lib/setupBoot');
  expect(typeof mod.ensureSetupCodeAtBoot).toBe('function');
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
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-setupboot-'));
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

function codeFile() {
  return path.join(cwd, '.cosign', 'setup-code');
}

describe('ensureSetupCodeAtBoot', () => {
  test('setup needed and no code: makes the code file once and returns true', () => {
    const { ensureSetupCodeAtBoot } = load();
    const log = stubLogger();
    expect(ensureSetupCodeAtBoot({ env: {}, cwd, log })).toBe(true);
    expect(fs.existsSync(codeFile())).toBe(true);
    const code = fs.readFileSync(codeFile(), 'utf8').trim();
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    expect(logCalls(log)).toHaveLength(1);

    expect(ensureSetupCodeAtBoot({ env: {}, cwd, log })).toBe(true);
    expect(fs.readFileSync(codeFile(), 'utf8').trim()).toBe(code);
    expect(logCalls(log)).toHaveLength(1);
  });

  test('setup not needed: returns false and makes no file', () => {
    const { ensureSetupCodeAtBoot } = load();
    const log = stubLogger();
    const env = { ADMIN_DASHBOARD_EMAILS: 'owner@example.com' };
    expect(ensureSetupCodeAtBoot({ env, cwd, log })).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.cosign'))).toBe(false);
    expect(logCalls(log)).toHaveLength(0);
  });

  test('an owner list saved on the host means setup is not needed', () => {
    fs.mkdirSync(path.join(cwd, '.cosign'));
    fs.writeFileSync(
      path.join(cwd, '.cosign', 'settings.json'),
      JSON.stringify({ ADMIN_DASHBOARD_EMAILS: 'owner@example.com' })
    );
    const { ensureSetupCodeAtBoot } = load();
    expect(ensureSetupCodeAtBoot({ env: {}, cwd, log: stubLogger() })).toBe(false);
    expect(fs.existsSync(codeFile())).toBe(false);
  });

  test('an unwritable folder returns false, logs one line without a code and does not throw', () => {
    // .cosign is a plain file, so no folder can be made there, even as root.
    fs.writeFileSync(path.join(cwd, '.cosign'), 'not a folder');
    const { ensureSetupCodeAtBoot } = load();
    const log = stubLogger();
    let result;
    expect(() => {
      result = ensureSetupCodeAtBoot({ env: {}, cwd, log });
    }).not.toThrow();
    expect(result).toBe(false);
    const calls = logCalls(log);
    expect(calls).toHaveLength(1);
    expect(calls[0].join(' ')).not.toMatch(/[0-9a-f]{32}/);
  });
});
