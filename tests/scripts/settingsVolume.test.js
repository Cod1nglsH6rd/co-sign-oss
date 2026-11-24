// Issue co-sign-313: the owner's saved setup answers live in /app/.cosign.
// In Docker that folder is its own named volume (settings), so the answers
// outlive a rebuild, and the image makes it owned by node so the app, which
// runs as node, can write there. The folder never goes into git or into the
// build context. These tests read the files as text; Docker is never started.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// A missing file reads as '' so each test fails on its assertion.
function read(rel) {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

// Lines without comments or blanks, trimmed.
function lines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

// The Dockerfile lines from the last FROM to the end: the stage the container runs.
function runtimeStage() {
  const all = lines(read('Dockerfile'));
  let last = -1;
  all.forEach((line, i) => {
    if (/^FROM\s/i.test(line)) last = i;
  });
  return last === -1 ? [] : all.slice(last);
}

// The compose file's lines with full-line comments removed, indentation kept.
function composeLines() {
  return read('docker-compose.yml')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line));
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// The lines under `key:` at the given indent; null when the key is not there.
function subBlock(all, key, indent) {
  const start = all.findIndex((l) => indentOf(l) === indent && l.trim().startsWith(key + ':'));
  if (start === -1) return null;
  const out = [];
  for (let i = start + 1; i < all.length; i += 1) {
    if (all[i].trim() !== '' && indentOf(all[i]) <= indent) break;
    out.push(all[i]);
  }
  return out;
}

describe('Dockerfile settings folder (co-sign-313)', () => {
  it('creates /app/.cosign owned by node in the runtime stage, before USER node', () => {
    const stage = runtimeStage();
    const userAt = stage.findIndex((line) => /^USER\s+node\b/i.test(line));
    expect(userAt).toBeGreaterThan(-1);

    const runs = stage.slice(0, userAt).filter((line) => /^RUN\s/i.test(line)).join('\n');
    expect(runs).toMatch(/\bmkdir\b[^\n]*\/app\/\.cosign\b/);
    expect(runs).toMatch(/\bchown\b[^\n]*\bnode(:node)?\s[^\n]*\/app\/\.cosign\b/);
  });
});

describe('docker-compose.yml settings volume (co-sign-313)', () => {
  it('mounts the named volume settings at /app/.cosign on the app service', () => {
    const app = subBlock(subBlock(composeLines(), 'services', 0) || [], 'app', 2) || [];
    const mounts = (subBlock(app, 'volumes', 4) || [])
      .map((l) => /^\s*-\s*["']?([^"'\s]+)["']?\s*$/.exec(l))
      .filter(Boolean)
      .map((m) => m[1]);
    expect(mounts).toContain('settings:/app/.cosign');
  });

  it('declares settings under the top-level volumes', () => {
    const declared = (subBlock(composeLines(), 'volumes', 0) || [])
      .map((l) => /^ {2}([A-Za-z0-9_-]+):/.exec(l))
      .filter(Boolean)
      .map((m) => m[1]);
    expect(declared).toContain('settings');
  });
});

describe('ignore files list .cosign (co-sign-313)', () => {
  const entries = (rel) => lines(read(rel)).map((line) => line.replace(/^\/+|\/+$/g, ''));

  it('.dockerignore lists .cosign', () => {
    expect(entries('.dockerignore')).toContain('.cosign');
  });

  it('.gitignore lists .cosign', () => {
    expect(entries('.gitignore')).toContain('.cosign');
  });
});
