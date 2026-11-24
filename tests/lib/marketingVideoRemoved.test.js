import fs from 'fs';
import path from 'path';
import { privateFile } from '../helpers/privateFile';

// Issue co-sign-119: the Remotion marketing video (remotion/ and
// public/video.mp4) is gone, with rows in docs/REMOVED-FILES.md, and no
// remotion or @remotion/* package is a dependency or devDependency. The
// published tree leaves docs/REMOVED-FILES.md out, so there its case is
// skipped.

const ROOT = path.join(__dirname, '..', '..');
const removedFiles = privateFile('docs/REMOVED-FILES.md');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function isRemotion(name) {
  return name === 'remotion' || name.startsWith('@remotion/');
}

// Table rows in docs/REMOVED-FILES.md look like: | `some/path` | reason |
function removedPaths() {
  return fs
    .readFileSync(removedFiles.path, 'utf8')
    .split('\n')
    .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|/))
    .filter(Boolean)
    .map((m) => m[1]);
}

describe('marketing video removed (issue co-sign-119)', () => {
  it('no remotion package is a dependency or devDependency', () => {
    const pkg = readJson('package.json');
    const names = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ];
    expect(names.filter(isRemotion)).toEqual([]);
  });

  it('no remotion package is in package-lock.json', () => {
    const lock = readJson('package-lock.json');
    const names = Object.keys(lock.packages || {}).map((p) =>
      p.replace(/^.*node_modules\//, '')
    );
    expect(names.filter(isRemotion)).toEqual([]);
  });

  it('remotion/ and public/video.mp4 are absent from the tree', () => {
    expect(fs.existsSync(path.join(ROOT, 'remotion'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'public', 'video.mp4'))).toBe(false);
  });

  removedFiles.it('docs/REMOVED-FILES.md has a row for each removed path', () => {
    const removed = removedPaths();
    expect(removed).toContain('remotion/');
    expect(removed).toContain('public/video.mp4');
  });
});
