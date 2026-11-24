/**
 * checkMigrationNames: every migration name starts with a 14-digit timestamp,
 * and the timestamps are unique and strictly increasing.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function load() {
  return require('../../scripts/db/schemaCheck.js');
}

describe('checkMigrationNames', () => {
  it('returns no problems for the real supabase/migrations file names', () => {
    const names = fs
      .readdirSync(path.join(ROOT, 'supabase', 'migrations'))
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(names.length).toBeGreaterThan(0);
    const { checkMigrationNames } = load();
    expect(checkMigrationNames(names)).toEqual([]);
  });

  it('returns no problems for a short well-formed list', () => {
    const { checkMigrationNames } = load();
    expect(
      checkMigrationNames(['20260101000000_a.sql', '20260101000001_b.sql'])
    ).toEqual([]);
  });

  it('reports a duplicate timestamp and names the file', () => {
    const { checkMigrationNames } = load();
    const problems = checkMigrationNames([
      '20260101000000_a.sql',
      '20260101000000_b.sql',
    ]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain('20260101000000_b.sql');
  });

  it('reports a 12-digit timestamp and names the file', () => {
    const { checkMigrationNames } = load();
    const problems = checkMigrationNames([
      '20260101000000_a.sql',
      '202601020000_short.sql',
    ]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain('202601020000_short.sql');
  });

  it('reports an out-of-order list and names the file', () => {
    const { checkMigrationNames } = load();
    const problems = checkMigrationNames([
      '20260102000000_later.sql',
      '20260101000000_earlier.sql',
    ]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain('20260101000000_earlier.sql');
  });

  it('reports a name with no timestamp at all', () => {
    const { checkMigrationNames } = load();
    const problems = checkMigrationNames(['add_things.sql']);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain('add_things.sql');
  });
});
