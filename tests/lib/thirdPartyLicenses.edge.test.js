/**
 * Licence-list generator, part three (release review T4):
 * - collect(lockJson, { installedRoot }) reads the licence of a package whose
 *   lock entry has none from its installed package.json at the same path, when
 *   the installed version matches and the package is not a platform binary
 *   (an entry with os or cpu), so the result does not depend on the machine;
 * - edgeImports(rootDir) lists the packages each supabase/functions/<name>/
 *   deno.json imports, and the Markdown gets an 'Edge functions' section;
 *   an edge licence is stated only when the Node application installs the
 *   same name@version, otherwise the entry says where to confirm it;
 * - the note under the title speaks for the Node application and names the
 *   edge packages whose licence is still to be confirmed;
 * - the committed THIRD-PARTY-LICENSES.md has no 'No licence' entry for next.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const gen = () => require('../../scripts/third-party-licenses/generate.js');

function tmpTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-edge-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function section(md, heading) {
  const start = md.indexOf(`\n## ${heading}\n`);
  if (start === -1) return '';
  const next = md.indexOf('\n## ', start + 1);
  return next === -1 ? md.slice(start) : md.slice(start, next);
}

describe('collect reads a missing licence from the installed package.json', () => {
  const lock = {
    packages: {
      '': { name: 'app', version: '1.0.0' },
      'node_modules/framework': { version: '15.0.0' },
      'node_modules/old-style': { version: '0.1.2' },
      'node_modules/other-version': { version: '2.0.0' },
      'node_modules/not-installed': { version: '1.0.0' },
      'node_modules/platform-bin': { version: '15.0.0', os: ['darwin'], cpu: ['arm64'], optional: true },
      'node_modules/parent/node_modules/nested': { version: '3.0.0' },
      'node_modules/has-one': { version: '1.0.0', license: 'ISC' },
    },
  };
  const dir = tmpTree({
    'node_modules/framework/package.json': JSON.stringify({ version: '15.0.0', license: 'MIT' }),
    'node_modules/old-style/package.json': JSON.stringify({ version: '0.1.2', licenses: [{ type: 'MIT' }] }),
    'node_modules/other-version/package.json': JSON.stringify({ version: '2.0.1', license: 'MIT' }),
    'node_modules/platform-bin/package.json': JSON.stringify({ version: '15.0.0', license: 'MIT' }),
    'node_modules/nested/package.json': JSON.stringify({ version: '9.9.9', license: 'BSD-3-Clause' }),
    'node_modules/parent/node_modules/nested/package.json': JSON.stringify({ version: '3.0.0', license: 'Apache-2.0' }),
    'node_modules/has-one/package.json': JSON.stringify({ version: '1.0.0', license: 'MIT' }),
  });
  const byName = () => Object.fromEntries(gen().collect(lock, { installedRoot: dir }).map((e) => [e.name, e]));

  it('uses the installed licence (string or licenses array) when the lock has none', () => {
    expect(byName().framework.license).toBe('MIT');
    expect(byName()['old-style'].license).toBe('MIT');
  });

  it('reads the package at its own lock path, not a same-named one elsewhere', () => {
    expect(byName().nested.license).toBe('Apache-2.0');
  });

  it('keeps null when the installed version differs or nothing is installed', () => {
    expect(byName()['other-version'].license).toBeNull();
    expect(byName()['not-installed'].license).toBeNull();
  });

  it('does not read platform binaries, so the output is the same on every machine', () => {
    expect(byName()['platform-bin'].license).toBeNull();
  });

  it('keeps the lock licence when there is one, and reads nothing without installedRoot', () => {
    expect(byName()['has-one'].license).toBe('ISC');
    expect(Object.fromEntries(gen().collect(lock).map((e) => [e.name, e])).framework.license).toBeNull();
  });
});

describe('edge functions', () => {
  it('parses npm:, esm.sh and deno.land/std import specifiers', () => {
    const { parseSpecifier } = gen();
    expect(parseSpecifier('npm:mupdf@1.27.0')).toEqual({ name: 'mupdf', version: '1.27.0', registry: 'npm' });
    expect(parseSpecifier('npm:@scope/pkg@2.0.0/sub')).toEqual({ name: '@scope/pkg', version: '2.0.0', registry: 'npm' });
    expect(parseSpecifier('https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs?external=canvas')).toEqual({
      name: 'pdfjs-dist',
      version: '4.0.379',
      registry: 'npm',
    });
    expect(parseSpecifier('https://deno.land/std@0.224.0/encoding/base64.ts')).toEqual({
      name: 'Deno std',
      version: '0.224.0',
      registry: 'deno-std',
    });
    expect(parseSpecifier('./local.ts')).toBeNull();
  });

  it('edgeImports lists each function import, with a licence only when the same name@version is installed', () => {
    const dir = tmpTree({
      'supabase/functions/render/deno.json': JSON.stringify({
        imports: { lib: 'npm:copyleft-lib@1.0.0', b64: 'https://deno.land/std@0.224.0/encoding/base64.ts' },
      }),
      'supabase/functions/extract/deno.json': JSON.stringify({
        imports: { a: 'https://esm.sh/shared@1.17.1', b: 'https://esm.sh/viewer@4.0.0/build/x.mjs' },
      }),
      'node_modules/shared/package.json': JSON.stringify({
        version: '1.17.1',
        license: 'MIT',
        repository: 'git+https://github.com/example/shared.git',
      }),
      'node_modules/viewer/package.json': JSON.stringify({
        version: '5.0.0',
        license: 'Apache-2.0',
        repository: { type: 'git', url: 'git+https://github.com/example/viewer.git' },
      }),
    });
    // No confirmed entries here, so only the install can prove a licence.
    const edge = gen().edgeImports(dir, {});
    const by = Object.fromEntries(edge.map((e) => [`${e.fn}:${e.name}`, e]));
    expect(Object.keys(by).sort()).toEqual(['extract:shared', 'extract:viewer', 'render:Deno std', 'render:copyleft-lib']);
    expect(by['extract:shared'].license).toBe('MIT');
    expect(by['extract:shared'].proof).toBe('node_modules/shared/package.json');
    expect(by['extract:viewer'].license).toBeNull();
    expect(by['extract:viewer'].confirmAt).toBe('https://github.com/example/viewer');
    expect(by['render:copyleft-lib'].license).toBeNull();
    expect(by['render:copyleft-lib'].confirmAt).toBe('https://www.npmjs.com/package/copyleft-lib/v/1.0.0');
    expect(by['render:Deno std'].confirmAt).toBe('https://deno.land/std@0.224.0');
  });

  it('render adds an Edge functions section and the note names the unconfirmed packages', () => {
    const { render } = gen();
    const entries = [{ name: 'alpha', version: '1.0.0', license: 'MIT', dev: false }];
    const edge = [
      { fn: 'render', name: 'copyleft-lib', version: '1.0.0', license: null, confirmAt: 'https://x.test/c' },
      { fn: 'extract', name: 'shared', version: '1.17.1', license: 'MIT', proof: 'node_modules/shared/package.json' },
    ];
    const md = render(entries, {}, null, edge);
    const lines = md.split('\n');
    expect(lines[2]).toBe(
      'The Node application (package-lock.json) has no GPL or AGPL package. The optional edge functions are listed under Edge functions; the licence of copyleft-lib@1.0.0 (render) is still to be confirmed there.'
    );
    const s = section(md, 'Edge functions');
    expect(s).toContain('- copyleft-lib@1.0.0 (render): licence to confirm at https://x.test/c');
    expect(s).toContain('- shared@1.17.1 (extract): MIT, from node_modules/shared/package.json');
  });

  it('names an edge package whose licence is GPL or AGPL in the note, as a plain fact', () => {
    const { render } = gen();
    const edge = [
      { fn: 'render', name: 'copyleft-lib', version: '1.0.0', license: 'AGPL-3.0-or-later', confirmed: { source: 'x', checked: 'y' } },
      { fn: 'render', name: 'gpl-lib', version: '2.0.0', license: 'GPL-2.0', proof: 'x' },
    ];
    const note = render([], {}, null, edge).split('\n')[2];
    expect(note).toBe(
      'The Node application (package-lock.json) has no GPL or AGPL package. ' +
        'The optional edge function render imports copyleft-lib@1.0.0, which is AGPL-3.0-or-later, so anyone who deploys that function takes on the AGPL\'s terms for it. ' +
        'The optional edge function render imports gpl-lib@2.0.0, which is GPL-2.0, so anyone who deploys that function takes on the GPL\'s terms for it. ' +
        'Every edge-function import is listed under Edge functions.'
    );
  });

  describe('confirmed licences (edge-confirmed.json)', () => {
    const files = {
      'supabase/functions/render/deno.json': JSON.stringify({
        imports: { lib: 'npm:copyleft-lib@1.0.0', b64: 'https://deno.land/std@0.224.0/encoding/base64.ts' },
      }),
      'supabase/functions/extract/deno.json': JSON.stringify({
        imports: { a: 'https://esm.sh/shared@1.17.1', b: 'https://esm.sh/viewer@4.1.0/build/x.mjs' },
      }),
      'node_modules/shared/package.json': JSON.stringify({ version: '1.17.1', license: 'MIT' }),
    };
    const confirmed = {
      'copyleft-lib@1.0.0': { license: 'AGPL-3.0-or-later', source: 'https://registry.test/copyleft-lib/1.0.0', checked: '2026-11-21' },
      'Deno std@0.224.0': { license: 'MIT', source: 'https://deno.test/std@0.224.0/LICENSE', checked: '2026-11-21' },
      'viewer@4.0.0': { license: 'Apache-2.0', source: 'https://registry.test/viewer/4.0.0', checked: '2026-11-21' },
      'shared@1.17.1': { license: 'BSD-3-Clause', source: 'https://registry.test/shared/1.17.1', checked: '2026-11-21' },
    };
    const byKey = () =>
      Object.fromEntries(gen().edgeImports(tmpTree(files), confirmed).map((e) => [`${e.name}@${e.version}`, e]));

    it('uses a confirmed entry for the same name@version when the install cannot prove it', () => {
      const e = byKey()['copyleft-lib@1.0.0'];
      expect(e.license).toBe('AGPL-3.0-or-later');
      expect(e.confirmed).toEqual({ source: 'https://registry.test/copyleft-lib/1.0.0', checked: '2026-11-21' });
      expect(byKey()['Deno std@0.224.0'].license).toBe('MIT');
    });

    it('still asks to confirm a version with no entry, so a bump never keeps an old answer', () => {
      const e = byKey()['viewer@4.1.0'];
      expect(e.license).toBeNull();
      expect(e.confirmAt).toBe('https://www.npmjs.com/package/viewer/v/4.1.0');
    });

    it('prefers the installed package.json over a confirmed entry', () => {
      const e = byKey()['shared@1.17.1'];
      expect(e.license).toBe('MIT');
      expect(e.proof).toBe('node_modules/shared/package.json');
      expect(e.confirmed).toBeUndefined();
    });

    it('prints a confirmed licence with its source and date', () => {
      const md = gen().render([], {}, null, gen().edgeImports(tmpTree(files), confirmed));
      const s = section(md, 'Edge functions');
      expect(s).toContain(
        '- copyleft-lib@1.0.0 (render): AGPL-3.0-or-later, confirmed at https://registry.test/copyleft-lib/1.0.0 on 2026-11-21'
      );
      expect(s).toContain('- viewer@4.1.0 (extract): licence to confirm at https://www.npmjs.com/package/viewer/v/4.1.0');
    });
  });

  it('keeps the old one-line note when there are no edge imports', () => {
    const { render } = gen();
    expect(render([], {}, null, []).split('\n')[2]).toBe('No GPL or AGPL package is present.');
  });
});

describe('the real repository', () => {
  it('lists the four edge-function imports from supabase/functions/*/deno.json', () => {
    const ids = gen()
      .edgeImports(root)
      .map((e) => `${e.fn}:${e.name}@${e.version}`)
      .sort();
    expect(ids).toEqual([
      'extract-form-fields:pdf-lib@1.17.1',
      'extract-form-fields:pdfjs-dist@4.0.379',
      'pdf-to-image:Deno std@0.224.0',
      'pdf-to-image:mupdf@1.27.0',
    ]);
  });

  it('THIRD-PARTY-LICENSES.md states every edge-function licence and where it was proven', () => {
    const md = fs.readFileSync(path.join(root, 'THIRD-PARTY-LICENSES.md'), 'utf8');
    const s = section(md, 'Edge functions');
    expect(s).toContain('- pdf-lib@1.17.1 (extract-form-fields): MIT, from node_modules/pdf-lib/package.json');
    expect(s).toContain(
      '- pdfjs-dist@4.0.379 (extract-form-fields): Apache-2.0, confirmed at https://registry.npmjs.org/pdfjs-dist/4.0.379 on 2026-11-21'
    );
    expect(s).toContain(
      '- Deno std@0.224.0 (pdf-to-image): MIT, confirmed at https://deno.land/std@0.224.0/LICENSE on 2026-11-21'
    );
    expect(s).toContain(
      '- mupdf@1.27.0 (pdf-to-image): AGPL-3.0-or-later, confirmed at https://registry.npmjs.org/mupdf/1.27.0 on 2026-11-21'
    );
    expect(s).not.toContain('licence to confirm');
  });

  it('line 3 says the Node application has no GPL or AGPL package and pdf-to-image imports AGPL mupdf', () => {
    const md = fs.readFileSync(path.join(root, 'THIRD-PARTY-LICENSES.md'), 'utf8');
    expect(md.split('\n')[2]).toBe(
      'The Node application (package-lock.json) has no GPL or AGPL package. ' +
        "The optional edge function pdf-to-image imports mupdf@1.27.0, which is AGPL-3.0-or-later, so anyone who deploys that function takes on the AGPL's terms for it. " +
        'Every edge-function import is listed under Edge functions.'
    );
  });

  it('THIRD-PARTY-LICENSES.md has no No licence entry for next', () => {
    const md = fs.readFileSync(path.join(root, 'THIRD-PARTY-LICENSES.md'), 'utf8');
    expect(md).not.toMatch(/(^|\s)next@\S+ \(No licence\)/m);
    const blocks = md.split('\n### ').filter((b) => b.startsWith('No licence\n'));
    for (const b of blocks) expect(b).not.toMatch(/(^|\s)next@/m);
    expect(md).toMatch(/^### MIT\n\n.*(^|\s)next@15\.5\.29(\s|$)/ms);
  });
});
