/**
 * Bundled-asset rights: every file under public/ is listed in
 * scripts/third-party-licenses/assets.json with its source and licence
 * (locale JSON files are the project's own and may be listed by pattern),
 * every font ships with a licence text in its folder, source code imports
 * icons only from react-icons/fi, and THIRD-PARTY-LICENSES.md carries a
 * 'Bundled assets' section rendered from assets.json.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const publicDir = path.join(root, 'public');
const assetsPath = path.join(root, 'scripts', 'third-party-licenses', 'assets.json');

const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
const LICENCE_FILE = /^(OFL|LICEN[CS]E)(\.(txt|md))?$/i;
const SOURCE_EXT = /\.(js|jsx|mjs|cjs|ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'coverage', 'out', 'build', 'tests', 'public']);
// Any react-icons module specifier, in an import, a require or a dynamic import.
const ICON_IMPORT = /(?:from\s*|require\(\s*|import\(\s*)['"](react-icons(?:\/[^'"]*)?)['"]/g;

function walk(dir, skip) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip && skip.has(d.name)) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(full, skip));
    else out.push(full);
  }
  return out;
}

function rel(p) {
  return path.relative(root, p).split(path.sep).join('/');
}

function loadAssets() {
  expect(fs.existsSync(assetsPath)).toBe(true);
  const data = JSON.parse(fs.readFileSync(assetsPath, 'utf8'));
  expect(Array.isArray(data.assets)).toBe(true);
  return data;
}

function isLocaleJson(relPath) {
  return /^public\/locales\/[^/]+\.json$/.test(relPath);
}

describe('assets.json covers every bundled file', () => {
  it('lists every file under public/ except locale JSON by its exact path', () => {
    const { assets } = loadAssets();
    const listed = new Set(assets.map((a) => a.path));
    const missing = walk(publicDir)
      .map(rel)
      .filter((p) => !isLocaleJson(p) && !listed.has(p));
    expect(missing).toEqual([]);
  });

  it('gives every entry a source and a licence that is not empty or unknown', () => {
    const { assets } = loadAssets();
    const bad = assets
      .filter(
        (a) =>
          typeof a.license !== 'string' ||
          !a.license.trim() ||
          /^unknown$/i.test(a.license.trim()) ||
          typeof a.source !== 'string' ||
          !a.source.trim()
      )
      .map((a) => a.path);
    expect(bad).toEqual([]);
  });

  it('records the Noto Sans font as OFL-1.1 and the pdf.js worker as Apache-2.0', () => {
    const byPath = Object.fromEntries(loadAssets().assets.map((a) => [a.path, a]));
    expect(byPath['public/fonts/NotoSans-Regular.ttf'].license).toBe('OFL-1.1');
    expect(byPath['public/pdf.worker.min.mjs'].license).toBe('Apache-2.0');
  });

  it('has notes on the Google web fonts and on react-icons/fi', () => {
    const notes = (loadAssets().notes || []).join('\n');
    expect(notes).toContain('Google Fonts');
    // Inter was loaded only by the deleted public/enterprise/*.html mock-ups
    // (release clean-ups); the app's own pages load Fraunces and the others.
    expect(notes).not.toContain('Inter');
    expect(notes).toContain('Fraunces');
    expect(notes).toContain('OFL-1.1');
    expect(notes).toContain('react-icons/fi');
  });
});

describe('fonts carry their licence', () => {
  it('has a licence text file next to every font file under public/', () => {
    const fonts = walk(publicDir).filter((p) => FONT_EXT.test(p));
    expect(fonts.length).toBeGreaterThan(0);
    const without = fonts
      .filter((f) => !fs.readdirSync(path.dirname(f)).some((n) => LICENCE_FILE.test(n)))
      .map(rel);
    expect(without).toEqual([]);
  });

  it('ships the SIL Open Font License 1.1 with the Noto Sans copyright line', () => {
    const oflPath = path.join(publicDir, 'fonts', 'OFL.txt');
    expect(fs.existsSync(oflPath)).toBe(true);
    const text = fs.readFileSync(oflPath, 'utf8');
    expect(text).toContain('Copyright 2022 The Noto Project Authors');
    expect(text).toMatch(/SIL OPEN FONT LICENSE\s+Version 1\.1/i);
    expect(text).toContain('PERMISSION & CONDITIONS');
  });
});

describe('icons come only from react-icons/fi', () => {
  it('finds no source file importing another react-icons set', () => {
    const offenders = [];
    let fiUses = 0;
    for (const file of walk(root, SKIP_DIRS).filter((p) => SOURCE_EXT.test(p))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(ICON_IMPORT)) {
        if (m[1] === 'react-icons/fi') fiUses += 1;
        else offenders.push(`${rel(file)}: ${m[1]}`);
      }
    }
    expect(fiUses).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

describe('Bundled assets section', () => {
  const fixture = {
    assets: [
      { path: 'public/fonts/Example.ttf', license: 'OFL-1.1', source: 'Example Foundry; embedded in PDFs.' },
      { path: 'public/logo/logo.png', license: 'Own artwork', source: 'Drawn for the project.' },
    ],
    notes: ['Icons come from a single free set.'],
  };

  it('render() adds a Bundled assets section listing each asset with its licence and source', () => {
    const { render } = require('../../scripts/third-party-licenses/generate.js');
    const md = render([{ name: 'alpha', version: '1.0.0', license: 'MIT', dev: false }], {}, fixture);
    const start = md.indexOf('\n## Bundled assets\n');
    expect(start).toBeGreaterThan(-1);
    const section = md.slice(start);
    const fontLine = section.split('\n').find((l) => l.includes('public/fonts/Example.ttf'));
    expect(fontLine).toBeDefined();
    expect(fontLine).toContain('OFL-1.1');
    expect(fontLine).toContain('Example Foundry; embedded in PDFs.');
    const logoLine = section.split('\n').find((l) => l.includes('public/logo/logo.png'));
    expect(logoLine).toContain('Own artwork');
    expect(section).toContain('Icons come from a single free set.');
    // The package list stays above it.
    expect(md.indexOf('alpha@1.0.0')).toBeLessThan(start);
  });

  it('THIRD-PARTY-LICENSES.md lists every assets.json entry in its Bundled assets section', () => {
    const { assets } = loadAssets();
    const md = fs.readFileSync(path.join(root, 'THIRD-PARTY-LICENSES.md'), 'utf8');
    const start = md.indexOf('\n## Bundled assets\n');
    expect(start).toBeGreaterThan(-1);
    const section = md.slice(start);
    const absent = assets.filter((a) => !section.includes(a.path)).map((a) => a.path);
    expect(absent).toEqual([]);
  });
});
