const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const viewerPath = path.join(root, 'pages', '[locale]', 'documents', '[id].js');
const LOCALES = ['en', 'vi', 'es', 'pt', 'fr', 'zh', 'yue', 'ht', 'ne'];

function readViewer() {
  return fs.readFileSync(viewerPath, 'utf8');
}

function loadLocale(code) {
  return JSON.parse(fs.readFileSync(path.join(root, 'locales', `${code}.json`), 'utf8'));
}

function lookup(messages, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), messages);
}

function placeholders(text) {
  return (text.match(/\{\w+\}/g) || []).sort();
}

function usedToastKeys() {
  const keys = readViewer().match(/viewer\.toast\.[A-Za-z0-9_]+/g) || [];
  return [...new Set(keys)];
}

describe('document viewer toasts are localized', () => {
  test('no toast call passes a hard-coded English string or template literal', () => {
    const src = readViewer();
    const pattern = /toast(?:\.(?:success|error|loading))?\(\s*(['"`])[A-Za-z]/g;
    const offenders = [];
    let m;
    while ((m = pattern.exec(src)) !== null) {
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`line ${line}: ${src.slice(m.index, src.indexOf('\n', m.index)).trim()}`);
    }
    expect(offenders).toEqual([]);
  });

  test('the viewer uses viewer.toast.* keys', () => {
    expect(usedToastKeys().length).toBeGreaterThan(0);
  });

  test('locales/ holds exactly the nine languages checked here', () => {
    const files = fs.readdirSync(path.join(root, 'locales')).filter((f) => f.endsWith('.json')).sort();
    expect(files).toEqual(LOCALES.map((c) => `${c}.json`).sort());
  });

  test('every viewer.toast.* key exists, non-empty, in all nine locales', () => {
    const missing = [];
    for (const code of LOCALES) {
      const messages = loadLocale(code);
      for (const key of usedToastKeys()) {
        const value = lookup(messages, key);
        if (typeof value !== 'string' || value.trim() === '') missing.push(`${code}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('every viewer.toast.* key is translated in Vietnamese', () => {
    const en = loadLocale('en');
    const vi = loadLocale('vi');
    const untranslated = usedToastKeys().filter((key) => {
      const enText = lookup(en, key);
      const viText = lookup(vi, key);
      return typeof enText !== 'string' || typeof viText !== 'string' || enText === viText;
    });
    expect(untranslated).toEqual([]);
  });

  test('every locale keeps the same {placeholders} as English', () => {
    const en = loadLocale('en');
    const mismatched = [];
    for (const code of LOCALES) {
      const messages = loadLocale(code);
      for (const key of usedToastKeys()) {
        const enText = lookup(en, key);
        const text = lookup(messages, key);
        if (typeof enText !== 'string' || typeof text !== 'string') continue;
        if (placeholders(enText).join() !== placeholders(text).join()) mismatched.push(`${code}: ${key}`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});
