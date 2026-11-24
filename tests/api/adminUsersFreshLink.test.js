/**
 * POST /api/admin/users for an address that already has an account. Only an
 * account that is already an active member of the owner's organisation and
 * still carries app_metadata.password_pending === true gets a fresh one-time
 * sign-in link (generateLink, type 'magiclink'), handled like an invite link:
 * mailed through lib/email.js (real here) or handed back to the owner. Only
 * Supabase and Resend's HTTP call (global.fetch) are faked.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));

const VARS = ['NEXT_PUBLIC_APP_URL', 'ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'EMAIL_FROM'];
const SECRET = 'fresh-secret-456';
const LINK = `https://auth.example.com/verify?token=${SECRET}&type=magiclink`;
const RESEND_ON = { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key_123456', EMAIL_FROM: 'Co Sign <noreply@example.com>' };
const MARKED = { id: 'u-old', email: 'old@example.com', app_metadata: { provider: 'email', password_pending: true } };
const UNMARKED = { id: 'u-old', email: 'old@example.com', app_metadata: { provider: 'email' } };
const savedEnv = {};
let cwd;
let realFetch;

beforeEach(() => {
  VARS.forEach((name) => { savedEnv[name] = process.env[name]; delete process.env[name]; });
  process.env.ADMIN_DASHBOARD_EMAILS = 'owner@example.com';
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-fresh-link-'));
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

function allLogged() {
  return ['log', 'info', 'warn', 'error']
    .flatMap((level) => console[level].mock.calls)
    .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, Object.getOwnPropertyNames(a || {})))).join(' '))
    .join('\n');
}

// org_memberships: the owner is an active member of org-1; `members` lists
// the other user ids already active in org-1.
function fakeSupabase({ user, members, linkFails = false }) {
  const upserts = [];
  const from = jest.fn(() => {
    const eqs = {};
    const query = {};
    ['select', 'order', 'limit'].forEach((m) => { query[m] = () => query; });
    query.eq = (col, val) => { eqs[col] = val; return query; };
    const row = () => {
      const active = eqs.status === undefined || eqs.status === 'active';
      if (eqs.user_id === 'u-owner') return active ? { id: 'm-owner', org_id: 'org-1', user_id: 'u-owner', role: 'admin', status: 'active' } : null;
      const ok = active && (eqs.org_id === undefined || eqs.org_id === 'org-1') && members.includes(eqs.user_id);
      return ok ? { id: 'm-old', org_id: 'org-1', user_id: eqs.user_id, role: 'member', status: 'active' } : null;
    };
    query.single = async () => (row() ? { data: row(), error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } });
    query.maybeSingle = async () => ({ data: row(), error: null });
    query.upsert = async (rows) => { upserts.push(rows); return { error: null }; };
    return query;
  });
  const admin = {
    listUsers: jest.fn(async () => ({ data: { users: [user] }, error: null })),
    getUserById: jest.fn(async () => ({ data: { user } })),
    updateUserById: jest.fn(async () => ({ data: { user }, error: null })),
    inviteUserByEmail: jest.fn(),
    generateLink: jest.fn(async () => (linkFails
      ? { data: { properties: { action_link: LINK }, user: null }, error: { message: 'Database error finding user', status: 500 } }
      : {
        data: {
          properties: { action_link: LINK, email_otp: '654321', hashed_token: 'hashed', redirect_to: 'https://cosign.example.com/enterprise/login', verification_type: 'magiclink' },
          user,
        },
        error: null,
      })),
  };
  require('../../lib/supabaseClient').requireServiceSupabase.mockReturnValue({
    from,
    auth: { getUser: async () => ({ data: { user: { id: 'u-owner', email: 'owner@example.com' } }, error: null }), admin },
  });
  return { admin, upserts };
}

async function addUser() {
  const handler = require('../../pages/api/admin/users').default;
  const { req, res } = createMocks({
    method: 'POST',
    // The Origin header is never used for the link.
    headers: { authorization: 'Bearer jwt', host: 'cosign.example.com', origin: 'https://evil.example.com' },
    body: { email: 'old@example.com', role: 'member' },
  });
  await handler(req, res);
  return { status: res._getStatusCode(), body: JSON.parse(res._getData()) };
}

const OLD = { id: 'u-old', email: 'old@example.com', role: 'member' };
const UPSERT = [[{ org_id: 'org-1', user_id: 'u-old', role: 'member', status: 'active' }]];

describe('POST /api/admin/users: a fresh sign-in link for a member who never chose a password', () => {
  it.each([
    ['mail off, site address set: the link is returned', { NEXT_PUBLIC_APP_URL: 'https://site.example.com' }, 'https://site.example.com/enterprise/login', { mailed: false, mailReason: 'mail_off', inviteLink: LINK }],
    ['mail off, no site address: the request Host is used', {}, 'https://cosign.example.com/enterprise/login', { mailed: false, mailReason: 'mail_off', inviteLink: LINK }],
    ['Resend on: the link is mailed', { ...RESEND_ON, NEXT_PUBLIC_APP_URL: 'https://site.example.com' }, 'https://site.example.com/enterprise/login', { mailed: true }],
  ])('%s', async (_name, env, redirectTo, expected) => {
    Object.assign(process.env, env);
    const { admin, upserts } = fakeSupabase({ user: MARKED, members: ['u-old'] });

    const { status, body } = await addUser();

    expect(status).toBe(200);
    expect(admin.generateLink).toHaveBeenCalledTimes(1);
    expect(admin.generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 'old@example.com', options: { redirectTo } });
    expect(admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(body).toEqual({ orgId: 'org-1', invited: false, user: OLD, ...expected });
    expect(upserts).toEqual(UPSERT);
    if (expected.mailed) {
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.resend.com/emails');
      expect(JSON.parse(init.body)).toMatchObject({ to: ['old@example.com'] });
      expect(JSON.parse(init.body).html).toContain(LINK);
    } else {
      expect(global.fetch).not.toHaveBeenCalled();
    }
    expect(allLogged()).not.toContain(SECRET);
  });

  it.each([
    ['an existing member without the mark', UNMARKED, ['u-old']],
    ['a marked account that is not yet a member of the owner\'s organisation', MARKED, []],
  ])('%s gets the membership and no link', async (_name, user, members) => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://site.example.com';
    const { admin, upserts } = fakeSupabase({ user, members });

    const { status, body } = await addUser();

    expect(status).toBe(200);
    expect(admin.generateLink).not.toHaveBeenCalled();
    expect(body).toEqual({ orgId: 'org-1', invited: false, user: OLD });
    expect(upserts).toEqual(UPSERT);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a failure to make the link answers 500, changes nothing and logs no link', async () => {
    Object.assign(process.env, RESEND_ON);
    const { admin, upserts } = fakeSupabase({ user: MARKED, members: ['u-old'], linkFails: true });

    const { status, body } = await addUser();

    expect(status).toBe(500);
    expect(typeof body.error).toBe('string');
    expect(body.user).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(admin.generateLink).toHaveBeenCalledTimes(1);
    expect(admin.updateUserById).not.toHaveBeenCalled();
    expect(upserts).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(allLogged()).not.toContain(SECRET);
  });
});
