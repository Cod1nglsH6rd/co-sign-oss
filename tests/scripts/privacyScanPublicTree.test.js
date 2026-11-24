import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The public tree has no scripts/privacy-scan/terms.json and no
// known-hits.json (both stay in the private repository), and until its first
// commit it is not a git checkout. `npm run scan:private` there must still
// run: a note says no hashed terms are checked, the phone rule and
// PRIVATE_SCAN_TERMS still run, and the folder is walked file by file.
// Each case copies scan.js alone into a temporary folder. The phone numbers
// below are built at run time, so this file holds none.

const SCAN = path.join(__dirname, '..', '..', 'scripts', 'privacy-scan', 'scan.js');
const phone = () => ['(408)', ' 321', '-', '4567'].join('');

let base;
let tree;

function write(rel, text) {
  const file = path.join(tree, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function run(env = {}) {
  const res = spawnSync(process.execPath, ['scripts/privacy-scan/scan.js'], {
    cwd: tree,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
  return { code: res.status, lines: res.stdout.split('\n').filter(Boolean), stderr: res.stderr };
}

const notes = (lines) => lines.filter((l) => l.includes(': note: '));
const results = (lines) => lines.filter((l) => !l.includes(': note: '));

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'scanpublic-'));
  tree = path.join(base, 'tree');
  write('scripts/privacy-scan/scan.js', fs.readFileSync(SCAN));
  write('README.md', '# A tree\n\nCall (408) 555-2317 for nothing.\n');
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('npm run scan:private in a tree without terms.json (the public tree)', () => {
  it('says there is no terms file and exits 0 on a clean tree', () => {
    const { code, lines, stderr } = run();
    expect(stderr).toBe('');
    expect(results(lines)).toEqual([]);
    expect(notes(lines)).toEqual([
      expect.stringMatching(/^terms\.json: note: not found, so no hashed term or email is checked/),
      expect.stringMatching(/: note: not a git checkout, so every file under it is scanned except \.git, node_modules/),
    ]);
    expect(code).toBe(0);
  });

  it('still runs the phone rule, leaving out node_modules', () => {
    write('lib/a.js', `const n = '${phone()}';\n`);
    write('node_modules/pkg/b.js', `const n = '${phone()}';\n`);
    const { code, lines } = run();
    expect(results(lines)).toEqual(['lib/a.js:1 phone']);
    expect(lines.join('\n')).not.toContain('4567');
    expect(code).toBe(1);
  });

  it('still checks the terms PRIVATE_SCAN_TERMS gives', () => {
    write('docs/notes.md', 'signed by zebra-quokka\n');
    const { code, lines } = run({ PRIVATE_SCAN_TERMS: 'zebra-quokka' });
    expect(results(lines)).toEqual(['docs/notes.md:1 term']);
    expect(lines.join('\n')).not.toMatch(/zebra/i);
    expect(code).toBe(1);
  });

  it('walks the tree when it sits inside some other git checkout', () => {
    const git = spawnSync('git', ['init', '-q', base], { encoding: 'utf8' });
    expect(git.status).toBe(0);
    write('lib/a.js', `const n = '${phone()}';\n`);
    const { code, lines } = run();
    expect(results(lines)).toEqual(['lib/a.js:1 phone']);
    expect(code).toBe(1);
  });

  it('main() given a terms file that does not exist prints the note and still returns 0', () => {
    const { main } = require('../../scripts/privacy-scan/scan.js');
    const out = [];
    const code = main({
      root: tree,
      files: ['README.md'],
      termsFile: path.join(base, 'no-terms.json'),
      env: {},
      log: (l) => out.push(l),
    });
    expect(out).toEqual([expect.stringMatching(/^no-terms\.json: note: not found/)]);
    expect(code).toBe(0);
  });
});
