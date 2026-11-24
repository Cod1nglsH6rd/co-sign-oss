/**
 * scripts/db/migrate.js builds a fresh local database: SUPABASE-SETUP.sql as
 * the baseline, then supabase/migrations/*.sql in name order, each in its own
 * transaction and recorded in cosign_meta.schema_migrations. The runner is
 * handed an in-memory file list and a fake client that records every query,
 * so no database is touched and `pg` is never loaded. Database addresses here
 * carry no user or password.
 */

function load() {
  return require('../../scripts/db/migrate');
}

const ROOT = '/repo';

// A stand-in for node:fs: the baseline plus a migrations folder.
function memoryFs(migrations) {
  const files = {
    [ROOT + '/SUPABASE-SETUP.sql']: '-- baseline',
  };
  for (const [name, sql] of Object.entries(migrations)) {
    files[ROOT + '/supabase/migrations/' + name] = sql;
  }
  return {
    readdirSync: (dir) => {
      if (dir !== ROOT + '/supabase/migrations') throw new Error('unexpected dir ' + dir);
      return Object.keys(migrations);
    },
    readFileSync: (p) => {
      if (!(p in files)) throw new Error('ENOENT ' + p);
      return files[p];
    },
  };
}

// A fake pg client: records queries, answers the applied-names lookup with
// `applied`, and throws when it is asked to run the SQL text `failOn`.
function fakeClient({ applied = [], failOn = null } = {}) {
  const queries = [];
  return {
    queries,
    connected: false,
    ended: false,
    async connect() {
      this.connected = true;
    },
    async end() {
      this.ended = true;
    },
    async query(text, params) {
      queries.push({ text, params });
      if (failOn !== null && text === failOn) throw new Error('syntax error at or near "BROKEN"');
      if (/select\s+name\s+from\s+cosign_meta\.schema_migrations/i.test(text)) {
        return { rows: applied.map((name) => ({ name })) };
      }
      return { rows: [] };
    },
  };
}

function collector() {
  const lines = [];
  return { lines, log: (...args) => lines.push(args.join(' ')) };
}

async function run({ env, migrations, client }) {
  const { lines, log } = collector();
  let created = 0;
  const code = await load().runMigrations({
    env,
    root: ROOT,
    fs: memoryFs(migrations),
    createClient: () => {
      created += 1;
      return client;
    },
    log,
    error: log,
  });
  return { code, lines, created: () => created };
}

const LOCAL = { DATABASE_URL: 'postgres://localhost:54322/postgres' };
const REMOTE = 'postgresql://db.abcdefgh.supabase.co:5432/postgres';
const INSERT = /insert into cosign_meta\.schema_migrations/i;

describe('planMigrations', () => {
  it('puts SUPABASE-SETUP.sql first, then migrations in name order, ignoring non-sql files', () => {
    const { planMigrations } = load();
    const plan = planMigrations(
      [
        'supabase/migrations/20260313000000_b.sql',
        'supabase/migrations/README.md',
        'SUPABASE-SETUP.sql',
        'supabase/migrations/20260309102745_a.sql',
        'supabase/migrations/20260313000001_c.sql',
      ],
      [],
    );
    expect(plan.map((step) => step.name)).toEqual([
      'SUPABASE-SETUP.sql',
      '20260309102745_a.sql',
      '20260313000000_b.sql',
      '20260313000001_c.sql',
    ]);
    expect(plan[1].path).toBe('supabase/migrations/20260309102745_a.sql');
  });

  it('skips files whose names are already applied, the baseline included', () => {
    const { planMigrations } = load();
    const plan = planMigrations(
      [
        'SUPABASE-SETUP.sql',
        'supabase/migrations/20260309102745_a.sql',
        'supabase/migrations/20260313000000_b.sql',
        'supabase/migrations/20260313000001_c.sql',
      ],
      ['SUPABASE-SETUP.sql', '20260313000000_b.sql'],
    );
    expect(plan.map((step) => step.name)).toEqual(['20260309102745_a.sql', '20260313000001_c.sql']);
  });
});

describe('runMigrations', () => {
  it('applies each pending file in its own transaction and records it', async () => {
    const client = fakeClient({ applied: ['SUPABASE-SETUP.sql'] });
    const { code } = await run({
      env: LOCAL,
      migrations: { '2_b.sql': '-- b', '1_a.sql': '-- a' },
      client,
    });
    expect(code).toBe(0);
    const texts = client.queries.map((q) => q.text);
    const firstBegin = texts.indexOf('BEGIN');
    expect(texts.slice(firstBegin)).toEqual([
      'BEGIN', '-- a', expect.stringMatching(INSERT), 'COMMIT',
      'BEGIN', '-- b', expect.stringMatching(INSERT), 'COMMIT',
    ]);
    const recorded = client.queries.filter((q) => INSERT.test(q.text)).map((q) => q.params);
    expect(recorded).toEqual([['1_a.sql'], ['2_b.sql']]);
    expect(texts).not.toContain('-- baseline');
    expect(client.ended).toBe(true);
  });

  it('stops at the failing file with a non-zero exit, names it, and rolls it back', async () => {
    const client = fakeClient({ failOn: 'BROKEN' });
    const { code, lines } = await run({
      env: LOCAL,
      migrations: { '1_a.sql': '-- a', '2_bad.sql': 'BROKEN', '3_c.sql': '-- c' },
      client,
    });
    expect(code).not.toBe(0);
    expect(lines.join('\n')).toContain('2_bad.sql');
    const texts = client.queries.map((q) => q.text);
    expect(texts).not.toContain('-- c');
    expect(texts[texts.indexOf('BROKEN') + 1]).toBe('ROLLBACK');
    const recorded = client.queries.filter((q) => INSERT.test(q.text)).map((q) => q.params[0]);
    expect(recorded).toEqual(['SUPABASE-SETUP.sql', '1_a.sql']);
    expect(client.ended).toBe(true);
  });

  it('refuses a *.supabase.co host without connecting', async () => {
    const client = fakeClient();
    const { code, lines, created } = await run({
      env: { DATABASE_URL: REMOTE },
      migrations: { '1_a.sql': '-- a' },
      client,
    });
    expect(code).not.toBe(0);
    expect(created()).toBe(0);
    expect(client.queries).toEqual([]);
    expect(lines.join('\n')).toMatch(/MIGRATE_ALLOW_REMOTE/);
  });

  it.each([
    'postgresql://db.abcdefgh.supabase.co.:5432/postgres',
    'postgresql://DB.ABCDEFGH.SUPABASE.CO:5432/postgres',
  ])('refuses the remote host written as %s', async (url) => {
    const client = fakeClient();
    const { code, created } = await run({
      env: { DATABASE_URL: url },
      migrations: { '1_a.sql': '-- a' },
      client,
    });
    expect(code).not.toBe(0);
    expect(created()).toBe(0);
  });

  it('runs against a *.supabase.co host when MIGRATE_ALLOW_REMOTE=1', async () => {
    const client = fakeClient();
    const { code, created } = await run({
      env: { DATABASE_URL: REMOTE, MIGRATE_ALLOW_REMOTE: '1' },
      migrations: { '1_a.sql': '-- a' },
      client,
    });
    expect(code).toBe(0);
    expect(created()).toBe(1);
    expect(client.queries.map((q) => q.text)).toContain('-- a');
  });

  it('does not treat a lookalike host as remote', async () => {
    const client = fakeClient();
    const { code } = await run({
      env: { DATABASE_URL: 'postgres://notsupabase.co.local:5432/postgres' },
      migrations: {},
      client,
    });
    expect(code).toBe(0);
  });

  it('refuses to run without DATABASE_URL', async () => {
    const client = fakeClient();
    const { code, created } = await run({ env: {}, migrations: {}, client });
    expect(code).not.toBe(0);
    expect(created()).toBe(0);
  });
});
