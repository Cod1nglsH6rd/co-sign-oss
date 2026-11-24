/**
 * Once, for a Docker stack whose database was made before the stack generated
 * its own database password: that database still has the password it was
 * first started with, while auth, rest, storage and migrate now log in with
 * the one the keys service made (/keys/db_password). This logs in to the
 * stack's database as supabase_admin with the old password (OLD_DB_PASSWORD)
 * and gives supabase_admin the password on the keys volume, with statement
 * logging off for that session so the password is not written to the
 * database's log. Prints neither password.
 *
 * When the database already takes the password on the keys volume it changes
 * nothing, so running it twice is harmless.
 *
 * Exit codes: 0 set (or nothing to do), 1 the database refused the old
 * password or the change failed, 2 OLD_DB_PASSWORD or the password file is
 * missing.
 *
 * While the database is still starting it tries again, every 2 s for a minute.
 *
 * Usage, with only the database started (README.md, "Run it at home"):
 *   docker compose run --rm --no-deps -e OLD_DB_PASSWORD='<old password>' \
 *     migrate node scripts/docker/set-db-password.js
 * It runs in the migrate image, which has the pg package and the keys volume.
 */

const PASSWORD_FILE = '/keys/db_password';
const DATABASE = { host: 'db', port: 5432, database: 'postgres', user: 'supabase_admin' };
const WRONG_PASSWORD = '28P01';

function defaultCreateClient(config) {
  // Loaded here so the tests need no database driver.
  const { Client } = require('pg');
  return new Client(config);
}

// One try: a connected client for that password, or the connection error.
async function connectOnce(createClient, password) {
  const client = createClient({ ...DATABASE, password });
  try {
    await client.connect();
    return { client };
  } catch (err) {
    try {
      await client.end();
    } catch {
      // already closed
    }
    return { err };
  }
}

// Tries again while the database is still starting (any error but a refused
// password), up to `tries` times, `waitMs` apart.
async function connect(createClient, password, { tries, waitMs, sleep }) {
  let result;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    result = await connectOnce(createClient, password);
    if (result.client || (result.err && result.err.code === WRONG_PASSWORD) || attempt === tries) break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(waitMs);
  }
  return result;
}

function explain(err) {
  return [err && err.code, err && err.message].filter(Boolean).join(' ');
}

async function setDbPassword({
  env = process.env,
  fs = require('node:fs'),
  createClient = defaultCreateClient,
  log = console.log,
  error = console.error,
  tries = 30,
  waitMs = 2000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const retry = { tries, waitMs, sleep };
  const old = env.OLD_DB_PASSWORD;
  if (!old) {
    error('OLD_DB_PASSWORD is not set: pass the password the database was first started with (-e OLD_DB_PASSWORD=...)');
    return 2;
  }
  let next;
  try {
    next = String(fs.readFileSync(PASSWORD_FILE, 'utf8')).trim();
  } catch (err) {
    error(`Cannot read ${PASSWORD_FILE} (${err && err.code}): start the database and the keys service first (docker compose up -d db)`);
    return 2;
  }
  if (!next) {
    error(`${PASSWORD_FILE} is empty: delete it and start the keys service again to make a new one`);
    return 2;
  }

  const already = await connect(createClient, next, retry);
  if (already.client) {
    await already.client.end();
    log('The database already takes the password on the keys volume; nothing changed.');
    return 0;
  }

  if (already.err && already.err.code !== WRONG_PASSWORD) {
    error(`Could not reach the database: ${explain(already.err)}`);
    return 1;
  }

  const { client, err } = await connect(createClient, old, retry);
  if (!client) {
    if (err && err.code === WRONG_PASSWORD) {
      error('The password in OLD_DB_PASSWORD was refused too: check it (the old default, or the POSTGRES_PASSWORD you had set).');
    } else {
      error(`Could not reach the database: ${explain(err)}`);
    }
    return 1;
  }
  try {
    // Superuser settings for this session only: no statement or duration log
    // line (and no pgaudit line where it is loaded) carries the password.
    await client.query("set log_statement = 'none'");
    await client.query('set log_min_duration_statement = -1');
    await client.query("set pgaudit.log = 'none'");
    const { rows } = await client.query('select quote_literal($1) as q', [next]);
    await client.query('alter role supabase_admin with password ' + rows[0].q);
  } catch (e) {
    error(`The password was not changed: ${explain(e)}`);
    return 1;
  } finally {
    await client.end();
  }
  log('database password set: supabase_admin now has the password on the keys volume. Run docker compose up -d.');
  return 0;
}

if (require.main === module) {
  setDbPassword().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { setDbPassword };
