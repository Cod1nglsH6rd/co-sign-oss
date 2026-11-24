/**
 * Checks on the database schema: offline checks on the schema files, and a
 * read-only check of a live database (introspect, main; run as a script).
 *
 * checkMigrationNames(names): every supabase/migrations file name must start
 * with a 14-digit timestamp (YYYYMMDDHHMMSS), and the timestamps must be
 * unique and strictly increasing in the order given. Returns a list of
 * plain-English problems, each naming the file; [] when all is well.
 */

function checkMigrationNames(names) {
  const problems = [];
  const seen = new Map();
  let previous = null;

  for (const name of names || []) {
    const digits = (/^\d*/.exec(name) || [''])[0];
    if (digits.length !== 14) {
      problems.push(
        `${name} does not start with a 14-digit timestamp (found ${digits.length} digits).`
      );
      continue;
    }
    if (seen.has(digits)) {
      problems.push(
        `${name} has the same timestamp ${digits} as ${seen.get(digits)}.`
      );
    } else if (previous && digits < previous.timestamp) {
      problems.push(
        `${name} is out of order: its timestamp ${digits} comes before ${previous.name}.`
      );
    }
    if (!seen.has(digits)) seen.set(digits, name);
    if (!previous || digits > previous.timestamp) {
      previous = { name, timestamp: digits };
    }
  }

  return problems;
}

// Languages with per-language translation columns on `fields`
// (pages/api/ocr.js LANGUAGE_NAMES without en), and the column bases.
const TRANSLATION_LANGUAGES = ['vi', 'es', 'pt', 'fr', 'zh', 'yue', 'ht', 'ne'];
const TRANSLATION_BASES = ['field_name', 'explanation', 'position_hint'];
const FIELD_TRANSLATION_COLUMNS = TRANSLATION_BASES.flatMap((base) =>
  TRANSLATION_LANGUAGES.map((lang) => `${base}_${lang}`)
);

/**
 * EXPECTED: what the app relies on in the database, written by hand from the
 * select/insert/update/upsert/eq calls in pages/, lib/, hooks/ and components/.
 *
 * tables:      table name -> the columns the app reads or writes
 * rpcs:        database functions the app calls with supabase.rpc()
 * buckets:     storage buckets the app reads or writes
 * userData:    tables that must have RLS on and at least one policy
 * serviceOnly: tables with RLS on and no anon or authenticated policy
 *              (only the service role touches them)
 *
 * Billing tables are left out on purpose: the app must not use them.
 */
const EXPECTED = {
  tables: {
    documents: [
      'id', 'user_id', 'org_id', 'created_by', 'file_name', 'file_path',
      'file_url', 'file_size', 'file_type', 'document_type', 'status',
      'processing_status', 'lifecycle_status', 'preferred_language',
      'phase1_data', 'metadata', 'page_count', 'completion_count',
      'has_rect', 'is_multi_party', 'archived_at', 'created_at', 'updated_at',
    ],
    fields: [
      'id', 'document_id', 'field_name', 'field_type', 'field_value',
      'position', 'position_hint', 'explanation', 'sort_order',
      ...FIELD_TRANSLATION_COLUMNS,
    ],
    fill_sessions: [
      'id', 'document_id', 'client_user_id', 'token', 'token_hash', 'status',
      'recipient_email', 'recipient_name', 'recipient_last_name',
      'assigned_role', 'field_filter', 'require_signature',
      'preferred_language', 'send_method', 'embed_origin', 'metadata',
      'verification_token_hash', 'verification_attempts',
      'last_verify_attempt_at', 'verified_at', 'expires_at', 'sent_at',
      'first_opened_at', 'completed_at', 'created_at',
    ],
    session_fields: [
      'id', 'session_id', 'field_id', 'field_value', 'signature_data_url',
      'signature_timestamp', 'filled_at',
    ],
    org_memberships: ['id', 'org_id', 'user_id', 'role', 'status', 'created_at'],
    organizations: ['id', 'name', 'require_recipient_verification', 'retention_days'],
    audit_log: [
      'action', 'entity_type', 'entity_id', 'actor_type', 'actor_id',
      'session_id', 'document_id', 'details', 'ip_address', 'user_agent',
      'timestamp',
    ],
    chat_history: ['user_id', 'document_id', 'message', 'response', 'timestamp'],
    beta_signups: ['id', 'email', 'locale', 'source'],
    app_config: ['key'],
  },
  rpcs: [
    'increment_completion_count',
    'enterprise_finalize_setup_tx',
    'enterprise_duplicate_template_tx',
  ],
  buckets: ['documents', 'filled-documents'],
  userData: [
    'documents',
    'fields',
    'fill_sessions',
    'session_fields',
    'org_memberships',
    'organizations',
    'audit_log',
    'chat_history',
  ],
  serviceOnly: ['beta_signups', 'app_config'],
};

/**
 * scanSourceUsage(text): the tables, database functions and storage buckets
 * a piece of JS source calls, as { tables, rpcs, buckets }, each name listed
 * once. Finds .from('x'), .rpc('x') and storage.from('x') with single, double
 * or back quotes, also when the call is split across lines. A .from that
 * follows `storage` is a bucket, not a table. Calls whose argument is not a
 * plain string (Array.from(list), storage.from(bucket)) are skipped.
 */
const CALL_PATTERN = /(\bstorage\s*)?\.(from|rpc)\(\s*(['"`])([^'"`$\\\s]+)\3/g;

function scanSourceUsage(text) {
  const tables = new Set();
  const rpcs = new Set();
  const buckets = new Set();
  for (const match of String(text || '').matchAll(CALL_PATTERN)) {
    const [, storage, method, , name] = match;
    if (method === 'rpc') rpcs.add(name);
    else if (storage) buckets.add(name);
    else tables.add(name);
  }
  return { tables: [...tables], rpcs: [...rpcs], buckets: [...buckets] };
}

/**
 * compareSchema(introspection, expected = EXPECTED): compares a database
 * described as { columns: [{table, column}], functions: [name],
 * rls: {table: bool}, policies: [{table, name, roles}], buckets: [name] }
 * with what the app needs. Returns a list of plain-English problems, each
 * naming the table, column, function or bucket; [] when all is well.
 * A missing table is reported once, not once per column, and its RLS and
 * policies are not checked. A table missing from rls counts as RLS off. A
 * policy for `public` counts as one for anon and authenticated, since
 * public covers both.
 */
const CLIENT_ROLES = ['anon', 'authenticated', 'public'];

function compareSchema(introspection, expected = EXPECTED) {
  const db = introspection || {};
  const problems = [];

  const columnsByTable = new Map();
  for (const { table, column } of db.columns || []) {
    if (!columnsByTable.has(table)) columnsByTable.set(table, new Set());
    columnsByTable.get(table).add(column);
  }

  for (const [table, columns] of Object.entries(expected.tables || {})) {
    const present = columnsByTable.get(table);
    if (!present) {
      problems.push(`Table ${table} is missing.`);
      continue;
    }
    for (const column of columns) {
      if (!present.has(column)) {
        problems.push(`Column ${table}.${column} is missing.`);
      }
    }
  }

  const functions = new Set(db.functions || []);
  for (const name of expected.rpcs || []) {
    if (!functions.has(name)) problems.push(`Database function ${name} (RPC) is missing.`);
  }

  const buckets = new Set(db.buckets || []);
  for (const name of expected.buckets || []) {
    if (!buckets.has(name)) problems.push(`Storage bucket ${name} is missing.`);
  }

  const rls = db.rls || {};
  const policies = db.policies || [];
  const exists = (table) => columnsByTable.has(table);

  for (const table of [...(expected.userData || []), ...(expected.serviceOnly || [])]) {
    if (exists(table) && rls[table] !== true) {
      problems.push(`Table ${table} has RLS (row level security) turned off.`);
    }
  }

  for (const table of expected.userData || []) {
    if (exists(table) && !policies.some((p) => p.table === table)) {
      problems.push(`Table ${table} has no RLS policies, so no user can reach its rows.`);
    }
  }

  for (const table of expected.serviceOnly || []) {
    if (!exists(table)) continue;
    for (const policy of policies) {
      if (policy.table !== table) continue;
      const open = (policy.roles || []).filter((r) => CLIENT_ROLES.includes(r));
      if (open.length) {
        problems.push(
          `Table ${table} should only be used by the service role, but policy "${policy.name}" lets ${open.join(', ')} in.`
        );
      }
    }
  }

  return problems;
}

/**
 * introspect(client): reads a live database's public schema through client,
 * which has query(sql) returning a promise of {rows} (a pg Client does), and
 * returns the shape compareSchema takes. Read-only catalog queries.
 */
const INTROSPECT_SQL = {
  columns:
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
  functions:
    'SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace ' +
    "WHERE n.nspname = 'public'",
  rls:
    'SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ' +
    "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')",
  // roles is name[], which pg hands back as a string; text[] comes back as an array.
  policies:
    "SELECT tablename, policyname, roles::text[] AS roles FROM pg_policies WHERE schemaname = 'public'",
  buckets: 'SELECT id FROM storage.buckets',
};

async function introspect(client) {
  const rows = async (sql) => (await client.query(sql)).rows;
  const rls = {};
  for (const r of await rows(INTROSPECT_SQL.rls)) rls[r.relname] = r.relrowsecurity === true;
  return {
    columns: (await rows(INTROSPECT_SQL.columns)).map((r) => ({ table: r.table_name, column: r.column_name })),
    functions: (await rows(INTROSPECT_SQL.functions)).map((r) => r.proname),
    rls,
    policies: (await rows(INTROSPECT_SQL.policies)).map((r) => ({
      table: r.tablename,
      name: r.policyname,
      roles: r.roles || [],
    })),
    buckets: (await rows(INTROSPECT_SQL.buckets)).map((r) => r.id),
  };
}

/**
 * main({env, client, log}): checks the database behind client against
 * EXPECTED and logs each problem. Resolves to 0 when there are none, 1 when
 * there are, and 2 (after a usage line, without querying) when
 * env.DATABASE_URL is not set.
 *
 * runCli({env, createClient, log, error}): the script path. Makes a client
 * from DATABASE_URL, connects, runs main and closes the client; 2 when the
 * database cannot be read.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/db/schemaCheck.js
 */
const USAGE = 'Usage: DATABASE_URL=postgres://... node scripts/db/schemaCheck.js';

async function main({ env = {}, client, log = console.log } = {}) {
  if (!env.DATABASE_URL) {
    log(USAGE);
    return 2;
  }
  const problems = compareSchema(await introspect(client));
  for (const problem of problems) log(problem);
  log(problems.length ? `schema check: ${problems.length} problem(s)` : 'schema check: no problems');
  return problems.length ? 1 : 0;
}

function defaultCreateClient(connectionString) {
  // Loaded here so the checks and their tests need no database driver.
  const { Client } = require('pg');
  return new Client({ connectionString });
}

async function runCli({
  env = {},
  createClient = defaultCreateClient,
  log = console.log,
  error = console.error,
} = {}) {
  if (!env.DATABASE_URL) return main({ env, log });
  let client;
  try {
    client = createClient(env.DATABASE_URL);
    await client.connect();
    return await main({ env, client, log });
  } catch (err) {
    error('schema check could not read the database: ' + (err && err.message));
    return 2;
  } finally {
    try {
      if (client) await client.end();
    } catch {
      // nothing left to close
    }
  }
}

if (require.main === module) {
  // Named here, not left to the default, so scripts/envSync.js sees the read.
  runCli({ env: { DATABASE_URL: process.env.DATABASE_URL } }).then((code) => process.exit(code));
}

module.exports = { checkMigrationNames, EXPECTED, scanSourceUsage, compareSchema, introspect, main, runCli };
