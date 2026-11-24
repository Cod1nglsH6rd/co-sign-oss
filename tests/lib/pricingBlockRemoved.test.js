const fs = require('fs');
const path = require('path');

// Issue co-sign-227: the rest of the pricing text (Pro card, title, subtitle)
// is gone from every language, so no locale bundle has a pricing block or a
// paid-plan price.

const DIR = path.join(__dirname, '..', '..', 'locales');
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));

function strings(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('pricing block removed from locales (issue co-sign-227)', () => {
  it('finds all nine locale files', () => {
    expect(FILES).toHaveLength(9);
  });

  it.each(FILES)('%s has no top-level pricing key', (file) => {
    const bundle = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    expect(Object.keys(bundle)).not.toContain('pricing');
  });

  it.each(FILES)('%s has no string containing $7 or $3.99', (file) => {
    const bundle = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    const prices = strings(bundle).filter((s) => s.includes('$7') || s.includes('$3.99'));
    expect(prices).toEqual([]);
  });
});
