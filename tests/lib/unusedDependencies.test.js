import fs from 'fs';
import path from 'path';

// Issue #76: puppeteer, axios, docx and zustand are not used by the app, and
// dotenv is only used by scripts/*.js (local tooling). Keeping them as
// production dependencies pulls in unused code, high advisories (the
// puppeteer chain) and a Chromium download on every npm ci.

const ROOT = path.join(__dirname, '..', '..');
const REMOVED = ['puppeteer', 'axios', 'docx', 'zustand'];
const APP_DIRS = ['pages', 'lib', 'components', 'hooks'];

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (/\.(js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// import x from 'pkg', import 'pkg', require('pkg'), import('pkg'), and the
// same with a subpath ('pkg/whatever').
function importsPackage(source, name) {
  const spec = `['"]${name}(?:/[^'"]*)?['"]`;
  const re = new RegExp(
    `(?:\\bfrom\\s*${spec}|\\bimport\\s*${spec}|\\brequire\\s*\\(\\s*${spec}\\s*\\)|\\bimport\\s*\\(\\s*${spec}\\s*\\))`
  );
  return re.test(source);
}

describe('unused dependencies (issue #76)', () => {
  it.each(REMOVED)('%s is not a dependency or devDependency', (name) => {
    expect(Object.keys(pkg.dependencies || {})).not.toContain(name);
    expect(Object.keys(pkg.devDependencies || {})).not.toContain(name);
  });

  it('dotenv is only a devDependency', () => {
    expect(Object.keys(pkg.dependencies || {})).not.toContain('dotenv');
    expect(Object.keys(pkg.devDependencies || {})).toContain('dotenv');
  });

  it('the import matcher recognises every import form', () => {
    expect(importsPackage("import axios from 'axios';", 'axios')).toBe(true);
    expect(importsPackage('import "zustand";', 'zustand')).toBe(true);
    expect(importsPackage("const p = require('puppeteer');", 'puppeteer')).toBe(true);
    expect(importsPackage("const d = await import('docx');", 'docx')).toBe(true);
    expect(importsPackage("import { create } from 'zustand/vanilla';", 'zustand')).toBe(true);
    expect(importsPackage("import x from 'axios-retry';", 'axios')).toBe(false);
    expect(importsPackage("const name = 'report.docx';", 'docx')).toBe(false);
  });

  it('no file under pages/, lib/, components/ or hooks/ imports a removed package', () => {
    const offenders = [];
    for (const dir of APP_DIRS) {
      const abs = path.join(ROOT, dir);
      expect(fs.existsSync(abs)).toBe(true);
      for (const file of jsFiles(abs)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const name of REMOVED) {
          if (importsPackage(source, name)) offenders.push(`${path.relative(ROOT, file)}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
