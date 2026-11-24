/**
 * lib/hostSettings.js, part 2: which value wins, and a view safe to show.
 *
 * - effectiveSetting(name, env, { cwd }) returns a non-blank env value first
 *   (whitespace-only is blank), then the saved value, then null. A name
 *   outside the six throws, and the error holds no setting value.
 * - settingsView(env, { cwd }) lists all six names as { set, source, value };
 *   the two API keys are masked to at most their last 4 characters, and to
 *   none when the key is shorter than 12. A key of 8 or more characters,
 *   from env or saved, in use or overridden, typed into another setting is
 *   masked there too.
 * Every test passes a plain env object and its own temp folder. The key
 * values are made-up placeholders, not shaped like any real provider's key.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function load() {
  return require('../../lib/hostSettings');
}

const SIX = [
  'ANTHROPIC_API_KEY',
  'EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'NEXT_PUBLIC_APP_URL',
  'ADMIN_DASHBOARD_EMAILS',
];

let cwd;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-view-'));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function writeSaved(values) {
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify(values));
}

// How many characters of the mask could have come from the key.
function keyCharsShown(mask, key) {
  return [...mask].filter((ch) => key.includes(ch)).length;
}

describe('effectiveSetting', () => {
  test('a non-blank env value wins over the saved value', () => {
    const { effectiveSetting } = load();
    writeSaved({ EMAIL_FROM: 'saved@example.com' });
    expect(effectiveSetting('EMAIL_FROM', { EMAIL_FROM: 'env@example.com' }, { cwd })).toBe('env@example.com');
  });

  test('a blank or whitespace-only env value falls back to the saved value', () => {
    const { effectiveSetting } = load();
    writeSaved({ EMAIL_FROM: 'saved@example.com' });
    expect(effectiveSetting('EMAIL_FROM', { EMAIL_FROM: '   \t' }, { cwd })).toBe('saved@example.com');
    expect(effectiveSetting('EMAIL_FROM', { EMAIL_FROM: '' }, { cwd })).toBe('saved@example.com');
    expect(effectiveSetting('EMAIL_FROM', {}, { cwd })).toBe('saved@example.com');
  });

  test('null when neither env nor the saved file has it', () => {
    const { effectiveSetting } = load();
    expect(effectiveSetting('EMAIL_FROM', {}, { cwd })).toBeNull();
    expect(effectiveSetting('EMAIL_FROM', { EMAIL_FROM: '  ' }, { cwd })).toBeNull();
    writeSaved({ EMAIL_FROM: '   ' });
    expect(effectiveSetting('EMAIL_FROM', {}, { cwd })).toBeNull();
  });

  test('a name outside the six throws, and the error holds no setting value', () => {
    const { effectiveSetting } = load();
    writeSaved({ ANTHROPIC_API_KEY: 'placeholder-saved-secret-0001' });
    const env = { OTHER_SECRET: 'placeholder-other-secret-9999', ANTHROPIC_API_KEY: 'placeholder-env-secret-0002' };
    let error;
    try {
      effectiveSetting('OTHER_SECRET', env, { cwd });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    const text = `${error.message} ${error.stack}`;
    expect(text).not.toContain('placeholder-other-secret-9999');
    expect(text).not.toContain('placeholder-saved-secret-0001');
    expect(text).not.toContain('placeholder-env-secret-0002');
  });
});

describe('settingsView', () => {
  test('lists all six names, each as { set, source, value }', () => {
    const { settingsView } = load();
    writeSaved({ EMAIL_FROM: 'saved@example.com' });
    const view = settingsView({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: '  ' }, { cwd });
    expect(Object.keys(view).sort()).toEqual([...SIX].sort());
    for (const name of SIX) {
      expect(Object.keys(view[name]).sort()).toEqual(['set', 'source', 'value']);
    }
    expect(view.EMAIL_PROVIDER).toEqual({ set: true, source: 'env', value: 'resend' });
    expect(view.EMAIL_FROM).toEqual({ set: true, source: 'saved', value: 'saved@example.com' });
    expect(view.NEXT_PUBLIC_APP_URL).toEqual({ set: false, source: null, value: null });
  });

  test('a long env key shows only its last 4 characters', () => {
    const { settingsView } = load();
    const key = 'ABCDEFGHIJKLMNOPQRSTUVwxyz';
    const view = settingsView({ ANTHROPIC_API_KEY: key }, { cwd });
    expect(view.ANTHROPIC_API_KEY).toMatchObject({ set: true, source: 'env' });
    const mask = view.ANTHROPIC_API_KEY.value;
    expect(mask.endsWith('wxyz')).toBe(true);
    expect(keyCharsShown(mask, key)).toBeLessThanOrEqual(4);
    expect(JSON.stringify(view)).not.toContain(key);
  });

  test('a long saved key shows only its last 4 characters', () => {
    const { settingsView } = load();
    const key = 'ABCDEFGHIJKLMNOPQRstuv';
    writeSaved({ RESEND_API_KEY: key });
    const view = settingsView({}, { cwd });
    expect(view.RESEND_API_KEY).toMatchObject({ set: true, source: 'saved' });
    const mask = view.RESEND_API_KEY.value;
    expect(mask.endsWith('stuv')).toBe(true);
    expect(keyCharsShown(mask, key)).toBeLessThanOrEqual(4);
    expect(JSON.stringify(view)).not.toContain(key);
  });

  test('a key of exactly 12 characters shows at most its last 4', () => {
    const { settingsView } = load();
    const key = 'ABCDEFGHwxyz';
    const view = settingsView({ RESEND_API_KEY: key }, { cwd });
    const mask = view.RESEND_API_KEY.value;
    expect(mask.endsWith('wxyz')).toBe(true);
    expect(keyCharsShown(mask, key)).toBeLessThanOrEqual(4);
    expect(JSON.stringify(view)).not.toContain(key);
  });

  test('a key shorter than 12 shows none of its characters, from either source', () => {
    const { settingsView } = load();
    const savedKey = 'abcdefghijk'; // 11
    const envKey = 'LMNOPQRSTUV'; // 11
    writeSaved({ RESEND_API_KEY: savedKey });
    const view = settingsView({ ANTHROPIC_API_KEY: envKey }, { cwd });
    expect(view.ANTHROPIC_API_KEY).toMatchObject({ set: true, source: 'env' });
    expect(view.RESEND_API_KEY).toMatchObject({ set: true, source: 'saved' });
    for (const [mask, key] of [[view.ANTHROPIC_API_KEY.value, envKey], [view.RESEND_API_KEY.value, savedKey]]) {
      expect(typeof mask).toBe('string');
      expect(keyCharsShown(mask, key)).toBe(0);
    }
    const text = JSON.stringify(view);
    expect(text).not.toContain(envKey);
    expect(text).not.toContain(savedKey);
  });

  test('a short key made of mask-like characters is still never shown in full', () => {
    const { settingsView } = load();
    for (const key of ['••••', '****', '••••••••', '...']) {
      writeSaved({ RESEND_API_KEY: key });
      const view = settingsView({ ANTHROPIC_API_KEY: key }, { cwd });
      expect(view.ANTHROPIC_API_KEY).toMatchObject({ set: true, source: 'env' });
      expect(view.RESEND_API_KEY).toMatchObject({ set: true, source: 'saved' });
      expect(view.ANTHROPIC_API_KEY.value).not.toContain(key);
      expect(view.RESEND_API_KEY.value).not.toContain(key);
      expect(JSON.stringify(view)).not.toContain(key);
    }
  });
});

describe('settingsView masks a key typed into another setting', () => {
  test('a key pasted into EMAIL_FROM is masked there, from env or saved', () => {
    const { settingsView } = load();
    const envKey = 'placeholder-pasted-env-PQRS';
    const savedKey = 'placeholder-pasted-saved-TUVW';
    writeSaved({ RESEND_API_KEY: savedKey, EMAIL_FROM: savedKey });
    let view = settingsView({ ANTHROPIC_API_KEY: envKey, EMAIL_FROM: envKey }, { cwd });
    expect(view.EMAIL_FROM).toMatchObject({ set: true, source: 'env' });
    expect(view.EMAIL_FROM.value).not.toContain(envKey);
    expect(JSON.stringify(view)).not.toContain(envKey);

    view = settingsView({ ANTHROPIC_API_KEY: envKey }, { cwd });
    expect(view.EMAIL_FROM).toMatchObject({ set: true, source: 'saved' });
    expect(view.EMAIL_FROM.value).not.toContain(savedKey);
    expect(JSON.stringify(view)).not.toContain(savedKey);
  });

  test('a key embedded inside NEXT_PUBLIC_APP_URL is masked, the rest of the address kept', () => {
    const { settingsView } = load();
    const key = 'placeholder-embedded-key-LMNO';
    const view = settingsView(
      { RESEND_API_KEY: key, NEXT_PUBLIC_APP_URL: `https://example.com/?k=${key}&x=1` },
      { cwd },
    );
    const shown = view.NEXT_PUBLIC_APP_URL.value;
    expect(shown).not.toContain(key);
    expect(shown.startsWith('https://example.com/?k=')).toBe(true);
    expect(shown.endsWith('&x=1')).toBe(true);
    expect(JSON.stringify(view)).not.toContain(key);
  });

  test('a saved key overridden by an env key is still masked where it was typed', () => {
    const { settingsView } = load();
    const savedKey = 'placeholder-overridden-saved-EFGH';
    const envKey = 'placeholder-winning-env-IJKL';
    writeSaved({ ANTHROPIC_API_KEY: savedKey, EMAIL_FROM: `owner+${savedKey}@example.com` });
    const view = settingsView({ ANTHROPIC_API_KEY: envKey }, { cwd });
    expect(view.ANTHROPIC_API_KEY).toMatchObject({ set: true, source: 'env' });
    expect(view.EMAIL_FROM).toMatchObject({ set: true, source: 'saved' });
    expect(view.EMAIL_FROM.value).not.toContain(savedKey);
    expect(view.EMAIL_FROM.value.startsWith('owner+')).toBe(true);
    const text = JSON.stringify(view);
    expect(text).not.toContain(savedKey);
    expect(text).not.toContain(envKey);
  });

  test('a key of 8 to 11 characters typed elsewhere is masked too', () => {
    const { settingsView } = load();
    const key = 'Qz7Kp2Lm'; // 8
    const view = settingsView({ ANTHROPIC_API_KEY: key, ADMIN_DASHBOARD_EMAILS: `a@example.com,${key}` }, { cwd });
    expect(view.ADMIN_DASHBOARD_EMAILS.value).not.toContain(key);
    expect(view.ADMIN_DASHBOARD_EMAILS.value.startsWith('a@example.com,')).toBe(true);
    expect(JSON.stringify(view)).not.toContain(key);
  });

  test('a key shorter than 8 is not masked in other settings, so ordinary words stay', () => {
    const { settingsView } = load();
    const view = settingsView({ RESEND_API_KEY: 'resend', EMAIL_PROVIDER: 'resend' }, { cwd });
    expect(view.EMAIL_PROVIDER.value).toBe('resend');
    expect(view.RESEND_API_KEY.value).not.toContain('resend');
  });

  test('the same key saved under both key names is shown in full nowhere', () => {
    const { settingsView } = load();
    const key = 'placeholder-shared-both-HIJK';
    writeSaved({ ANTHROPIC_API_KEY: key, RESEND_API_KEY: key, EMAIL_FROM: `me+${key}@example.com` });
    const view = settingsView({}, { cwd });
    expect(view.ANTHROPIC_API_KEY).toMatchObject({ set: true, source: 'saved' });
    expect(view.RESEND_API_KEY).toMatchObject({ set: true, source: 'saved' });
    expect(view.ANTHROPIC_API_KEY.value.endsWith('HIJK')).toBe(true);
    expect(view.RESEND_API_KEY.value.endsWith('HIJK')).toBe(true);
    expect(view.EMAIL_FROM.value).not.toContain(key);
    expect(JSON.stringify(view)).not.toContain(key);
  });

  test('JSON of the view holds none of several typed keys in full', () => {
    const { settingsView } = load();
    const a = 'placeholder-first-key-AAAA';
    const r = 'placeholder-second-key-RRRR';
    writeSaved({ RESEND_API_KEY: r, NEXT_PUBLIC_APP_URL: `https://${r}.example.com` });
    const view = settingsView(
      { ANTHROPIC_API_KEY: a, EMAIL_FROM: `${a} <${r}@example.com>`, ADMIN_DASHBOARD_EMAILS: `${r},${a}` },
      { cwd },
    );
    const text = JSON.stringify(view);
    expect(text).not.toContain(a);
    expect(text).not.toContain(r);
  });
});
