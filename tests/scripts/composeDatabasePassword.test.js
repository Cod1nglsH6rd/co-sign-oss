/**
 * The Docker stack's database password (2026-11-21): the
 * compose file used to fall back to one fixed, published password in five
 * places, so anyone who could reach a stack's services knew the database's
 * password. Now the keys service makes a random one on first start, on the
 * keys volume with the other generated secrets (scripts/docker/gen-keys.js),
 * and every service that logs in reads it from there: the database from
 * /keys/db_password, auth, storage and migrate from /keys/db.env through
 * their entrypoints, and rest (whose image has no shell) from
 * /keys/rest_db_uri with PostgREST's @file form.
 *
 * These tests read docker-compose.yml and docker/ as text; Docker is never
 * started. They pin the structure (where each service gets the password),
 * not any old value.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const COMPOSE = path.join(ROOT, 'docker-compose.yml');

function isComment(line) {
  return /^\s*#/.test(line);
}

// The file's lines without full-line comments; [] when it is missing.
function codeLines() {
  if (!fs.existsSync(COMPOSE)) return [];
  return fs.readFileSync(COMPOSE, 'utf8').split('\n').filter((l) => !isComment(l));
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// The lines under `key:` at the given indent, up to the next line at that
// indent or less. null when the key is not there.
function subBlock(lines, key, indent) {
  const start = lines.findIndex((l) => indentOf(l) === indent && l.trim().startsWith(key + ':'));
  if (start === -1) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() !== '' && indentOf(lines[i]) <= indent) break;
    out.push(lines[i]);
  }
  return out;
}

function service(name) {
  return subBlock(subBlock(codeLines(), 'services', 0) || [], name, 2) || [];
}

// `KEY: value` pairs under a service's environment, quotes removed.
function environment(name) {
  const out = {};
  for (const line of subBlock(service(name), 'environment', 4) || []) {
    const m = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

// The list items under a service's key (volumes, entrypoint, command), quotes removed.
function listUnder(name, key) {
  return (subBlock(service(name), key, 4) || [])
    .filter((l) => /^\s*-\s+/.test(l))
    .map((l) => l.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
}

// Everything under a service's key as one string: list items and folded text.
function textUnder(name, key) {
  const block = subBlock(service(name), key, 4) || [];
  const inline = (service(name).find((l) => indentOf(l) === 4 && l.trim().startsWith(key + ':')) || '').trim();
  return [inline.slice(key.length + 1)].concat(block.map((l) => l.trim().replace(/^-\s+/, ''))).join(' ');
}

function waitsForKeys(name) {
  const keys = subBlock(subBlock(service(name), 'depends_on', 4) || [], 'keys', 6) || [];
  return keys.map((l) => l.trim()).includes('condition: service_completed_successfully');
}

// Every file under docker/, relative to the repository root.
function dockerFiles(rel = 'docker') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const child = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...dockerFiles(child));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

// A database address with a password in it: scheme://user:password@host.
const ADDRESS_WITH_PASSWORD = /postgres(?:ql)?:\/\/[^\s'"`@/]*:[^\s'"`@/]*@/;

describe('docker-compose.yml: no fixed database password', () => {
  it('sets no POSTGRES_PASSWORD value and reads no ${POSTGRES_PASSWORD} anywhere', () => {
    const text = codeLines().join('\n');
    expect(text).toContain('services:');
    expect(text).not.toMatch(/^\s*POSTGRES_PASSWORD\s*:/m);
    expect(text).not.toMatch(/\$\{POSTGRES_PASSWORD/);
  });

  it('holds no database address at all: the keys service writes them from the password it made', () => {
    const text = codeLines().join('\n');
    expect(text).not.toMatch(/postgres(?:ql)?:\/\//);
    expect(text).not.toMatch(ADDRESS_WITH_PASSWORD);
  });

  it('nothing under docker/ holds a database password or an address with one', () => {
    const files = dockerFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect([file, ADDRESS_WITH_PASSWORD.test(text)]).toEqual([file, false]);
      expect([file, /POSTGRES_PASSWORD\s*[:=]\s*\S/.test(text)]).toEqual([file, false]);
    }
  });
});

describe('docker-compose.yml: every service reads the generated password from the keys volume', () => {
  it('the keys service makes it, and hands the files the services read to uid 1000', () => {
    const command = textUnder('keys', 'command');
    expect(command).toContain('node /scripts/gen-keys.js /keys');
    const chown = /chown 1000:1000 ([^\n]*)/.exec(command);
    expect(chown).not.toBeNull();
    for (const file of ['/keys/db_password', '/keys/db.env', '/keys/rest_db_uri']) {
      expect([file, chown[1].split(/\s+/).includes(file)]).toEqual([file, true]);
    }
  });

  it('the database takes its first-start password from /keys/db_password, made before it starts', () => {
    expect(environment('db').POSTGRES_PASSWORD_FILE).toBe('/keys/db_password');
    expect(listUnder('db', 'volumes')).toContain('keys:/keys:ro');
    expect(waitsForKeys('db')).toBe(true);
  });

  it('auth, storage and migrate load /keys/db.env in their entrypoints, and keep no address in their environment', () => {
    for (const name of ['auth', 'storage', 'migrate']) {
      expect([name, textUnder(name, 'entrypoint')]).toEqual([name, expect.stringContaining('. /keys/db.env')]);
      expect([name, listUnder(name, 'volumes')]).toEqual([name, expect.arrayContaining(['keys:/keys:ro'])]);
      expect([name, waitsForKeys(name)]).toEqual([name, true]);
      const env = environment(name);
      expect([name, Object.keys(env).filter((k) => /DATABASE_URL|DB_URI/.test(k))]).toEqual([name, []]);
    }
  });

  it('auth gets its address from DATABASE_URL, with its own search_path, before GoTrue starts', () => {
    const sh = textUnder('auth', 'entrypoint');
    expect(sh).toContain('GOTRUE_DB_DATABASE_URL="$$DATABASE_URL?search_path=auth"');
    expect(sh.indexOf('. /keys/db.env')).toBeLessThan(sh.indexOf('exec auth'));
  });

  it('storage exports DATABASE_URL before it starts', () => {
    const sh = textUnder('storage', 'entrypoint');
    expect(sh).toMatch(/export [^&]*\bDATABASE_URL\b/);
    expect(sh.indexOf('. /keys/db.env')).toBeLessThan(sh.indexOf('exec node'));
  });

  it("migrate's entrypoint runs whatever command it is given, so `docker compose run migrate node …` gets the address too", () => {
    const sh = textUnder('migrate', 'entrypoint');
    expect(sh).toContain('export DATABASE_URL');
    expect(sh).toMatch(/exec "\$\$@"/);
    expect(listUnder('migrate', 'command')).toEqual([]);
    expect(textUnder('migrate', 'command')).toContain('"node", "scripts/db/migrate.js"');
  });

  it('rest (no shell in its image) reads its address from /keys/rest_db_uri with the @file form', () => {
    expect(environment('rest').PGRST_DB_URI).toBe('@/keys/rest_db_uri');
    expect(listUnder('rest', 'volumes')).toContain('keys:/keys:ro');
    expect(waitsForKeys('rest')).toBe(true);
  });
});
