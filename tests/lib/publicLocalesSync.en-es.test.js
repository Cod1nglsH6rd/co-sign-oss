import fs from 'fs';
import path from 'path';

// Issue co-sign-236: the viewer's English and Spanish language files in
// public/locales/ are byte-identical copies of the locales/ sources, so the
// payment strings removed from the sources are gone from the viewer too.

const ROOT = path.join(__dirname, '..', '..');
const CODES = ['en', 'es'];
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

describe('public/locales en and es match locales/', () => {
  for (const code of CODES) {
    it(`public/locales/${code}.json is byte-identical to locales/${code}.json`, () => {
      const source = fs.readFileSync(path.join(ROOT, 'locales', `${code}.json`));
      const copy = fs.readFileSync(path.join(ROOT, 'public', 'locales', `${code}.json`));
      expect(copy.equals(source)).toBe(true);
    });

    it(`public/locales/${code}.json has no pricing, billing or limit keys`, () => {
      const bundle = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'public', 'locales', `${code}.json`), 'utf8')
      );
      const present = REMOVED.filter((k) => has(bundle, k)).map((k) => k.join('.'));
      expect(present).toEqual([]);
    });
  }
});
