/**
 * lib/hostSettings.js keeps the setup answers in a file on the host,
 * .cosign/settings.json under the working folder. Only six names may be
 * saved, and only those six are ever kept in the file; the file is written
 * to a fresh, unguessable temp file in the same folder and renamed into
 * place, owner-only (0600). A missing, broken or unreadable file reads as {}.
 * Every test passes its own temp folder as the working folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function load() {
  return require('../../lib/hostSettings');
}

let cwd;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-settings-'));
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

function settingsFile() {
  return path.join(cwd, '.cosign', 'settings.json');
}

const posixTest = process.platform === 'win32' ? test.skip : test;

describe('saveSettings refuses unknown names', () => {
  test('an unknown name throws, names the name but not the value, and writes nothing', () => {
    const { saveSettings } = load();
    let error;
    try {
      saveSettings({ EMAIL_FROM: 'a@example.com', DATABASE_URL: 'secret-value-123' }, { cwd });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).not.toContain('secret-value-123');
    expect(error.message).not.toContain('a@example.com');
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  test('an unknown name leaves an existing file untouched', () => {
    const { saveSettings } = load();
    saveSettings({ EMAIL_PROVIDER: 'resend' }, { cwd });
    const before = fs.readFileSync(settingsFile(), 'utf8');
    expect(() => saveSettings({ SUPABASE_SERVICE_ROLE_KEY: 'x' }, { cwd })).toThrow(
      'SUPABASE_SERVICE_ROLE_KEY'
    );
    expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(before);
  });

  test('each of the six names is accepted', () => {
    const { saveSettings, readSavedSettings } = load();
    const all = {
      ANTHROPIC_API_KEY: 'sk-ant-test',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'sign@example.com',
      NEXT_PUBLIC_APP_URL: 'https://sign.example.com',
      ADMIN_DASHBOARD_EMAILS: 'owner@example.com',
    };
    saveSettings(all, { cwd });
    expect(readSavedSettings({ cwd })).toEqual(all);
  });
});

describe('saving and reading', () => {
  test('a saved value reads back', () => {
    const { saveSettings, readSavedSettings } = load();
    saveSettings({ ANTHROPIC_API_KEY: 'sk-ant-abc' }, { cwd });
    expect(readSavedSettings({ cwd })).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-abc' });
  });

  test('the file is .cosign/settings.json under the working folder', () => {
    const { saveSettings } = load();
    saveSettings({ EMAIL_FROM: 'sign@example.com' }, { cwd });
    expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))).toEqual({
      EMAIL_FROM: 'sign@example.com',
    });
  });

  test('the working folder defaults to the process working folder', () => {
    const { saveSettings } = load();
    jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    saveSettings({ EMAIL_FROM: 'sign@example.com' });
    expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))).toEqual({
      EMAIL_FROM: 'sign@example.com',
    });
  });

  test('saving one name keeps the others', () => {
    const { saveSettings, readSavedSettings } = load();
    saveSettings({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_1' }, { cwd });
    saveSettings({ RESEND_API_KEY: 're_2' }, { cwd });
    expect(readSavedSettings({ cwd })).toEqual({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_2' });
  });
});

describe('only the six names are ever kept', () => {
  function plantFile() {
    fs.mkdirSync(path.join(cwd, '.cosign'));
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify({ EMAIL_PROVIDER: 'resend', DATABASE_URL: 'postgres://planted' })
    );
  }

  test('a name planted in the file is not read back', () => {
    const { readSavedSettings } = load();
    plantFile();
    expect(readSavedSettings({ cwd })).toEqual({ EMAIL_PROVIDER: 'resend' });
  });

  test('a save drops a name planted in the file and keeps the six', () => {
    const { saveSettings } = load();
    plantFile();
    saveSettings({ EMAIL_FROM: 'sign@example.com' }, { cwd });
    expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))).toEqual({
      EMAIL_PROVIDER: 'resend',
      EMAIL_FROM: 'sign@example.com',
    });
  });
});

describe('safe write', () => {
  test('writes a temp file in the same folder, renames it, and leaves no temp file', () => {
    const { saveSettings } = load();
    const rename = jest.spyOn(fs, 'renameSync');
    saveSettings({ EMAIL_FROM: 'sign@example.com' }, { cwd });

    expect(rename).toHaveBeenCalledTimes(1);
    const [from, to] = rename.mock.calls[0];
    expect(path.resolve(to)).toBe(settingsFile());
    expect(path.dirname(path.resolve(from))).toBe(path.join(cwd, '.cosign'));
    expect(path.resolve(from)).not.toBe(settingsFile());
    expect(fs.readdirSync(path.join(cwd, '.cosign'))).toEqual(['settings.json']);
  });

  test('the temp name cannot be guessed from the clock', () => {
    const { saveSettings } = load();
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const rename = jest.spyOn(fs, 'renameSync');
    saveSettings({ EMAIL_FROM: 'one@example.com' }, { cwd });
    saveSettings({ EMAIL_FROM: 'two@example.com' }, { cwd });
    expect(rename).toHaveBeenCalledTimes(2);
    expect(rename.mock.calls[0][0]).not.toBe(rename.mock.calls[1][0]);
  });

  posixTest('a symlink planted at an earlier temp name does not redirect the write', () => {
    const { saveSettings } = load();
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    const rename = jest.spyOn(fs, 'renameSync');
    saveSettings({ EMAIL_FROM: 'one@example.com' }, { cwd });
    const usedTemp = rename.mock.calls[0][0];

    const victim = path.join(cwd, 'victim.txt');
    fs.writeFileSync(victim, 'keep me');
    fs.chmodSync(victim, 0o644);
    fs.symlinkSync(victim, usedTemp);

    saveSettings({ EMAIL_FROM: 'two@example.com' }, { cwd });
    expect(fs.readFileSync(victim, 'utf8')).toBe('keep me');
    expect(fs.statSync(victim).mode & 0o777).toBe(0o644);
    expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))).toEqual({
      EMAIL_FROM: 'two@example.com',
    });
  });

  posixTest('the file is owner-only (0600)', () => {
    const { saveSettings } = load();
    saveSettings({ EMAIL_FROM: 'sign@example.com' }, { cwd });
    expect(fs.statSync(settingsFile()).mode & 0o777).toBe(0o600);
  });

  posixTest('an existing looser file becomes 0600 after a save', () => {
    const { saveSettings } = load();
    fs.mkdirSync(path.join(cwd, '.cosign'));
    fs.writeFileSync(settingsFile(), '{}', { mode: 0o644 });
    fs.chmodSync(settingsFile(), 0o644);
    saveSettings({ EMAIL_FROM: 'sign@example.com' }, { cwd });
    expect(fs.statSync(settingsFile()).mode & 0o777).toBe(0o600);
  });
});

describe('reading a bad file gives {}', () => {
  test('a missing file reads as {}', () => {
    const { readSavedSettings } = load();
    expect(readSavedSettings({ cwd })).toEqual({});
  });

  test('invalid JSON reads as {}', () => {
    const { readSavedSettings } = load();
    fs.mkdirSync(path.join(cwd, '.cosign'));
    fs.writeFileSync(settingsFile(), '{ not json');
    expect(readSavedSettings({ cwd })).toEqual({});
  });

  test('JSON that is not an object reads as {}', () => {
    const { readSavedSettings } = load();
    fs.mkdirSync(path.join(cwd, '.cosign'));
    fs.writeFileSync(settingsFile(), '["EMAIL_FROM"]');
    expect(readSavedSettings({ cwd })).toEqual({});
  });

  test('an unreadable file reads as {}', () => {
    const { readSavedSettings } = load();
    // A folder where the file should be cannot be read as a file, even by root.
    fs.mkdirSync(settingsFile(), { recursive: true });
    expect(readSavedSettings({ cwd })).toEqual({});
  });
});

describe('no environment reads', () => {
  test('lib/hostSettings.js does not read process.env', () => {
    const { saveSettings, readSavedSettings } = load();
    const saved = process.env;
    const touched = [];
    process.env = new Proxy(saved, {
      get(target, key) {
        touched.push(key);
        return target[key];
      },
    });
    try {
      saveSettings({ EMAIL_FROM: 'sign@example.com' }, { cwd });
      readSavedSettings({ cwd });
    } finally {
      process.env = saved;
    }
    expect(touched).toEqual([]);
  });
});
