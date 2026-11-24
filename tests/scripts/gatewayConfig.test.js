/**
 * docker/gateway/Caddyfile is the Docker stack's one public door: it listens
 * on :3000, sends /auth/v1, /rest/v1 and /storage/v1 to the local auth, data
 * and storage APIs (prefix stripped) and everything else to the app. These
 * tests read the file as text; Caddy itself is never started.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const CADDYFILE = path.join(ROOT, 'docker', 'gateway', 'Caddyfile');

// The file without comments; '' when it is missing, so each test fails on
// its assertion rather than erroring on the read.
function readConfig() {
  if (!fs.existsSync(CADDYFILE)) return '';
  return fs
    .readFileSync(CADDYFILE, 'utf8')
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

// The text between the braces that follow `header {`, or null.
function block(text, header) {
  const escaped = header.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const match = new RegExp('(^|\\n)\\s*' + escaped + '\\s*\\{').exec(text);
  if (!match) return null;
  let depth = 1;
  const start = match.index + match[0].length;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') depth -= 1;
    if (depth === 0) return text.slice(start, i);
  }
  return null;
}

function upstreams(text) {
  return [...text.matchAll(/reverse_proxy\s+([^\n{]+)/g)].flatMap((m) => m[1].trim().split(/\s+/));
}

function sizeInBytes(value) {
  const match = /^(\d+(?:\.\d+)?)\s*([KMG]i?B|B)?$/i.exec(String(value).trim());
  if (!match) return NaN;
  const unit = (match[2] || 'B').toUpperCase();
  const scale = { B: 1, KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1024 ** 2, GB: 1e9, GIB: 1024 ** 3 }[unit];
  return Number(match[1]) * scale;
}

// Every upload limit the app enforces, in bytes: a numeric limit exported by
// lib/fileSize.js (none today), the dashboard's MAX_FILE_BYTES and the
// sizeLimit of each API route. Next.js reads '25mb' as 25 * 1024 * 1024.
function appUploadLimits() {
  const limits = [];
  const fileSize = require('../../lib/fileSize');
  for (const [name, value] of Object.entries(fileSize)) {
    if (/MAX|LIMIT/i.test(name) && Number.isFinite(value)) limits.push(value);
  }
  const dashboard = fs.readFileSync(path.join(ROOT, 'pages', '[locale]', 'dashboard.js'), 'utf8');
  const dash = /MAX_FILE_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/.exec(dashboard);
  if (dash) limits.push(Number(dash[1]) * 1024 * 1024);
  const apiDir = path.join(ROOT, 'pages', 'api');
  for (const file of fs.readdirSync(apiDir).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(apiDir, file), 'utf8');
    for (const m of source.matchAll(/sizeLimit:\s*['"](\d+(?:\.\d+)?)\s*([kmg]?b)['"]/gi)) {
      const scale = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2].toUpperCase()];
      limits.push(Number(m[1]) * scale);
    }
  }
  return limits;
}

describe('docker/gateway/Caddyfile', () => {
  test('the site listens on :3000', () => {
    const site = block(readConfig(), ':3000');
    expect(site).not.toBeNull();
  });

  test.each([
    ['/auth/v1/*', 'auth:9999'],
    ['/rest/v1/*', 'rest:3000'],
    ['/storage/v1/*', 'storage:5000'],
  ])('%s goes to %s with the prefix stripped', (prefix, upstream) => {
    const site = block(readConfig(), ':3000') || '';
    const route = block(site, 'handle_path ' + prefix);
    expect(route).not.toBeNull();
    expect(upstreams(route)).toEqual([upstream]);
  });

  test('everything else goes to app:3000', () => {
    const site = block(readConfig(), ':3000') || '';
    const fallback = block(site, 'handle');
    expect(fallback).not.toBeNull();
    expect(upstreams(fallback)).toEqual(['app:3000']);
  });

  test('the body limit is at least every upload limit the app enforces', () => {
    const limits = appUploadLimits();
    // Some limit must be found, or this test proves nothing.
    expect(limits.length).toBeGreaterThan(0);
    const site = block(readConfig(), ':3000') || '';
    const body = block(site, 'request_body') || '';
    const match = /max_size\s+(\S+)/.exec(body);
    expect(match).not.toBeNull();
    const maxSize = sizeInBytes(match[1]);
    for (const limit of limits) expect(maxSize).toBeGreaterThanOrEqual(limit);
  });

  test('no route reaches the database', () => {
    const text = readConfig();
    const all = upstreams(text);
    expect(all.sort()).toEqual(['app:3000', 'auth:9999', 'rest:3000', 'storage:5000']);
    expect(text).not.toMatch(/\b(db|postgres|postgresql):\d+|:5432\b/i);
  });
});
