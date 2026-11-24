/**
 * /api/admin/usage and /api/admin/users trust only the env allowlist: with it
 * unset, every signed-in user (including the old hard-coded addresses) gets 403.
 */

import { createMocks } from 'node-mocks-http';
import { createClient } from '@supabase/supabase-js';
import usageHandler from '../../pages/api/admin/usage';
import usersHandler from '../../pages/api/admin/users';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const VARS = ['ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS'];
const saved = {};

// A fake Supabase client: every query resolves to an empty, successful result.
function makeSupabase(email, fromCalls) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    single: async () => ({ data: { org_id: 'org-1' }, error: null }),
    then: (resolve, reject) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject),
  };
  return {
    from: (table) => { fromCalls.push(table); return builder; },
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email } }, error: null }),
      admin: { getUserById: async () => ({ data: { user: null } }) },
    },
  };
}

async function call(handler, email) {
  const fromCalls = [];
  createClient.mockReturnValue(makeSupabase(email, fromCalls));
  const { req, res } = createMocks({ method: 'GET', headers: { authorization: 'Bearer jwt' } });
  await handler(req, res);
  return { status: res._getStatusCode(), fromCalls };
}

beforeEach(() => {
  VARS.forEach((name) => { saved[name] = process.env[name]; delete process.env[name]; });
  createClient.mockReset();
});

afterEach(() => {
  VARS.forEach((name) => {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  });
});

describe.each([
  ['/api/admin/usage', usageHandler],
  ['/api/admin/users', usersHandler],
])('%s', (_name, handler) => {
  it.each(['admin@example.org', 'owner@example.net', 'someone@example.com'])(
    'answers 403 to %s when the allowlist is unset',
    async (email) => {
      const { status, fromCalls } = await call(handler, email);
      expect(status).toBe(403);
      expect(fromCalls).toEqual([]);
    },
  );

  it('answers 403 when the allowlist is set but blank', async () => {
    process.env.ADMIN_DASHBOARD_EMAILS = ' , ';
    process.env.NEXT_PUBLIC_OWNER_EMAILS = ' ';
    const { status } = await call(handler, 'admin@example.org');
    expect(status).toBe(403);
  });

  it('lets an allowlisted email through, trimmed and case-insensitive', async () => {
    process.env.ADMIN_DASHBOARD_EMAILS = ' Owner@Example.com , other@example.com';
    const { status } = await call(handler, 'owner@EXAMPLE.com');
    expect(status).toBe(200);
  });

  it('answers 403 to a user not on the allowlist', async () => {
    process.env.ADMIN_DASHBOARD_EMAILS = 'owner@example.com';
    const { status } = await call(handler, 'intruder@example.com');
    expect(status).toBe(403);
  });
});
