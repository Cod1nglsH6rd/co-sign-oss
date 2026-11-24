/**
 * compareSchema: compares an introspected database (a plain object) with
 * EXPECTED and lists each problem in plain English, naming the table, column,
 * function or bucket.
 */

function load() {
  const mod = require('../../scripts/db/schemaCheck.js');
  expect(typeof mod.compareSchema).toBe('function');
  return mod;
}

// A database that has everything EXPECTED asks for.
function completeFixture(EXPECTED) {
  const columns = [];
  for (const [table, cols] of Object.entries(EXPECTED.tables)) {
    for (const column of cols) columns.push({ table, column });
  }
  const rls = {};
  for (const table of Object.keys(EXPECTED.tables)) rls[table] = true;
  const policies = EXPECTED.userData.map((table) => ({
    table,
    name: `${table} owner access`,
    roles: ['authenticated'],
  }));
  // A service_role policy on a service-only table is allowed.
  policies.push({
    table: EXPECTED.serviceOnly[0],
    name: 'service role only',
    roles: ['service_role'],
  });
  return {
    columns,
    functions: [...EXPECTED.rpcs],
    rls,
    policies,
    buckets: [...EXPECTED.buckets],
  };
}

function fixture() {
  return completeFixture(load().EXPECTED);
}

describe('compareSchema', () => {
  it('reports no problems for a database that has everything EXPECTED needs', () => {
    const { compareSchema } = load();
    expect(compareSchema(fixture())).toEqual([]);
  });

  it('uses EXPECTED when no expected list is passed', () => {
    const { compareSchema, EXPECTED } = load();
    const db = fixture();
    expect(compareSchema(db)).toEqual(compareSchema(db, EXPECTED));
  });

  it('reports a missing table by name', () => {
    const { compareSchema } = load();
    const db = fixture();
    db.columns = db.columns.filter((c) => c.table !== 'chat_history');
    const problems = compareSchema(db);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes('chat_history'))).toBe(true);
    expect(problems.every((p) => p.includes('chat_history'))).toBe(true);
  });

  it('reports a missing column with its table and column name', () => {
    const { compareSchema } = load();
    const db = fixture();
    db.columns = db.columns.filter(
      (c) => !(c.table === 'fill_sessions' && c.column === 'token_hash')
    );
    const problems = compareSchema(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('fill_sessions');
    expect(problems[0]).toContain('token_hash');
  });

  it('reports a missing RPC by function name', () => {
    const { compareSchema } = load();
    const db = fixture();
    db.functions = db.functions.filter((f) => f !== 'increment_completion_count');
    const problems = compareSchema(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('increment_completion_count');
  });

  it('reports a missing bucket by name', () => {
    const { compareSchema } = load();
    const db = fixture();
    db.buckets = db.buckets.filter((b) => b !== 'filled-documents');
    const problems = compareSchema(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('filled-documents');
  });

  it('reports RLS off on a userData table', () => {
    const { compareSchema } = load();
    const db = fixture();
    db.rls.documents = false;
    const problems = compareSchema(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('documents');
    expect(problems[0]).toMatch(/RLS/);
  });

  it('reports RLS off on a serviceOnly table', () => {
    const { compareSchema } = load();
    const db = fixture();
    db.rls.app_config = false;
    const problems = compareSchema(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('app_config');
    expect(problems[0]).toMatch(/RLS/);
  });

  it('treats a table missing from the rls map as RLS off', () => {
    const { compareSchema } = load();
    const db = fixture();
    delete db.rls.beta_signups;
    const problems = compareSchema(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('beta_signups');
  });

  it('reports a userData table with no policies', () => {
    const { compareSchema } = load();
    const db = fixture();
    db.policies = db.policies.filter((p) => p.table !== 'session_fields');
    const problems = compareSchema(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('session_fields');
  });

  it('reports a serviceOnly table with a policy for authenticated', () => {
    const { compareSchema } = load();
    const db = fixture();
    db.policies.push({ table: 'beta_signups', name: 'leaky read', roles: ['authenticated'] });
    const problems = compareSchema(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('beta_signups');
    expect(problems[0]).toContain('leaky read');
  });

  it('reports a serviceOnly table with a policy for anon', () => {
    const { compareSchema } = load();
    const db = fixture();
    db.policies.push({ table: 'app_config', name: 'open insert', roles: ['service_role', 'anon'] });
    const problems = compareSchema(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('app_config');
    expect(problems[0]).toContain('anon');
  });

  it('reports a serviceOnly table with a policy for public (which covers anon and authenticated)', () => {
    const { compareSchema } = load();
    const db = fixture();
    db.policies.push({ table: 'app_config', name: 'default roles', roles: ['public'] });
    const problems = compareSchema(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('app_config');
  });

  it('checks against a custom expected list when one is passed', () => {
    const { compareSchema } = load();
    const expected = {
      tables: { notes: ['id', 'body'] },
      rpcs: ['bump'],
      buckets: ['files'],
      userData: ['notes'],
      serviceOnly: [],
    };
    const db = {
      columns: [{ table: 'notes', column: 'id' }],
      functions: [],
      rls: { notes: true },
      policies: [{ table: 'notes', name: 'own', roles: ['authenticated'] }],
      buckets: [],
    };
    const problems = compareSchema(db, expected);
    expect(problems).toHaveLength(3);
    expect(problems.some((p) => p.includes('notes') && p.includes('body'))).toBe(true);
    expect(problems.some((p) => p.includes('bump'))).toBe(true);
    expect(problems.some((p) => p.includes('files'))).toBe(true);
  });
});
