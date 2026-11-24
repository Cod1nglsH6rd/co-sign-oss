/**
 * The migration runner names the two settings it reads, so the settings
 * checker (scripts/envSync.js) sees them and .env.example can list them.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const REL = 'scripts/db/migrate.js';

function readRunner() {
  return fs.readFileSync(path.join(ROOT, REL), 'utf8');
}

// The file without block or line comments, whitespace collapsed.
function codeOf(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ');
}

describe('migration runner settings', () => {
  it('the settings checker finds exactly DATABASE_URL and MIGRATE_ALLOW_REMOTE read in the runner', () => {
    const { collectEnvReads } = require('../../scripts/envSync.js');
    const { reads, unresolved } = collectEnvReads([{ path: REL, text: readRunner() }]);
    const names = [...new Set(reads.map((r) => r.name))].sort();
    expect(names).toEqual(['DATABASE_URL', 'MIGRATE_ALLOW_REMOTE']);
    expect(unresolved).toEqual([]);
  });

  it('the entry block passes both settings to runMigrations by name', () => {
    const code = codeOf(readRunner());
    const start = code.indexOf('if (require.main === module) {');
    expect(start).toBeGreaterThan(-1);
    const entry = code.slice(start);
    expect(entry).toMatch(
      /runMigrations\(\s*\{\s*env:\s*\{\s*DATABASE_URL:\s*process\.env\.DATABASE_URL,\s*MIGRATE_ALLOW_REMOTE:\s*process\.env\.MIGRATE_ALLOW_REMOTE,?\s*\}\s*,?\s*\}\s*\)/,
    );
  });
});
