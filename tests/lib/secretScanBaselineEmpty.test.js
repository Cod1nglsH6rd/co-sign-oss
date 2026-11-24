// Issue co-sign-131: every known secret-scan hit has been cleared, so the
// known-hits list is empty and must stay empty. A new hit is fixed in the
// file that has it, never by listing it here.

const baseline = require('../../scripts/secret-scan-baseline.json');

describe('secret scan known-hits list (co-sign-131)', () => {
  it('is an empty list', () => {
    expect(baseline).toEqual([]);
  });
});
