/**
 * README facts that must match the code (release review T1a, 2026-11-21):
 * the Node.js version is the one package.json's engines field asks for; the
 * languages are the nine lib/i18n.js lists; every component, hook and lib
 * file in the project tree exists (there is no components/layout/Footer.js);
 * the local quick start creates the test account before it signs in with it,
 * says where http://localhost:3000 really sends you, and does not call the
 * organisation dashboard a mock.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function flat(text) {
  return text.replace(/\s+/g, ' ').trim();
}

const readme = () => read('README.md');

// The numbered steps of Getting Started's quick start, in order, flattened.
function quickStartSteps() {
  const text = readme();
  const start = text.indexOf('#### Quick Start');
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf('\n---', start);
  const body = text.slice(start, end === -1 ? undefined : end);
  const steps = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^(\d+)\.\s+(.*)$/);
    if (m) steps.push(m[2]);
    else if (steps.length) steps[steps.length - 1] += `\n${line}`;
  }
  return steps.map(flat);
}

describe('README: Node.js version', () => {
  test('names the version package.json asks for, everywhere it names one', () => {
    const engines = require('../../package.json').engines.node;
    expect(engines).toBe('>=20.19');
    const text = readme();
    expect(text).toContain('Node.js 20.19 or later');
    const named = text.match(/Node(?:\.js)? \d+(?:\.\d+)?\+?/g) || [];
    expect(named.filter((n) => !/^Node(?:\.js)? 20\.19$/.test(n))).toEqual([]);
  });
});

describe('README: languages', () => {
  const { locales } = require('../../lib/i18n');

  test('lib/i18n.js has nine locales, one file each in locales/', () => {
    expect(locales).toHaveLength(9);
    expect(fs.readdirSync(path.join(ROOT, 'locales')).filter((f) => f.endsWith('.json')).sort())
      .toEqual(locales.map((l) => `${l}.json`).sort());
  });

  test('never names only three locales', () => {
    const text = readme();
    expect(text).not.toMatch(/en\/vi\/es\b/);
    expect(text).not.toContain('(`/en`, `/vi`, `/es`)');
    expect(text).not.toMatch(/`vi`, `es`, or `en`/);
    expect(text).not.toMatch(/English \/ Vietnamese \/ Spanish/);
  });

  test('the locales line of the project tree lists all nine', () => {
    const line = readme().split('\n').find((l) => /── locales\//.test(l));
    expect(line).toBeDefined();
    for (const code of locales) expect(line).toMatch(new RegExp(`\\b${code}\\b`));
  });
});

describe('README: project tree paths exist', () => {
  // Entries such as "│   ├── layout/Footer.js   # ..." under components/, hooks/ and lib/.
  function treeFiles() {
    const out = [];
    let dir = null;
    for (const line of readme().split('\n')) {
      const top = line.match(/^[├└]── ([\w.-]+)\/(?:\s|$)/);
      if (top) { dir = top[1]; continue; }
      if (/^[├└]── /.test(line)) { dir = null; continue; }
      const entry = line.match(/^│ {3}[├└]── ([\w./[\]-]+\.js)\s/);
      if (entry && ['components', 'hooks', 'lib'].includes(dir)) out.push(`${dir}/${entry[1]}`);
    }
    return out;
  }

  test('every component, hook and lib file named in the tree exists', () => {
    const files = treeFiles();
    expect(files).toEqual(expect.arrayContaining(['components/layout/Navigation.js', 'hooks/useAuth.js', 'lib/i18n.js']));
    expect(files.filter((f) => !fs.existsSync(path.join(ROOT, f)))).toEqual([]);
  });

  test('names no Footer component, which does not exist', () => {
    expect(fs.existsSync(path.join(ROOT, 'components', 'layout', 'Footer.js'))).toBe(false);
    expect(readme()).not.toMatch(/Footer\.js|\(`Footer`\)/);
  });
});

describe('README: the local quick start', () => {
  test('creates the test account before the step that signs in with it', () => {
    const steps = quickStartSteps();
    const seed = steps.findIndex((s) => s.includes('npm run seed:dev'));
    const signIn = steps.findIndex((s) => s.includes('Test123!') && /sign in/i.test(s) && !s.includes('npm run seed:dev'));
    expect(seed).toBeGreaterThan(-1);
    expect(signIn).toBeGreaterThan(seed);
  });

  test('says where http://localhost:3000 sends you, as pages/index.js does', () => {
    const index = read('pages/index.js');
    expect(index).toContain("needed ? '/setup' : '/enterprise/login'");
    const open = quickStartSteps().find((s) => s.includes('http://localhost:3000') && /sign in/i.test(s));
    expect(open).toBeDefined();
    expect(open).toContain('/enterprise/login');
    expect(open).toContain('/setup');
    expect(open).not.toMatch(/redirected to `\/en`/);
  });

  test('does not call the organisation dashboard a mock', () => {
    expect(readme()).not.toMatch(/admin mock|static pages/i);
    expect(read('pages/enterprise/admin.js')).toContain('Organization Dashboard');
    expect(readme()).toMatch(/`?\/enterprise\/admin`?[^\n]*(organisation|organization) dashboard/i);
  });
});
