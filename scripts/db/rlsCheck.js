/**
 * The row-level-security check's pure parts: the seeded values, probe ids and
 * constants the cases in rlsCases.js bind to $1, $2, ... (caseParams), the
 * ordered statements the runner
 * (runRlsCheck) executes for one case inside its open transaction (caseSteps), and
 * whether a database error is a permission denial (isPermissionError).
 *
 * Steps are { text, values }. Each case runs between a savepoint and its
 * rollback, so a leaking UPDATE or DELETE never outlives its case and the
 * role and claims set with SET LOCAL / set_config(..., true) stay scoped to
 * the runner's transaction.
 *
 * runRlsCheck is the script entry. It refuses a missing DATABASE_URL, and a
 * DATABASE_URL on a *.supabase.co host unless MIGRATE_ALLOW_REMOTE=1, before
 * any client is created. Past the guards it opens one transaction, inserts
 * the fixture as the connecting role, runs every case as anon or user B,
 * records each case's row count and whether it was refused with 42501, and
 * always ends with ROLLBACK, so nothing it wrote is kept. It returns 1 on a
 * leak or on any error, 0 when every case behaved.
 *
 * Usage: DATABASE_URL=postgres://... node scripts/db/rlsCheck.js
 */

const { isRemoteHost } = require('./migrate');
const { buildCases, checkResults } = require('./rlsCases');
const { buildFixture } = require('./rlsFixture');

const ROLES = ['anon', 'authenticated'];

// The value of `name` in the fixture's single-row INSERT INTO `table` whose
// `match` column is `value` (by default: whose id is `value`); undefined when
// there is no such row.
function insertedValue(statements, table, value, name, match = 'id') {
  const prefix = `INSERT INTO ${table} (`;
  for (const s of statements || []) {
    if (!s || typeof s.text !== 'string' || !s.text.startsWith(prefix)) continue;
    const columns = s.text.slice(prefix.length, s.text.indexOf(')')).split(', ');
    const matchAt = columns.indexOf(match);
    const nameAt = columns.indexOf(name);
    if (matchAt === -1 || nameAt === -1 || s.values[matchAt] !== value) continue;
    return s.values[nameAt];
  }
  return undefined;
}

// The one app_config key the fixture inserted; undefined when there is none.
function insertedAppConfigKey(statements) {
  const prefix = 'INSERT INTO public.app_config (';
  const found = (statements || []).filter((s) => s && typeof s.text === 'string' && s.text.startsWith(prefix));
  if (found.length !== 1) return undefined;
  const columns = found[0].text.slice(prefix.length, found[0].text.indexOf(')')).split(', ');
  return found[0].values[columns.indexOf('key')];
}

function caseParams(fixture) {
  const ids = (fixture && fixture.ids) || {};
  const statements = fixture && fixture.statements;
  const objectName = (id) => (id ? insertedValue(statements, 'storage.objects', id, 'name') : undefined);
  const params = {
    orgAId: ids.orgA,
    orgADocumentId: ids.documentA,
    orgASessionId: ids.sessionA,
    orgAObjectName: objectName(ids.documentsObjectA),
    orgAFilledObjectName: objectName(ids.filledObjectA),
    userBId: ids.userB,
    userBOrgId: ids.orgB,
    userBMembershipId: ids.membershipB,
    userBDocumentId: ids.documentB,
    userBSessionId: ids.sessionB,
    userBChatHistoryId: ids.chatHistoryB,
    appConfigKey: insertedAppConfigKey(statements),
    betaSignupId: ids.betaSignup,
    // The rows the insert cases try to add: org A's paths, fresh ids.
    probeDocumentId: ids.probeDocument,
    probeFieldId: ids.probeField,
    probeSessionId: ids.probeSession,
    probeTokenHash: ids.probeSession ? `rls-probe-${ids.probeSession}` : undefined,
    probeAuditLogId: ids.probeAuditLog,
    probeMembershipId: ids.probeMembership,
    probeChatHistoryId: ids.probeChatHistory,
    probeDocumentsObjectId: ids.probeDocumentsObject,
    probeDocumentsObjectName:
      ids.orgA && ids.probeDocumentsObject ? `${ids.orgA}/${ids.probeDocumentsObject}.pdf` : undefined,
    probeFilledObjectId: ids.probeFilledObject,
    probeFilledObjectName:
      ids.documentA && ids.probeFilledObject ? `${ids.documentA}/${ids.probeFilledObject}-filled.pdf` : undefined,
    probeAppConfigKey: ids.probeAppConfig ? `rls-probe-${ids.probeAppConfig}` : undefined,
    probeBetaSignupId: ids.probeBetaSignup,
    probeEmail: ids.probeBetaSignup ? `rls-probe-${ids.probeBetaSignup}@example.com` : undefined,
    // Constants, bound like every other value.
    probeText: 'rls probe',
    probeSortOrder: '2',
    adminRole: 'admin',
    activeStatus: 'active',
    documentsBucket: 'documents',
    filledBucket: 'filled-documents',
    language: 'en',
    emptyJsonObject: '{}',
    emptyJsonArray: '[]',
  };
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string' || value === '') {
      throw new Error(`rlsCheck: fixture has no value for ${key}`);
    }
  }
  return params;
}

function caseSteps(c, params, userBId) {
  if (!ROLES.includes(c.role)) throw new Error(`rlsCheck: unknown role ${c.role} in case ${c.id}`);
  const values = c.params.map((name) => {
    if (!params || !Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(`rlsCheck: no value for param ${name} in case ${c.id}`);
    }
    return params[name];
  });
  const steps = [
    { text: 'SAVEPOINT rls_case', values: [] },
    { text: `SET LOCAL ROLE ${c.role}`, values: [] },
  ];
  if (c.role === 'authenticated') {
    steps.push({
      text: "SELECT set_config('request.jwt.claims', $1, true)",
      values: [JSON.stringify({ sub: userBId, role: 'authenticated' })],
    });
  }
  steps.push({ text: c.sql, values }, { text: 'ROLLBACK TO SAVEPOINT rls_case', values: [] });
  return steps;
}

// 42501 is Postgres's insufficient_privilege: the role may not touch the table
// at all. Any other error (42P01 undefined_table, say) is a broken check.
function isPermissionError(err) {
  return Boolean(err) && err.code === '42501';
}

function defaultCreateClient(connectionString) {
  // Loaded here so the pure parts and their tests need no database driver.
  const { Client } = require('pg');
  return new Client({ connectionString });
}

async function runRlsCheck({
  env = process.env,
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
  const client = createClient(databaseUrl);
  let current = null;
  try {
    await client.connect();
    await client.query('BEGIN');
    const fixture = buildFixture();
    for (const s of fixture.statements) {
      await client.query({ text: s.text, values: s.values });
    }
    const params = caseParams(fixture);
    const cases = buildCases();
    const results = {};
    for (const c of cases) {
      current = c;
      for (const step of caseSteps(c, params, fixture.ids.userB)) {
        if (step.text !== c.sql) {
          await client.query({ text: step.text, values: step.values });
          continue;
        }
        try {
          const res = await client.query({ text: step.text, values: step.values });
          results[c.id] = { rowCount: res.rowCount, denied: false };
        } catch (err) {
          if (!isPermissionError(err)) throw err;
          // The denial aborted the case; its savepoint brings the transaction back.
          await client.query({ text: 'ROLLBACK TO SAVEPOINT rls_case', values: [] });
          results[c.id] = { rowCount: 0, denied: true };
          break;
        }
      }
    }
    current = null;
    const leaks = checkResults(cases, results);
    if (leaks.length === 0) {
      log(`rls check passed: ${cases.length} cases, no leaks`);
      return 0;
    }
    for (const leak of leaks) error(`rls check leak: ${leak.id}: ${leak.message}`);
    return 1;
  } catch (err) {
    const where = current ? ` in case ${current.id}` : '';
    error(`rls check failed${where}: ${(err && err.message) || err}`);
    return 1;
  } finally {
    // Nothing the check wrote is kept; a lost connection already dropped it.
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // swallowed
    }
    try {
      await client.end();
    } catch (_) {
      // swallowed
    }
  }
}

if (require.main === module) {
  // Named here, not left to the default, so scripts/envSync.js sees both reads.
  runRlsCheck({
    env: { DATABASE_URL: process.env.DATABASE_URL, MIGRATE_ALLOW_REMOTE: process.env.MIGRATE_ALLOW_REMOTE },
  }).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { caseParams, caseSteps, isPermissionError, runRlsCheck };
