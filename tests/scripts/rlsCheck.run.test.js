/**
 * runRlsCheck past its guards: one client, BEGIN, the fixture inserts, every
 * case's steps in order, then ROLLBACK and end() whatever happened. The pg
 * client is a fake that records what it is sent and answers like a database
 * whose policies hide org A's rows from anon and from user B. Nothing here
 * touches a database.
 */

const LOCAL_URL = 'postgres://localhost:5432/postgres';

function load() {
  return require('../../scripts/db/rlsCheck');
}

// A case's own statement: anything sent while a role is set, other than the
// claims and the rollbacks. Fixture inserts are sent before any role is set.
const caseQueries = (client) => client.queries.filter((q) => q.inCase);

function columnsOf(text) {
  return text.slice(text.indexOf('(') + 1, text.indexOf(')')).split(', ');
}

// Whether the fixture row `id` in `table` is the user `sub`'s own: their
// document, membership or chat history row, or an org they are a member of.
function owns(state, table, id, sub) {
  const row = (t, rowId) => (state.rows[t] || []).find((r) => r.id === rowId);
  if (table === 'public.organizations') {
    return (state.rows['public.org_memberships'] || []).some((m) => m.org_id === id && m.user_id === sub);
  }
  const found = row(table, id);
  return Boolean(found) && found.user_id === sub;
}

const denial = () => Object.assign(new Error('permission denied for function'), { code: '42501' });

// A fake pg client. `answer(q, state)` may return a result or throw; when it
// returns undefined the default answer is used: no rows for every case query,
// except user B (by the claims' sub) selecting a row of their own, and a
// permission denial for every function call (the service role alone may run
// them).
function fakeClient(answer = () => undefined, { rollbackFails = false, endFails = false } = {}) {
  const events = [];
  const queries = [];
  const state = { role: null, sub: null, rows: {}, ended: false };
  const client = {
    events,
    queries,
    state,
    connect: async () => {
      events.push('connect');
    },
    query: async (textOrConfig, maybeValues) => {
      const q =
        typeof textOrConfig === 'string'
          ? { text: textOrConfig, values: maybeValues || [] }
          : { text: textOrConfig.text, values: textOrConfig.values || [] };
      q.inCase =
        state.role !== null &&
        !q.text.startsWith("SELECT set_config('request.jwt.claims'") &&
        q.text !== 'ROLLBACK TO SAVEPOINT rls_case' &&
        q.text !== 'ROLLBACK';
      events.push(q.text);
      queries.push(q);
      if (q.text === 'ROLLBACK' && rollbackFails) throw new Error('connection lost');

      const given = answer(q, state);
      if (given !== undefined) return given;

      if (!q.inCase && q.text.startsWith('INSERT INTO ')) {
        const table = q.text.slice('INSERT INTO '.length, q.text.indexOf(' ('));
        const row = {};
        columnsOf(q.text).forEach((c, i) => {
          row[c] = q.values[i];
        });
        (state.rows[table] = state.rows[table] || []).push(row);
      } else if (q.text.startsWith('SET LOCAL ROLE ')) {
        state.role = q.text.slice('SET LOCAL ROLE '.length);
      } else if (q.text.startsWith("SELECT set_config('request.jwt.claims'")) {
        state.sub = JSON.parse(q.values[0]).sub;
      } else if (q.text === 'ROLLBACK TO SAVEPOINT rls_case') {
        state.role = null;
        state.sub = null;
      }
      if (q.inCase) {
        if (/^SELECT public\.\w+\(/.test(q.text)) throw denial();
        const own = /^SELECT id FROM (\S+) WHERE id = \$1$/.exec(q.text);
        const mine = own && state.role === 'authenticated' && state.sub && owns(state, own[1], q.values[0], state.sub);
        return mine ? { rows: [{ id: q.values[0] }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: null };
    },
    end: async () => {
      state.ended = true;
      events.push('end');
      if (endFails) throw new Error('already closed');
    },
  };
  return client;
}

async function run(client) {
  const { runRlsCheck } = load();
  const created = [];
  const logs = [];
  const errors = [];
  const code = await runRlsCheck({
    env: { DATABASE_URL: LOCAL_URL },
    createClient: (url) => {
      created.push(url);
      return client;
    },
    log: (m) => logs.push(String(m)),
    error: (m) => errors.push(String(m)),
  });
  return { code, created, logs, errors };
}

// The document a case's query is about belongs to org A when its owner is not
// the user in the current claims (or there are no claims, as for anon).
function selectsOrgADocument(role) {
  return (q, state) => {
    const doc = (state.rows['public.documents'] || []).find((r) => r.id === q.values[0]);
    if (
      q.text === 'SELECT id FROM public.documents WHERE id = $1' &&
      state.role === role &&
      doc &&
      doc.user_id !== state.sub
    ) {
      return { rows: [{ id: q.values[0] }], rowCount: 1 };
    }
    return undefined;
  };
}

function failOnCase(role, text, err) {
  return (q, state) => {
    if (q.text === text && state.role === role) throw err;
    return undefined;
  };
}

describe('runRlsCheck runner', () => {
  it('with no leaks: one client, BEGIN first, fixture and every case sent, pass line logged, returns 0', async () => {
    const { buildCases } = require('../../scripts/db/rlsCases');
    const client = fakeClient();
    const { code, created, logs, errors } = await run(client);

    expect(errors).toEqual([]);
    expect(code).toBe(0);
    expect(created).toEqual([LOCAL_URL]);
    expect(client.events[0]).toBe('connect');
    expect(client.events[1]).toBe('BEGIN');
    expect(logs.filter((l) => l.startsWith('rls check passed'))).toHaveLength(1);

    // The fixture's inserts (the insert cases send INSERTs too, as anon or
    // user B, each after its savepoint and role).
    const fixture = client.queries.filter((q) => q.text.startsWith('INSERT INTO ') && !q.inCase);
    expect(fixture.length).toBeGreaterThan(0);
    for (const q of fixture) expect(Array.isArray(q.values)).toBe(true);
    // Fixture inserts come before any case runs, as the connecting role.
    const firstSavepoint = client.queries.findIndex((q) => q.text === 'SAVEPOINT rls_case');
    const lastInsert = client.queries.map((q) => q.text.startsWith('INSERT INTO ') && !q.inCase).lastIndexOf(true);
    expect(lastInsert).toBeLessThan(firstSavepoint);

    expect(caseQueries(client).map((q) => q.text)).toEqual(buildCases().map((c) => c.sql));
    expect(client.queries.filter((q) => q.text === 'SAVEPOINT rls_case')).toHaveLength(buildCases().length);

    expect(client.queries[client.queries.length - 1].text).toBe('ROLLBACK');
    expect(client.state.ended).toBe(true);
  });

  it.each([
    ['anon', 'anon:select:public.documents'],
    ['authenticated', 'authenticated:select:public.documents'],
  ])('one row for the %s select of org A\'s document returns 1 and prints that case id', async (role, id) => {
    const client = fakeClient(selectsOrgADocument(role));
    const { code, logs, errors } = await run(client);

    expect(code).toBe(1);
    expect(errors.filter((e) => e.includes(id))).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(logs.some((l) => l.startsWith('rls check passed'))).toBe(false);
    expect(client.queries[client.queries.length - 1].text).toBe('ROLLBACK');
    expect(client.state.ended).toBe(true);
  });

  it('when a fixture insert throws: returns 1, ROLLBACK is the last query and end() was called', async () => {
    const client = fakeClient((q) => {
      if (q.text.startsWith('INSERT INTO public.documents (')) throw new Error('insert failed');
      return undefined;
    });
    const { code, errors } = await run(client);

    expect(code).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
    expect(client.queries.some((q) => q.text === 'SAVEPOINT rls_case')).toBe(false);
    expect(client.queries[client.queries.length - 1].text).toBe('ROLLBACK');
    expect(client.state.ended).toBe(true);
  });

  it('when BEGIN throws: returns 1, ROLLBACK is the last query and end() was called', async () => {
    const client = fakeClient((q) => {
      if (q.text === 'BEGIN') throw new Error('no transaction');
      return undefined;
    });
    const { code } = await run(client);

    expect(code).toBe(1);
    expect(client.queries.some((q) => q.text.startsWith('INSERT INTO '))).toBe(false);
    expect(client.queries[client.queries.length - 1].text).toBe('ROLLBACK');
    expect(client.state.ended).toBe(true);
  });

  it('a 42501 error on a case query counts as 0 rows, rolls back to the savepoint and the run goes on', async () => {
    const { buildCases } = require('../../scripts/db/rlsCases');
    const text = 'DELETE FROM storage.objects WHERE name = $1 RETURNING id';
    const denied = Object.assign(new Error('permission denied for table objects'), { code: '42501' });
    const client = fakeClient(failOnCase('anon', text, denied));
    const { code, logs, errors } = await run(client);

    expect(errors).toEqual([]);
    expect(code).toBe(0);
    expect(logs.filter((l) => l.startsWith('rls check passed'))).toHaveLength(1);
    const at = client.queries.findIndex((q) => q.text === text);
    expect(client.queries[at + 1].text).toBe('ROLLBACK TO SAVEPOINT rls_case');
    // Every case still ran.
    expect(caseQueries(client)).toHaveLength(buildCases().length);
    expect(client.queries[client.queries.length - 1].text).toBe('ROLLBACK');
  });

  it('a 42P01 error on a case query stops the run and returns 1 naming the case', async () => {
    const text = 'SELECT id FROM public.audit_log WHERE document_id = $1';
    const missing = Object.assign(new Error('relation "public.audit_log" does not exist'), { code: '42P01' });
    const client = fakeClient(failOnCase('authenticated', text, missing));
    const { code, logs, errors } = await run(client);

    expect(code).toBe(1);
    expect(errors.some((e) => e.includes('authenticated:select:public.audit_log'))).toBe(true);
    expect(logs.some((l) => l.startsWith('rls check passed'))).toBe(false);
    // Nothing after the failing case ran.
    // anon runs the same text earlier; the authenticated one is the last.
    const at = client.queries.map((q) => q.text === text).lastIndexOf(true);
    expect(client.queries[at - 2].text).toBe('SET LOCAL ROLE authenticated');
    expect(client.queries.slice(at + 1).filter((q) => q.inCase)).toEqual([]);
    expect(client.queries[client.queries.length - 1].text).toBe('ROLLBACK');
    expect(client.state.ended).toBe(true);
  });

  it("an insert case that adds a row is a leak: returns 1 and prints that case id", async () => {
    const id = 'authenticated:insert:public.org_memberships';
    const client = fakeClient((q, state) =>
      q.inCase && state.role === 'authenticated' && q.text.startsWith('INSERT INTO public.org_memberships (')
        ? { rows: [], rowCount: 1 }
        : undefined
    );
    const { code, errors } = await run(client);

    expect(code).toBe(1);
    expect(errors).toEqual([`rls check leak: ${id}: authenticated insert on public.org_memberships touched 1 row(s)`]);
    expect(client.queries[client.queries.length - 1].text).toBe('ROLLBACK');
  });

  it('a 42501 on an insert case counts as nothing inserted and the run goes on', async () => {
    const { buildCases } = require('../../scripts/db/rlsCases');
    const refused = Object.assign(new Error('new row violates row-level security policy'), { code: '42501' });
    const client = fakeClient((q) => {
      if (q.inCase && q.text.startsWith('INSERT INTO ')) throw refused;
      return undefined;
    });
    const { code, errors } = await run(client);

    expect(errors).toEqual([]);
    expect(code).toBe(0);
    expect(caseQueries(client)).toHaveLength(buildCases().length);
  });

  it('a function call that runs instead of being refused is a leak, even with no row back', async () => {
    const id = 'anon:execute:public.increment_completion_count';
    const client = fakeClient((q, state) =>
      q.inCase && state.role === 'anon' && q.text.startsWith('SELECT public.increment_completion_count(')
        ? { rows: [], rowCount: 0 }
        : undefined
    );
    const { code, errors } = await run(client);

    expect(code).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(new RegExp(`^rls check leak: ${id}: .*expected a permission denial$`));
  });

  it('a failing ROLLBACK and a failing end() are swallowed', async () => {
    const client = fakeClient(undefined, { rollbackFails: true, endFails: true });
    const { code, logs } = await run(client);

    expect(code).toBe(0);
    expect(logs.filter((l) => l.startsWith('rls check passed'))).toHaveLength(1);
    expect(client.queries[client.queries.length - 1].text).toBe('ROLLBACK');
    expect(client.state.ended).toBe(true);
  });
});
