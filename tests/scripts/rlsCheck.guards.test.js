/**
 * The RLS check runner refuses to start without a database URL, and refuses
 * a hosted (*.supabase.co) one unless MIGRATE_ALLOW_REMOTE=1, before it ever
 * creates a database client. Nothing here touches a database.
 */

function load() {
  return require('../../scripts/db/rlsCheck');
}

function fakes() {
  const calls = { createClient: [], errors: [], client: [] };
  // issue #471: past the guards the runner uses the client, so it gets a fake that records what it is sent.
  const client = {
    connect: async () => {
      calls.client.push('connect');
    },
    query: async (textOrConfig) => {
      calls.client.push(typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text);
      return { rows: [], rowCount: 0 };
    },
    end: async () => {
      calls.client.push('end');
    },
  };
  return {
    calls,
    createClient: (url) => {
      calls.createClient.push(url);
      return client;
    },
    log: () => {},
    error: (msg) => calls.errors.push(msg),
  };
}

async function run(env) {
  const { runRlsCheck } = load();
  expect(typeof runRlsCheck).toBe('function');
  const f = fakes();
  const code = await runRlsCheck({ env, createClient: f.createClient, log: f.log, error: f.error });
  return { code, calls: f.calls };
}

describe('runRlsCheck guards', () => {
  it('a missing DATABASE_URL prints an error and returns 1 without creating a client', async () => {
    const { code, calls } = await run({});
    expect(code).toBe(1);
    expect(calls.createClient).toEqual([]);
    expect(calls.errors.length).toBeGreaterThan(0);
  });

  it('a *.supabase.co DATABASE_URL returns 1 without creating a client', async () => {
    const { code, calls } = await run({ DATABASE_URL: 'postgres://db.abc.supabase.co/postgres' });
    expect(code).toBe(1);
    expect(calls.createClient).toEqual([]);
    expect(calls.errors.length).toBeGreaterThan(0);
  });

  it('a *.supabase.co DATABASE_URL with MIGRATE_ALLOW_REMOTE other than "1" is still refused', async () => {
    const { code, calls } = await run({
      DATABASE_URL: 'postgres://db.abc.supabase.co/postgres',
      MIGRATE_ALLOW_REMOTE: 'true',
    });
    expect(code).toBe(1);
    expect(calls.createClient).toEqual([]);
  });

  it('a *.supabase.co DATABASE_URL with MIGRATE_ALLOW_REMOTE=1 gets past the refusal', async () => {
    const { code, calls } = await run({
      DATABASE_URL: 'postgres://db.abc.supabase.co/postgres',
      MIGRATE_ALLOW_REMOTE: '1',
    });
    expect(calls.createClient).toEqual(['postgres://db.abc.supabase.co/postgres']);
    // issue #471: the guard's decision is that the run goes on (connect, then BEGIN), not the runner's exit code.
    expect(calls.client.slice(0, 2)).toEqual(['connect', 'BEGIN']);
    expect(calls.errors.some((e) => e.includes('refusing'))).toBe(false);
    expect(typeof code).toBe('number');
  });

  it('a local DATABASE_URL gets past the guards', async () => {
    const { code, calls } = await run({ DATABASE_URL: 'postgres://localhost:5432/postgres' });
    expect(calls.createClient).toEqual(['postgres://localhost:5432/postgres']);
    // issue #471: the guard's decision is that the run goes on (connect, then BEGIN), not the runner's exit code.
    expect(calls.client.slice(0, 2)).toEqual(['connect', 'BEGIN']);
    expect(calls.errors.some((e) => e.includes('refusing'))).toBe(false);
    expect(typeof code).toBe('number');
  });

  it('migrate.js exports isRemoteHost: true for db.abc.supabase.co, false for localhost', () => {
    const { isRemoteHost } = require('../../scripts/db/migrate.js');
    expect(typeof isRemoteHost).toBe('function');
    expect(isRemoteHost('postgres://db.abc.supabase.co/postgres')).toBe(true);
    expect(isRemoteHost('postgres://localhost:5432/postgres')).toBe(false);
  });

  it('keeps the existing rlsCheck exports', () => {
    const mod = load();
    expect(typeof mod.caseParams).toBe('function');
    expect(typeof mod.caseSteps).toBe('function');
    expect(typeof mod.isPermissionError).toBe('function');
  });
});
