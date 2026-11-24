/**
 * scripts/db/rlsCases.js lists the row-level-security cases (who tries what on
 * org A's rows) and checks a runner's row counts for leaks. Nothing here
 * touches a database: results are plain objects keyed by case id.
 */

function load() {
  return require('../../scripts/db/rlsCases');
}

// Every place the select/update/delete cases look: [table, name] where name
// tells apart two targets on one table (the two buckets).
const TARGETS = [
  ['public.documents'],
  ['public.fields'],
  ['public.fill_sessions'],
  ['public.session_fields'],
  ['public.audit_log'],
  ['storage.objects'],
  ['storage.objects', 'filled-documents'],
  ['public.organizations'],
  ['public.org_memberships'],
  ['public.chat_history'],
  ['public.app_config'],
  ['public.beta_signups'],
];
const TABLES = [...new Set(TARGETS.map(([t]) => t))];
const INSERT_TARGETS = [
  ['public.documents'],
  ['public.fields'],
  ['public.fill_sessions'],
  ['public.audit_log'],
  ['public.org_memberships'],
  ['public.chat_history'],
  ['storage.objects'],
  ['storage.objects', 'filled-documents'],
  ['public.app_config'],
  ['public.beta_signups'],
];
const FUNCTIONS = [
  'public.increment_completion_count',
  'public.enterprise_finalize_setup_tx',
  'public.enterprise_duplicate_template_tx',
];
const ROLES = ['anon', 'authenticated'];
const ACTIONS = ['select', 'update', 'delete'];
// The SQL keyword each action's statement starts with.
const KEYWORD = { select: 'select', update: 'update', delete: 'delete', insert: 'insert', execute: 'select' };

const id = (role, action, [table, name]) => [role, action, table, name].filter(Boolean).join(':');

// A clean run: no forbidden case touched a row, every function call was
// refused, the positive cases saw one row each.
function cleanResults(cases) {
  const results = {};
  for (const c of cases) {
    results[c.id] =
      c.expect === 'refused' ? { rowCount: 0, denied: true } : { rowCount: c.expect === 'some' ? 1 : 0, denied: false };
  }
  return results;
}

describe('buildCases', () => {
  // Was 6 tables and 36 cases; widened to every table that holds an
  // organisation's data, the filled-documents bucket, app_config and
  // beta_signups: 12 targets, 72 cases.
  test('every target has select, update and delete cases for both roles, expecting no rows', () => {
    const { buildCases } = load();
    const cases = buildCases();
    for (const target of TARGETS) {
      for (const role of ROLES) {
        for (const action of ACTIONS) {
          const found = cases.filter((c) => c.id === id(role, action, target));
          expect(found).toHaveLength(1);
          expect(found[0]).toMatchObject({ role, action, table: target[0], expect: 'none' });
        }
      }
    }
    const plain = cases.filter((c) => ACTIONS.includes(c.action) && c.expect === 'none' && !/:move-/.test(c.id));
    expect(plain).toHaveLength(72);
  });

  test('every insert target has one insert case per role, expecting no row, with no RETURNING', () => {
    const { buildCases } = load();
    const cases = buildCases();
    for (const target of INSERT_TARGETS) {
      for (const role of ROLES) {
        const found = cases.filter((c) => c.id === id(role, 'insert', target));
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ role, action: 'insert', table: target[0], expect: 'none' });
        expect(found[0].sql.startsWith(`INSERT INTO ${target[0]} (`)).toBe(true);
        // RETURNING would make a write that went through fail the SELECT
        // policies with the same 42501 as a refusal.
        expect(found[0].sql).not.toMatch(/returning/i);
      }
    }
    expect(cases.filter((c) => c.action === 'insert')).toHaveLength(20);
  });

  test("the membership insert has user B join org A as admin; the document one carries org A's org_id", () => {
    const { buildCases } = load();
    const cases = buildCases();
    const columns = (c) => c.sql.slice(c.sql.indexOf('(') + 1, c.sql.indexOf(')')).split(', ');
    const valueOf = (c, column) => c.params[columns(c).indexOf(column)];
    const membership = cases.find((c) => c.id === 'authenticated:insert:public.org_memberships');
    expect(valueOf(membership, 'org_id')).toBe('orgAId');
    expect(valueOf(membership, 'user_id')).toBe('userBId');
    expect(valueOf(membership, 'role')).toBe('adminRole');
    const doc = cases.find((c) => c.id === 'authenticated:insert:public.documents');
    expect(valueOf(doc, 'org_id')).toBe('orgAId');
    for (const table of ['public.fields', 'public.fill_sessions', 'public.chat_history']) {
      expect(valueOf(cases.find((c) => c.id === `authenticated:insert:${table}`), 'document_id')).toBe('orgADocumentId');
    }
  });

  test("move cases repoint user B's own document and fill session into org A, with no RETURNING", () => {
    const { buildCases } = load();
    const moves = buildCases().filter((c) => /:move-/.test(c.id));
    expect(moves.map((c) => c.id).sort()).toEqual(
      [
        'anon:update:public.documents:move-org_id',
        'authenticated:update:public.documents:move-org_id',
        'anon:update:public.fill_sessions:move-document_id',
        'authenticated:update:public.fill_sessions:move-document_id',
      ].sort()
    );
    for (const c of moves) {
      expect(c.expect).toBe('none');
      expect(c.sql).toMatch(/^UPDATE \S+ SET \w+ = \$1 WHERE id = \$2$/);
      expect(c.params[1]).toMatch(/^userB/);
    }
  });

  test('every function that takes another row id is called by both roles and must be refused', () => {
    const { buildCases } = load();
    const calls = buildCases().filter((c) => c.action === 'execute');
    expect(calls).toHaveLength(6);
    for (const fn of FUNCTIONS) {
      for (const role of ROLES) {
        const found = calls.filter((c) => c.id === `${role}:execute:${fn}`);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ table: fn, expect: 'refused' });
        expect(found[0].sql.startsWith(`SELECT ${fn}($1::uuid`)).toBe(true);
        expect(found[0].params[0]).toBe('orgADocumentId');
      }
    }
  });

  // Was one positive case (user B's own document); now also user B's own
  // organisation, membership and chat history row, so that a policy hiding
  // everything on those tables is not read as safe.
  test("includes positive cases: user B selects their own document, organisation, membership and chat history", () => {
    const { buildCases } = load();
    const positive = buildCases().filter((c) => c.expect === 'some');
    expect(positive).toHaveLength(4);
    expect(positive.map((c) => c.table).sort()).toEqual(
      ['public.documents', 'public.organizations', 'public.org_memberships', 'public.chat_history'].sort()
    );
    for (const c of positive) {
      expect(c).toMatchObject({ role: 'authenticated', action: 'select' });
      expect(c.sql).toBe(`SELECT id FROM ${c.table} WHERE id = $1`);
      expect(c.params[0]).toMatch(/^userB/);
    }
  });

  test('each case has a unique id, the fields a runner needs, and parameterised SQL', () => {
    const { buildCases } = load();
    const cases = buildCases();
    expect(cases).toHaveLength(106);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(typeof c.id).toBe('string');
      expect(ROLES).toContain(c.role);
      expect(Object.keys(KEYWORD)).toContain(c.action);
      expect(['none', 'some', 'refused']).toContain(c.expect);
      expect(c.sql).toMatch(/\$1\b/);
      expect(c.sql.toLowerCase().startsWith(KEYWORD[c.action])).toBe(true);
      expect(c.sql).toContain(c.table);
      // One param name per placeholder, and no value written into the SQL.
      expect(new Set(c.sql.match(/\$\d+/g)).size).toBe(c.params.length);
      expect(c.sql).not.toMatch(/'/);
    }
  });

  // A filter that reads another RLS-protected table runs under the tested
  // role's policies there, so a locked-down parent table would hide a leak in
  // the child (e.g. session_fields found through fill_sessions).
  test("each case's SQL reads only its own table, so another table's policy cannot hide a leak", () => {
    const { buildCases } = load();
    for (const c of buildCases()) {
      for (const other of [...TABLES, ...FUNCTIONS].filter((t) => t !== c.table)) {
        expect(c.sql).not.toContain(other);
      }
    }
  });

  test('session_fields cases pick org A rows by a seeded session id, not a document id', () => {
    const { buildCases } = load();
    const sessionCases = buildCases().filter((c) => c.table === 'public.session_fields');
    expect(sessionCases).toHaveLength(6);
    for (const c of sessionCases) {
      expect(c.sql).toMatch(/session_id\s*=\s*\$1\b/);
      expect(c.params).toHaveLength(1);
      expect(c.params[0]).not.toEqual('orgADocumentId');
    }
  });
});

describe('checkResults', () => {
  test('returns [] when no forbidden case touched a row, every call was refused and user B saw their rows', () => {
    const { buildCases, checkResults } = load();
    const cases = buildCases();
    expect(checkResults(cases, cleanResults(cases))).toEqual([]);
  });

  test('reports a leaked row, naming the role, action and table', () => {
    const { buildCases, checkResults } = load();
    const cases = buildCases();
    const results = cleanResults(cases);
    const leaky = cases.find(
      (c) => c.role === 'anon' && c.action === 'select' && c.table === 'public.fill_sessions'
    );
    results[leaky.id] = { rowCount: 1, denied: false };
    const leaks = checkResults(cases, results);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({
      id: leaky.id,
      role: 'anon',
      action: 'select',
      table: 'public.fill_sessions',
    });
  });

  test('reports one entry per failing case, including writes that affected rows', () => {
    const { buildCases, checkResults } = load();
    const cases = buildCases();
    const results = cleanResults(cases);
    const upd = cases.find(
      (c) => c.role === 'authenticated' && c.action === 'update' && c.table === 'storage.objects'
    );
    const del = cases.find(
      (c) => c.role === 'anon' && c.action === 'delete' && c.table === 'public.audit_log'
    );
    results[upd.id] = { rowCount: 3, denied: false };
    results[del.id] = { rowCount: 1, denied: false };
    const leaks = checkResults(cases, results);
    expect(leaks.map((l) => l.id).sort()).toEqual([upd.id, del.id].sort());
  });

  test('reports an insert that went through, by its case id', () => {
    const { buildCases, checkResults } = load();
    const cases = buildCases();
    const results = cleanResults(cases);
    results['authenticated:insert:public.org_memberships'] = { rowCount: 1, denied: false };
    const leaks = checkResults(cases, results);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({
      id: 'authenticated:insert:public.org_memberships',
      action: 'insert',
      rowCount: 1,
    });
    expect(leaks[0].message).toBe('authenticated insert on public.org_memberships touched 1 row(s)');
  });

  test('reports a function call that ran instead of being refused, even when it returned nothing', () => {
    const { buildCases, checkResults } = load();
    const cases = buildCases();
    for (const rowCount of [1, 0]) {
      const results = cleanResults(cases);
      results['anon:execute:public.increment_completion_count'] = { rowCount, denied: false };
      const leaks = checkResults(cases, results);
      expect(leaks).toHaveLength(1);
      expect(leaks[0]).toMatchObject({ id: 'anon:execute:public.increment_completion_count', action: 'execute' });
      expect(leaks[0].message).toMatch(/expected a permission denial/);
    }
  });

  test('reports user B seeing nothing on any of their own rows', () => {
    const { buildCases, checkResults } = load();
    const cases = buildCases();
    for (const positive of cases.filter((c) => c.expect === 'some')) {
      const results = cleanResults(cases);
      results[positive.id] = { rowCount: 0, denied: false };
      const leaks = checkResults(cases, results);
      expect(leaks).toHaveLength(1);
      expect(leaks[0]).toMatchObject({
        id: positive.id,
        role: 'authenticated',
        action: 'select',
        table: positive.table,
      });
    }
  });

  test('throws when the case list is missing or empty', () => {
    const { checkResults } = load();
    expect(() => checkResults(undefined, {})).toThrow();
    expect(() => checkResults(null, {})).toThrow();
    expect(() => checkResults([], {})).toThrow();
  });

  test('throws when a case has no result', () => {
    const { buildCases, checkResults } = load();
    const cases = buildCases();
    const results = cleanResults(cases);
    delete results[cases[0].id];
    expect(() => checkResults(cases, results)).toThrow(cases[0].id);
    expect(() => checkResults(cases, undefined)).toThrow();
  });

  // A broken runner can hand back NaN or Infinity; neither is a row count, so
  // neither may count as user B seeing their document (or as a clean 'none').
  test.each([NaN, Infinity, -Infinity, -1, 0.5, '1'])(
    'throws when a row count is not a whole number of rows (%p)',
    (bad) => {
      const { buildCases, checkResults } = load();
      const cases = buildCases();
      for (const kind of ['some', 'none', 'refused']) {
        const one = cases.find((c) => c.expect === kind);
        const results = cleanResults(cases);
        results[one.id] = { ...results[one.id], rowCount: bad };
        expect(() => checkResults(cases, results)).toThrow(one.id);
      }
    }
  );
});
