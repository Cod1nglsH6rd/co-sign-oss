/**
 * First-boot key maker for the Docker stack.
 *
 * ensureKeys(dir, fs, log) writes dir/supabase.env once: a random JWT_SECRET
 * (48 bytes, base64url) and SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY,
 * HS256 tokens signed with it for the anon and service_role roles, valid for
 * ten years. The file is written with mode 0600. When the file already exists
 * (or another first boot writes it first) it is left untouched, so the keys
 * stay the same across restarts as long as the volume holding dir is kept.
 * Logs only 'keys created' or 'keys kept', never a key.
 *
 * ensureDbPassword(dir, fs, log) writes dir/db_password once in the same way:
 * 32 random bytes as hex, mode 0600, left untouched when it is there. The
 * database takes it on its first start (POSTGRES_PASSWORD_FILE).
 *
 * writeDbAddresses(dir, fs) writes, on every start, the address the other
 * services log in with, from dir/db_password: dir/db.env (one line,
 * DATABASE_URL='...', for the auth, storage and migrate entrypoints to
 * source) and dir/rest_db_uri (the address alone, for PostgREST's @file
 * form). User supabase_admin on db:5432/postgres; the password is
 * percent-encoded. Each file is written beside its place and renamed over it,
 * mode 0600.
 *
 * Usage: node scripts/docker/gen-keys.js <dir>
 */

const crypto = require('node:crypto');

const TEN_YEARS = 10 * 365 * 24 * 60 * 60;
// The role the image gives the first-start password, and the stack's database.
const DB_USER = 'supabase_admin';
const DB_HOST = 'db:5432';
const DB_NAME = 'postgres';

function inDir(dir, name) {
  return String(dir).replace(/\/+$/, '') + '/' + name;
}

function base64url(json) {
  return Buffer.from(JSON.stringify(json)).toString('base64url');
}

// An HS256 JSON Web Token for payload, signed with secret.
function signJwt(payload, secret) {
  const body = base64url({ alg: 'HS256', typ: 'JWT' }) + '.' + base64url(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + signature;
}

function ensureKeys(dir, fs, log = console.log) {
  const file = String(dir).replace(/\/+$/, '') + '/supabase.env';
  if (fs.existsSync(file)) {
    log('keys kept');
    return;
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TEN_YEARS;
  const lines = [
    'JWT_SECRET=' + secret,
    'SUPABASE_ANON_KEY=' + signJwt({ role: 'anon', iss: 'supabase', iat, exp }, secret),
    'SUPABASE_SERVICE_ROLE_KEY=' + signJwt({ role: 'service_role', iss: 'supabase', iat, exp }, secret),
  ];
  try {
    // wx: never overwrite a file another first boot wrote since the check above.
    fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      log('keys kept');
      return;
    }
    throw err;
  }
  log('keys created');
}

function ensureDbPassword(dir, fs, log = console.log) {
  const file = inDir(dir, 'db_password');
  if (fs.existsSync(file)) {
    log('database password kept');
    return;
  }
  // Hex: nothing in it needs quoting in an address, a shell line or SQL.
  const password = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(file, password, { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      log('database password kept');
      return;
    }
    throw err;
  }
  log('database password created');
}

// Written beside the file and renamed over it, so a reader never sees half of it.
function writePrivate(fs, file, text) {
  const next = file + '.next';
  if (fs.existsSync(next)) fs.unlinkSync(next);
  fs.writeFileSync(next, text, { mode: 0o600, flag: 'wx' });
  fs.renameSync(next, file);
}

function writeDbAddresses(dir, fs) {
  const password = String(fs.readFileSync(inDir(dir, 'db_password'), 'utf8')).trim();
  if (!password) throw new Error(inDir(dir, 'db_password') + ' is empty: delete it and start again to make a new one');
  // encodeURIComponent leaves ' as it is; %27 keeps the sourced line's quotes whole.
  const encoded = encodeURIComponent(password).replace(/'/g, '%27');
  const address = ['postgres://', DB_USER, ':', encoded, '@', DB_HOST, '/', DB_NAME].join('');
  writePrivate(fs, inDir(dir, 'rest_db_uri'), address);
  writePrivate(fs, inDir(dir, 'db.env'), "DATABASE_URL='" + address + "'\n");
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node scripts/docker/gen-keys.js <dir>');
    process.exit(1);
  }
  const fs = require('node:fs');
  // A keys volume made before the stack generated the database password: the
  // database there still has the password it was first started with.
  const older = fs.existsSync(inDir(dir, 'supabase.env')) && !fs.existsSync(inDir(dir, 'db_password'));
  ensureKeys(dir, fs);
  ensureDbPassword(dir, fs);
  writeDbAddresses(dir, fs);
  if (older) {
    console.log(
      'This keys volume is older than the generated database password, so the database still has its old one. ' +
        'Run scripts/docker/set-db-password.js once, as README.md says under "Run it at home" (An install made before 2026-11-21).'
    );
  }
}

module.exports = { signJwt, ensureKeys, ensureDbPassword, writeDbAddresses };
