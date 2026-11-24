// lib/internalAuth is new; require it inside each test so the file loads
// (and fails on an assertion) before the module exists.
function load() {
  return require('../../lib/internalAuth');
}

// Load a fresh copy of the module (its own module registry), so anything it
// reads while initializing sees the environment as the test set it.
function loadFresh() {
  let mod;
  jest.isolateModules(() => {
    mod = require('../../lib/internalAuth');
  });
  return mod;
}

// Set (or unset, for undefined) env vars for the length of fn, then put back
// whatever was there before, including a value that already existed.
function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined;
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe('getInternalToken', () => {
  it('returns a 32-byte random token that is stable within a process', () => {
    const { getInternalToken } = load();
    const first = getInternalToken();
    expect(typeof first).toBe('string');
    // 32 bytes as hex is 64 characters.
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(getInternalToken()).toBe(first);
    expect(load().getInternalToken()).toBe(first);
  });

  it('is not read from the environment, even when the module first loads', () => {
    const planted = 'a'.repeat(64);
    const names = {
      INTERNAL_TOKEN: planted,
      INTERNAL_AUTH_TOKEN: planted,
      INTERNAL_SECRET: planted,
      CRON_SECRET: planted,
      PROCESS_OCR_CRON_SECRET: planted,
    };
    withEnv(names, () => {
      const fresh = loadFresh();
      const token = fresh.getInternalToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(token).not.toBe(planted);
      expect(
        fresh.isInternalAuthorized({ headers: { 'x-internal-token': planted } }),
      ).toBe(false);
    });
  });

  it('makes a new random token for each fresh process-level load', () => {
    const a = loadFresh().getInternalToken();
    const b = loadFresh().getInternalToken();
    expect(a).toBe(b);
  });
});

describe('isInternalAuthorized', () => {
  it('accepts the right internal token with no CRON_SECRET set', () => {
    withEnv({ CRON_SECRET: undefined, PROCESS_OCR_CRON_SECRET: undefined }, () => {
      const { getInternalToken, isInternalAuthorized } = loadFresh();
      const req = { headers: { 'x-internal-token': getInternalToken() } };
      expect(isInternalAuthorized(req)).toBe(true);
    });
  });

  it('refuses a wrong token', () => {
    const { getInternalToken, isInternalAuthorized } = load();
    const token = getInternalToken();
    const wrong = (token[0] === 'a' ? 'b' : 'a') + token.slice(1);
    expect(isInternalAuthorized({ headers: { 'x-internal-token': wrong } })).toBe(false);
    expect(isInternalAuthorized({ headers: { 'x-internal-token': 'nope' } })).toBe(false);
  });

  it('refuses an empty header', () => {
    const { isInternalAuthorized } = load();
    expect(isInternalAuthorized({ headers: { 'x-internal-token': '' } })).toBe(false);
  });

  it('refuses a missing header or request', () => {
    const { isInternalAuthorized } = load();
    expect(isInternalAuthorized({ headers: {} })).toBe(false);
    expect(isInternalAuthorized({})).toBe(false);
    expect(isInternalAuthorized(undefined)).toBe(false);
  });

  it('does not accept the token in the Authorization header used for user JWTs', () => {
    const { getInternalToken, isInternalAuthorized } = load();
    const req = { headers: { authorization: `Bearer ${getInternalToken()}` } };
    expect(isInternalAuthorized(req)).toBe(false);
  });
});
