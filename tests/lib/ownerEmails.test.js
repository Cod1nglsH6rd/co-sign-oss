/**
 * Owner allowlists come only from env: comma-separated, trimmed, lower-cased,
 * and empty when unset (no built-in personal email fallback).
 */

const VARS = ['ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS'];
const saved = {};

beforeEach(() => {
  VARS.forEach((name) => { saved[name] = process.env[name]; delete process.env[name]; });
});

afterEach(() => {
  VARS.forEach((name) => {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  });
});

function load() {
  return require('../../lib/ownerEmails');
}

describe('parseOwnerEmails', () => {
  it('splits on commas, trims, lower-cases and drops blanks', () => {
    const { parseOwnerEmails } = load();
    expect(parseOwnerEmails(' Alice@Example.com, ,bob@example.COM ,,')).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('returns [] for an empty, missing or non-string value', () => {
    const { parseOwnerEmails } = load();
    expect(parseOwnerEmails('')).toEqual([]);
    expect(parseOwnerEmails(undefined)).toEqual([]);
    expect(parseOwnerEmails(null)).toEqual([]);
    expect(parseOwnerEmails('  ,  ')).toEqual([]);
  });
});

describe('getServerOwnerEmails', () => {
  it('returns [] when no variable is set', () => {
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails()).toEqual([]);
  });

  it('prefers ADMIN_DASHBOARD_EMAILS over NEXT_PUBLIC_OWNER_EMAILS', () => {
    process.env.ADMIN_DASHBOARD_EMAILS = 'Server@Example.com';
    process.env.NEXT_PUBLIC_OWNER_EMAILS = 'client@example.com';
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails()).toEqual(['server@example.com']);
  });

  it('falls back to NEXT_PUBLIC_OWNER_EMAILS', () => {
    process.env.NEXT_PUBLIC_OWNER_EMAILS = ' a@example.com , B@example.com ';
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails()).toEqual(['a@example.com', 'b@example.com']);
  });

  it('ignores NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS', () => {
    process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS = 'x@example.com';
    const { getServerOwnerEmails } = load();
    expect(getServerOwnerEmails()).toEqual([]);
  });
});

describe('no browser owner list', () => {
  // issue #487: the browser asks GET /api/admin/me, so the build-time getClientOwnerEmails is gone.
  it('exports no getClientOwnerEmails', () => {
    expect(load()).not.toHaveProperty('getClientOwnerEmails');
  });
});

describe('isOwnerEmail', () => {
  it('matches case-insensitively and rejects empty input', () => {
    const { isOwnerEmail } = load();
    expect(isOwnerEmail('Owner@Example.com', ['owner@example.com'])).toBe(true);
    expect(isOwnerEmail('other@example.com', ['owner@example.com'])).toBe(false);
    expect(isOwnerEmail('', ['owner@example.com'])).toBe(false);
    expect(isOwnerEmail(undefined, [])).toBe(false);
  });
});
