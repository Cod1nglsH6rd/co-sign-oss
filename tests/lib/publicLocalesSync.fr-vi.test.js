import fs from 'fs';
import path from 'path';

// Issue co-sign-237: the viewer's French and Vietnamese bundles under
// public/locales/ are byte-identical copies of locales/, so the payment
// strings removed from the sources are gone from the viewer too.

const ROOT = path.join(__dirname, '..', '..');
const CODES = ['fr', 'vi'];

function read(dir, code) {
  return fs.readFileSync(path.join(ROOT, dir, `${code}.json`));
}

describe('public/locales fr and vi match locales/', () => {
  for (const code of CODES) {
    it(`public/locales/${code}.json is byte-identical to locales/${code}.json`, () => {
      const source = read('locales', code);
      const copy = read('public/locales', code);
      expect(copy.equals(source)).toBe(true);
    });

    it(`public/locales/${code}.json has no pricing or billing strings`, () => {
      const bundle = JSON.parse(read('public/locales', code).toString('utf8'));
      expect(bundle).not.toHaveProperty('pricing');
      expect(bundle).not.toHaveProperty(['nav', 'pricing']);
      expect(bundle).not.toHaveProperty(['nav', 'billing']);
      expect(bundle).not.toHaveProperty(['footer', 'links', 'pricing']);
      expect(bundle).not.toHaveProperty(['dashboard', 'limitReached']);
    });
  }
});
