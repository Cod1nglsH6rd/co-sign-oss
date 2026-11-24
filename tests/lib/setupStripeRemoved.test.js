import fs from 'fs';
import path from 'path';

// Issue co-sign-232: scripts/setup.sh no longer prints Stripe setup steps,
// its printed users table has no stripe_customer_id column, and the README
// sentence about the extended schema it prints no longer says "payments".
// Release review T1b (2026-11-21): setup.sh now prints no SQL at all, so there
// is no users table to hold the column, and the README no longer has a
// sentence about a schema printed by setup.sh (tests/lib/readmeCloudSetup.test.js
// pins the database step that replaced it).

const ROOT = path.join(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Stripe removed from scripts/setup.sh (issue co-sign-232)', () => {
  it('setup.sh has no mention of stripe in any case', () => {
    expect(read('scripts/setup.sh')).not.toMatch(/stripe/i);
  });

  it('setup.sh has no price IDs step', () => {
    expect(read('scripts/setup.sh')).not.toMatch(/price IDs/i);
  });

  it('setup.sh prints no users table, so no stripe_customer_id column', () => {
    const script = read('scripts/setup.sh');
    expect(script).not.toMatch(/CREATE TABLE/i);
    expect(script).not.toMatch(/stripe_customer_id/);
  });

  it('no README line about setup.sh mentions payments or a schema it prints', () => {
    const lines = read('README.md')
      .split('\n')
      .filter((l) => l.includes('setup.sh'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toMatch(/payments/i);
      expect(line).not.toMatch(/schema printed by/i);
    }
  });
});
