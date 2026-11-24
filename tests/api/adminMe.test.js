/**
 * GET /api/admin/me tells the signed-in caller whether they are an owner, by
 * the server's own list (env, then the ADMIN_DASHBOARD_EMAILS saved on the host
 * at /setup), and nothing else. No valid session: 401.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');
const { createClient } = require('@supabase/supabase-js');

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const VARS = ['ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS'];
const savedEnv = {};
let cwd;

beforeEach(() => {
  VARS.forEach((name) => { savedEnv[name] = process.env[name]; delete process.env[name]; });
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-admin-me-'));
  createClient.mockReturnValue({
    auth: {
      getUser: async (jwt) => (jwt.startsWith('good:')
        ? { data: { user: { id: 'user-1', email: jwt.slice(5) } }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } }),
    },
  });
});

afterEach(() => {
  VARS.forEach((name) => {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  });
  fs.rmSync(cwd, { recursive: true, force: true });
});

function saveOnHost(settings) {
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify(settings));
}

const OWNER = 'owner@example.com';

describe('GET /api/admin/me', () => {
  it.each([
    ['the owner saved on the host', () => saveOnHost({ ADMIN_DASHBOARD_EMAILS: 'Owner@Example.com' }), `Bearer good:${OWNER}`, 200, { owner: true }],
    ['an owner named in env', () => { process.env.NEXT_PUBLIC_OWNER_EMAILS = OWNER; }, `Bearer good:${OWNER}`, 200, { owner: true }],
    ['a signed-in non-owner', () => saveOnHost({ ADMIN_DASHBOARD_EMAILS: OWNER }), 'Bearer good:staff@example.com', 200, { owner: false }],
    ['no session', () => saveOnHost({ ADMIN_DASHBOARD_EMAILS: OWNER }), undefined, 401, null],
    ['a session the server rejects', () => saveOnHost({ ADMIN_DASHBOARD_EMAILS: OWNER }), 'Bearer expired', 401, null],
  ])('%s', async (_name, setup, authorization, status, body) => {
    setup();
    const handler = require('../../pages/api/admin/me').default;
    const { req, res } = createMocks({ method: 'GET', headers: authorization ? { authorization } : {} });
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    try {
      await handler(req, res);
    } finally {
      cwdSpy.mockRestore();
    }
    expect(res._getStatusCode()).toBe(status);
    const json = res._getJSONData();
    if (body) expect(json).toEqual(body);
    else expect(json).not.toHaveProperty('owner');
  });
});
