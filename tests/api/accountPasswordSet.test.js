/**
 * POST /api/account/password-set clears app_metadata.password_pending for the
 * Bearer session's own user only, keeps the rest and answers { ok: true }.
 */

const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));

let users;
let admin;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  users = {
    'u-caller': { id: 'u-caller', app_metadata: { provider: 'email', team: 'blue', password_pending: true } },
    'u-other': { id: 'u-other', app_metadata: { provider: 'email', password_pending: true } },
  };
  // Stores app_metadata as given, so anything the route leaves out is lost.
  admin = {
    updateUserById: jest.fn(async (id, attrs) => {
      users[id] = { ...users[id], ...attrs };
      return { data: { user: users[id] }, error: null };
    }),
  };
  require('../../lib/supabaseClient').requireServiceSupabase.mockReturnValue({
    auth: {
      getUser: jest.fn(async (jwt) => (jwt === 'good-caller'
        ? { data: { user: JSON.parse(JSON.stringify(users['u-caller'])) }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } })),
      admin,
    },
  });
});

afterEach(() => jest.restoreAllMocks());

async function call({ method = 'POST', authorization, body } = {}) {
  const handler = require('../../pages/api/account/password-set').default;
  const { req, res } = createMocks({ method, headers: authorization ? { authorization } : {}, body });
  await handler(req, res);
  return { status: res._getStatusCode(), body: JSON.parse(res._getData() || 'null') };
}

describe('POST /api/account/password-set', () => {
  it("clears the caller's own mark, keeps their other app_metadata and ignores a user id in the body", async () => {
    const { status, body } = await call({ authorization: 'Bearer good-caller', body: { userId: 'u-other' } });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(admin.updateUserById).toHaveBeenCalledTimes(1);
    expect(admin.updateUserById.mock.calls[0][0]).toBe('u-caller');
    expect(users['u-caller'].app_metadata.password_pending ?? false).toBe(false);
    expect(users['u-caller'].app_metadata).toMatchObject({ provider: 'email', team: 'blue' });
    expect(users['u-other'].app_metadata.password_pending).toBe(true);
  });

  it.each([
    ['no authorization header', 'POST', undefined, 401],
    ['a token the server rejects', 'POST', 'Bearer expired', 401],
    ['another method', 'GET', 'Bearer good-caller', 405],
  ])('%s is refused and nothing is written', async (_name, method, authorization, expected) => {
    const res = await call({ method, authorization });

    expect(res.status).toBe(expected);
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });

  it('a failed write is logged and not answered ok', async () => {
    admin.updateUserById.mockImplementation(async () => ({ data: { user: null }, error: { message: 'write refused' } }));

    const { status, body } = await call({ authorization: 'Bearer good-caller' });

    expect(status).toBe(500);
    expect(body).not.toHaveProperty('ok', true);
    expect(console.error.mock.calls.flat().join(' ')).toContain('write refused');
  });
});
