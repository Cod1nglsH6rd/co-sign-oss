import fs from 'fs';
import path from 'path';
import { privateFile } from '../helpers/privateFile';

// Issue co-sign-223: no payments are taken, so the Stripe webhook route is
// deleted and docs/REMOVED-FILES.md records why. The published tree leaves
// docs/REMOVED-FILES.md out, so there its case is skipped.

const ROOT = path.join(__dirname, '..', '..');
const ROUTE = 'pages/api/billing/webhook.js';
const removedFiles = privateFile('docs/REMOVED-FILES.md');

// Table rows look like: | `some/path` | reason |
function removedRows() {
  return fs
    .readFileSync(removedFiles.path, 'utf8')
    .split('\n')
    .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/))
    .filter(Boolean)
    .map((m) => ({ path: m[1], reason: m[2].trim() }));
}

describe('billing webhook route removed (issue co-sign-223)', () => {
  it('pages/api/billing/webhook.js is gone', () => {
    expect(fs.existsSync(path.join(ROOT, ROUTE))).toBe(false);
  });

  removedFiles.it('docs/REMOVED-FILES.md has a row for it saying no payments are taken', () => {
    const row = removedRows().find((r) => r.path === ROUTE);
    expect(row).toBeDefined();
    expect(row.reason).toMatch(/no payments are taken/i);
  });
});
