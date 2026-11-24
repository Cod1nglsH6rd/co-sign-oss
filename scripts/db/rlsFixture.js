/**
 * The row-level-security check's seed rows: two users, two orgs with one
 * membership each, and per org one document with one field, one fill session,
 * one session field, one audit_log row, one chat_history row and one storage
 * object in each bucket. User A belongs to org A and user B to org B, so the
 * cases in rlsCases.js can have user B try org A's rows. One app_config row
 * and one beta_signups row are seeded too: neither belongs to an org, and
 * neither may be reached by anon or user B at all.
 *
 * buildFixture(ids?) returns { statements, ids }: statements are single-row
 * INSERTs as { text, values }, in foreign-key order, for a runner (not here)
 * to execute as a role that bypasses RLS. Every value is a parameter.
 *
 * ids also holds the probe ids (probe*): ids for the rows the insert cases try
 * to add. No statement here uses them; they are fresh so that a leaking insert
 * fails on nothing but row-level security (no duplicate key, no sequence).
 *
 * fields, session_fields, audit_log and chat_history have bigserial ids
 * (SUPABASE-SETUP.sql), so those ids are whole numbers as strings; every other
 * id is a UUID.
 */

const crypto = require('crypto');

// The buckets created in supabase/migrations (20261119100100).
const BUCKETS = { documentsObject: 'documents', filledObject: 'filled-documents' };

const UUID_KEYS = ['user', 'org', 'membership', 'document', 'session', ...Object.keys(BUCKETS)];
const BIGINT_KEYS = ['field', 'sessionField', 'auditLog', 'chatHistory'];
const SIDES = ['A', 'B'];

// One of each, not one per side.
const SINGLE_UUID_KEYS = [
  'appConfig',
  'betaSignup',
  'probeDocument',
  'probeSession',
  'probeMembership',
  'probeDocumentsObject',
  'probeFilledObject',
  'probeAppConfig',
  'probeBetaSignup',
];
const SINGLE_BIGINT_KEYS = ['probeField', 'probeAuditLog', 'probeChatHistory'];

function keys(names) {
  return names.flatMap((n) => SIDES.map((s) => `${n}${s}`));
}

function freshIds() {
  const ids = {};
  for (const k of [...keys(UUID_KEYS), ...SINGLE_UUID_KEYS]) ids[k] = crypto.randomUUID();
  // Kept below 2^48 so a JavaScript number could still hold it.
  for (const k of [...keys(BIGINT_KEYS), ...SINGLE_BIGINT_KEYS]) {
    ids[k] = String(crypto.randomInt(1, 2 ** 48 - 1));
  }
  return ids;
}

function insert(table, row) {
  const columns = Object.keys(row);
  const params = columns.map((_, i) => `$${i + 1}`);
  return {
    text: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${params.join(', ')})`,
    values: columns.map((c) => row[c]),
  };
}

function buildFixture(given = {}) {
  const ids = freshIds();
  for (const [key, value] of Object.entries(given)) {
    if (!(key in ids)) throw new Error(`rlsFixture: unknown id key ${key}`);
    ids[key] = value;
  }

  const statements = [];
  for (const s of SIDES) {
    statements.push(
      insert('auth.users', {
        id: ids[`user${s}`],
        email: `rls-${ids[`user${s}`]}@example.com`,
        aud: 'authenticated',
        role: 'authenticated',
      })
    );
  }
  for (const s of SIDES) {
    statements.push(insert('public.organizations', { id: ids[`org${s}`], name: `RLS fixture org ${s}` }));
  }
  for (const s of SIDES) {
    statements.push(
      insert('public.org_memberships', {
        id: ids[`membership${s}`],
        org_id: ids[`org${s}`],
        user_id: ids[`user${s}`],
        role: 'admin',
        status: 'active',
      })
    );
  }
  for (const s of SIDES) {
    const org = ids[`org${s}`];
    const user = ids[`user${s}`];
    const doc = ids[`document${s}`];
    const session = ids[`session${s}`];
    const path = `${org}/${doc}.pdf`;
    statements.push(
      insert('public.documents', {
        id: doc,
        org_id: org,
        user_id: user,
        created_by: user,
        file_name: `rls-fixture-${s}.pdf`,
        file_path: path,
        file_url: path,
      }),
      insert('public.fields', {
        id: ids[`field${s}`],
        document_id: doc,
        field_name: `rls fixture field ${s}`,
        sort_order: 1,
      }),
      insert('public.fill_sessions', {
        id: session,
        document_id: doc,
        client_user_id: user,
        token_hash: `rls-fixture-${session}`,
      }),
      insert('public.session_fields', {
        id: ids[`sessionField${s}`],
        session_id: session,
        field_id: ids[`field${s}`],
      }),
      insert('public.audit_log', {
        id: ids[`auditLog${s}`],
        action: 'created',
        entity_type: 'fill_session',
        entity_id: session,
        actor_type: 'client',
        actor_id: user,
        session_id: session,
        document_id: doc,
      }),
      // user_id is the auth uid as text, as saveChatMessage writes it.
      insert('public.chat_history', {
        id: ids[`chatHistory${s}`],
        user_id: user,
        document_id: doc,
        message: `rls fixture message ${s}`,
        response: `rls fixture response ${s}`,
      }),
      insert('storage.objects', {
        id: ids[`documentsObject${s}`],
        bucket_id: BUCKETS.documentsObject,
        name: path,
      }),
      // Filled PDFs live under the document id, as complete.js uploads them
      // and as the filled-documents policies read them.
      insert('storage.objects', {
        id: ids[`filledObject${s}`],
        bucket_id: BUCKETS.filledObject,
        name: `${doc}/${session}-filled.pdf`,
      })
    );
  }
  // app_config is keyed by text; 20261119100300 deleted its last rows, so
  // without this one a select that sees nothing would prove nothing.
  statements.push(
    insert('public.app_config', { key: `rls-fixture-${ids.appConfig}`, value: 'rls fixture value' }),
    insert('public.beta_signups', { id: ids.betaSignup, email: `rls-${ids.betaSignup}@example.com` })
  );
  return { statements, ids };
}

module.exports = { buildFixture };
