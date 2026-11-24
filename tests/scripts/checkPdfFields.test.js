const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'check-pdf-fields.js');

describe('scripts/check-pdf-fields.js', () => {
  it('prints a usage line and exits 1 when no path is given, before reading any file', () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Usage: node scripts/check-pdf-fields.js <file.pdf>');
    expect(run.stdout).not.toContain('PDF Raw Content Analysis');
  });

  it('treats an empty path as missing', () => {
    const run = spawnSync(process.execPath, [SCRIPT, '  '], { encoding: 'utf8' });
    expect(run.status).toBe(1);
  });

  it('has no personal laptop path in its source', () => {
    expect(fs.readFileSync(SCRIPT, 'utf8')).not.toContain('/Users/');
  });
});
