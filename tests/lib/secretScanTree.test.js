// Every synthetic key below is assembled at run time from short fragments, so
// this file holds no key-shaped literal. Planted files are never written: the
// test hands checkTree a path list and a reader that returns their text.

const fs = require('fs');
const path = require('path');
const secretScan = require('../../scripts/secretScan');

const ROOT = path.resolve(__dirname, '..', '..');

const dash = '-';
// 40 key characters with no x, so the value never reads as an "xxx" placeholder.
const filler = 'Ab3Cd4Ef5Gh6Jk7Lm8Np9Qr2St3Uv4Wy5Za6Bc7D';
const anthropicKey = 'sk' + dash + 'ant' + dash + 'api03' + dash + filler;

// Folders never walked, and the names .gitignore's entries give, as
// {anchored, re}: an entry with a leading / names a path at the root only.
const SKIPPED = ['.git', 'node_modules', '.next', 'coverage'];

function ignoreRules() {
  return fs
    .readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'))
    .map((l) => {
      const anchored = l.startsWith('/');
      const name = l.replace(/^\/+|\/+$/g, '');
      const source = name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
      return { anchored, re: new RegExp('^' + source + '$') };
    });
}

// Every file under the repository root, relative to it, with / separators.
function treeFiles() {
  const rules = ignoreRules();
  const files = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const p = rel ? rel + '/' + entry.name : entry.name;
      if (SKIPPED.includes(entry.name)) continue;
      if (rules.some((r) => r.re.test(r.anchored ? p : entry.name))) continue;
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) files.push(p);
    }
  };
  walk('');
  return files;
}

// A reader over an in-memory {path: text} map, in place of the disk.
function reader(files) {
  return (p) => Buffer.from(files[p]);
}

const planted = 'lib/planted-key.js';
const plantedText = 'const a = 1;\nconst key = "' + anthropicKey + '";\n';

function expectTreeApi() {
  for (const name of ['checkTree', 'formatProblems', 'loadBaseline', 'main']) {
    expect(typeof secretScan[name]).toBe('function');
  }
}

describe('tree scan against the baseline', () => {
  beforeEach(expectTreeApi);

  it('finds no hit outside the baseline in the repository tree', () => {
    const result = secretScan.checkTree({ paths: treeFiles() });
    expect(secretScan.formatProblems({ unlisted: result.unlisted, stale: [] })).toEqual([]);
    expect(secretScan.formatProblems({ unlisted: [], stale: result.stale })).toEqual([]);
  }, 120000);

  it('keeps the baseline to {file, kind, count} entries for files in the tree and known kinds', () => {
    const baseline = secretScan.loadBaseline();
    const files = treeFiles();
    const kindNames = secretScan.kinds.map((k) => k.kind);
    // The list may be empty: it is once every known hit has been cleared (co-sign-131).
    expect(Array.isArray(baseline)).toBe(true);
    for (const entry of baseline) {
      expect(Object.keys(entry).sort()).toEqual(['count', 'file', 'kind']);
      expect(Number.isInteger(entry.count) && entry.count > 0).toBe(true);
      expect(kindNames).toContain(entry.kind);
      expect(files).toContain(entry.file);
    }
  });

  it('fails on a key planted in an injected tracked-looking path', () => {
    const result = secretScan.checkTree({ paths: [planted], readFile: reader({ [planted]: plantedText }), baseline: [] });
    expect(result).toEqual({ unlisted: [{ file: planted, line: 2, kind: 'anthropic' }], stale: [] });
    const lines = secretScan.formatProblems(result);
    expect(lines).toEqual([planted + ':2:anthropic']);
    expect(lines.some((l) => l.includes(filler.slice(0, 12)))).toBe(false);
  });

  it('fails on a planted key next to the real baseline', () => {
    const baseline = [{ file: 'docs/PRD.md', kind: 'supabase-ref', count: 1 }];
    const ref = 'qwertyuiop' + 'asdfghjklm';
    const files = { 'docs/PRD.md': 'live co-sign DB (`' + ref + '`)\n', [planted]: plantedText };
    const result = secretScan.checkTree({ paths: Object.keys(files), readFile: reader(files), baseline });
    expect(result).toEqual({ unlisted: [{ file: planted, line: 2, kind: 'anthropic' }], stale: [] });
  });

  it('passes when every hit is covered by a baseline entry for its file and kind', () => {
    const result = secretScan.checkTree({
      paths: [planted],
      readFile: reader({ [planted]: plantedText }),
      baseline: [{ file: planted, kind: 'anthropic', count: 1 }],
    });
    expect(result).toEqual({ unlisted: [], stale: [] });
  });

  it('reports every hit of a file and kind that has more hits than its count', () => {
    const text = 'a = "' + anthropicKey + '"\nb = "' + anthropicKey + '"\n';
    const result = secretScan.checkTree({
      paths: [planted],
      readFile: reader({ [planted]: text }),
      baseline: [{ file: planted, kind: 'anthropic', count: 1 }],
    });
    expect(result.unlisted).toEqual([
      { file: planted, line: 1, kind: 'anthropic' },
      { file: planted, line: 2, kind: 'anthropic' },
    ]);
  });

  it('does not let an entry for another kind or file cover a hit', () => {
    const result = secretScan.checkTree({
      paths: [planted],
      readFile: reader({ [planted]: plantedText }),
      baseline: [
        { file: planted, kind: 'stripe', count: 1 },
        { file: 'lib/other.js', kind: 'anthropic', count: 1 },
      ],
    });
    expect(result.unlisted).toEqual([{ file: planted, line: 2, kind: 'anthropic' }]);
    expect(result.stale).toEqual([
      { file: planted, kind: 'stripe', count: 1 },
      { file: 'lib/other.js', kind: 'anthropic', count: 1 },
    ]);
  });

  it('reports a baseline entry that no longer hits as stale, naming file and kind only', () => {
    const entry = { file: 'lib/clean.js', kind: 'stripe', count: 1 };
    const result = secretScan.checkTree({
      paths: ['lib/clean.js'],
      readFile: reader({ 'lib/clean.js': 'module.exports = 1;\n' }),
      baseline: [entry],
    });
    expect(result).toEqual({ unlisted: [], stale: [entry] });
    expect(secretScan.formatProblems(result)).toEqual(['lib/clean.js:-:stripe']);
  });
});

describe('CLI mode', () => {
  beforeEach(expectTreeApi);

  it('prints file:line:kind for an unlisted hit, never the value, and returns 1', () => {
    const out = [];
    const code = secretScan.main({
      paths: [planted],
      readFile: reader({ [planted]: plantedText }),
      baseline: [],
      log: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out).toEqual([planted + ':2:anthropic']);
  });

  it('prints nothing and returns 0 when every hit is listed', () => {
    const out = [];
    const code = secretScan.main({
      paths: [planted],
      readFile: reader({ [planted]: plantedText }),
      baseline: [{ file: planted, kind: 'anthropic', count: 1 }],
      log: (line) => out.push(line),
    });
    expect(code).toBe(0);
    expect(out).toEqual([]);
  });
});

describe('false positives found in the tree', () => {
  it('does not report a glyph name assigned in the pdf.js glyph table as a supabase-ref', () => {
    expect(secretScan.scanText('e.abbreviationsigndeva=2416;e.ref=1', 'public/pdf.worker.min.js')).toEqual([]);
  });

  it('still reports a 20-letter ref given as a value next to ref', () => {
    const ref = 'qwertyuiop' + 'asdfghjklm';
    expect(secretScan.scanText('const ref = "' + ref + '";', 'a.js')).toEqual([{ file: 'a.js', line: 1, kind: 'supabase-ref' }]);
  });

  it('does not decode an npm sha512 integrity hash, even one whose bytes read as a key', () => {
    // Base64 of printable text holding a key: scanned if the sha512- skip were gone.
    const hash = Buffer.from('key=' + anthropicKey + '!!').toString('base64');
    const line = '      "integrity": "sha512-' + hash + '",';
    expect(secretScan.scanText(line, 'package-lock.json')).toEqual([]);
  });
});
