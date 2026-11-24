import fs from 'fs';
import path from 'path';
import { privateFile } from '../helpers/privateFile';

// Issue co-sign-205: the personal pricing page (pages/[locale]/pricing.js) is
// gone, with a row in docs/REMOVED-FILES.md; nothing in the app links or
// routes to /pricing, and the document-limit upgrade prompt is gone from the
// dashboard and the upload hook. The published tree leaves
// docs/REMOVED-FILES.md out, so there its case is skipped.

const ROOT = path.join(__dirname, '..', '..');
const PAGE = 'pages/[locale]/pricing.js';
const APP_DIRS = ['pages', 'components', 'hooks', 'lib'];
const removedFiles = privateFile('docs/REMOVED-FILES.md');

// Table rows in docs/REMOVED-FILES.md look like: | `some/path` | reason |
function removedPaths() {
  return fs
    .readFileSync(removedFiles.path, 'utf8')
    .split('\n')
    .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|/))
    .filter(Boolean)
    .map((m) => m[1]);
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('pricing page removed (issue co-sign-205)', () => {
  it('the pricing page file is absent from the tree', () => {
    expect(fs.existsSync(path.join(ROOT, PAGE))).toBe(false);
  });

  removedFiles.it('docs/REMOVED-FILES.md has a row for the pricing page', () => {
    expect(removedPaths()).toContain(PAGE);
  });

  it('no file under pages/, components/, hooks/ or lib/ links or routes to /pricing', () => {
    const offenders = APP_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)))
      .filter((file) => /\/pricing\b/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('the landing-page footer has no Pricing link', () => {
    expect(read('pages/[locale]/index.js')).not.toMatch(/footer\.links\.pricing/);
  });

  it('the dashboard no longer handles doc_limit_reached or shows limitReached', () => {
    const source = read('pages/[locale]/dashboard.js');
    expect(source).not.toMatch(/doc_limit_reached/);
    expect(source).not.toMatch(/limitReached/);
  });

  it('useDocuments no longer special-cases doc_limit_reached', () => {
    expect(read('hooks/useDocuments.js')).not.toMatch(/doc_limit_reached/);
  });
});
