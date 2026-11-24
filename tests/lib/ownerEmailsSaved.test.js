/**
 * getServerOwnerEmails takes, of ADMIN_DASHBOARD_EMAILS from env, then
 * NEXT_PUBLIC_OWNER_EMAILS from env, then the ADMIN_DASHBOARD_EMAILS saved on
 * the host (.cosign/settings.json, see lib/hostSettings.js), the first that
 * names someone. Every test passes its own temp folder as the working folder.
 * In a browser, loading lib/ownerEmails and using it never loads the
 * server-only lib/hostSettings.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const VARS = ['ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS'];
const savedEnv = {};
let cwd;

beforeEach(() => {
  VARS.forEach((name) => { savedEnv[name] = process.env[name]; delete process.env[name]; });
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-owners-'));
});

afterEach(() => {
  VARS.forEach((name) => {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  });
  fs.rmSync(cwd, { recursive: true, force: true });
});

function writeSaved(settings) {
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify(settings));
}

function load() {
  return require('../../lib/ownerEmails');
}

// Loads lib/ownerEmails afresh with lib/hostSettings made to throw if loaded.
function withHostSettingsForbidden(run) {
  try {
    jest.isolateModules(() => {
      jest.doMock('../../lib/hostSettings', () => {
        throw new Error('lib/hostSettings is server-only');
      });
      run(load());
    });
  } finally {
    jest.dontMock('../../lib/hostSettings');
  }
}

describe('getServerOwnerEmails with a saved ADMIN_DASHBOARD_EMAILS', () => {
  it('uses the saved list when both env variables are unset', () => {
    writeSaved({ ADMIN_DASHBOARD_EMAILS: ' Saved@Example.com , other@example.com ' });
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails({ cwd })).toEqual(['saved@example.com', 'other@example.com']);
  });

  it('uses the saved list when both env variables are blank', () => {
    process.env.ADMIN_DASHBOARD_EMAILS = '   ';
    process.env.NEXT_PUBLIC_OWNER_EMAILS = '';
    writeSaved({ ADMIN_DASHBOARD_EMAILS: 'saved@example.com' });
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails({ cwd })).toEqual(['saved@example.com']);
  });

  it('uses the saved list when the env values name no address', () => {
    process.env.ADMIN_DASHBOARD_EMAILS = ' , ';
    process.env.NEXT_PUBLIC_OWNER_EMAILS = ',';
    writeSaved({ ADMIN_DASHBOARD_EMAILS: 'saved@example.com' });
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails({ cwd })).toEqual(['saved@example.com']);
  });

  it('reads the saved list from the process working folder by default', () => {
    writeSaved({ ADMIN_DASHBOARD_EMAILS: 'saved@example.com' });
    const original = process.cwd();
    process.chdir(cwd);
    try {
      const { getServerOwnerEmails } = load();
      expect(getServerOwnerEmails()).toEqual(['saved@example.com']);
    } finally {
      process.chdir(original);
    }
  });

  it('a non-blank env ADMIN_DASHBOARD_EMAILS wins over env NEXT_PUBLIC_OWNER_EMAILS and the saved list', () => {
    process.env.ADMIN_DASHBOARD_EMAILS = 'Env@Example.com';
    process.env.NEXT_PUBLIC_OWNER_EMAILS = 'public@example.com';
    writeSaved({ ADMIN_DASHBOARD_EMAILS: 'saved@example.com' });
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails({ cwd })).toEqual(['env@example.com']);
  });

  it('a non-blank env NEXT_PUBLIC_OWNER_EMAILS wins over the saved list', () => {
    process.env.NEXT_PUBLIC_OWNER_EMAILS = 'public@example.com';
    writeSaved({ ADMIN_DASHBOARD_EMAILS: 'saved@example.com' });
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails({ cwd })).toEqual(['public@example.com']);
  });

  it('an env ADMIN_DASHBOARD_EMAILS that names no address gives way to env NEXT_PUBLIC_OWNER_EMAILS', () => {
    process.env.ADMIN_DASHBOARD_EMAILS = ',';
    process.env.NEXT_PUBLIC_OWNER_EMAILS = 'public@example.com';
    writeSaved({ ADMIN_DASHBOARD_EMAILS: 'saved@example.com' });
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails({ cwd })).toEqual(['public@example.com']);
  });

  it('returns [] with nothing in env and no saved file', () => {
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails({ cwd })).toEqual([]);
  });

  it('returns [] with nothing in env and a saved value that names no address', () => {
    writeSaved({ ADMIN_DASHBOARD_EMAILS: ' , ' });
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails({ cwd })).toEqual([]);
  });

  it('in a browser (window defined) never loads lib/hostSettings and returns []', () => {
    writeSaved({ ADMIN_DASHBOARD_EMAILS: 'saved@example.com' });
    global.window = {};
    try {
      withHostSettingsForbidden(({ getServerOwnerEmails }) => {
        expect(getServerOwnerEmails({ cwd })).toEqual([]);
      });
    } finally {
      delete global.window;
    }
  });
});

describe('lib/ownerEmails in a browser', () => {
  // issue #487: getClientOwnerEmails is gone; the module still loads and works in a browser without lib/hostSettings.
  it('loads and answers without ever loading lib/hostSettings', () => {
    writeSaved({ ADMIN_DASHBOARD_EMAILS: 'saved@example.com' });
    global.window = {};
    try {
      withHostSettingsForbidden((ownerEmails) => {
        expect(ownerEmails).not.toHaveProperty('getClientOwnerEmails');
        expect(ownerEmails.parseOwnerEmails(' Client@Example.com ')).toEqual(['client@example.com']);
        expect(ownerEmails.isOwnerEmail('Client@Example.com', ['client@example.com'])).toBe(true);
      });
    } finally {
      delete global.window;
    }
  });
});
