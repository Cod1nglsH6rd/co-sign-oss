/**
 * lib/setupLock.js setupNeeded(env, { cwd }) says whether the first-run setup
 * is still needed: true only when no owner list is in effect, from env
 * (ADMIN_DASHBOARD_EMAILS or NEXT_PUBLIC_OWNER_EMAILS) or saved in
 * .cosign/settings.json (ADMIN_DASHBOARD_EMAILS). Blank or comma-only values
 * are no list. On Vercel it is never needed. It never writes a file.
 * Every test passes its own temp folder as the working folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function load() {
  return require('../../lib/setupLock');
}

let cwd;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-setuplock-'));
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

function writeSaved(contents) {
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify(contents));
}

describe('setupNeeded with nothing saved', () => {
  test('no owner list anywhere: setup is needed', () => {
    expect(load().setupNeeded({}, { cwd })).toBe(true);
  });

  test('ADMIN_DASHBOARD_EMAILS in env: not needed', () => {
    expect(load().setupNeeded({ ADMIN_DASHBOARD_EMAILS: 'owner@example.com' }, { cwd })).toBe(false);
  });

  test('NEXT_PUBLIC_OWNER_EMAILS in env: not needed', () => {
    expect(load().setupNeeded({ NEXT_PUBLIC_OWNER_EMAILS: 'owner@example.com' }, { cwd })).toBe(false);
  });

  test('blank env values count as no list', () => {
    const env = { ADMIN_DASHBOARD_EMAILS: '   ', NEXT_PUBLIC_OWNER_EMAILS: '' };
    expect(load().setupNeeded(env, { cwd })).toBe(true);
  });

  test('comma-only env values count as no list', () => {
    const env = { ADMIN_DASHBOARD_EMAILS: ' , ,', NEXT_PUBLIC_OWNER_EMAILS: ',' };
    expect(load().setupNeeded(env, { cwd })).toBe(true);
  });

  test('a comma-only ADMIN_DASHBOARD_EMAILS does not hide a real NEXT_PUBLIC_OWNER_EMAILS', () => {
    const env = { ADMIN_DASHBOARD_EMAILS: ',', NEXT_PUBLIC_OWNER_EMAILS: 'owner@example.com' };
    expect(load().setupNeeded(env, { cwd })).toBe(false);
  });
});

describe('setupNeeded with saved settings', () => {
  test('ADMIN_DASHBOARD_EMAILS saved: not needed', () => {
    writeSaved({ ADMIN_DASHBOARD_EMAILS: 'owner@example.com' });
    expect(load().setupNeeded({}, { cwd })).toBe(false);
  });

  test('a blank or comma-only saved ADMIN_DASHBOARD_EMAILS counts as no list', () => {
    writeSaved({ ADMIN_DASHBOARD_EMAILS: '  ' });
    expect(load().setupNeeded({}, { cwd })).toBe(true);
    writeSaved({ ADMIN_DASHBOARD_EMAILS: ', ,' });
    expect(load().setupNeeded({}, { cwd })).toBe(true);
  });

  test('a comma-only env value does not hide a real saved list', () => {
    writeSaved({ ADMIN_DASHBOARD_EMAILS: 'owner@example.com' });
    expect(load().setupNeeded({ ADMIN_DASHBOARD_EMAILS: ',' }, { cwd })).toBe(false);
  });

  test('NEXT_PUBLIC_OWNER_EMAILS in the file is not a saved setting and is ignored', () => {
    writeSaved({ NEXT_PUBLIC_OWNER_EMAILS: 'owner@example.com' });
    expect(load().setupNeeded({}, { cwd })).toBe(true);
  });

  test('a saved list in another folder does not count', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-setuplock-other-'));
    try {
      fs.mkdirSync(path.join(other, '.cosign'));
      fs.writeFileSync(
        path.join(other, '.cosign', 'settings.json'),
        JSON.stringify({ ADMIN_DASHBOARD_EMAILS: 'owner@example.com' }),
      );
      expect(load().setupNeeded({}, { cwd })).toBe(true);
      expect(load().setupNeeded({}, { cwd: other })).toBe(false);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test('a broken settings file counts as no list', () => {
    fs.mkdirSync(path.join(cwd, '.cosign'));
    fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), '{not json');
    expect(load().setupNeeded({}, { cwd })).toBe(true);
  });
});

describe('setupNeeded on Vercel', () => {
  test('VERCEL set: never needed, even with no owner list', () => {
    expect(load().setupNeeded({ VERCEL: '1' }, { cwd })).toBe(false);
    expect(load().setupNeeded({ VERCEL: '1', ADMIN_DASHBOARD_EMAILS: ' , ' }, { cwd })).toBe(false);
  });

  test('a blank VERCEL is not Vercel', () => {
    expect(load().setupNeeded({ VERCEL: '  ' }, { cwd })).toBe(true);
  });
});

describe('setupNeeded writes nothing', () => {
  test('an empty folder stays empty and no write call is made', () => {
    const { setupNeeded } = load();
    const spies = ['writeFileSync', 'mkdirSync', 'openSync', 'renameSync', 'appendFileSync'].map((name) =>
      jest.spyOn(fs, name),
    );
    expect(setupNeeded({}, { cwd })).toBe(true);
    expect(setupNeeded({ ADMIN_DASHBOARD_EMAILS: 'owner@example.com' }, { cwd })).toBe(false);
    expect(setupNeeded({ VERCEL: '1' }, { cwd })).toBe(false);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  test('a saved file is left exactly as it was', () => {
    writeSaved({ ADMIN_DASHBOARD_EMAILS: 'owner@example.com', OTHER: 'x' });
    const file = path.join(cwd, '.cosign', 'settings.json');
    const before = fs.readFileSync(file, 'utf8');
    expect(load().setupNeeded({}, { cwd })).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(fs.readdirSync(path.join(cwd, '.cosign'))).toEqual(['settings.json']);
  });
});
