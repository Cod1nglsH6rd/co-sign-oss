/**
 * scripts/docker/gen-keys.js makes the Docker stack's keys on first boot:
 * ensureKeys(dir, fs, log) writes dir/supabase.env once with a random
 * JWT_SECRET and anon/service_role keys signed with it, and logs only
 * 'keys created' or 'keys kept'. The key maker is handed an in-memory fs and
 * a log that collects lines, so no key is written to disk and no real key
 * appears in this file: every value is made at run time.
 */

const crypto = require('node:crypto');
const { checkTree } = require('../../scripts/secretScan');

const TEN_YEARS = 10 * 365 * 24 * 60 * 60;

function load() {
  return require('../../scripts/docker/gen-keys');
}

// A stand-in for node:fs holding files in a Map: path -> {data, options}.
// A write with flag 'wx' fails with EEXIST when the file is there, as node:fs does.
// seen(path) answers existsSync, so a test can hide a file another process wrote.
function memoryFs(initial = {}, seen = null) {
  const files = new Map(Object.entries(initial).map(([p, data]) => [p, { data, options: undefined }]));
  let writes = 0;
  return {
    files,
    writes: () => writes,
    existsSync: (p) => (seen ? seen(p) : files.has(p)),
    readFileSync: (p) => files.get(p).data,
    writeFileSync: (p, data, options) => {
      writes += 1;
      if (options && options.flag === 'wx' && files.has(p)) {
        const err = new Error("EEXIST: file already exists, open '" + p + "'");
        err.code = 'EEXIST';
        throw err;
      }
      files.set(p, { data: String(data), options });
    },
  };
}

function collector() {
  const lines = [];
  const log = (...args) => lines.push(args);
  return { lines, log };
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('scripts/docker/gen-keys.js signJwt', () => {
  it('signs an HS256 token whose signature verifies with the secret', () => {
    const { signJwt } = load();
    const secret = crypto.randomBytes(16).toString('hex');
    const token = signJwt({ role: 'anon', n: 7 }, secret);
    const [header, payload, signature] = token.split('.');

    expect(decodePart(header)).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decodePart(payload)).toEqual({ role: 'anon', n: 7 });
    const expected = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
    expect(signature).toBe(expected);

    const wrong = crypto.createHmac('sha256', secret + 'x').update(header + '.' + payload).digest('base64url');
    expect(signature).not.toBe(wrong);
  });
});

describe('scripts/docker/gen-keys.js ensureKeys', () => {
  it('writes a random secret and anon/service_role keys to dir/supabase.env with mode 0600', () => {
    const { ensureKeys } = load();
    const fs = memoryFs();
    const out = collector();
    const before = Math.floor(Date.now() / 1000);
    ensureKeys('/keys', fs, out.log);

    expect([...fs.files.keys()]).toEqual(['/keys/supabase.env']);
    const file = fs.files.get('/keys/supabase.env');
    expect(file.options.mode).toBe(0o600);

    const env = parseEnv(file.data);
    expect(Object.keys(env).sort()).toEqual(['JWT_SECRET', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);
    expect(env.JWT_SECRET).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(env.JWT_SECRET, 'base64url')).toHaveLength(48);

    for (const [name, role] of [
      ['SUPABASE_ANON_KEY', 'anon'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'service_role'],
    ]) {
      const [header, payload, signature] = env[name].split('.');
      expect(decodePart(header).alg).toBe('HS256');
      expect(decodePart(payload).role).toBe(role);
      expect(signature).toBe(crypto.createHmac('sha256', env.JWT_SECRET).update(header + '.' + payload).digest('base64url'));
    }

    const service = decodePart(env.SUPABASE_SERVICE_ROLE_KEY.split('.')[1]);
    expect(service.exp - before).toBeGreaterThanOrEqual(TEN_YEARS);
    expect(service.exp - before).toBeLessThan(TEN_YEARS + 30 * 24 * 60 * 60);

    expect(out.lines).toEqual([['keys created']]);
  });

  it('makes a different secret on each fresh volume', () => {
    const { ensureKeys } = load();
    const a = memoryFs();
    const b = memoryFs();
    ensureKeys('/keys', a, collector().log);
    ensureKeys('/keys', b, collector().log);
    const secretA = parseEnv(a.files.get('/keys/supabase.env').data).JWT_SECRET;
    const secretB = parseEnv(b.files.get('/keys/supabase.env').data).JWT_SECRET;
    expect(secretA).not.toBe(secretB);
  });

  it('keeps the same keys on a second run and logs only "keys kept"', () => {
    const { ensureKeys } = load();
    const fs = memoryFs();
    ensureKeys('/data/keys', fs, collector().log);
    const first = fs.files.get('/data/keys/supabase.env');

    const out = collector();
    ensureKeys('/data/keys', fs, out.log);

    expect(fs.files.get('/data/keys/supabase.env')).toBe(first);
    expect(fs.files.size).toBe(1);
    expect(out.lines).toEqual([['keys kept']]);
  });

  it('leaves an existing supabase.env untouched', () => {
    const { ensureKeys } = load();
    const fs = memoryFs({ '/keys/supabase.env': 'JWT_SECRET=kept-by-hand\n' });
    const out = collector();

    ensureKeys('/keys', fs, out.log);

    expect(fs.writes()).toBe(0);
    expect(fs.files.get('/keys/supabase.env').data).toBe('JWT_SECRET=kept-by-hand\n');
    expect(out.lines).toEqual([['keys kept']]);
  });

  it('keeps the file another first boot wrote after the check, and logs "keys kept"', () => {
    const { ensureKeys } = load();
    // existsSync says no, as it did before the other process won the race.
    const fs = memoryFs({ '/keys/supabase.env': 'JWT_SECRET=written-by-the-other-boot\n' }, () => false);
    const out = collector();

    ensureKeys('/keys', fs, out.log);

    expect(fs.files.get('/keys/supabase.env').data).toBe('JWT_SECRET=written-by-the-other-boot\n');
    expect(out.lines).toEqual([['keys kept']]);
  });

  it('still throws a write error that is not EEXIST', () => {
    const { ensureKeys } = load();
    const fs = memoryFs();
    fs.writeFileSync = () => {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    };
    const out = collector();

    expect(() => ensureKeys('/keys', fs, out.log)).toThrow('EACCES');
    expect(out.lines).toEqual([]);
  });
});

// 2026-11-21: the database password is made here too, once,
// instead of the compose file's fixed fallback; the addresses the services
// read are written from it on every start.
describe('scripts/docker/gen-keys.js ensureDbPassword', () => {
  it('writes 32 random bytes as hex to dir/db_password with mode 0600, and logs no password', () => {
    const { ensureDbPassword } = load();
    const fs = memoryFs();
    const out = collector();
    ensureDbPassword('/keys/', fs, out.log);

    expect([...fs.files.keys()]).toEqual(['/keys/db_password']);
    const file = fs.files.get('/keys/db_password');
    expect(file.options).toEqual({ mode: 0o600, flag: 'wx' });
    expect(file.data).toMatch(/^[0-9a-f]{64}$/);
    expect(out.lines).toEqual([['database password created']]);
  });

  it('makes a different password on each fresh volume', () => {
    const { ensureDbPassword } = load();
    const a = memoryFs();
    const b = memoryFs();
    ensureDbPassword('/keys', a, collector().log);
    ensureDbPassword('/keys', b, collector().log);
    expect(a.files.get('/keys/db_password').data).not.toBe(b.files.get('/keys/db_password').data);
  });

  it('leaves an existing db_password untouched and logs "database password kept"', () => {
    const { ensureDbPassword } = load();
    const fs = memoryFs({ '/keys/db_password': 'kept-by-hand' });
    const out = collector();
    ensureDbPassword('/keys', fs, out.log);
    expect(fs.writes()).toBe(0);
    expect(fs.files.get('/keys/db_password').data).toBe('kept-by-hand');
    expect(out.lines).toEqual([['database password kept']]);
  });

  it('keeps the file another first boot wrote after the check', () => {
    const { ensureDbPassword } = load();
    const fs = memoryFs({ '/keys/db_password': 'written-by-the-other-boot' }, () => false);
    const out = collector();
    ensureDbPassword('/keys', fs, out.log);
    expect(fs.files.get('/keys/db_password').data).toBe('written-by-the-other-boot');
    expect(out.lines).toEqual([['database password kept']]);
  });
});

describe('scripts/docker/gen-keys.js writeDbAddresses', () => {
  // memoryFs plus renameSync and unlinkSync, as the address writer uses them.
  function renamingFs(initial) {
    const fs = memoryFs(initial);
    fs.renameSync = (from, to) => {
      fs.files.set(to, fs.files.get(from));
      fs.files.delete(from);
    };
    fs.unlinkSync = (p) => fs.files.delete(p);
    return fs;
  }

  it('writes db.env and rest_db_uri from db_password: user supabase_admin on db:5432/postgres, mode 0600', () => {
    const { ensureDbPassword, writeDbAddresses } = load();
    const fs = renamingFs();
    ensureDbPassword('/keys', fs, collector().log);
    const password = fs.files.get('/keys/db_password').data;

    writeDbAddresses('/keys', fs);

    expect([...fs.files.keys()].sort()).toEqual(['/keys/db.env', '/keys/db_password', '/keys/rest_db_uri']);
    const uri = fs.files.get('/keys/rest_db_uri');
    expect(uri.options.mode).toBe(0o600);
    const address = new URL(uri.data);
    expect([address.protocol, address.username, address.hostname, address.port, address.pathname]).toEqual([
      'postgres:', 'supabase_admin', 'db', '5432', '/postgres',
    ]);
    expect(decodeURIComponent(address.password)).toBe(password);
    expect(address.search).toBe('');

    const env = fs.files.get('/keys/db.env');
    expect(env.options.mode).toBe(0o600);
    expect(env.data).toBe("DATABASE_URL='" + uri.data + "'\n");
  });

  it('encodes a password set by hand, so the address and the sourced line stay whole', () => {
    const { writeDbAddresses } = load();
    const typed = "it's a p@ss/word:#1 ?";
    const fs = renamingFs({ '/keys/db_password': typed + '\n' });

    writeDbAddresses('/keys', fs);

    const uri = fs.files.get('/keys/rest_db_uri').data;
    expect(decodeURIComponent(new URL(uri).password)).toBe(typed.trim());
    expect(uri.split('@')).toHaveLength(2);
    expect(uri).not.toMatch(/[\s'"]/);
    expect(fs.files.get('/keys/db.env').data).toBe("DATABASE_URL='" + uri + "'\n");
  });

  it('rewrites both files on every start, so they follow the password file', () => {
    const { writeDbAddresses } = load();
    const fs = renamingFs({ '/keys/db_password': 'first' });
    writeDbAddresses('/keys', fs);
    fs.files.set('/keys/db_password', { data: 'second', options: undefined });
    writeDbAddresses('/keys', fs);
    expect(decodeURIComponent(new URL(fs.files.get('/keys/rest_db_uri').data).password)).toBe('second');
    expect([...fs.files.keys()].sort()).toEqual(['/keys/db.env', '/keys/db_password', '/keys/rest_db_uri']);
  });

  it('refuses an empty password file', () => {
    const { writeDbAddresses } = load();
    const fs = renamingFs({ '/keys/db_password': ' \n' });
    expect(() => writeDbAddresses('/keys', fs)).toThrow(/db_password is empty/);
    expect(fs.files.size).toBe(1);
  });
});

describe('scripts/docker/gen-keys.js source', () => {
  it('exists and holds no key or secret the secret scan can find', () => {
    expect(load()).toEqual(
      expect.objectContaining({
        signJwt: expect.any(Function),
        ensureKeys: expect.any(Function),
        ensureDbPassword: expect.any(Function),
        writeDbAddresses: expect.any(Function),
      })
    );
    expect(checkTree({ paths: ['scripts/docker/gen-keys.js'], baseline: [] })).toEqual({ unlisted: [], stale: [] });
  });
});
