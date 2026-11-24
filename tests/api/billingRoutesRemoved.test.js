import fs from 'fs';
import path from 'path';
import { privateFile } from '../helpers/privateFile';

// Issue co-sign-224: no payments are taken, so the checkout and portal
// billing routes are deleted, docs/REMOVED-FILES.md records why, and the
// README no longer describes /api/billing/* at all. The published tree leaves
// docs/REMOVED-FILES.md out, so there its case is skipped.

const ROOT = path.join(__dirname, '..', '..');
const ROUTES = [
  'pages/api/billing/checkout.js',
  'pages/api/billing/portal.js',
  'pages/api/billing/webhook.js',
];
const removedFiles = privateFile('docs/REMOVED-FILES.md');

// Table rows look like: | `some/path` | reason |
function removedPaths() {
  return fs
    .readFileSync(removedFiles.path, 'utf8')
    .split('\n')
    .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/))
    .filter(Boolean)
    .map((m) => m[1]);
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'coverage', 'tests']);
const SOURCE_EXT = /\.(js|jsx|mjs|cjs|ts|tsx)$/;

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(path.join(dir, entry.name), out);
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// import ... from '.../lib/stripe' or require('.../lib/stripe')
const IMPORTS_LIB_STRIPE =
  /(?:from\s+|require\(\s*|import\(\s*)['"][^'"]*lib\/stripe(?:\.js)?['"]/;

describe('checkout and portal billing routes removed (issue co-sign-224)', () => {
  it('the pages/api/billing folder is gone', () => {
    expect(fs.existsSync(path.join(ROOT, 'pages', 'api', 'billing'))).toBe(false);
  });

  removedFiles.it('docs/REMOVED-FILES.md has a row for each billing route file', () => {
    const listed = removedPaths();
    for (const route of ROUTES) {
      expect(listed).toContain(route);
    }
  });

  it('README.md does not mention /api/billing', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    expect(readme).not.toContain('/api/billing');
  });

  it('no source file outside lib/stripe.js and tests/ imports lib/stripe', () => {
    const own = path.join(ROOT, 'lib', 'stripe.js');
    const importers = sourceFiles(ROOT)
      .filter((file) => file !== own)
      .filter((file) => IMPORTS_LIB_STRIPE.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    expect(importers).toEqual([]);
  });
});
