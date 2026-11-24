// package.json's own fields, for the open-source release: the Node version the
// dependencies need (pdfjs-dist 5.x needs 20.19 or later), the same author as
// LICENSE, a description and keywords for a self-hosted e-signing app, and no
// repository field until the public repository exists. package-lock.json's
// root entry carries the same engines, as npm writes it.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));

describe('package.json metadata', () => {
  const pkg = readJson('package.json');

  it('needs Node 20.19 or later', () => {
    expect(pkg.engines).toEqual({ node: '>=20.19' });
  });

  it('names the same author as LICENSE', () => {
    const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
    expect(pkg.author).toBe('Cô Sign contributors');
    expect(license).toContain(`Copyright (c) 2026 ${pkg.author}`);
  });

  it('describes a self-hosted e-signing app, with matching keywords', () => {
    expect(pkg.description).toMatch(/self-hosted/i);
    expect(pkg.description).toMatch(/sign/i);
    expect(pkg.keywords).toEqual(expect.arrayContaining(['e-signature', 'self-hosted', 'pdf']));
    expect(pkg.keywords).not.toContain('immigration');
  });

  it('has no repository field yet', () => {
    expect(pkg).not.toHaveProperty('repository');
  });

  it("matches package-lock.json's root entry", () => {
    const root = readJson('package-lock.json').packages[''];
    expect(root.name).toBe(pkg.name);
    expect(root.version).toBe(pkg.version);
    expect(root.license).toBe(pkg.license);
    expect(root.engines).toEqual(pkg.engines);
  });
});
