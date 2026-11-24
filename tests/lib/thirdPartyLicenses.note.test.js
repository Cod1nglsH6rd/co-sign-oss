/**
 * Licence-list generator, part two: render() puts a note right under the
 * '# Third-party licences' title saying whether any GPL or AGPL package is
 * present (LGPL does not count), every flagged package in the real
 * package-lock.json has a reason in reviewed.json, and the list for the real
 * lockfile stays under 300 lines.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const reviewedPath = path.join(root, 'scripts', 'third-party-licenses', 'reviewed.json');

// Release review T4: the real lockfile is read against the installed
// package.json files, as the generator does, so packages whose lock entry has
// no licence (next, Sentry, OpenTelemetry) get their real one and need no
// reviewed reason; collect(lock) alone left them as 'No licence'.
function realEntries() {
  const { collect } = require('../../scripts/third-party-licenses/generate.js');
  return collect(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')), { installedRoot: root });
}

function noteOf(md) {
  const lines = md.split('\n');
  expect(lines[0]).toBe('# Third-party licences');
  const note = lines.slice(1).find((l) => l.trim() !== '');
  expect(note.startsWith('#')).toBe(false);
  return note;
}

describe('GPL/AGPL note under the title', () => {
  it('says none is present for MIT and LGPL-only entries', () => {
    const { render } = require('../../scripts/third-party-licenses/generate.js');
    const entries = [
      { name: 'alpha', version: '1.0.0', license: 'MIT', dev: false },
      { name: 'lgpl-thing', version: '5.0.0', license: 'LGPL-3.0-or-later', dev: false },
      { name: 'lgpl-two', version: '2.0.0', license: 'Apache-2.0 AND LGPL-3.0-or-later', dev: true },
    ];
    expect(noteOf(render(entries, {}))).toBe('No GPL or AGPL package is present.');
  });

  it('names a GPL-3.0 and an AGPL-3.0 entry', () => {
    const { render } = require('../../scripts/third-party-licenses/generate.js');
    const entries = [
      { name: 'alpha', version: '1.0.0', license: 'MIT', dev: false },
      { name: 'gpl-thing', version: '3.1.0', license: 'GPL-3.0', dev: false },
      { name: 'agpl-thing', version: '0.4.0', license: 'AGPL-3.0', dev: true },
      { name: 'lgpl-thing', version: '5.0.0', license: 'LGPL-3.0-or-later', dev: false },
    ];
    const note = noteOf(render(entries, {}));
    expect(note).not.toBe('No GPL or AGPL package is present.');
    expect(note).toContain('gpl-thing@3.1.0');
    expect(note).toContain('agpl-thing@0.4.0');
    expect(note).not.toContain('alpha@');
    expect(note).not.toContain('lgpl-thing@');
  });
});

describe('the real lockfile', () => {
  it('check() returns code 0 with the real reviewed.json', () => {
    const { check } = require('../../scripts/third-party-licenses/generate.js');
    expect(fs.existsSync(reviewedPath)).toBe(true);
    const reviewed = JSON.parse(fs.readFileSync(reviewedPath, 'utf8'));
    const result = check(realEntries(), reviewed);
    expect(result.output).toBe('');
    expect(result.code).toBe(0);
  });

  it('render() is under 300 lines', () => {
    const { render } = require('../../scripts/third-party-licenses/generate.js');
    const reviewed = fs.existsSync(reviewedPath) ? JSON.parse(fs.readFileSync(reviewedPath, 'utf8')) : {};
    const lines = render(realEntries(), reviewed).split('\n');
    expect(lines.length).toBeLessThan(300);
  });
});
