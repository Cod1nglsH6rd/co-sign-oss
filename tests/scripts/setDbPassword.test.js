/**
 * scripts/docker/set-db-password.js (2026-11-21): a database
 * made before the stack generated its own password still has the old one,
 * and the services now log in with the password on the keys volume. The
 * script logs in with the old password (OLD_DB_PASSWORD) and gives
 * supabase_admin the one in /keys/db_password, with statement logging off for
 * that session, and prints neither. The database client is a stand-in here:
 * nothing connects anywhere.
 */

const crypto = require('crypto');
const { checkTree } = require('../../scripts/secretScan');

function load() {
  return require('../../scripts/docker/set-db-password');
}

const NEW = crypto.randomBytes(32).toString('hex');
const OLD = 'old-' + crypto.randomBytes(8).toString('hex');

function fakeFs(files = { '/keys/db_password': NEW + '\n' }) {
  return {
    readFileSync: (p) => {
      if (!(p in files)) {
        const err = new Error('ENOENT: no such file, open ' + p);
        err.code = 'ENOENT';
        throw err;
      }
      return files[p];
    },
  };
}

// A stand-in pg client per connection: `accepts` is the one password the
// database takes; quote_literal is answered the way Postgres would.
// `startingFor` connections fail as a database still starting would.
function fakeDatabase(accepts, startingFor = 0) {
  const connections = [];
  const createClient = (config) => {
    const conn = { config, queries: [], ended: false };
    connections.push(conn);
    return {
      connect: async () => {
        if (connections.length <= startingFor) {
          const err = new Error('connect ECONNREFUSED');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        if (config.password !== accepts) {
          const err = new Error('password authentication failed for user "' + config.user + '"');
          err.code = '28P01';
          throw err;
        }
      },
      query: async (text, values) => {
        conn.queries.push({ text, values });
        if (/quote_literal/.test(text)) return { rows: [{ q: "'" + String(values[0]).replace(/'/g, "''") + "'" }] };
        return { rows: [] };
      },
      end: async () => {
        conn.ended = true;
      },
    };
  };
  return { connections, createClient };
}

function collector() {
  const lines = [];
  return { lines, fn: (...args) => lines.push(args.join(' ')) };
}

async function runWith({ env = { OLD_DB_PASSWORD: OLD }, fs = fakeFs(), accepts = OLD, startingFor = 0, tries = 3 } = {}) {
  const db = fakeDatabase(accepts, startingFor);
  const log = collector();
  const error = collector();
  const waits = [];
  const code = await load().setDbPassword({
    env, fs, createClient: db.createClient, log: log.fn, error: error.fn,
    tries, waitMs: 5, sleep: async (ms) => { waits.push(ms); },
  });
  return { code, db, log: log.lines, error: error.lines, waits };
}

describe('scripts/docker/set-db-password.js', () => {
  it('logs in to db as supabase_admin with the old password and sets the one on the keys volume', async () => {
    const { code, db, log, error } = await runWith();
    expect(code).toBe(0);
    expect(error).toEqual([]);
    const last = db.connections[db.connections.length - 1];
    expect(last.config).toEqual({ host: 'db', port: 5432, database: 'postgres', user: 'supabase_admin', password: OLD });
    const texts = last.queries.map((q) => q.text);
    // Statement logging is off before the password is sent, so it is never logged.
    const alter = texts.findIndex((t) => /^alter role supabase_admin with password /i.test(t));
    expect(alter).toBeGreaterThan(-1);
    expect(texts.indexOf("set log_statement = 'none'")).toBeGreaterThan(-1);
    expect(texts.indexOf("set log_statement = 'none'")).toBeLessThan(alter);
    expect(texts.indexOf('set log_min_duration_statement = -1')).toBeLessThan(alter);
    expect(texts[alter]).toBe("alter role supabase_admin with password '" + NEW + "'");
    // The new password is quoted by the server, from a bound value.
    expect(last.queries.find((q) => /quote_literal/.test(q.text)).values).toEqual([NEW]);
    expect(last.ended).toBe(true);
    expect(log.join('\n')).toMatch(/database password set/);
  });

  it('does nothing when the database already takes the password on the keys volume', async () => {
    const { code, db, log } = await runWith({ accepts: NEW });
    expect(code).toBe(0);
    expect(db.connections).toHaveLength(1);
    expect(db.connections[0].config.password).toBe(NEW);
    expect(db.connections[0].queries.filter((q) => /alter role/i.test(q.text))).toEqual([]);
    expect(log.join('\n')).toMatch(/already/);
  });

  it('answers 1 and says so when the old password is refused too', async () => {
    const { code, error, db } = await runWith({ accepts: 'something-else' });
    expect(code).toBe(1);
    expect(error.join('\n')).toMatch(/OLD_DB_PASSWORD was refused/);
    expect(db.connections.every((c) => c.queries.every((q) => !/alter role/i.test(q.text)))).toBe(true);
  });

  it('tries again while the database is starting, then goes on', async () => {
    const { code, db, waits } = await runWith({ startingFor: 2 });
    expect(code).toBe(0);
    expect(waits).toEqual([5, 5]);
    expect(db.connections.map((c) => c.config.password)).toEqual([NEW, NEW, NEW, OLD]);
    expect(db.connections[3].queries.some((q) => /^alter role/.test(q.text))).toBe(true);
  });

  it('answers 1 when the database never answers, without trying the old password', async () => {
    const { code, error, db } = await runWith({ startingFor: 99, tries: 3 });
    expect(code).toBe(1);
    expect(error.join('\n')).toMatch(/Could not reach the database: ECONNREFUSED/);
    expect(db.connections.map((c) => c.config.password)).toEqual([NEW, NEW, NEW]);
  });

  it('answers 2 without connecting when OLD_DB_PASSWORD is not set', async () => {
    const { code, error, db } = await runWith({ env: {} });
    expect(code).toBe(2);
    expect(error.join('\n')).toMatch(/OLD_DB_PASSWORD is not set/);
    expect(db.connections).toEqual([]);
  });

  it('answers 2 without connecting when the keys volume has no password yet', async () => {
    const missing = await runWith({ fs: fakeFs({}) });
    expect(missing.code).toBe(2);
    expect(missing.error.join('\n')).toMatch(/\/keys\/db_password/);
    expect(missing.db.connections).toEqual([]);

    const empty = await runWith({ fs: fakeFs({ '/keys/db_password': '\n' }) });
    expect(empty.code).toBe(2);
    expect(empty.db.connections).toEqual([]);
  });

  it('never prints either password', async () => {
    for (const accepts of [OLD, NEW, 'something-else']) {
      // eslint-disable-next-line no-await-in-loop
      const { log, error } = await runWith({ accepts });
      const printed = log.concat(error).join('\n');
      expect(printed).not.toContain(NEW);
      expect(printed).not.toContain(OLD);
    }
  });

  it('holds no key or secret the secret scan can find', () => {
    expect(checkTree({ paths: ['scripts/docker/set-db-password.js'], baseline: [] })).toEqual({ unlisted: [], stale: [] });
  });
});
