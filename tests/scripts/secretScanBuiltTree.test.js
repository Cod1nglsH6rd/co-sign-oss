import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// `node scripts/secretScan.js` in a tree that is not a git checkout of its
// own (the public tree the publish script builds, before its first commit)
// scans every file there except .git, node_modules, .next and coverage,
// instead of failing on `git ls-files` or listing another checkout's files.
// Its EXCLUDED paths are not in that tree, which changes nothing. The key
// below is assembled at run time, so this file holds no key-shaped literal.

const ROOT = path.join(__dirname, '..', '..');
const dash = '-';
const filler = 'Ab3Cd4Ef5Gh6Jk7Lm8Np9Qr2St3Uv4Wy5Za6Bc7D';
const key = () => 'sk' + dash + 'ant' + dash + 'api03' + dash + filler;

let base;
let tree;

function write(rel, text) {
  const file = path.join(tree, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function run() {
  const res = spawnSync(process.execPath, ['scripts/secretScan.js'], {
    cwd: tree,
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  return { code: res.status, lines: res.stdout.split('\n').filter(Boolean), stderr: res.stderr };
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'secretbuilt-'));
  tree = path.join(base, 'tree');
  write('scripts/secretScan.js', fs.readFileSync(path.join(ROOT, 'scripts', 'secretScan.js')));
  write('scripts/secret-scan-baseline.json', '[]\n');
  write('lib/clean.js', 'module.exports = 1;\n');
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('node scripts/secretScan.js in a built tree that is not a git checkout', () => {
  it('exits 0 on a clean tree', () => {
    const { code, lines, stderr } = run();
    expect(stderr).toBe('');
    expect(lines).toEqual([]);
    expect(code).toBe(0);
  });

  it('reports a planted key by file, line and kind, never the value, leaving out node_modules', () => {
    write('lib/a.js', '// nothing\nconst k = "' + key() + '";\n');
    write('node_modules/pkg/index.js', 'const k = "' + key() + '";\n');
    write('.next/cache.js', 'const k = "' + key() + '";\n');
    const { code, lines } = run();
    expect(lines).toEqual(['lib/a.js:2:anthropic']);
    expect(lines.join('\n')).not.toContain(filler.slice(0, 12));
    expect(code).toBe(1);
  });

  it('walks the tree when it sits inside some other git checkout', () => {
    expect(spawnSync('git', ['init', '-q', base]).status).toBe(0);
    write('lib/a.js', 'const k = "' + key() + '";\n');
    const { code, lines } = run();
    expect(lines).toEqual(['lib/a.js:1:anthropic']);
    expect(code).toBe(1);
  });
});
