import fs from 'fs';
import path from 'path';

// Issue co-sign-225: the Pricing and Billing menu items, the footer Pricing
// link and the document-limit message are gone from every source locale.

const LOCALES_DIR = path.join(__dirname, '..', '..', 'locales');
const EXPECTED = ['en', 'vi', 'es', 'fr', 'ht', 'ne', 'pt', 'yue', 'zh'];
const REMOVED = [
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

const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));

describe('payment nav strings removed from locales/', () => {
  it('reads all nine source locales', () => {
    expect(files.map((f) => f.replace(/\.json$/, '')).sort()).toEqual([...EXPECTED].sort());
  });

  for (const file of files) {
    it(`${file} has no nav.pricing, nav.billing, footer.links.pricing or dashboard.limitReached`, () => {
      const bundle = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
      const present = REMOVED.filter((p) => has(bundle, p)).map((p) => p.join('.'));
      expect(present).toEqual([]);
      // The neighbours stay.
      expect(has(bundle, ['nav', 'features'])).toBe(true);
      expect(has(bundle, ['footer', 'links', 'features'])).toBe(true);
      expect(has(bundle, ['dashboard', 'title'])).toBe(true);
    });
  }
});
