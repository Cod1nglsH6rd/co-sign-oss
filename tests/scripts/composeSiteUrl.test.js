/**
 * The address the Docker stack is served at (2026-11-21). Until then the auth
 * service had fixed addresses, http://localhost:<COSIGN_PORT>, so every link it
 * made (the one-time invite link the owner copies, for one) opened only in a
 * browser on the host machine, and a return address under the owner's real
 * address was outside its allow list.
 *
 * Now one compose setting, COSIGN_SITE_URL, gives the auth service its
 * external URL (<site>/auth/v1), its site URL and its redirect allow list
 * (<site>/**), with http://localhost:<COSIGN_PORT> when it is not set. The app
 * gets it as NEXT_PUBLIC_APP_URL, blank when it is not set, so an install that
 * sets nothing keeps the Site address saved at /setup.
 *
 * These tests read docker-compose.yml and the gateway's Caddyfile as text and
 * run the auth service's entrypoint with sh, with the key files and GoTrue
 * itself left out; Docker is never started.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const COMPOSE = path.join(ROOT, 'docker-compose.yml');
const CADDYFILE = path.join(ROOT, 'docker', 'gateway', 'Caddyfile');

// A missing file reads as '' so each test fails on its assertion.
function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function isComment(line) {
  return /^\s*#/.test(line);
}

// The lines of one service, from `  <name>:` up to the next service.
function serviceLines(name) {
  const lines = read(COMPOSE).split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {0,2}\S/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

// { KEY: 'raw value' } under a service's `environment:` map, comments skipped.
function environment(name) {
  const lines = serviceLines(name);
  const start = lines.findIndex((l) => l === '    environment:');
  const env = {};
  if (start === -1) return env;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || isComment(line)) continue;
    if (!/^ {6}\S/.test(line)) break;
    const m = /^ {6}([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return env;
}

// The comment lines right above a service's `KEY:` line, as one string.
function commentAbove(name, key) {
  const lines = serviceLines(name);
  const at = lines.findIndex((l) => !isComment(l) && l.trim().startsWith(key + ':'));
  if (at === -1) return '';
  const comment = [];
  for (let i = at - 1; i >= 0 && isComment(lines[i]); i -= 1) comment.unshift(lines[i].replace(/^\s*#\s?/, ''));
  return comment.join(' ');
}

// The shell the auth container runs: the last item of its entrypoint list.
function authEntrypoint() {
  const lines = serviceLines('auth');
  const start = lines.findIndex((l) => l.trim() === 'entrypoint:');
  if (start === -1) return '';
  const items = [];
  for (let i = start + 1; i < lines.length && /^\s*- /.test(lines[i]); i += 1) {
    items.push(lines[i].replace(/^\s*- /, ''));
  }
  return items[items.length - 1] || '';
}

// What Compose puts in the container for a value written `${VAR:-default}` in
// the file, given the host's settings: the setting when it is set and not
// blank, else the default. Any other value is taken as it is written.
function interpolate(raw, host) {
  const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*):-([^${}]*)\}$/.exec(raw);
  if (!m) return raw;
  return host[m[1]] ? host[m[1]] : m[2];
}

const LOAD_KEYS = '. /keys/supabase.env && . /keys/db.env && ';
const START = 'exec auth';

// The three addresses the auth service would start with, for the given host
// settings: the auth environment from the file, then its entrypoint with the
// key files and GoTrue left out (GoTrue's start replaced by printing them).
function authAddresses(host = {}) {
  const env = { PATH: process.env.PATH };
  for (const [key, raw] of Object.entries(environment('auth'))) env[key] = interpolate(raw, host);
  // In the file, $$ is Compose's escaped dollar: the shell gets one.
  const sh = authEntrypoint()
    .replace(/\$\$/g, '$')
    .replace(LOAD_KEYS, '')
    .replace(START, 'printf "%s\\n" "$API_EXTERNAL_URL" "$GOTRUE_SITE_URL" "$GOTRUE_URI_ALLOW_LIST"');
  const res = spawnSync('sh', ['-c', sh], { env, encoding: 'utf8' });
  expect(res.status).toBe(0);
  const [external, site, allow] = res.stdout.split('\n');
  return { API_EXTERNAL_URL: external, GOTRUE_SITE_URL: site, GOTRUE_URI_ALLOW_LIST: allow };
}

describe('docker-compose.yml: the auth service follows COSIGN_SITE_URL', () => {
  test('the auth service gets COSIGN_SITE_URL (blank by default) and COSIGN_PORT, and no fixed address', () => {
    const env = environment('auth');
    expect(env.COSIGN_SITE_URL).toBe('${COSIGN_SITE_URL:-}');
    expect(env.COSIGN_PORT).toBe('${COSIGN_PORT:-3000}');
    for (const name of ['API_EXTERNAL_URL', 'GOTRUE_SITE_URL', 'GOTRUE_URI_ALLOW_LIST']) {
      expect([name, env[name]]).toEqual([name, undefined]);
    }
  });

  test('the entrypoint builds the three addresses from one site address before GoTrue starts', () => {
    const sh = authEntrypoint();
    expect(sh).toContain(LOAD_KEYS);
    expect(sh.endsWith(START)).toBe(true);
    // Compose substitutes nothing in it: every dollar is an escaped one.
    expect(sh.replace(/\$\$/g, '')).not.toContain('$');
    const site = sh.indexOf('site="$${COSIGN_SITE_URL:-http://localhost:$$COSIGN_PORT}"');
    expect(site).toBeGreaterThan(-1);
    const exported = sh.indexOf('export API_EXTERNAL_URL="$$site/auth/v1" GOTRUE_SITE_URL="$$site" GOTRUE_URI_ALLOW_LIST="$$site/**"');
    expect(exported).toBeGreaterThan(site);
    expect(sh.indexOf(START)).toBeGreaterThan(exported);
  });

  test('with nothing set, the addresses are the localhost ones the stack always had', () => {
    expect(authAddresses({})).toEqual({
      API_EXTERNAL_URL: 'http://localhost:3000/auth/v1',
      GOTRUE_SITE_URL: 'http://localhost:3000',
      GOTRUE_URI_ALLOW_LIST: 'http://localhost:3000/**',
    });
  });

  test('with only COSIGN_PORT set, they follow the port as before', () => {
    expect(authAddresses({ COSIGN_PORT: '8080' })).toEqual({
      API_EXTERNAL_URL: 'http://localhost:8080/auth/v1',
      GOTRUE_SITE_URL: 'http://localhost:8080',
      GOTRUE_URI_ALLOW_LIST: 'http://localhost:8080/**',
    });
  });

  test.each([
    ['a domain behind a proxy', 'https://sign.example.com'],
    ['a LAN address with the port', 'http://192.168.1.20:3000'],
  ])('with COSIGN_SITE_URL set to %s, every address is under it, whatever COSIGN_PORT is', (_label, site) => {
    expect(authAddresses({ COSIGN_SITE_URL: site, COSIGN_PORT: '8080' })).toEqual({
      API_EXTERNAL_URL: `${site}/auth/v1`,
      GOTRUE_SITE_URL: site,
      GOTRUE_URI_ALLOW_LIST: `${site}/**`,
    });
  });

  test('a trailing slash on COSIGN_SITE_URL is dropped', () => {
    expect(authAddresses({ COSIGN_SITE_URL: 'https://sign.example.com/' })).toEqual({
      API_EXTERNAL_URL: 'https://sign.example.com/auth/v1',
      GOTRUE_SITE_URL: 'https://sign.example.com',
      GOTRUE_URI_ALLOW_LIST: 'https://sign.example.com/**',
    });
  });

  test('the app gets COSIGN_SITE_URL as NEXT_PUBLIC_APP_URL, blank when it is not set', () => {
    // Blank, not localhost: a blank setting counts as unset (lib/hostSettings.js),
    // so with nothing set the Site address saved at /setup still applies.
    expect(environment('app').NEXT_PUBLIC_APP_URL).toBe('${COSIGN_SITE_URL:-}');
  });

  test('COSIGN_SITE_URL is used only with a blank default, in auth and app', () => {
    const uses = read(COMPOSE)
      .split('\n')
      .filter((l) => !isComment(l))
      .join('\n')
      .match(/(?<!\$)\$\{COSIGN_SITE_URL[^}]*\}/g);
    expect(uses).toEqual(['${COSIGN_SITE_URL:-}', '${COSIGN_SITE_URL:-}']);
  });

  test('the comment above the setting gives the rule for it and the Site address saved at /setup', () => {
    const text = commentAbove('auth', 'COSIGN_SITE_URL');
    expect(text).toContain('COSIGN_SITE_URL');
    expect(text).toContain('http://localhost:<COSIGN_PORT>');
    expect(text).toContain('NEXT_PUBLIC_APP_URL');
    expect(text).toMatch(/\/setup/);
    expect(text).toMatch(/wins/);
    expect(text).toMatch(/invite/i);
  });

  test('no other fixed localhost address is left in the file outside healthchecks', () => {
    const fixed = read(COMPOSE)
      .split('\n')
      .filter((l) => !isComment(l) && /localhost/.test(l))
      .filter((l) => !/^\s*test: \[/.test(l))
      .filter((l) => !l.includes('$${COSIGN_SITE_URL:-http://localhost:$$COSIGN_PORT}'));
    expect(fixed).toEqual([]);
  });

  // 2026-11-21, found by the end-to-end run: GoTrue builds each link it makes
  // as API_EXTERNAL_URL resolved against its mailer URL path, and the default
  // paths are absolute ('/verify'), so the /auth/v1 of API_EXTERNAL_URL was
  // replaced: the invite link the owner copied was <site>/verify, which the
  // gateway sends to the app (a 404), not to the auth service. Resolved here
  // the same way (a URL reference against a base, as Go's ResolveReference
  // does), every link path must come out at <site>/auth/v1/verify.
  test.each([
    'GOTRUE_MAILER_URLPATHS_INVITE',
    'GOTRUE_MAILER_URLPATHS_RECOVERY',
    'GOTRUE_MAILER_URLPATHS_CONFIRMATION',
    'GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE',
  ])('%s puts the links the auth service makes under its /auth/v1 address', (name) => {
    const linkPath = environment('auth')[name];
    expect([name, linkPath]).toEqual([name, '/auth/v1/verify']);
    for (const host of [{}, { COSIGN_SITE_URL: 'https://sign.example.com' }]) {
      const { API_EXTERNAL_URL: external } = authAddresses(host);
      expect(new URL(linkPath, external).href).toBe(`${external}/verify`);
    }
    const code = read(CADDYFILE).split('\n').filter((l) => !isComment(l)).join('\n');
    expect(code).toMatch(/handle_path \/auth\/v1\/\* \{\s*reverse_proxy auth:9999/);
  });

  test("the gateway's Caddyfile names no host: it answers on :3000 whatever the address", () => {
    const code = read(CADDYFILE)
      .split('\n')
      .filter((l) => !isComment(l));
    expect(code.some((l) => l.trim() === ':3000 {')).toBe(true);
    expect(code.filter((l) => /localhost|https?:\/\//.test(l))).toEqual([]);
  });
});
