/**
 * No parked API routes (release review T13, 2026-11-21). api-disabled/ held
 * three dead route files (chat.js, embed.js, ocr.js) that trusted a userId
 * from the request body with the service role: moved back under pages/api/
 * they would be an open hole. The folder is gone, nothing points at it, and
 * no folder of that name may come back anywhere in the tree.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const NAME = 'api-disabled';
const SKIP = new Set(['node_modules', '.git', '.next', 'coverage']);

// Every folder named api-disabled, as a repo-relative path.
function disabledFolders(rel = '', out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.name === NAME) out.push(child);
    disabledFolders(child, out);
  }
  return out;
}

describe('no api-disabled folder (T13)', () => {
  test('no folder named api-disabled exists anywhere in the tree', () => {
    expect(disabledFolders()).toEqual([]);
  });

  test('the README does not mention it', () => {
    expect(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')).not.toContain(NAME);
  });
});
