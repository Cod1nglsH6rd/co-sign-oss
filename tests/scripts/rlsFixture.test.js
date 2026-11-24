/**
 * scripts/db/rlsFixture.js builds the parameterised INSERTs that seed the
 * row-level-security check: two users, two orgs with one membership each, per
 * org one document with its child rows (chat history included) and one
 * storage object per bucket, and one app_config and one beta_signups row.
 * Nothing here touches a database: statements are plain {text, values}.
 */

function load() {
  return require('../../scripts/db/rlsFixture');
}

const FIXED = {
  userA: '11111111-1111-4111-8111-111111111111',
  userB: '22222222-2222-4222-8222-222222222222',
  orgA: '33333333-3333-4333-8333-333333333333',
  orgB: '44444444-4444-4444-8444-444444444444',
  membershipA: '55555555-5555-4555-8555-555555555555',
  membershipB: '66666666-6666-4666-8666-666666666666',
  documentA: '77777777-7777-4777-8777-777777777777',
  documentB: '88888888-8888-4888-8888-888888888888',
  fieldA: '900000001',
  fieldB: '900000002',
  sessionA: '99999999-9999-4999-8999-999999999999',
  sessionB: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sessionFieldA: '900000003',
  sessionFieldB: '900000004',
  auditLogA: '900000005',
  auditLogB: '900000006',
  documentsObjectA: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  documentsObjectB: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  filledObjectA: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  filledObjectB: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  chatHistoryA: '900000007',
  chatHistoryB: '900000008',
  appConfig: 'f0000001-0000-4000-8000-000000000001',
  betaSignup: 'f0000002-0000-4000-8000-000000000002',
  probeDocument: 'f0000003-0000-4000-8000-000000000003',
  probeSession: 'f0000004-0000-4000-8000-000000000004',
  probeMembership: 'f0000005-0000-4000-8000-000000000005',
  probeDocumentsObject: 'f0000006-0000-4000-8000-000000000006',
  probeFilledObject: 'f0000007-0000-4000-8000-000000000007',
  probeAppConfig: 'f0000008-0000-4000-8000-000000000008',
  probeBetaSignup: 'f0000009-0000-4000-8000-000000000009',
  probeField: '900000009',
  probeAuditLog: '900000010',
  probeChatHistory: '900000011',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Reads `INSERT INTO table (a, b) VALUES ($1, $2)` back into a row object, so
// the tests check what each column really receives.
function parse(statement) {
  const m = statement.text.match(/^\s*INSERT INTO\s+(\S+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i);
  if (!m) throw new Error(`not a single-row INSERT: ${statement.text}`);
  const columns = m[2].split(',').map((c) => c.trim());
  const params = m[3].split(',').map((p) => p.trim());
  const row = {};
  columns.forEach((col, i) => {
    const pm = params[i].match(/^\$(\d+)$/);
    if (!pm) throw new Error(`column ${col} is not a parameter: ${params[i]}`);
    row[col] = statement.values[Number(pm[1]) - 1];
  });
  return { table: m[1], row };
}

function rows(fixture) {
  return fixture.statements.map((s, index) => ({ index, ...parse(s) }));
}

function find(all, table, id) {
  const found = all.filter((r) => r.table === table && String(r.row.id) === String(id));
  expect(found).toHaveLength(1);
  return found[0];
}

describe('buildFixture', () => {
  test('inserts two users, two orgs and one membership per org', () => {
    const all = rows(load().buildFixture(FIXED));
    expect(all.filter((r) => r.table === 'auth.users')).toHaveLength(2);
    expect(all.filter((r) => r.table === 'public.organizations')).toHaveLength(2);
    expect(find(all, 'public.org_memberships', FIXED.membershipA).row).toMatchObject({
      org_id: FIXED.orgA,
      user_id: FIXED.userA,
    });
    expect(find(all, 'public.org_memberships', FIXED.membershipB).row).toMatchObject({
      org_id: FIXED.orgB,
      user_id: FIXED.userB,
    });
  });

  test("each org's rows point to that org's ids", () => {
    const all = rows(load().buildFixture(FIXED));
    for (const s of ['A', 'B']) {
      const org = FIXED[`org${s}`];
      const doc = FIXED[`document${s}`];
      const session = FIXED[`session${s}`];
      expect(find(all, 'public.documents', doc).row.org_id).toBe(org);
      expect(find(all, 'public.fields', FIXED[`field${s}`]).row.document_id).toBe(doc);
      expect(find(all, 'public.fill_sessions', session).row.document_id).toBe(doc);
      expect(find(all, 'public.session_fields', FIXED[`sessionField${s}`]).row).toMatchObject({
        session_id: session,
        field_id: FIXED[`field${s}`],
      });
      expect(find(all, 'public.audit_log', FIXED[`auditLog${s}`]).row).toMatchObject({
        document_id: doc,
        session_id: session,
      });
      // Storage policies read the owner from the first folder of the name:
      // the org for `documents`, the document for `filled-documents`.
      const docObject = find(all, 'storage.objects', FIXED[`documentsObject${s}`]).row;
      expect(docObject.name.split('/')[0]).toBe(org);
      const filledObject = find(all, 'storage.objects', FIXED[`filledObject${s}`]).row;
      expect(filledObject.name.split('/')[0]).toBe(doc);
    }
  });

  test('every child row comes after the rows its foreign keys point to', () => {
    const all = rows(load().buildFixture(FIXED));
    const at = (table, id) => find(all, table, id).index;
    const users = [FIXED.userA, FIXED.userB].map((id) => at('auth.users', id));
    const orgs = [FIXED.orgA, FIXED.orgB].map((id) => at('public.organizations', id));
    const memberships = [FIXED.membershipA, FIXED.membershipB].map((id) =>
      at('public.org_memberships', id)
    );
    for (const m of memberships) {
      expect(m).toBeGreaterThan(Math.max(...users, ...orgs));
    }
    for (const s of ['A', 'B']) {
      const doc = at('public.documents', FIXED[`document${s}`]);
      expect(doc).toBeGreaterThan(Math.max(...users, ...orgs, ...memberships));
      const field = at('public.fields', FIXED[`field${s}`]);
      const session = at('public.fill_sessions', FIXED[`session${s}`]);
      expect(field).toBeGreaterThan(doc);
      expect(session).toBeGreaterThan(doc);
      expect(at('public.session_fields', FIXED[`sessionField${s}`])).toBeGreaterThan(
        Math.max(field, session)
      );
      expect(at('public.audit_log', FIXED[`auditLog${s}`])).toBeGreaterThan(session);
      expect(at('storage.objects', FIXED[`documentsObject${s}`])).toBeGreaterThan(doc);
      expect(at('storage.objects', FIXED[`filledObject${s}`])).toBeGreaterThan(session);
    }
  });

  test("each org has one chat_history row on its document, owned by its user (uid as text), after the document", () => {
    const all = rows(load().buildFixture(FIXED));
    expect(all.filter((r) => r.table === 'public.chat_history')).toHaveLength(2);
    for (const s of ['A', 'B']) {
      const chat = find(all, 'public.chat_history', FIXED[`chatHistory${s}`]);
      expect(chat.row).toMatchObject({ document_id: FIXED[`document${s}`], user_id: FIXED[`user${s}`] });
      expect(chat.index).toBeGreaterThan(find(all, 'public.documents', FIXED[`document${s}`]).index);
    }
  });

  // 20261119100300 deleted app_config's last rows: a select that sees nothing
  // on an empty table would prove nothing.
  test('seeds one app_config row and one beta_signups row', () => {
    const all = rows(load().buildFixture(FIXED));
    const config = all.filter((r) => r.table === 'public.app_config');
    expect(config).toHaveLength(1);
    expect(config[0].row.key).toContain(FIXED.appConfig);
    expect(typeof config[0].row.value).toBe('string');
    const beta = find(all, 'public.beta_signups', FIXED.betaSignup);
    expect(beta.row.email).toContain(FIXED.betaSignup);
  });

  // The probe ids are for the rows the insert cases try to add, so no seeded
  // row may already hold one (a duplicate key would fail the insert for a
  // reason other than row-level security).
  test('no statement uses a probe id', () => {
    const { statements, ids } = load().buildFixture(FIXED);
    const probes = Object.keys(ids).filter((k) => k.startsWith('probe'));
    expect(probes.sort()).toEqual(Object.keys(FIXED).filter((k) => k.startsWith('probe')).sort());
    for (const s of statements) {
      for (const k of probes) {
        expect(s.values.some((v) => String(v).includes(ids[k]))).toBe(false);
      }
    }
  });

  test('both buckets get one object per org', () => {
    const all = rows(load().buildFixture(FIXED));
    const objects = all.filter((r) => r.table === 'storage.objects');
    const pairs = objects.map((o) => `${o.row.bucket_id}:${o.row.name.split('/')[0]}`).sort();
    expect(pairs).toEqual(
      [
        `documents:${FIXED.orgA}`,
        `documents:${FIXED.orgB}`,
        `filled-documents:${FIXED.documentA}`,
        `filled-documents:${FIXED.documentB}`,
      ].sort()
    );
  });

  test('no value is written into the SQL text', () => {
    const { statements } = load().buildFixture(FIXED);
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      expect(s.text).not.toMatch(/'/);
      const placeholders = new Set(s.text.match(/\$\d+/g));
      expect(placeholders.size).toBe(s.values.length);
      const bare = s.text.replace(/\$\d+/g, '');
      for (const v of s.values) {
        expect(bare).not.toContain(String(v));
      }
    }
  });

  test('returns the ids it was given', () => {
    const { ids } = load().buildFixture(FIXED);
    expect(ids).toEqual(FIXED);
  });

  test('makes fresh ids when none are passed', () => {
    const { buildFixture } = load();
    const first = buildFixture();
    const second = buildFixture();
    expect(Object.keys(first.ids).sort()).toEqual(Object.keys(FIXED).sort());
    for (const key of Object.keys(FIXED)) {
      expect(first.ids[key]).not.toBe(second.ids[key]);
      if (UUID_RE.test(FIXED[key])) expect(first.ids[key]).toMatch(UUID_RE);
      else expect(String(first.ids[key])).toMatch(/^[1-9]\d*$/);
    }
    // The fresh ids are the ones the statements use.
    const all = rows(first);
    expect(find(all, 'public.documents', first.ids.documentA).row.org_id).toBe(first.ids.orgA);
  });

  test('refuses an id key it does not know', () => {
    expect(() => load().buildFixture({ orgC: FIXED.orgA })).toThrow(/orgC/);
  });
});
