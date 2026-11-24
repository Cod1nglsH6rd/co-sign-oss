/**
 * POST /api/admin/users marks a NEW account (the generateLink path) with
 * app_metadata.password_pending = true, keeping its other app_metadata. A
 * failure to mark does not fail the invite and logs the id and message, never
 * the link. An address that already has an account is not touched.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));

const VARS = ['NEXT_PUBLIC_APP_URL', 'ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'EMAIL_FROM'];
const SECRET = 'one-time-secret-456';
const LINK = `https://auth.example.com/verify?token=${SECRET}&type=invite`;
const savedEnv = {};
let cwd;

beforeEach(() => {
  VARS.forEach((name) => { savedEnv[name] = process.env[name]; delete process.env[name]; });
  process.env.ADMIN_DASHBOARD_EMAILS = 'owner@example.com';
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-pending-mark-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  ['log', 'info', 'warn', 'error'].forEach((level) => jest.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
  VARS.forEach((name) => {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  });
});

function fakeSupabase({ existingUsers = [], updateUserById } = {}) {
  const query = {};
  ['select', 'eq', 'order', 'limit'].forEach((m) => { query[m] = () => query; });
  query.single = async () => ({ data: { org_id: 'org-1' }, error: null });
  query.upsert = async () => ({ error: null });
  const admin = {
    listUsers: jest.fn(async () => ({ data: { users: existingUsers }, error: null })),
    getUserById: jest.fn(async () => ({ data: { user: null } })),
    generateLink: jest.fn(async () => ({
      data: {
        properties: { action_link: LINK },
        user: { id: 'u-new', email: 'new@example.com', app_metadata: { provider: 'email', team: 'blue' } },
      },
      error: null,
    })),
    updateUserById: jest.fn(updateUserById || (async (id, attrs) => ({ data: { user: { id, ...attrs } }, error: null }))),
  };
  require('../../lib/supabaseClient').requireServiceSupabase.mockReturnValue({
    from: jest.fn(() => query),
    auth: { getUser: async () => ({ data: { user: { id: 'u-owner', email: 'owner@example.com' } }, error: null }), admin },
  });
  return admin;
}

async function addUser(email = 'new@example.com') {
  const handler = require('../../pages/api/admin/users').default;
  const { req, res } = createMocks({
    method: 'POST',
    headers: { authorization: 'Bearer jwt', host: 'cosign.example.com' },
    body: { email, role: 'member' },
  });
  await handler(req, res);
  return { status: res._getStatusCode(), body: JSON.parse(res._getData()) };
}

describe('POST /api/admin/users: the password_pending mark', () => {
  it('a new account gets password_pending = true, with its other app_metadata kept', async () => {
    const admin = fakeSupabase();

    const { status, body } = await addUser();

    expect(status).toBe(200);
    expect(body.invited).toBe(true);
    expect(admin.updateUserById).toHaveBeenCalledTimes(1);
    expect(admin.updateUserById).toHaveBeenCalledWith('u-new', {
      app_metadata: { provider: 'email', team: 'blue', password_pending: true },
    });
  });

  it.each([
    ['answers an error', async () => ({ data: { user: null }, error: { message: 'mark write refused' } })],
    ['throws', async () => { throw new Error('mark write refused'); }],
  ])('when setting the mark %s, the invite still succeeds and one line names the user, never the link', async (_name, updateUserById) => {
    const admin = fakeSupabase({ updateUserById });

    const { status, body } = await addUser();

    expect(admin.updateUserById).toHaveBeenCalledTimes(1);
    expect(status).toBe(200);
    expect(body).toMatchObject({ invited: true, inviteLink: LINK, user: { id: 'u-new' } });
    const lines = ['log', 'info', 'warn', 'error']
      .flatMap((level) => console[level].mock.calls)
      .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    const markLines = lines.filter((line) => line.includes('mark write refused'));
    expect(markLines).toHaveLength(1);
    expect(markLines[0]).toContain('u-new');
    expect(lines.join('\n')).not.toContain(SECRET);
  });

  it('an address that already has an account is not marked', async () => {
    const admin = fakeSupabase({ existingUsers: [{ id: 'u-old', email: 'old@example.com', app_metadata: {} }] });

    const { status, body } = await addUser('old@example.com');

    expect(status).toBe(200);
    expect(body).toEqual({ orgId: 'org-1', invited: false, user: { id: 'u-old', email: 'old@example.com', role: 'member' } });
    expect(admin.generateLink).not.toHaveBeenCalled();
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });
});
