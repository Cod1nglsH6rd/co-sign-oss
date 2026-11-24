import fs from 'fs';
import path from 'path';
import {
  SUPPORTED_LANGUAGES,
  getLabel,
  getExplanation,
  getPositionHint,
} from '../../lib/fieldTranslations';
import { locales, localeNames, localeFlags, defaultLocale } from '../../lib/i18n';

const EXPECTED = ['en', 'vi', 'es', 'pt', 'fr', 'zh', 'yue', 'ht', 'ne'];

function countKeys(obj) {
  let n = 0;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) n += countKeys(v);
    else n += 1;
  }
  return n;
}

function readLocale(dir, code) {
  const p = path.join(process.cwd(), dir, `${code}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('language configuration', () => {
  it('field-translation and UI locale lists agree on the supported set', () => {
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual([...EXPECTED].sort());
    expect([...locales].sort()).toEqual([...EXPECTED].sort());
    expect(SUPPORTED_LANGUAGES).toContain(defaultLocale);
  });

  it('every locale has a display name and a flag', () => {
    for (const code of locales) {
      expect(typeof localeNames[code]).toBe('string');
      expect(localeNames[code].length).toBeGreaterThan(0);
      expect(typeof localeFlags[code]).toBe('string');
      expect(localeFlags[code].length).toBeGreaterThan(0);
    }
  });
});

describe('locale message bundles', () => {
  for (const dir of ['locales', 'public/locales']) {
    describe(dir, () => {
      const en = readLocale(dir, 'en');
      const enCount = countKeys(en);

      for (const code of locales) {
        it(`${code}.json exists, parses, and matches en key count`, () => {
          const bundle = readLocale(dir, code);
          expect(countKeys(bundle)).toBe(enCount);
        });
      }
    });
  }
});

describe('getLabel / getExplanation / getPositionHint', () => {
  const field = {
    field_name: 'Signature of Seller',
    field_name_zh: '卖方签名',
    field_name_yue: '賣方簽名',
    explanation: 'Sign here.',
    explanation_zh: '在此签名。',
    position_hint: 'page 3, bottom',
    position_hint_zh: 'page 3，底部',
  };

  it('returns the translated column when present', () => {
    expect(getLabel(field, 'zh')).toBe('卖方签名');
    expect(getLabel(field, 'yue')).toBe('賣方簽名');
    expect(getExplanation(field, 'zh')).toBe('在此签名。');
    expect(getPositionHint(field, 'zh')).toBe('page 3，底部');
  });

  it('falls back to English when a language column is empty or absent', () => {
    expect(getLabel(field, 'ne')).toBe('Signature of Seller'); // no field_name_ne
    expect(getExplanation(field, 'yue')).toBe('Sign here.'); // no explanation_yue
    expect(getLabel(field, 'fr')).toBe('Signature of Seller'); // no column
    expect(getLabel(field, 'en')).toBe('Signature of Seller');
  });

  it('treats unknown languages as English', () => {
    expect(getLabel(field, 'xx')).toBe('Signature of Seller');
  });
});
