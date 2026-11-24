// Every synthetic key below is assembled at run time from short fragments, so
// this file holds no key-shaped literal. Files go to a fresh folder under
// os.tmpdir() and are removed afterwards.

const fs = require('fs');
const os = require('os');
const path = require('path');

function load() {
  return require('../../scripts/secretScan');
}

const dash = '-';
const und = '_';
// 40 key characters with no x, so the value never reads as an "xxx" placeholder.
const filler = 'Ab3Cd4Ef5Gh6Jk7Lm8Np9Qr2St3Uv4Wy5Za6Bc7D';
const anthropicKey = 'sk' + dash + 'ant' + dash + 'api03' + dash + filler;
const stripeKey = 'sk' + und + 'live' + und + filler.slice(0, 24);

let dir;
let cwd;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'secretscan-files-')));
  cwd = process.cwd();
});

afterEach(() => {
  process.chdir(cwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

describe('scanFiles', () => {
  test('reports a planted key with the given path and its line', () => {
    const { scanFiles } = load();
    const file = write('config.js', 'const a = 1;\n\nconst key = "' + anthropicKey + '";\n');
    expect(scanFiles([file])).toEqual([{ file, line: 3, kind: 'anthropic' }]);
  });

  test('combines the hits of several files, each under its own path', () => {
    const { scanFiles } = load();
    const one = write('one.txt', anthropicKey + '\n');
    const two = write('two.txt', 'nothing here\n' + stripeKey + '\n');
    expect(scanFiles([one, two])).toEqual([
      { file: one, line: 1, kind: 'anthropic' },
      { file: two, line: 2, kind: 'stripe' },
    ]);
  });

  test('a file with a NUL byte gives no hit', () => {
    const { scanFiles } = load();
    const file = write('blob.bin', Buffer.concat([Buffer.from(anthropicKey + '\n'), Buffer.from([0]), Buffer.from('tail\n')]));
    expect(scanFiles([file])).toEqual([]);
  });

  test('a clean file gives no hit', () => {
    const { scanFiles } = load();
    const file = write('clean.md', '# Notes\n\nNothing secret on these lines.\n');
    expect(scanFiles([file])).toEqual([]);
  });

  test('harness-owned paths given relative to the repo root give no hit', () => {
    const { scanFiles } = load();
    write('docs/decisions/0001.md', anthropicKey + '\n');
    write('docs/plans/plan.md', anthropicKey + '\n');
    write('.dev-manager.yml', 'key: ' + anthropicKey + '\n');
    write('docs/other.md', anthropicKey + '\n');
    process.chdir(dir);
    expect(scanFiles(['docs/decisions/0001.md'])).toEqual([]);
    expect(scanFiles(['docs/plans/plan.md', '.dev-manager.yml'])).toEqual([]);
    // The same content outside the excluded paths is still reported.
    expect(scanFiles(['docs/other.md'])).toEqual([{ file: 'docs/other.md', line: 1, kind: 'anthropic' }]);
  });

  test('harness-owned paths given as absolute or non-canonical paths give no hit', () => {
    const { scanFiles } = load();
    const decision = write('docs/decisions/0001.md', anthropicKey + '\n');
    const config = write('.dev-manager.yml', 'key: ' + anthropicKey + '\n');
    const other = write('docs/other.md', anthropicKey + '\n');
    process.chdir(dir);
    expect(scanFiles([decision, config])).toEqual([]);
    expect(scanFiles(['./docs/../docs/decisions/0001.md', 'docs//plans/../decisions/0001.md'])).toEqual([]);
    expect(scanFiles([path.join(dir, 'docs', '.', 'decisions', '0001.md')])).toEqual([]);
    // An absolute path outside the excluded entries is still reported, as given.
    expect(scanFiles([other])).toEqual([{ file: other, line: 1, kind: 'anthropic' }]);
  });

  test('exports the excluded list', () => {
    const { EXCLUDED } = load();
    expect(EXCLUDED).toEqual(expect.arrayContaining(['.dev-manager.yml', 'docs/decisions/', 'docs/plans/']));
  });

  test('no hit holds the matched text', () => {
    const { scanFiles } = load();
    const file = write('keys.env', 'A=' + anthropicKey + '\nB=' + stripeKey + '\n');
    const hits = scanFiles([file]);
    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      expect(Object.keys(hit).sort()).toEqual(['file', 'kind', 'line']);
      const text = JSON.stringify(hit);
      expect(text).not.toContain(anthropicKey);
      expect(text).not.toContain(stripeKey);
      expect(text).not.toContain(filler.slice(0, 16));
    }
  });
});
