/**
 * The setup answers the owner gives, saved in a file on the host:
 * .cosign/settings.json under the working folder.
 *
 * - Only six names may be saved (SETTING_NAMES). Any other name is refused
 *   before anything is written; the error names the name, never a value.
 *   Any other name already in the file is ignored on read and dropped on save.
 * - The file is written to a new temp file with a random name in the same
 *   folder (created exclusively, so a file or link already at that name is
 *   never followed), then renamed into place. It is owner-only (0600).
 * - A missing, broken or unreadable file reads as {}.
 * - effectiveSetting(name, env) returns a non-blank env value first
 *   (whitespace-only is blank), then the saved value, then null.
 * - settingsView(env) lists all six as { set, source, value }; the two API
 *   keys are masked to at most their last 4 characters, and to an empty
 *   string when the key is shorter than 12. Any key of 8 or more characters
 *   (from env or saved, in use or overridden) typed into any setting is
 *   masked there the same way.
 *
 * This file reads no environment settings itself: callers pass env in as a
 * plain object. Pass { cwd } to choose the working folder (default: the
 * process's working folder).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SETTING_NAMES = [
  'ANTHROPIC_API_KEY',
  'EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'NEXT_PUBLIC_APP_URL',
  'ADMIN_DASHBOARD_EMAILS',
];

function settingsFilePath({ cwd = process.cwd() } = {}) {
  return path.join(cwd, '.cosign', 'settings.json');
}

// Only the six names, from any object.
function knownSettings(source) {
  const kept = {};
  for (const name of SETTING_NAMES) {
    if (Object.prototype.hasOwnProperty.call(source, name)) kept[name] = source[name];
  }
  return kept;
}

function readSavedSettings(options) {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFilePath(options), 'utf8'));
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? knownSettings(saved) : {};
  } catch {
    return {};
  }
}

function saveSettings(updates, options) {
  for (const name of Object.keys(updates)) {
    if (!SETTING_NAMES.includes(name)) {
      throw new Error(`${name} is not a setting that can be saved here`);
    }
  }

  const file = settingsFilePath(options);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const next = knownSettings({ ...readSavedSettings(options), ...updates });
  const temp = path.join(dir, `.settings.json.${crypto.randomBytes(16).toString('hex')}.tmp`);
  // 'wx' fails if anything, a symlink included, is already at this name.
  let fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, JSON.stringify(next, null, 2) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
    throw error;
  }
  return next;
}

const SECRET_NAMES = ['ANTHROPIC_API_KEY', 'RESEND_API_KEY'];
// A key shorter than this is not hunted for in the other settings, so an
// ordinary word typed as a key does not blank out ordinary text.
const MIN_TYPED_SECRET = 8;

function nonBlank(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

// Env first, then the saved file, then nowhere.
function resolveSetting(name, env, saved) {
  const fromEnv = nonBlank(env && env[name]);
  if (fromEnv !== null) return { source: 'env', value: fromEnv };
  const fromSaved = nonBlank(saved[name]);
  if (fromSaved !== null) return { source: 'saved', value: fromSaved };
  return { source: null, value: null };
}

function effectiveSetting(name, env, options) {
  if (!SETTING_NAMES.includes(name)) {
    // Fixed text: the name itself is not echoed, in case a value was passed.
    throw new Error('Not a known setting name');
  }
  return resolveSetting(name, env, readSavedSettings(options)).value;
}

// At most the last 4 characters. A key shorter than 12 shows nothing: an
// empty string, so no fixed mask text can ever equal the key itself. A longer
// key's mask (8 characters) is always shorter than the key.
function maskKey(key) {
  return key.length < 12 ? '' : `••••${key.slice(-4)}`;
}

function settingsView(env, options) {
  const saved = readSavedSettings(options);
  const view = {};
  for (const name of SETTING_NAMES) {
    const { source, value } = resolveSetting(name, env, saved);
    const shown = value !== null && SECRET_NAMES.includes(name) ? maskKey(value) : value;
    view[name] = { set: source !== null, source, value: shown };
  }

  // Every key the owner typed, in use or overridden by env. Longest first,
  // so a key inside a longer key does not leave the longer one half-masked.
  const secrets = new Set();
  for (const name of SECRET_NAMES) {
    for (const value of [nonBlank(env && env[name]), nonBlank(saved[name])]) {
      if (value !== null && value.length >= MIN_TYPED_SECRET) secrets.add(value);
    }
  }
  const longestFirst = [...secrets].sort((a, b) => b.length - a.length);

  // Each replacement makes the text shorter, so this always ends; it repeats
  // until no key is left, even one that a replacement put together.
  for (const name of SETTING_NAMES) {
    let found = view[name].value !== null;
    while (found) {
      found = false;
      for (const secret of longestFirst) {
        if (view[name].value.includes(secret)) {
          view[name].value = view[name].value.split(secret).join(maskKey(secret));
          found = true;
        }
      }
    }
  }
  return view;
}

module.exports = {
  SETTING_NAMES,
  settingsFilePath,
  readSavedSettings,
  saveSettings,
  effectiveSetting,
  settingsView,
};
