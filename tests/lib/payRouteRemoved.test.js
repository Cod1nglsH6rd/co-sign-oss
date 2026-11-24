import fs from 'fs';
import path from 'path';
import { privateFile } from '../helpers/privateFile';

// Issue co-sign-241: the parked Stripe payments file (api-disabled/pay.js) is
// gone, with a row in docs/REMOVED-FILES.md, and README.md no longer mentions
// it or its /api/pay route. The published tree leaves docs/REMOVED-FILES.md
// out, so there its case is skipped.

const ROOT = path.join(__dirname, '..', '..');
const FILE = 'api-disabled/pay.js';
const removedFiles = privateFile('docs/REMOVED-FILES.md');

// Table rows in docs/REMOVED-FILES.md look like: | `some/path` | reason |
function removedRows() {
  return fs
    .readFileSync(removedFiles.path, 'utf8')
    .split('\n')
    .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/))
    .filter(Boolean)
    .map((m) => ({ path: m[1], reason: m[2].trim() }));
}

describe('parked Stripe payments file removed (issue co-sign-241)', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  it('api-disabled/pay.js is absent from the tree', () => {
    expect(fs.existsSync(path.join(ROOT, FILE))).toBe(false);
  });

  removedFiles.it('docs/REMOVED-FILES.md has a row for api-disabled/pay.js with a reason', () => {
    const row = removedRows().find((r) => r.path === FILE);
    expect(row).toBeDefined();
    expect(row.reason).toMatch(/payments/i);
  });

  it('README.md mentions neither pay.js nor /api/pay', () => {
    expect(readme).not.toContain('pay.js');
    expect(readme).not.toContain('/api/pay');
  });

  // Was: the README's project tree still lists the other api-disabled files
  // (chat.js, embed.js) and no Stripe. Release review T13 deleted the whole
  // folder (tests/lib/noDisabledRoutes.test.js), so the tree has no
  // api-disabled block at all, and the block between pages/ and components/
  // names no parked payments file.
  it('README.md project tree has no api-disabled block, and no Stripe file', () => {
    expect(readme).not.toContain('api-disabled');
    const start = readme.indexOf('├── pages/');
    expect(start).toBeGreaterThan(-1);
    const block = readme.slice(start, readme.indexOf('├── components/', start));
    expect(block).not.toMatch(/Stripe|pay\.js/i);
  });
});
