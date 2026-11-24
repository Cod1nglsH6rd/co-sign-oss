/**
 * docker-compose.yml brings up the whole stack with one command: the app, its
 * own database, auth, data and storage APIs, and the gateway in front. These
 * tests read the file as text; Docker is never started.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const COMPOSE = path.join(ROOT, 'docker-compose.yml');

// The file's lines without full-line comments; [] when it is missing, so each
// test fails on its assertion rather than erroring on the read.
function readLines() {
  if (!fs.existsSync(COMPOSE)) return [];
  return fs
    .readFileSync(COMPOSE, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line));
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// The lines under `key:` at the given indent: every following line that is
// blank or indented deeper. null when the key is not there.
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

// { name: lines } for each service under the top-level `services:` key.
function services() {
  const block = subBlock(readLines(), 'services', 0) || [];
  const result = {};
  let current = null;
  for (const line of block) {
    const name = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (name) {
      current = name[1];
      result[current] = [];
    } else if (current) {
      result[current].push(line);
    }
  }
  return result;
}

// The list items (`- value`) right under `key:` in a service, quotes removed.
function listUnder(serviceLines, key) {
  const block = subBlock(serviceLines, key, 4) || [];
  return block
    .filter((l) => /^\s*-\s+/.test(l))
    .map((l) => l.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
}

describe('docker-compose.yml', () => {
  test('every ${VAR} in the file has a :- default, so no variable or .env file is needed', () => {
    const text = readLines().join('\n');
    // $$ is an escaped dollar, not a substitution.
    const vars = [...text.matchAll(/(?<!\$)\$\{([^}]*)\}/g)].map((m) => m[1]);
    expect(vars).toContain('COSIGN_PORT:-3000');
    const withoutDefault = vars.filter((v) => !/^[A-Za-z_][A-Za-z0-9_]*:-/.test(v));
    expect(withoutDefault).toEqual([]);
  });

  test('the database, storage and keys live on named volumes, never on a host path', () => {
    const all = services();
    expect(listUnder(all.db || [], 'volumes')).toContain('db-data:/var/lib/postgresql/data');
    expect(listUnder(all.storage || [], 'volumes').some((v) => v.startsWith('storage-data:'))).toBe(true);
    expect(listUnder(all.keys || [], 'volumes').some((v) => v.startsWith('keys:'))).toBe(true);

    const declared = (subBlock(readLines(), 'volumes', 0) || [])
      .map((l) => /^ {2}([A-Za-z0-9_-]+):/.exec(l))
      .filter(Boolean)
      .map((m) => m[1]);
    expect(declared).toEqual(expect.arrayContaining(['db-data', 'storage-data', 'keys']));

    const sources = Object.values(all).flatMap((lines) => listUnder(lines, 'volumes').map((v) => v.split(':')[0]));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((s) => s.startsWith('/'))).toEqual([]);
  });

  // 2026-11-21: was '${COSIGN_PORT:-3000}:3000', which
  // published plain HTTP on every interface. Now loopback unless COSIGN_BIND says otherwise.
  test('only the gateway publishes a port, on ${COSIGN_PORT:-3000} of ${COSIGN_BIND:-127.0.0.1}', () => {
    const all = services();
    const publishing = Object.keys(all).filter((name) => subBlock(all[name], 'ports', 4) !== null);
    expect(publishing).toEqual(['gateway']);
    expect(listUnder(all.gateway, 'ports')).toEqual(['${COSIGN_BIND:-127.0.0.1}:${COSIGN_PORT:-3000}:3000']);
  });

  test('the comment above the port says what binding to 0.0.0.0 exposes and what else may change', () => {
    const raw = fs.existsSync(COMPOSE) ? fs.readFileSync(COMPOSE, 'utf8').split('\n') : [];
    const gateway = raw.findIndex((l) => l === '  gateway:');
    const ports = raw.findIndex((l, i) => i > gateway && l === '    ports:');
    expect(gateway).toBeGreaterThan(-1);
    expect(ports).toBeGreaterThan(gateway);
    const comment = [];
    for (let i = ports - 1; i > gateway && /^\s*#/.test(raw[i]); i -= 1) comment.unshift(raw[i].replace(/^\s*#\s?/, ''));
    const text = comment.join(' ');
    expect(text).toContain('COSIGN_BIND');
    expect(text).toContain('127.0.0.1');
    expect(text).toContain('0.0.0.0');
    expect(text).toMatch(/plain HTTP/);
    expect(text).toMatch(/TLS|HTTPS/);
    expect(text).toContain('COSIGN_TRUSTED_PROXY_HOPS');
  });

  test('the app starts only after the migration run completed successfully', () => {
    const app = services().app || [];
    const migrate = subBlock(subBlock(app, 'depends_on', 4) || [], 'migrate', 6) || [];
    expect(migrate.map((l) => l.trim())).toContain('condition: service_completed_successfully');
  });

  test('the stack has every service, and the one-shot ones are keys and migrate', () => {
    const all = services();
    expect(Object.keys(all).sort()).toEqual(['app', 'auth', 'db', 'gateway', 'keys', 'migrate', 'rest', 'storage']);
  });

  test('every long-running service restarts unless stopped and has a healthcheck', () => {
    const all = services();
    const longRunning = ['db', 'auth', 'rest', 'storage', 'gateway', 'app'];
    for (const name of longRunning) {
      const lines = all[name] || [];
      expect([name, lines.map((l) => l.trim()).includes('restart: unless-stopped')]).toEqual([name, true]);
      expect([name, subBlock(lines, 'healthcheck', 4) !== null]).toEqual([name, true]);
    }
  });

  test('the app reaches Supabase through the gateway, and the browser uses its own origin', () => {
    const env = (subBlock(services().app || [], 'environment', 4) || []).map((l) => l.trim());
    expect(env).toContain('SUPABASE_URL: http://gateway:3000');
    expect(env).toContain('PUBLIC_SUPABASE_URL: ""');
  });
});
