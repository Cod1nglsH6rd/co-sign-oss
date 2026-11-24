const fs = require('fs');
const path = require('path');

// Issue co-sign-242: docs/PRD.md and docs/GO-LIVE-CHECKLIST.md no longer say
// Stripe payments or billing are parked in api-disabled/; each says instead
// that no payments are taken. The PRD's dated 2026-06 changelog rows are
// history and stay, so only those rows are skipped; every other line, table
// rows included, is checked.

const ROOT = path.join(__dirname, '..', '..');
const DATED_CHANGELOG_ROW = /^\|\s*2026-06-\d{2}\s*\|/;

const DOCS = [
  { file: 'docs/PRD.md', skip: (line) => DATED_CHANGELOG_ROW.test(line.trim()) },
  { file: 'docs/GO-LIVE-CHECKLIST.md', skip: () => false },
];

function checkedLines({ file, skip }) {
  return fs
    .readFileSync(path.join(ROOT, file), 'utf8')
    .split('\n')
    .filter((line) => !skip(line));
}

describe('Stripe "parked" lines removed from the docs (issue co-sign-242)', () => {
  it.each(DOCS)('$file has no line saying Stripe is parked or in api-disabled/', (doc) => {
    const offending = checkedLines(doc).filter(
      (line) => /stripe/i.test(line) && (/parked/i.test(line) || /api-disabled/.test(line))
    );
    expect(offending).toEqual([]);
  });

  it.each(DOCS)('$file has a line saying no payments are taken', (doc) => {
    const saying = checkedLines(doc).filter((line) => /no payments are taken/i.test(line));
    expect(saying.length).toBeGreaterThan(0);
  });

  it('skips only dated 2026-06 changelog rows, not other table rows', () => {
    const prd = DOCS[0];
    expect(prd.skip('| 2026-06-18 | Billing not wired (Stripe parked) | x |')).toBe(true);
    expect(prd.skip('| Stripe | parked in `api-disabled/` |')).toBe(false);
    expect(prd.skip('| 2026-07-01 | Stripe parked |')).toBe(false);
  });
});
