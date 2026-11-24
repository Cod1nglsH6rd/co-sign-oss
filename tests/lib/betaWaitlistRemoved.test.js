/**
 * Beta waitlist removed (release review T6): Cô Sign is self-hosted, so it no
 * longer collects email addresses for a hosted beta. The beta page, its API
 * route and the landing page's waitlist call to action are gone; no route
 * writes to beta_signups (the table stays until a migration drops it, and
 * the owner usage page may still count it); the landing page points a visitor
 * to self-hosting and the sign-in page; the strings used only by the waitlist
 * are gone from all nine locales; and the terms and privacy pages open with a
 * notice that they are templates the operator must replace.
 */

const fs = require('fs');
const path = require('path');

jest.mock('next/router', () => ({
  useRouter: () => ({ asPath: '/en/terms', pathname: '/[locale]/terms', query: { locale: 'en' }, push() {}, replace() {} }),
}));
// next-intl ships ES modules Jest does not transform here; this stand-in
// looks keys up in the real English bundle.
jest.mock('next-intl', () => {
  const messages = require('../../locales/en.json');
  const lookup = (ns, key) =>
    [...(ns ? ns.split('.') : []), ...key.split('.')].reduce((o, k) => (o == null ? o : o[k]), messages);
  return {
    useTranslations: (ns) => (key) => {
      const value = lookup(ns, key);
      return typeof value === 'string' ? value : `${ns ? `${ns}.` : ''}${key}`;
    },
  };
});

const root = path.join(__dirname, '..', '..');
const SOURCE_EXT = /\.(js|jsx|mjs|cjs|ts|tsx)$/;
const LOCALES = ['en', 'es', 'fr', 'ht', 'ne', 'pt', 'vi', 'yue', 'zh'];

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(d.name)) out.push(full);
  }
  return out;
}

function rel(p) {
  return path.relative(root, p).split(path.sep).join('/');
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function locale(l) {
  return JSON.parse(read(`locales/${l}.json`));
}

// Each .from('beta_signups') call followed (in the same statement) by a write.
function writesToBetaSignups(text) {
  const hits = [];
  const re = /\.from\(\s*['"`]beta_signups['"`]\s*\)/g;
  let m;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + m[0].length);
    const end = rest.search(/;|\n\s*\n/);
    const statement = end === -1 ? rest : rest.slice(0, end);
    if (/\.\s*(insert|upsert|update|delete)\s*\(/.test(statement)) hits.push(m.index);
  }
  return hits;
}

describe('no route writes to beta_signups', () => {
  it('the check sees an upsert and lets a count through', () => {
    expect(writesToBetaSignups("await s\n  .from('beta_signups')\n  .upsert([{ email }]);")).toHaveLength(1);
    expect(writesToBetaSignups("s.from('beta_signups').select('id', { count: 'exact', head: true }),")).toHaveLength(0);
  });

  it('finds no write under pages/, lib/ or components/', () => {
    const files = ['pages', 'lib', 'components'].flatMap((d) => walk(path.join(root, d)));
    const offenders = files.filter((f) => writesToBetaSignups(fs.readFileSync(f, 'utf8')).length).map(rel);
    expect(offenders).toEqual([]);
  });

  it.each(['pages/api/beta.js', 'pages/[locale]/beta.js'])('%s is deleted', (file) => {
    expect(fs.existsSync(path.join(root, file))).toBe(false);
  });

  it('no page or component posts to /api/beta or links to a beta page', () => {
    const files = ['pages', 'components', 'lib'].flatMap((d) => walk(path.join(root, d)));
    const offenders = files
      .filter((f) => /\/api\/beta\b|\/beta[`'"]|id="beta"/.test(fs.readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('the landing page points to self-hosting', () => {
  const source = read('pages/[locale]/index.js');

  it('links to /enterprise/login and shows the self-hosted section', () => {
    expect(source).toContain('href="/enterprise/login"');
    expect(source).toContain("t('selfHosted.title')");
    expect(source).toContain("t('selfHosted.body')");
    expect(source).not.toMatch(/fetch\(|type="email"/);
  });

  it.each(LOCALES)('%s has the self-hosted strings and no waitlist strings', (l) => {
    const bundle = locale(l);
    expect(bundle.beta).toBeUndefined();
    expect(bundle.nav.beta).toBeUndefined();
    expect(bundle.hero.cta).toBeUndefined();
    for (const k of ['title', 'body', 'cta']) {
      expect(typeof bundle.selfHosted[k]).toBe('string');
      expect(bundle.selfHosted[k].trim()).not.toBe('');
    }
    expect(bundle.selfHosted.body).toContain('Cô Sign');
    expect(bundle.selfHosted.body).toContain('MIT');
    // The neighbours stay.
    expect(typeof bundle.hero.ctaSecondary).toBe('string');
    expect(typeof bundle.nav.login).toBe('string');
  });
});

describe('legal pages are marked as templates', () => {
  it.each(LOCALES)('%s has the template notice', (l) => {
    const { legalTemplate } = locale(l);
    expect(typeof legalTemplate.title).toBe('string');
    expect(typeof legalTemplate.body).toBe('string');
    expect(legalTemplate.body).toContain('Cô Sign');
  });

  it.each(['terms', 'privacy'])('the %s page opens with the notice, before its first heading', (page) => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const Page = require(`../../pages/[locale]/${page}.js`).default;
    const messages = locale('en');
    const html = renderToStaticMarkup(React.createElement(Page));
    const notice = html.indexOf(messages.legalTemplate.title);
    expect(notice).toBeGreaterThan(-1);
    expect(html).toContain(messages.legalTemplate.body);
    expect(notice).toBeLessThan(html.indexOf('<h2'));
  });
});
