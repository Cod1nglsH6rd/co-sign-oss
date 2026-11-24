/**
 * lib/internalAuth.js can be loaded more than once in one server process
 * (Next builds instrumentation.js and pages/api/* as separate bundles). Every
 * copy must use the same per-process token, or the OCR worker's dispatch is
 * refused by /api/ocr.
 */
import * as internalAuth from '../../lib/internalAuth';

// A separate copy of the module with its own module registry, as a second
// bundle in the same process would have.
function loadCopy() {
  let mod;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    mod = require('../../lib/internalAuth');
  });
  return mod;
}

describe('internal token shared across copies of lib/internalAuth', () => {
  it('returns the same token from two separately loaded copies', () => {
    const a = loadCopy();
    const b = loadCopy();
    const token = a.getInternalToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(b.getInternalToken()).toBe(token);
    expect(internalAuth.getInternalToken()).toBe(token);
  });

  it("accepts a token from one copy in the other copy's check", () => {
    const a = loadCopy();
    const b = loadCopy();
    expect(b.isInternalAuthorized({ headers: { 'x-internal-token': a.getInternalToken() } })).toBe(true);
    expect(a.isInternalAuthorized({ headers: { 'x-internal-token': b.getInternalToken() } })).toBe(true);
  });

  it('exports only its two functions, never the token itself', () => {
    const copy = loadCopy();
    const token = copy.getInternalToken();
    for (const mod of [internalAuth, copy]) {
      const names = Object.keys(mod).filter((k) => k !== 'default' && k !== '__esModule');
      expect(names.sort()).toEqual(['getInternalToken', 'isInternalAuthorized']);
      for (const name of Object.keys(mod)) {
        expect(mod[name]).not.toBe(token);
        expect(typeof mod[name] === 'string' && mod[name].includes(token)).toBe(false);
      }
    }
  });
});
