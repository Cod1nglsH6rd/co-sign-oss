import fs from 'fs';
import path from 'path';

// Issue co-sign-240: every viewer language file in public/locales/ is a
// byte-identical copy of its locales/ source, every source has a copy, and no
// copy carries a payment key. PR #244 regenerated all nine copies; this guard
// keeps them in step (npm run sync:locales rewrites them).

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'locales');
const PUB = path.join(ROOT, 'public', 'locales');
const jsonNames = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const REMOVED = [
  ['pricing'],
  ['nav', 'pricing'],
  ['nav', 'billing'],
  ['footer', 'links', 'pricing'],
  ['dashboard', 'limitReached'],
];

function has(obj, keyPath) {
  let cur = obj;
  for (const k of keyPath) {
    if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) {
      return false;
    }
    cur = cur[k];
  }
  return true;
}

describe('public/locales stays in step with locales/', () => {
  it('finds the language files it guards', () => {
    expect(jsonNames(SRC).length).toBeGreaterThanOrEqual(9);
    expect(has({ nav: { pricing: 'x' } }, ['nav', 'pricing'])).toBe(true);
    expect(has({ nav: {} }, ['nav', 'pricing'])).toBe(false);
  });

  it('every source has a public copy, and no public copy lacks a source', () => {
    expect(jsonNames(PUB)).toEqual(jsonNames(SRC));
  });

  it.each(jsonNames(SRC))('public/locales/%s is byte-identical to its source', (name) => {
    const source = fs.readFileSync(path.join(SRC, name));
    const copy = fs.readFileSync(path.join(PUB, name));
    expect(copy.equals(source)).toBe(true);
  });

  it.each(jsonNames(PUB))('public/locales/%s has no pricing, billing or limit keys', (name) => {
    const bundle = JSON.parse(fs.readFileSync(path.join(PUB, name), 'utf8'));
    expect(REMOVED.filter((k) => has(bundle, k)).map((k) => k.join('.'))).toEqual([]);
  });
});
