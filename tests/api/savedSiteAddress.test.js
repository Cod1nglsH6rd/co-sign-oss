/**
 * The admin invite link (POST /api/admin/users) reads the site address
 * through effectiveSetting('NEXT_PUBLIC_APP_URL'): a non-blank env value
 * wins, the address saved at setup (.cosign/settings.json) is used when env
 * is blank, then the request's Host; never the Origin header.
 * The signed-PDF export font (POST /api/sessions/[token]/complete) is read
 * from public/fonts on disk, with no HTTP request whatever the address.
 * Supabase and the other route helpers are mocked; every test runs in its
 * own temp folder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));
jest.mock('../../lib/sessionAuth', () => ({
  validateSessionToken: jest.fn(),
  isSessionVerified: jest.fn(),
}));
jest.mock('../../lib/rateLimit', () => ({ rateLimitPublic: jest.fn() }));
jest.mock('../../lib/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../lib/csrf', () => ({ validateCsrfToken: jest.fn() }));
jest.mock('../../lib/embedOrigin', () => ({ enforceEmbedOriginForSession: jest.fn() }));
jest.mock('../../lib/exportPdf', () => ({ generateFilledPdf: jest.fn() }));
// issue #492: the invite route now mails its link through lib/email.js's sendMemberInviteEmail (mocked: no network).
jest.mock('../../lib/email', () => ({ sendCompletionNotificationEmail: jest.fn(), sendMemberInviteEmail: jest.fn() }));
jest.mock('../../lib/sessionFieldRules', () => ({ getRequiredFieldIdSet: jest.fn() }));
jest.mock('../../lib/documentFetch', () => ({
  downloadDocumentBinary: jest.fn(),
  DocumentSourceNotAllowedError: class DocumentSourceNotAllowedError extends Error {},
}));

const VARS = ['NEXT_PUBLIC_APP_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS'];
const savedEnv = {};
let cwd;
let realFetch;

beforeEach(() => {
  VARS.forEach((name) => { savedEnv[name] = process.env[name]; delete process.env[name]; });
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-site-address-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  realFetch = global.fetch;
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

function writeSaved(values) {
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify(values));
}

// A query builder: every call chains, and awaiting it gives `data`.
function builder(data) {
  const b = {};
  ['select', 'eq', 'neq', 'in', 'order', 'limit', 'update', 'upsert'].forEach((m) => { b[m] = () => b; });
  b.single = async () => ({ data: Array.isArray(data) ? data[0] || null : data, error: null });
  b.then = (resolve, reject) => Promise.resolve({ data, error: null, count: 0 }).then(resolve, reject);
  return b;
}

describe('POST /api/sessions/[token]/complete: export font address', () => {
  function setup() {
    const { requireServiceSupabase } = require('../../lib/supabaseClient');
    const { validateSessionToken, isSessionVerified } = require('../../lib/sessionAuth');
    const { rateLimitPublic } = require('../../lib/rateLimit');
    const { validateCsrfToken } = require('../../lib/csrf');
    const { enforceEmbedOriginForSession } = require('../../lib/embedOrigin');
    const { generateFilledPdf } = require('../../lib/exportPdf');
    const { getRequiredFieldIdSet } = require('../../lib/sessionFieldRules');
    const { downloadDocumentBinary } = require('../../lib/documentFetch');

    const tables = { fields: [{ id: 1, field_name: 'Name', field_type: 'text', position: {} }] };
    requireServiceSupabase.mockReturnValue({
      from: (table) => builder(tables[table] || []),
      rpc: async () => ({ error: null }),
      storage: { from: () => ({ upload: async () => ({ error: { message: 'skip' } }) }) },
      auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
    });
    rateLimitPublic.mockResolvedValue(false);
    validateSessionToken.mockResolvedValue({
      session: {
        id: 's-1',
        document_id: 'd-1',
        status: 'opened',
        metadata: {},
        // org_id and an org folder path: complete.js now downloads only from
        // the document owner's folder (the old 'd-1/a.pdf' has no owner: 422).
        documents: { org_id: 'o-1', file_name: 'a.pdf', file_type: 'application/pdf', file_path: 'o-1/a.pdf' },
      },
      error: null,
    });
    enforceEmbedOriginForSession.mockReturnValue({ ok: true });
    isSessionVerified.mockReturnValue(true);
    validateCsrfToken.mockReturnValue(true);
    getRequiredFieldIdSet.mockReturnValue(new Set());
    downloadDocumentBinary.mockResolvedValue({ buffer: Buffer.from('pdf') });
    generateFilledPdf.mockResolvedValue(new Uint8Array([1]));

    global.fetch = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) }));
  }

  // The font used to be fetched over HTTP from the site address, else
  // VERCEL_PROJECT_PRODUCTION_URL, else the request's Host (a blind SSRF for
  // an anonymous signer). It is now read from disk: whichever address is set,
  // completing a signing makes no HTTP request for it.
  async function complete(headers = { host: 'request.example.test', 'x-forwarded-proto': 'https' }) {
    setup();
    const handler = require('../../pages/api/sessions/[token]/complete').default;
    const { req, res } = createMocks({
      method: 'POST',
      query: { token: 'tok' },
      body: {},
      headers,
    });
    await handler(req, res);
    return res;
  }

  it('makes no fetch when an env address is set', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://env.example.test';
    writeSaved({ NEXT_PUBLIC_APP_URL: 'https://saved.example.test' });
    await complete();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('makes no fetch when only a saved address is set', async () => {
    writeSaved({ NEXT_PUBLIC_APP_URL: 'https://saved.example.test' });
    await complete();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('makes no fetch to VERCEL_PROJECT_PRODUCTION_URL', async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'prod.example.test';
    await complete();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reads the font from public/fonts on disk and passes it to the export', async () => {
    fs.mkdirSync(path.join(cwd, 'public', 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'public', 'fonts', 'NotoSans-Regular.ttf'), Buffer.from('fake-font'));
    const { generateFilledPdf } = require('../../lib/exportPdf');
    generateFilledPdf.mockClear();
    await complete();
    expect(generateFilledPdf).toHaveBeenCalledTimes(1);
    expect(Buffer.from(generateFilledPdf.mock.calls[0][0].fontBytes).toString()).toBe('fake-font');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('makes no fetch to a forged Host when no address is set', async () => {
    const res = await complete({ host: '169.254.169.254:80', 'x-forwarded-proto': 'http' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBeLessThan(500);
  });
});

describe('POST /api/admin/users: invite link address', () => {
  async function inviteOptions(headers = {}) {
    process.env.ADMIN_DASHBOARD_EMAILS = 'owner@example.test';
    const inviteUserByEmail = jest.fn(async () => ({ data: { user: { id: 'u-2' } }, error: null }));
    // issue #492: the route asks generateLink (type 'invite') for the link instead of inviteUserByEmail.
    const fakeLink = 'https://app.example.com/auth/v1/verify?token=' + 'x'.repeat(8) + '&type=invite';
    const generateLink = jest.fn(async () => ({
      data: { user: { id: 'u-2', email: 'new@example.test' }, properties: { action_link: fakeLink } },
      error: null,
    }));
    // issue #492: the link is then mailed by the app's own mailer; here mail is off.
    const { sendMemberInviteEmail } = require('../../lib/email');
    sendMemberInviteEmail.mockResolvedValue({ sent: false, reason: 'mail_off' });
    const { requireServiceSupabase } = require('../../lib/supabaseClient');
    requireServiceSupabase.mockReturnValue({
      from: () => builder([{ org_id: 'org-1' }]),
      auth: {
        getUser: async () => ({ data: { user: { id: 'u-1', email: 'owner@example.test' } }, error: null }),
        admin: {
          listUsers: async () => ({ data: { users: [] }, error: null }),
          inviteUserByEmail,
          generateLink,
          getUserById: async () => ({ data: { user: null } }),
        },
      },
    });
    const handler = require('../../pages/api/admin/users').default;
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer jwt', ...headers },
      body: { email: 'new@example.test', role: 'member' },
    });
    await handler(req, res);
    // issue #492: the auth service's own mailer is no longer called; the redirect rides on generateLink's options.
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(generateLink).toHaveBeenCalledTimes(1);
    expect(generateLink.mock.calls[0][0].type).toBe('invite');
    expect(generateLink.mock.calls[0][0].email).toBe('new@example.test');
    return generateLink.mock.calls[0][0].options;
  }

  it('an env address wins over a saved one', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://env.example.test';
    writeSaved({ NEXT_PUBLIC_APP_URL: 'https://saved.example.test' });
    expect(await inviteOptions()).toEqual({ redirectTo: 'https://env.example.test/enterprise/login' });
  });

  it('uses the saved address when env is blank', async () => {
    process.env.NEXT_PUBLIC_APP_URL = ' ';
    writeSaved({ NEXT_PUBLIC_APP_URL: 'https://saved.example.test' });
    expect(await inviteOptions()).toEqual({ redirectTo: 'https://saved.example.test/enterprise/login' });
  });

  it('uses the saved address when env is unset', async () => {
    writeSaved({ NEXT_PUBLIC_APP_URL: 'https://saved.example.test' });
    expect(await inviteOptions()).toEqual({ redirectTo: 'https://saved.example.test/enterprise/login' });
  });

  // Was: 'the request Origin header still comes first, as before'. The
  // Origin header is chosen by whoever sends the request, so a forged one
  // would put their link in the invite email; it is never used now.
  it('a forged Origin or Host does not change the link when an address is saved', async () => {
    writeSaved({ NEXT_PUBLIC_APP_URL: 'https://saved.example.test' });
    expect(await inviteOptions({ origin: 'https://origin.example.test', host: 'forged.example.test' }))
      .toEqual({ redirectTo: 'https://saved.example.test/enterprise/login' });
  });

  it('a forged Origin is ignored even when no address is set (the Host is the last resort)', async () => {
    expect(await inviteOptions({ origin: 'https://origin.example.test', host: 'app.example.test' }))
      .toEqual({ redirectTo: 'https://app.example.test/enterprise/login' });
  });

  it('sends no redirect when there is no address anywhere', async () => {
    expect(await inviteOptions()).toBeUndefined();
  });
});
