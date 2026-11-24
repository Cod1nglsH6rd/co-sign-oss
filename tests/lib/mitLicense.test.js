/**
 * MIT licence (co-sign-255): LICENSE is the standard MIT text with a
 * 'Copyright (c)' line, package.json declares "MIT", and the README's
 * '### License' section names MIT and THIRD-PARTY-LICENSES.md and no longer
 * calls the project proprietary.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// Collapse line breaks and runs of spaces so wrapping does not matter.
function flat(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function readmeLicenceSection() {
  const md = read('README.md');
  const start = md.search(/^### License\s*$/m);
  expect(start).toBeGreaterThan(-1);
  const rest = md.slice(start + '### License'.length);
  const next = rest.search(/^#{1,3} /m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('LICENSE', () => {
  const text = read('LICENSE');

  it('starts with "MIT License"', () => {
    expect(text.startsWith('MIT License')).toBe(true);
  });

  it('has a "Copyright (c)" line', () => {
    expect(text).toMatch(/^Copyright \(c\) \d{4} .+$/m);
  });

  it('contains the MIT permission paragraph', () => {
    const body = flat(text);
    expect(body).toContain(
      'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:'
    );
    expect(body).toContain(
      'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.'
    );
  });

  it('contains the MIT warranty paragraph', () => {
    expect(flat(text)).toContain(
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.'
    );
  });

  it('no longer carries the old All Rights Reserved text', () => {
    expect(text).not.toMatch(/all rights reserved/i);
    expect(text).not.toMatch(/proprietary/i);
  });
});

describe('package.json', () => {
  it('declares the MIT licence', () => {
    expect(JSON.parse(read('package.json')).license).toBe('MIT');
  });
});

describe('README licence section', () => {
  const section = readmeLicenceSection();

  it('names MIT and points to LICENSE and THIRD-PARTY-LICENSES.md', () => {
    expect(section).toMatch(/\bMIT\b/);
    expect(section).toMatch(/\bLICENSE\b/);
    expect(section).toContain('THIRD-PARTY-LICENSES.md');
  });

  it('no longer says the project is proprietary', () => {
    expect(section).not.toMatch(/proprietary/i);
  });
});
