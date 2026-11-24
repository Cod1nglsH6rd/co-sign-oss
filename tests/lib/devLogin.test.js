/**
 * Dev login / seed account email: admin@example.com by default,
 * NEXT_PUBLIC_DEV_LOGIN_EMAIL overrides it.
 */

const VAR = 'NEXT_PUBLIC_DEV_LOGIN_EMAIL';
let saved;

beforeEach(() => {
  saved = process.env[VAR];
  delete process.env[VAR];
  jest.resetModules();
});

afterEach(() => {
  if (saved === undefined) delete process.env[VAR];
  else process.env[VAR] = saved;
});

function load() {
  return require('../../lib/devLogin');
}

describe('DEV_EMAIL', () => {
  it('defaults to admin@example.com when the env override is unset', () => {
    expect(load().DEV_EMAIL).toBe('admin@example.com');
  });

  it('uses NEXT_PUBLIC_DEV_LOGIN_EMAIL when it is set', () => {
    process.env[VAR] = 'dev@local.test';
    expect(load().DEV_EMAIL).toBe('dev@local.test');
  });

  it('falls back to the default when the override is empty', () => {
    process.env[VAR] = '';
    expect(load().DEV_EMAIL).toBe('admin@example.com');
  });
});
