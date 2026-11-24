/**
 * The row-level-security check's list of cases and the checker that finds
 * leaks. Each case is one role (anon, or authenticated as user B) trying one
 * action on org A's rows; a runner (not here) binds `params` to $1, $2, ...,
 * runs `sql` as that role and records, by case id, the rows returned or
 * affected and whether the database refused the statement (SQLSTATE 42501):
 *
 *   results = { [case.id]: { rowCount, denied } }
 *
 * Four kinds of 'none' case, each of which must touch 0 rows (a refusal counts
 * as 0):
 *   - select, update, delete on org A's rows in every table that holds an
 *     organisation's data, both storage buckets, and the two tables no client
 *     may reach at all (app_config, beta_signups);
 *   - insert: a new row that would belong to org A (or, for app_config and
 *     beta_signups, any new row);
 *   - move: user B updating one of their own rows so that it points into
 *     org A (a document's org_id, a fill session's document_id).
 * 'refused' cases call a database function with org A's ids and pass only on
 * a permission denial: every such function is meant to be callable by the
 * service role alone. 'some' cases (user B selecting their own document,
 * organisation, membership and chat history row) must see a row, so a check
 * whose role sees nothing at all cannot pass by accident.
 *
 * Inserts and moves have no RETURNING: with RETURNING the new row must also
 * pass the table's SELECT policies, and failing them raises the same 42501 as
 * a refused write, so a write that went through would be counted as refused.
 * Their row count comes from the command itself.
 */

const ROLES = ['anon', 'authenticated'];

// Each target names the seeded value bound to $1 and the WHERE clause that
// picks org A's rows by it. Each WHERE reads only its own table: a subquery on
// another table would run under the tested role's policies there, and a
// locked-down parent would hide a leak in the child. `name` tells apart two
// targets on one table (the two buckets); `key` is the column the statements
// return, where the table has no id.
const TARGETS = [
  { table: 'public.documents', param: 'orgADocumentId', where: 'id = $1' },
  { table: 'public.fields', param: 'orgADocumentId', where: 'document_id = $1' },
  { table: 'public.fill_sessions', param: 'orgADocumentId', where: 'document_id = $1' },
  { table: 'public.session_fields', param: 'orgASessionId', where: 'session_id = $1' },
  { table: 'public.audit_log', param: 'orgADocumentId', where: 'document_id = $1' },
  { table: 'storage.objects', param: 'orgAObjectName', where: 'name = $1' },
  { table: 'storage.objects', name: 'filled-documents', param: 'orgAFilledObjectName', where: 'name = $1' },
  { table: 'public.organizations', param: 'orgAId', where: 'id = $1' },
  { table: 'public.org_memberships', param: 'orgAId', where: 'org_id = $1' },
  { table: 'public.chat_history', param: 'orgADocumentId', where: 'document_id = $1' },
  // Not an organisation's data: read by /api/health and written by
  // POST /api/beta, both with the service role. No client may touch them.
  { table: 'public.app_config', param: 'appConfigKey', where: 'key = $1', key: 'key' },
  { table: 'public.beta_signups', param: 'betaSignupId', where: 'id = $1' },
];

const SQL = {
  select: (t) => `SELECT ${t.key || 'id'} FROM ${t.table} WHERE ${t.where}`,
  update: (t) => `UPDATE ${t.table} SET ${t.key || 'id'} = ${t.key || 'id'} WHERE ${t.where} RETURNING ${t.key || 'id'}`,
  delete: (t) => `DELETE FROM ${t.table} WHERE ${t.where} RETURNING ${t.key || 'id'}`,
};

// New rows, as { column: param }. Each would belong to org A (or, for the last
// two tables, is a row no client may add). user B's own id goes where a policy
// compares the row with auth.uid(), as an attacker would put it; every other
// value is valid, so the only thing that can stop the insert is the policy.
const INSERTS = [
  {
    table: 'public.documents',
    row: {
      id: 'probeDocumentId',
      org_id: 'orgAId',
      user_id: 'userBId',
      created_by: 'userBId',
      file_name: 'probeText',
      file_path: 'probeText',
      file_url: 'probeText',
    },
  },
  {
    table: 'public.fields',
    row: { id: 'probeFieldId', document_id: 'orgADocumentId', field_name: 'probeText', sort_order: 'probeSortOrder' },
  },
  {
    table: 'public.fill_sessions',
    row: {
      id: 'probeSessionId',
      document_id: 'orgADocumentId',
      client_user_id: 'userBId',
      token_hash: 'probeTokenHash',
    },
  },
  {
    table: 'public.audit_log',
    row: {
      id: 'probeAuditLogId',
      action: 'probeText',
      entity_type: 'probeText',
      actor_type: 'probeText',
      actor_id: 'userBId',
      session_id: 'orgASessionId',
      document_id: 'orgADocumentId',
    },
  },
  // The escalation that matters most: user B making themselves org A's admin.
  {
    table: 'public.org_memberships',
    row: {
      id: 'probeMembershipId',
      org_id: 'orgAId',
      user_id: 'userBId',
      role: 'adminRole',
      status: 'activeStatus',
    },
  },
  {
    table: 'public.chat_history',
    row: { id: 'probeChatHistoryId', user_id: 'userBId', document_id: 'orgADocumentId', message: 'probeText' },
  },
  {
    table: 'storage.objects',
    row: { id: 'probeDocumentsObjectId', bucket_id: 'documentsBucket', name: 'probeDocumentsObjectName' },
  },
  {
    table: 'storage.objects',
    name: 'filled-documents',
    row: { id: 'probeFilledObjectId', bucket_id: 'filledBucket', name: 'probeFilledObjectName' },
  },
  { table: 'public.app_config', row: { key: 'probeAppConfigKey', value: 'probeText' } },
  { table: 'public.beta_signups', row: { id: 'probeBetaSignupId', email: 'probeEmail' } },
];

// user B's own row, repointed into org A. The WHERE picks user B's row by its
// own id; the SET is the move.
const MOVES = [
  { table: 'public.documents', set: 'org_id', to: 'orgAId', param: 'userBDocumentId' },
  { table: 'public.fill_sessions', set: 'document_id', to: 'orgADocumentId', param: 'userBSessionId' },
];

// Every function a migration or SUPABASE-SETUP.sql defines that takes another
// row's id, with org A's ids (and user B's) as its arguments. Each is meant to
// be executable by the service role only (20260728170000, 20261119100000,
// 20261119100200).
const FUNCTIONS = [
  {
    name: 'public.increment_completion_count',
    args: [['orgADocumentId', 'uuid']],
  },
  {
    name: 'public.enterprise_finalize_setup_tx',
    args: [
      ['orgADocumentId', 'uuid'],
      ['orgAId', 'uuid'],
      ['userBId', 'uuid'],
      ['language', 'text'],
      ['emptyJsonObject', 'jsonb'],
      ['emptyJsonArray', 'jsonb'],
    ],
  },
  {
    name: 'public.enterprise_duplicate_template_tx',
    args: [
      ['orgADocumentId', 'uuid'],
      ['orgAId', 'uuid'],
      ['userBId', 'uuid'],
      ['probeText', 'text'],
      ['probeText', 'text'],
      ['probeText', 'text'],
    ],
  },
];

// user B's own rows, which user B must see.
const POSITIVES = [
  { table: 'public.documents', param: 'userBDocumentId' },
  { table: 'public.organizations', param: 'userBOrgId' },
  { table: 'public.org_memberships', param: 'userBMembershipId' },
  { table: 'public.chat_history', param: 'userBChatHistoryId' },
];

function caseId(role, action, target, suffix) {
  return [role, action, target.table, target.name, suffix].filter(Boolean).join(':');
}

function buildCases() {
  const cases = [];
  for (const role of ROLES) {
    for (const target of TARGETS) {
      for (const action of Object.keys(SQL)) {
        cases.push({
          id: caseId(role, action, target),
          role,
          table: target.table,
          action,
          sql: SQL[action](target),
          params: [target.param],
          expect: 'none',
        });
      }
    }
    for (const target of INSERTS) {
      const columns = Object.keys(target.row);
      cases.push({
        id: caseId(role, 'insert', target),
        role,
        table: target.table,
        action: 'insert',
        sql: `INSERT INTO ${target.table} (${columns.join(', ')}) VALUES (${columns
          .map((_, i) => `$${i + 1}`)
          .join(', ')})`,
        params: columns.map((c) => target.row[c]),
        expect: 'none',
      });
    }
    for (const move of MOVES) {
      cases.push({
        id: caseId(role, 'update', move, `move-${move.set}`),
        role,
        table: move.table,
        action: 'update',
        sql: `UPDATE ${move.table} SET ${move.set} = $1 WHERE id = $2`,
        params: [move.to, move.param],
        expect: 'none',
      });
    }
    for (const fn of FUNCTIONS) {
      cases.push({
        id: `${role}:execute:${fn.name}`,
        role,
        table: fn.name,
        action: 'execute',
        sql: `SELECT ${fn.name}(${fn.args.map(([, type], i) => `$${i + 1}::${type}`).join(', ')})`,
        params: fn.args.map(([param]) => param),
        expect: 'refused',
      });
    }
  }
  for (const own of POSITIVES) {
    cases.push({
      id: `authenticated:select:${own.table}:own`,
      role: 'authenticated',
      table: own.table,
      action: 'select',
      sql: `SELECT id FROM ${own.table} WHERE id = $1`,
      params: [own.param],
      expect: 'some',
    });
  }
  return cases;
}

function failure(c, result) {
  if (c.expect === 'some') {
    return result.rowCount < 1 ? `${c.role} ${c.action} on ${c.table} saw no rows, expected some` : null;
  }
  if (c.expect === 'refused') {
    return result.denied === true
      ? null
      : `${c.role} ${c.action} on ${c.table} ran (${result.rowCount} row(s)), expected a permission denial`;
  }
  return result.rowCount !== 0 ? `${c.role} ${c.action} on ${c.table} touched ${result.rowCount} row(s)` : null;
}

// Returns one leak entry per failing case; [] when every case behaved.
function checkResults(cases, results) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('rlsCases: no cases to check');
  }
  const leaks = [];
  for (const c of cases) {
    const result = results && results[c.id];
    // A row count is a whole number of rows; NaN or Infinity from a broken
    // runner is no result, never a pass.
    if (!result || !Number.isSafeInteger(result.rowCount) || result.rowCount < 0) {
      throw new Error(`rlsCases: no result for case ${c.id}`);
    }
    const message = failure(c, result);
    if (message) {
      leaks.push({
        id: c.id,
        role: c.role,
        action: c.action,
        table: c.table,
        rowCount: result.rowCount,
        message,
      });
    }
  }
  return leaks;
}

module.exports = { buildCases, checkResults };
