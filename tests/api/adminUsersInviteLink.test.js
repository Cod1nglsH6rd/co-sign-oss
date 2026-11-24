/**
 * POST /api/admin/users for an address with no account. The auth service's
 * own mailer (inviteUserByEmail) is never used: the route asks for an invite
 * link (generateLink, type 'invite'), mails it through the app's own mailer
 * (lib/email.js, real here) and, whenever that mail did not go out, hands the
 * link back to the owner with the reason lib/email.js gave. Only Supabase and
 * Resend's HTTP call (global.fetch) are faked; the saved settings folder is an
 * empty temp folder, so mail settings come from env alone.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));

const VARS = ['NEXT_PUBLIC_APP_URL', 'ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'EMAIL_FROM'];
const SECRET = 'one-time-secret-123';
const LINK = `https://auth.example.com/verify?token=${SECRET}&type=invite`;
const RESEND_ON = { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key_123456', EMAIL_FROM: 'Co Sign <noreply@example.com>' };
const savedEnv = {};
let cwd;
let realFetch;

beforeEach(() => {
  VARS.forEach((name) => { savedEnv[name] = process.env[name]; delete process.env[name]; });
  process.env.ADMIN_DASHBOARD_EMAILS = 'owner@example.com';
  process.env.NEXT_PUBLIC_APP_URL = 'https://cosign.example.com';
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-invite-link-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  ['log', 'info', 'warn', 'error'].forEach((level) => jest.spyOn(console, level).mockImplementation(() => {}));
  realFetch = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'mail-1' }) }));
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
  VARS.forEach((name) => {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  });
});

// Everything the console was given, as one string.
function allLogged() {
  return ['log', 'info', 'warn', 'error']
    .flatMap((level) => console[level].mock.calls)
    .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, Object.getOwnPropertyNames(a || {})))).join(' '))
    .join('\n');
}

function fakeSupabase({ existingUsers = [], generateLinkResult } = {}) {
  const upserts = [];
  const query = {};
  ['select', 'eq', 'order', 'limit'].forEach((m) => { query[m] = () => query; });
  query.single = async () => ({ data: { org_id: 'org-1' }, error: null });
  query.upsert = async (rows) => { upserts.push(rows); return { error: null }; };
  const admin = {
    listUsers: jest.fn(async () => ({ data: { users: existingUsers }, error: null })),
    getUserById: jest.fn(async () => ({ data: { user: null } })),
    inviteUserByEmail: jest.fn(async () => ({ data: { user: { id: 'u-invited' } }, error: null })),
    generateLink: jest.fn(async () => generateLinkResult || {
      data: {
        properties: { action_link: LINK, email_otp: '123456', hashed_token: 'hashed', redirect_to: 'https://cosign.example.com/enterprise/login', verification_type: 'invite' },
        user: { id: 'u-new', email: 'new@example.com' },
      },
      error: null,
    }),
  };
  require('../../lib/supabaseClient').requireServiceSupabase.mockReturnValue({
    from: jest.fn(() => query),
    auth: { getUser: async () => ({ data: { user: { id: 'u-owner', email: 'owner@example.com' } }, error: null }), admin },
  });
  return { admin, upserts };
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

describe('POST /api/admin/users: a new address gets an invite link, mailed or handed to the owner', () => {
  it.each([
    ['the app mail is sent', RESEND_ON, 200, { mailed: true }],
    ['the app mail is off', {}, null, { mailed: false, mailReason: 'mail_off', inviteLink: LINK }],
    ['no sender is set', { ...RESEND_ON, EMAIL_FROM: undefined }, null, { mailed: false, mailReason: 'no_sender', inviteLink: LINK }],
    ['the provider fails', RESEND_ON, 500, { mailed: false, mailReason: 'provider_error', inviteLink: LINK }],
  ])('%s', async (_name, mailEnv, resendStatus, expected) => {
    Object.entries(mailEnv).forEach(([name, value]) => { if (value !== undefined) process.env[name] = value; });
    if (resendStatus) global.fetch.mockImplementation(async () => ({ ok: resendStatus === 200, status: resendStatus, json: async () => ({}) }));
    const { admin, upserts } = fakeSupabase();

    const { status, body } = await addUser();

    expect(status).toBe(200);
    expect(admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(admin.generateLink).toHaveBeenCalledWith({
      type: 'invite',
      email: 'new@example.com',
      options: { redirectTo: 'https://cosign.example.com/enterprise/login' },
    });
    expect(body).toEqual({ orgId: 'org-1', invited: true, user: { id: 'u-new', email: 'new@example.com', role: 'member' }, ...expected });
    expect(upserts).toEqual([[{ org_id: 'org-1', user_id: 'u-new', role: 'member', status: 'active' }]]);
    if (resendStatus) {
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.resend.com/emails');
      expect(JSON.parse(init.body)).toMatchObject({ to: ['new@example.com'], from: RESEND_ON.EMAIL_FROM });
      expect(JSON.parse(init.body).html).toContain(LINK);
    } else {
      expect(global.fetch).not.toHaveBeenCalled();
    }
    expect(allLogged()).not.toContain(SECRET);
  });

  it('an address that already has an account gets the membership and no link', async () => {
    const { admin, upserts } = fakeSupabase({ existingUsers: [{ id: 'u-old', email: 'old@example.com' }] });

    const { status, body } = await addUser('old@example.com');

    expect(status).toBe(200);
    expect(body).toEqual({ orgId: 'org-1', invited: false, user: { id: 'u-old', email: 'old@example.com', role: 'member' } });
    expect(admin.generateLink).not.toHaveBeenCalled();
    expect(admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(upserts).toEqual([[{ org_id: 'org-1', user_id: 'u-old', role: 'member', status: 'active' }]]);
  });

  it('a failure to make the link adds no membership, answers 500 and logs no link', async () => {
    const { admin, upserts } = fakeSupabase({
      generateLinkResult: { data: { properties: { action_link: LINK }, user: null }, error: { message: 'Database error saving new user', status: 500 } },
    });

    const { status, body } = await addUser();

    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(admin.generateLink).toHaveBeenCalledTimes(1);
    expect(admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(upserts).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(allLogged()).not.toContain(SECRET);
  });
});
