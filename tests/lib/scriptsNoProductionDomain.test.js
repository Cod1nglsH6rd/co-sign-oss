/**
 * Scripts hold no private term (release review T14): the positioning scripts
 * default to http://localhost:3000, and no file under scripts/ holds a term
 * whose hash is in the privacy scanner's terms list (the old production
 * domain among them), checked with the scanner's own hashed-term and email
 * rules, so the terms never appear here in plain text. The one-off debug
 * scripts that read a real tax form (removed earlier) are deleted, so no
 * script directly in scripts/ opens that file any more.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const scan = require('../../scripts/privacy-scan/scan.js');

const RULES = new Set(['hashed-term', 'email']);

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name === 'node_modules') continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, out);
    else out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

function scriptFiles() {
  return walk(path.join(root, 'scripts'));
}

function termFindings(base, files, hashes) {
  const { findings, errors } = scan.scanTree(base, files, { hashes });
  expect(errors).toEqual([]);
  return findings.filter((f) => RULES.has(f.rule)).map((f) => `${f.path}:${f.line} ${f.rule}`);
}

describe('scripts/ holds no hashed private term', () => {
  it('the rule finds a hashed domain in a script and its address default', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scripts-term-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(
      path.join(dir, 'scripts', 'pull.js'),
      "const BASE = process.env.BASE_URL || 'https://app.zebra-quokka.example';\nconst local = 'http://localhost:3000';\n"
    );
    const hashes = new Set([crypto.createHash('sha256').update('zebra-quokka.example').digest('hex')]);
    expect(termFindings(dir, ['scripts/pull.js'], hashes)).toEqual(['scripts/pull.js:1 hashed-term']);
  });

  // The hashes the scanner itself loads by default, as `npm run scan:private`
  // does. The published tree has no terms list, so there the set is empty
  // and the check has nothing to find.
  it('finds no hashed-term or email hit in any file under scripts/', () => {
    const hashes = scan.loadHashes();
    expect(termFindings(root, scriptFiles(), hashes)).toEqual([]);
  });
});

describe('positioning scripts', () => {
  it.each(['pull-fields.js', 'upload-fixtures.js'])('%s defaults to http://localhost:3000', (file) => {
    const text = fs.readFileSync(path.join(root, 'scripts', 'positioning-suite', file), 'utf8');
    expect(text).toContain("'http://localhost:3000'");
  });
});

describe('one-off debug scripts removed', () => {
  // The debug scripts sat directly in scripts/. The positioning suite's
  // gen-forms.js still reads an optional local copy the user supplies, as its
  // README says, so its folder is not part of this check.
  it('no script directly in scripts/ opens the removed tax form', () => {
    const offenders = scriptFiles()
      .filter((f) => /^scripts\/[^/]+$/.test(f))
      .filter((f) => /fw2( copy)?\.pdf/.test(fs.readFileSync(path.join(root, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('keeps the maintained scripts', () => {
    for (const f of ['check-pdf-fields.js', 'sync-locales.js', 'seed-dev.js', 'envSync.js', 'secretScan.js']) {
      expect(fs.existsSync(path.join(root, 'scripts', f))).toBe(true);
    }
  });
});
