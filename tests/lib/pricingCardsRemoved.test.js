const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'locales');
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));

describe('Free and Single Document price cards removed from locales', () => {
  it('finds all nine locale files', () => {
    expect(FILES).toHaveLength(9);
  });

  it.each(FILES)('%s has no pricing.free or pricing.single', (file) => {
    const bundle = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    const pricing = bundle.pricing || {};
    expect(pricing).not.toHaveProperty('free');
    expect(pricing).not.toHaveProperty('single');
  });
});
