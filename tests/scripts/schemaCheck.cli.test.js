/**
 * Schema check CLI: introspect(client) reads a database's schema through an
 * injected client (query(sql) -> {rows}) into the shape compareSchema takes,
 * and main({env, client, log}) returns 0 with no problems, 1 with problems
 * (logging each), and 2 with a usage line when DATABASE_URL is not set.
 * runCli is the script path: it makes a client from DATABASE_URL, connects,
 * runs main and closes the client. The clients here are fakes that answer by
 * SQL text; no database is used.
 */

function load() {
  const mod = require('../../scripts/db/schemaCheck.js');
  expect(typeof mod.introspect).toBe('function');
  expect(typeof mod.main).toBe('function');
  return mod;
}

// A fake client: each answer is picked by a piece of the SQL text. Unknown
// SQL is an error, so a query introspect should not send fails the test.
function fakeClient(answers) {
  const sent = [];
  const calls = [];
  return {
    sent,
    calls,
    async connect() {
      calls.push('connect');
    },
    async end() {
      calls.push('end');
    },
    async query(sql) {
      sent.push(sql);
      const text = String(sql);
      const key = Object.keys(answers).find((k) => text.includes(k));
      if (!key) throw new Error(`fake client has no answer for: ${text}`);
      return { rows: answers[key] };
    },
  };
}

function answersFor({ columns, functions, rls, policies, buckets }) {
  return {
    'information_schema.columns': columns,
    pg_proc: functions,
    relrowsecurity: rls,
    pg_policies: policies,
    'storage.buckets': buckets,
  };
}

// Rows for a database that has everything EXPECTED asks for.
function completeRows(EXPECTED) {
  const columns = [];
  for (const [table, cols] of Object.entries(EXPECTED.tables)) {
    for (const column of cols) columns.push({ table_name: table, column_name: column });
  }
  return {
    columns,
    functions: EXPECTED.rpcs.map((proname) => ({ proname })),
    rls: Object.keys(EXPECTED.tables).map((relname) => ({ relname, relrowsecurity: true })),
    policies: EXPECTED.userData.map((table) => ({
      tablename: table,
      policyname: `${table} owner access`,
      roles: ['authenticated'],
    })),
    buckets: EXPECTED.buckets.map((id) => ({ id })),
  };
}

function missingTokenHash(EXPECTED) {
  const rows = completeRows(EXPECTED);
  rows.columns = rows.columns.filter(
    (c) => !(c.table_name === 'fill_sessions' && c.column_name === 'token_hash')
  );
  return rows;
}

describe('introspect', () => {
  it('maps the catalog rows to the shape compareSchema takes', async () => {
    const { introspect } = load();
    const client = fakeClient(
      answersFor({
        columns: [
          { table_name: 'notes', column_name: 'id' },
          { table_name: 'notes', column_name: 'body' },
          { table_name: 'tags', column_name: 'id' },
        ],
        functions: [{ proname: 'bump' }],
        rls: [
          { relname: 'notes', relrowsecurity: true },
          { relname: 'tags', relrowsecurity: false },
        ],
        policies: [{ tablename: 'notes', policyname: 'own notes', roles: ['authenticated'] }],
        buckets: [{ id: 'files' }],
      })
    );

    expect(await introspect(client)).toEqual({
      columns: [
        { table: 'notes', column: 'id' },
        { table: 'notes', column: 'body' },
        { table: 'tags', column: 'id' },
      ],
      functions: ['bump'],
      rls: { notes: true, tags: false },
      policies: [{ table: 'notes', name: 'own notes', roles: ['authenticated'] }],
      buckets: ['files'],
    });
  });

  it('asks each catalog for the public schema only', async () => {
    const { introspect } = load();
    const client = fakeClient(
      answersFor({ columns: [], functions: [], rls: [], policies: [], buckets: [] })
    );
    await introspect(client);
    const find = (part) => client.sent.find((sql) => sql.includes(part));
    expect(find('information_schema.columns')).toMatch(/table_schema\s*=\s*'public'/);
    expect(find('pg_proc')).toMatch(/pg_namespace/);
    expect(find('pg_proc')).toMatch(/nspname\s*=\s*'public'/);
    expect(find('relrowsecurity')).toMatch(/nspname\s*=\s*'public'/);
    expect(find('pg_policies')).toMatch(/schemaname\s*=\s*'public'/);
    expect(find('storage.buckets')).toBeDefined();
  });
});

describe('main', () => {
  const env = { DATABASE_URL: 'postgres://localhost:5432/cosign' };

  it('returns 0 for a database that has everything the app needs', async () => {
    const { main, EXPECTED } = load();
    const lines = [];
    const client = fakeClient(answersFor(completeRows(EXPECTED)));
    const code = await main({ env, client, log: (line) => lines.push(line) });
    expect(code).toBe(0);
    expect(lines.some((l) => /missing/i.test(l))).toBe(false);
  });

  it('returns 1 and logs the problem for a database missing a column', async () => {
    const { main, EXPECTED } = load();
    const lines = [];
    const client = fakeClient(answersFor(missingTokenHash(EXPECTED)));
    const code = await main({ env, client, log: (line) => lines.push(line) });
    expect(code).toBe(1);
    expect(lines.some((l) => l.includes('fill_sessions') && l.includes('token_hash'))).toBe(true);
  });

  it('returns 2 with a usage line, and queries nothing, when DATABASE_URL is not set', async () => {
    const { main } = load();
    const lines = [];
    const client = fakeClient({});
    const code = await main({ env: {}, client, log: (line) => lines.push(line) });
    expect(code).toBe(2);
    expect(lines.some((l) => l.includes('DATABASE_URL'))).toBe(true);
    expect(client.sent).toEqual([]);
  });
});

describe('runCli (the script path)', () => {
  const url = 'postgres://localhost:5432/cosign';

  it('makes a client from DATABASE_URL, connects, checks and closes it', async () => {
    const { runCli, EXPECTED } = load();
    expect(typeof runCli).toBe('function');
    const client = fakeClient(answersFor(missingTokenHash(EXPECTED)));
    const urls = [];
    const lines = [];
    const code = await runCli({
      env: { DATABASE_URL: url },
      createClient: (u) => {
        urls.push(u);
        return client;
      },
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(urls).toEqual([url]);
    expect(client.calls[0]).toBe('connect');
    expect(client.calls[client.calls.length - 1]).toBe('end');
    expect(client.sent.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('token_hash'))).toBe(true);
  });

  it('returns 2 without making a client when DATABASE_URL is not set', async () => {
    const { runCli } = load();
    expect(typeof runCli).toBe('function');
    let made = 0;
    const lines = [];
    const code = await runCli({
      env: {},
      createClient: () => {
        made += 1;
        return fakeClient({});
      },
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    });
    expect(code).toBe(2);
    expect(made).toBe(0);
  });

  it('returns 2 and closes the client when the database cannot be read', async () => {
    const { runCli } = load();
    expect(typeof runCli).toBe('function');
    const client = fakeClient({});
    client.connect = async () => {
      client.calls.push('connect');
      throw new Error('connection refused');
    };
    const lines = [];
    const code = await runCli({
      env: { DATABASE_URL: url },
      createClient: () => client,
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    });
    expect(code).toBe(2);
    expect(client.calls).toContain('end');
    expect(lines.some((l) => l.includes('connection refused'))).toBe(true);
  });
});
