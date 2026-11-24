import fs from 'fs';
import path from 'path';
import { privateFile } from '../helpers/privateFile';

// Issue co-sign-215: the billing page (pages/[locale]/billing.js) is gone,
// with a row in docs/REMOVED-FILES.md, and the shared AppLayout menu no
// longer links to it. The published tree leaves docs/REMOVED-FILES.md out,
// so there its case is skipped.

const ROOT = path.join(__dirname, '..', '..');
const PAGE = 'pages/[locale]/billing.js';
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

describe('billing page removed (issue co-sign-215)', () => {
  it('the billing page file is absent from the tree', () => {
    expect(fs.existsSync(path.join(ROOT, PAGE))).toBe(false);
  });

  removedFiles.it('docs/REMOVED-FILES.md has a row for the billing page', () => {
    expect(removedPaths()).toContain(PAGE);
  });

  it('AppLayout has no billing link, menu item or card icon', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'components', 'layout', 'AppLayout.js'),
      'utf8'
    );
    expect(source).not.toMatch(/\/billing/);
    expect(source).not.toMatch(/t\(\s*['"]billing['"]\s*\)/);
    expect(source).not.toMatch(/FiCreditCard/);
    expect(source).not.toMatch(/billing/i);
  });
});
