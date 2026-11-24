/**
 * MIT-consistent text (release review T5): Cô Sign is released under the MIT
 * licence as a self-hosted app, so no page, locale string or public file says
 * "All rights reserved" or makes a compliance or sales claim (SOC 2, HIPAA,
 * Contact Sales) that every self-hoster's site would repeat. The footer line
 * credits the contributors and names the MIT License in all nine languages,
 * public/locales/ is the generated copy of locales/, and the enterprise
 * landing page is a plain page that links to /enterprise/login.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const TEXT_EXT = /\.(js|jsx|mjs|cjs|ts|tsx|json|html|htm|css|txt|md|svg|xml)$/i;
const FORBIDDEN = [
  { rule: 'rights reserved', re: /rights\s+reserved/i },
  { rule: 'SOC 2', re: /\bsoc\s?2\b/i },
  { rule: 'HIPAA', re: /hipaa/i },
  { rule: 'Contact Sales', re: /contact\s+sales/i },
];

function walk(dir) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(full));
    else if (TEXT_EXT.test(d.name)) out.push(full);
  }
  return out;
}

function rel(p) {
  return path.relative(root, p).split(path.sep).join('/');
}

// path:line rule for each hit, never the matched text.
function findHits(files) {
  const hits = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { rule, re } of FORBIDDEN) if (re.test(line)) hits.push(`${rel(file)}:${i + 1} ${rule}`);
    });
  }
  return hits;
}

describe('no rights-reserved, compliance or sales wording', () => {
  it('the check finds each phrase in any case', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mit-text-'));
    const file = path.join(dir, 'x.html');
    fs.writeFileSync(file, 'ok\nAll Rights Reserved\nsoc2 ready\nHipaa\nCONTACT SALES\n');
    expect(findHits([file]).map((h) => h.replace(/^.*:(\d+) /, '$1 '))).toEqual([
      '2 rights reserved',
      '3 SOC 2',
      '4 HIPAA',
      '5 Contact Sales',
    ]);
  });

  it.each(['pages', 'locales', 'public'])('finds none in %s/', (dir) => {
    expect(findHits(walk(path.join(root, dir)))).toEqual([]);
  });
});

describe('footer.copyright', () => {
  const files = fs.readdirSync(path.join(root, 'locales')).filter((f) => f.endsWith('.json'));

  it('covers the nine languages', () => {
    expect(files.sort()).toEqual(['en', 'es', 'fr', 'ht', 'ne', 'pt', 'vi', 'yue', 'zh'].map((l) => `${l}.json`));
  });

  it('reads "© Cô Sign contributors · MIT License" in English', () => {
    const en = JSON.parse(fs.readFileSync(path.join(root, 'locales', 'en.json'), 'utf8'));
    expect(en.footer.copyright).toBe('© Cô Sign contributors · MIT License');
  });

  it.each(files)('%s keeps the project name and MIT, with no year', (f) => {
    const { copyright } = JSON.parse(fs.readFileSync(path.join(root, 'locales', f), 'utf8')).footer;
    expect(copyright.startsWith('© ')).toBe(true);
    expect(copyright).toContain('Cô Sign');
    expect(copyright).toContain('MIT');
    expect(copyright).toContain(' · ');
    expect(copyright).not.toMatch(/\d{4}/);
  });

  it.each(files)('public/locales/%s is the generated copy of locales/', (f) => {
    expect(fs.readFileSync(path.join(root, 'public', 'locales', f), 'utf8')).toBe(
      fs.readFileSync(path.join(root, 'locales', f), 'utf8')
    );
  });
});

describe('enterprise landing page', () => {
  const source = fs.readFileSync(path.join(root, 'pages', 'enterprise', 'index.js'), 'utf8');

  it('renders a plain page that links to /enterprise/login', () => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const EnterpriseLanding = require('../../pages/enterprise/index.js').default;
    const html = renderToStaticMarkup(React.createElement(EnterpriseLanding));
    expect(html).toContain('href="/enterprise/login"');
    expect(html).toMatch(/self-hosted/i);
    expect(html).toContain('MIT License');
  });

  it('has no demo form, dead #demo link, plans or waitlist call', () => {
    expect(source).not.toContain('#demo');
    expect(source).not.toMatch(/request (a )?demo/i);
    expect(source).not.toMatch(/\bplans?\b/i);
    expect(source).not.toContain('/api/beta');
  });
});
