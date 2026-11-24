/**
 * Builds a fresh local database: SUPABASE-SETUP.sql as the baseline, then
 * supabase/migrations/*.sql in name order. Each file runs in its own
 * transaction and is recorded by name in cosign_meta.schema_migrations, so a
 * second run applies only new files. Stops at the first failing file with a
 * non-zero exit and its name.
 *
 * Refuses a DATABASE_URL on a *.supabase.co host unless MIGRATE_ALLOW_REMOTE=1.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/db/migrate.js
 * Needs the `pg` package, which package.json does not list yet.
 */

const path = require('node:path');

const BASELINE = 'SUPABASE-SETUP.sql';
const MIGRATIONS_DIR = 'supabase/migrations';

// files: paths relative to the repo root. appliedNames: names already recorded.
// Returns [{name, path}] to apply: the baseline first, then migrations by name.
function planMigrations(files, appliedNames) {
  const applied = new Set(appliedNames || []);
  const baseline = files.filter((f) => f === BASELINE);
  const migrations = files
    .filter((f) => path.posix.dirname(f) === MIGRATIONS_DIR && f.endsWith('.sql'))
    .sort((a, b) => (path.posix.basename(a) < path.posix.basename(b) ? -1 : 1));
  return baseline
    .concat(migrations)
    .map((f) => ({ name: path.posix.basename(f), path: f }))
    .filter((step) => !applied.has(step.name));
}

function isRemoteHost(databaseUrl) {
  let host;
  try {
    // A fully qualified name may end in dots (db.x.supabase.co.); it is the same host.
    host = new URL(databaseUrl).hostname.toLowerCase().replace(/\.+$/, '');
  } catch {
    return false;
  }
  return host === 'supabase.co' || host.endsWith('.supabase.co');
}

function defaultCreateClient(connectionString) {
  // Loaded here so the plan and its tests need no database driver.
  const { Client } = require('pg');
  return new Client({ connectionString });
}

async function runMigrations({
  env = process.env,
  root = path.resolve(__dirname, '..', '..'),
  fs = require('node:fs'),
  createClient = defaultCreateClient,
  log = console.log,
  error = console.error,
} = {}) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    error('DATABASE_URL is not set');
    return 1;
  }
  if (isRemoteHost(databaseUrl) && env.MIGRATE_ALLOW_REMOTE !== '1') {
    error('refusing a *.supabase.co host; set MIGRATE_ALLOW_REMOTE=1 to run against it');
    return 1;
  }

  const files = [BASELINE].concat(
    fs.readdirSync(path.join(root, MIGRATIONS_DIR)).map((name) => MIGRATIONS_DIR + '/' + name),
  );

  const client = createClient(databaseUrl);
  let current = null;
  try {
    await client.connect();
    await client.query('CREATE SCHEMA IF NOT EXISTS cosign_meta');
    await client.query(
      'CREATE TABLE IF NOT EXISTS cosign_meta.schema_migrations ' +
        '(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query('SELECT name FROM cosign_meta.schema_migrations');
    const plan = planMigrations(files, rows.map((r) => r.name));

    for (const step of plan) {
      current = step;
      const sql = String(fs.readFileSync(path.join(root, step.path), 'utf8'));
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO cosign_meta.schema_migrations (name) VALUES ($1)', [step.name]);
      await client.query('COMMIT');
      log('applied ' + step.name);
    }
    current = null;
    log(plan.length ? 'done: ' + plan.length + ' applied' : 'nothing to apply');
    return 0;
  } catch (err) {
    if (current) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // the connection is gone; the transaction is rolled back with it
      }
      error('failed at ' + current.name + ': ' + (err && err.message));
    } else {
      error('migration setup failed: ' + (err && err.message));
    }
    return 1;
  } finally {
    try {
      await client.end();
    } catch {
      // nothing left to close
    }
  }
}

if (require.main === module) {
  // Named here, not left to the default, so scripts/envSync.js sees both reads.
  runMigrations({
    env: { DATABASE_URL: process.env.DATABASE_URL, MIGRATE_ALLOW_REMOTE: process.env.MIGRATE_ALLOW_REMOTE },
  }).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { planMigrations, runMigrations, isRemoteHost };
