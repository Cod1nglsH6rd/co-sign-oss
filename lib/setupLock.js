/**
 * Setup lock, part 1: is the first-run setup still needed?
 *
 * setupNeeded(env, { cwd }) is true only when no owner list is in effect:
 * none in env (ADMIN_DASHBOARD_EMAILS or NEXT_PUBLIC_OWNER_EMAILS) and none
 * saved in .cosign/settings.json (ADMIN_DASHBOARD_EMAILS, via
 * lib/hostSettings.js). A blank or comma-only value is no list. On Vercel
 * (adapterStatus(env).vercel === 'on') it is always false: setup there is
 * done in the Vercel dashboard. It only reads; it never writes a file.
 *
 * Setup lock, part 2: the one-time setup code.
 *
 * getSetupCode({ cwd, log }) returns the host's setup code. The first call
 * makes it (128 random bits from crypto.randomBytes, as 32 hex characters),
 * saves it to .cosign/setup-code and logs one line with the code and that
 * file's path, so only someone who can read the host's logs or files can
 * finish setup. Every later call, in this process or a new one, reads the
 * same code back from the file and logs nothing. Every call makes the folder
 * 0700 and the file 0600, also when they were already there with looser modes.
 *
 * verifySetupCode(input, env, { cwd }) is true only while setupNeeded is true,
 * no .cosign/first-admin.lock exists and input is exactly the saved code,
 * compared with crypto.timingSafeEqual. Anything else (wrong, empty, not a
 * string, another length, no code file, a lock file whatever setupNeeded
 * says) is false; it never throws and never makes a code.
 *
 * removeSetupCode({ cwd }) deletes .cosign/setup-code once the first admin is
 * made. With no code file it does nothing; any other filesystem error is
 * thrown as it is.
 *
 * Setup lock, part 3: only one first-admin claim succeeds, and a failed
 * claim can be released so the owner can retry.
 *
 * claimFirstAdmin({ cwd }) makes .cosign/first-admin.lock with an exclusive
 * 'wx' open (mode 0600) and resolves { ok: true } the first time. Every later
 * call, also ones started at the same moment, resolves { ok: false, reason }
 * and does not throw. Any other filesystem error is thrown as it is.
 *
 * releaseFirstAdmin({ cwd }), also part 3, removes .cosign/first-admin.lock,
 * so a claim whose first-admin setup then failed can be undone: the next
 * claimFirstAdmin resolves { ok: true } again. With no lock file it resolves
 * and does nothing. Any other filesystem error is thrown as it is.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { adapterStatus } from './adapters';
import { readSavedSettings } from './hostSettings';
import { parseOwnerEmails } from './ownerEmails';

export function setupNeeded(env = {}, options) {
  if (adapterStatus(env).vercel === 'on') return false;
  const lists = [
    env.ADMIN_DASHBOARD_EMAILS,
    env.NEXT_PUBLIC_OWNER_EMAILS,
    readSavedSettings(options).ADMIN_DASHBOARD_EMAILS,
  ];
  return lists.every((raw) => parseOwnerEmails(raw).length === 0);
}

const CODE_BYTES = 16;
const CODE_PATTERN = /^[0-9a-f]{32}$/;

function setupCodePath({ cwd = process.cwd() } = {}) {
  return path.join(cwd, '.cosign', 'setup-code');
}

function lockPath({ cwd = process.cwd() } = {}) {
  return path.join(cwd, '.cosign', 'first-admin.lock');
}

// The saved code, or null when the file is missing, unreadable or not a code.
function readSetupCode(options) {
  try {
    const saved = fs.readFileSync(setupCodePath(options), 'utf8').trim();
    return CODE_PATTERN.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function getSetupCode({ cwd, log = console } = {}) {
  const options = { cwd };
  const file = setupCodePath(options);
  const dir = path.dirname(file);
  // mkdirSync's mode only applies to a new folder, so an old one is tightened too.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);

  const existing = readSetupCode(options);
  if (existing !== null) {
    fs.chmodSync(file, 0o600);
    return existing;
  }

  // A file that is there but holds no code is replaced.
  fs.rmSync(file, { force: true });

  const code = crypto.randomBytes(CODE_BYTES).toString('hex');
  // Written in full to a new temp file, then linked into place: the link
  // fails if a code is already there, so of two first calls only one wins.
  const temp = path.join(dir, `.setup-code.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, code + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(temp, file);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return readSetupCode(options);
  } finally {
    fs.rmSync(temp, { force: true });
  }

  log.warn(`[setupLock] Setup code: ${code} (saved in ${file})`);
  return code;
}

export function verifySetupCode(input, env = {}, { cwd } = {}) {
  if (typeof input !== 'string' || input === '') return false;
  if (!setupNeeded(env, { cwd })) return false;
  // A lock means a first admin was claimed: a lost settings file must not reopen setup.
  if (fs.existsSync(lockPath({ cwd }))) return false;
  const code = readSetupCode({ cwd });
  if (code === null) return false;
  const given = Buffer.from(input, 'utf8');
  const expected = Buffer.from(code, 'utf8');
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

export function removeSetupCode({ cwd } = {}) {
  fs.rmSync(setupCodePath({ cwd }), { force: true });
}

export async function claimFirstAdmin({ cwd = process.cwd() } = {}) {
  const dir = path.join(cwd, '.cosign');
  const file = path.join(dir, 'first-admin.lock');
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await fs.promises.open(file, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return { ok: false, reason: 'The first admin has already been claimed on this host.' };
  }
  try {
    // The open's mode is cut by the umask, so the file is set to 0600 here too.
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  return { ok: true };
}

export async function releaseFirstAdmin({ cwd = process.cwd() } = {}) {
  const file = path.join(cwd, '.cosign', 'first-admin.lock');
  try {
    await fs.promises.unlink(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
