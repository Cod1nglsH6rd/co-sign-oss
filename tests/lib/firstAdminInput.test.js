/**
 * lib/firstAdminInput.js checks the first admin's email and password before
 * anything else happens.
 *
 * checkFirstAdminInput({ email, password }) is pure: no files, no network,
 * no console. A missing, non-string or malformed email resolves
 * { ok: false, message } naming the email. A missing, non-string or short
 * (under 10 characters) password resolves { ok: false, message } saying it
 * needs at least 10 characters. A valid input resolves { ok: true, email }
 * with the email trimmed and lower-cased. No result holds the password.
 */

const GOOD_PASSWORD = 'correct-horse-42';

function load() {
  const mod = require('../../lib/firstAdminInput');
  expect(typeof mod.checkFirstAdminInput).toBe('function');
  return mod.checkFirstAdminInput;
}

let consoleSpies;

beforeEach(() => {
  consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((name) =>
    jest.spyOn(console, name).mockImplementation(() => {})
  );
});

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
  }
  jest.restoreAllMocks();
});

function expectNoPassword(result, password) {
  expect(JSON.stringify(result)).not.toContain(password);
  expect(result).not.toHaveProperty('password');
}

describe('valid input', () => {
  it('resolves ok with the email trimmed and lower-cased', async () => {
    const check = load();
    const result = await check({ email: '  Owner@Example.COM ', password: GOOD_PASSWORD });
    expect(result).toEqual({ ok: true, email: 'owner@example.com' });
    expectNoPassword(result, GOOD_PASSWORD);
  });

  it('accepts a password of exactly 10 characters', async () => {
    const check = load();
    const result = await check({ email: 'a@b.co', password: '0123456789' });
    expect(result).toEqual({ ok: true, email: 'a@b.co' });
    expectNoPassword(result, '0123456789');
  });
});

describe('bad email', () => {
  const badEmails = [
    ['missing', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { email: 'a@b.co' }],
    ['empty', ''],
    ['only spaces', '   '],
    ['no @', 'owner.example.com'],
    ['two @', 'owner@@example.com'],
    ['two separate @', 'own@er@example.com'],
    ['nothing before @', '@example.com'],
    ['nothing after @', 'owner@'],
    ['no dot in the domain', 'owner@example'],
    ['a space inside', 'own er@example.com'],
    ['a space in the domain', 'owner@exa mple.com'],
    ['a tab inside', 'owner@example.\tcom'],
  ];

  it.each(badEmails)('rejects an email that is %s, naming the email', async (_label, email) => {
    const check = load();
    const result = await check({ email, password: GOOD_PASSWORD });
    expect(result.ok).toBe(false);
    expect(typeof result.message).toBe('string');
    expect(result.message).toMatch(/email/i);
    expect(result).not.toHaveProperty('email');
    expectNoPassword(result, GOOD_PASSWORD);
  });
});

describe('bad password', () => {
  const badPasswords = [
    ['missing', undefined],
    ['null', null],
    // Eleven digits, so not too short as text, in an order the privacy scan's phone rule does not read as a number to call.
    ['a number', 98765432101],
    ['an array', ['0123456789']],
    ['empty', ''],
    ['9 characters', '123456789'],
  ];

  it.each(badPasswords)('rejects a password that is %s, saying it needs at least 10 characters', async (_label, password) => {
    const check = load();
    const result = await check({ email: 'owner@example.com', password });
    expect(result.ok).toBe(false);
    expect(typeof result.message).toBe('string');
    expect(result.message).toMatch(/password/i);
    expect(result.message).toMatch(/at least 10 characters/i);
    if (typeof password === 'string' && password) {
      expectNoPassword(result, password);
    }
    expect(result).not.toHaveProperty('password');
  });
});

describe('missing input', () => {
  const missingInputs = [
    ['no argument', []],
    ['undefined', [undefined]],
    ['null', [null]],
    ['a string', ['owner@example.com']],
    ['a number', [42]],
    ['an empty object', [{}]],
  ];

  it.each(missingInputs)('resolves not ok, naming the email, when the input is %s', async (_label, args) => {
    const check = load();
    let result;
    let thrown;
    try {
      result = await check(...args);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeUndefined();
    expect(result.ok).toBe(false);
    expect(typeof result.message).toBe('string');
    expect(result.message).toMatch(/email/i);
    expect(result).not.toHaveProperty('email');
  });
});
