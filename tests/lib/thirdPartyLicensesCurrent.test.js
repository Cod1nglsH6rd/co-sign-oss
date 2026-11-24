/**
 * THIRD-PARTY-LICENSES.md at the repo root is the generator's output for the
 * real package-lock.json (read against the installed package.json files),
 * reviewed.json, assets.json and each supabase/functions/<name>/deno.json,
 * read offline.
 * When a dependency changes, regenerate it with
 * node scripts/third-party-licenses/generate.js > THIRD-PARTY-LICENSES.md
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const filePath = path.join(root, 'THIRD-PARTY-LICENSES.md');

function load() {
  const { collect, render, check } = require('../../scripts/third-party-licenses/generate.js');
  const lockJson = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const reviewed = JSON.parse(
    fs.readFileSync(path.join(root, 'scripts', 'third-party-licenses', 'reviewed.json'), 'utf8')
  );
  // Read against the installed package.json files, as the generator does (T4).
  const entries = collect(lockJson, { installedRoot: root });
  return { entries, reviewed, render, check };
}

function committed() {
  expect(fs.existsSync(filePath)).toBe(true);
  return fs.readFileSync(filePath, 'utf8');
}

describe('THIRD-PARTY-LICENSES.md stays current', () => {
  // Release review T4: the file is now generate(root), which also reads the
  // installed package.json of a package whose lock entry has no licence and
  // adds the Edge functions section; render(entries, reviewed) alone left both out.
  it('equals the generator output for the current lockfile, installed packages and edge functions', () => {
    const { generate } = require('../../scripts/third-party-licenses/generate.js');
    expect(committed()).toBe(generate(root));
  });

  it('has a reviewed reason for every flagged package', () => {
    const { entries, reviewed, check } = load();
    expect(check(entries, reviewed).output).toBe('');
    const md = committed();
    const flagged = md.slice(md.indexOf('\n## Flagged\n'));
    expect(md.includes('\n## Flagged\n')).toBe(true);
    expect(flagged).not.toMatch(/NOT REVIEWED/);
  });

  // Release review T4: the note speaks for the Node application only and
  // names the edge-function packages whose licence is still to be confirmed
  // (it said 'No GPL or AGPL package is present.' while mupdf was unlisted).
  it('opens with the Node application GPL or AGPL note and stays under 300 lines', () => {
    const lines = committed().split('\n');
    expect(lines[0]).toBe('# Third-party licences');
    expect(lines[2].startsWith('The Node application (package-lock.json) has no GPL or AGPL package.')).toBe(true);
    expect(lines.length).toBeLessThan(300);
  });
});
