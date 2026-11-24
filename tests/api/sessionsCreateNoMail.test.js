/**
 * POST /api/sessions/create when mail is not set up.
 *
 * lib/email is mocked: sendFillInviteEmail returns { sent: false, reason:
 * 'mail_off' } when no mail service is set up, and { sent: true } when the mail
 * went out. A session whose invite was not sent must not be marked 'sent'; the
 * response says so and carries the link to copy. The link's fallback address
 * (no Host header) comes from effectiveSetting('NEXT_PUBLIC_APP_URL'), so the
 * address saved at setup is used when env has none.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));
jest.mock('../../lib/auth', () => ({
  requireBearerUser: jest.fn(),
  requireOrgMembership: jest.fn(),
  requestedOrgId: jest.fn(() => null),
}));
jest.mock('../../lib/sessionAuth', () => ({ generateSessionToken: jest.fn() }));
jest.mock('../../lib/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../lib/email', () => ({ sendFillInviteEmail: jest.fn() }));

const VARS = ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SITE_URL', 'VERCEL_PROJECT_PRODUCTION_URL'];
const savedEnv = {};
let cwd;

beforeEach(() => {
  VARS.forEach((name) => { savedEnv[name] = process.env[name]; delete process.env[name]; });
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-no-mail-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});

  const { requireBearerUser, requireOrgMembership } = require('../../lib/auth');
  const { generateSessionToken } = require('../../lib/sessionAuth');
  requireBearerUser.mockResolvedValue({ user: { id: 'user-1', email: 'owner@example.com' } });
  requireOrgMembership.mockResolvedValue({ membership: { org_id: 'org-1', role: 'admin' } });
  generateSessionToken.mockReturnValue({ token: 'raw-token', tokenHash: 'hashed-token' });
});

afterEach(() => {
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
  ['select', 'eq', 'in', 'or', 'order', 'limit'].forEach((m) => { b[m] = () => b; });
  b.single = async () => ({ data, error: null });
  b.then = (resolve, reject) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return b;
}

function setupSupabase() {
  const updates = { fill_sessions: [], documents: [] };
  const supabase = {
    from: jest.fn((table) => {
      if (table === 'documents') {
        const b = builder({
          id: 'doc-1',
          file_name: 'Lease.pdf',
          status: 'ready',
          lifecycle_status: 'ready_to_send',
          preferred_language: 'en',
          org_id: 'org-1',
          phase1_data: { setupCompleted: true },
        });
        b.update = (values) => { updates.documents.push(values); return builder(null); };
        return b;
      }
      if (table === 'organizations') return builder({ require_recipient_verification: false });
      if (table === 'fields') return builder([{ id: 1 }, { id: 2 }]);
      if (table === 'fill_sessions') {
        return {
          insert: (rows) => builder({
            id: 'session-1',
            created_at: '2026-11-18T00:00:00.000Z',
            ...rows[0],
          }),
          update: (values) => { updates.fill_sessions.push(values); return builder(null); },
        };
      }
      return builder(null);
    }),
  };
  const { requireServiceSupabase } = require('../../lib/supabaseClient');
  requireServiceSupabase.mockReturnValue(supabase);
  return updates;
}

async function sendByEmail(headers = { host: 'cosign.example.com' }) {
  const handler = require('../../pages/api/sessions/create').default;
  const { req, res } = createMocks({
    method: 'POST',
    headers: { authorization: 'Bearer jwt', 'x-forwarded-proto': 'https', ...headers },
    body: {
      documentId: 'doc-1',
      recipientEmail: 'tenant@example.com',
      recipientName: 'Ana',
      recipientLastName: 'Nguyen',
      sendMethod: 'email',
    },
  });
  await handler(req, res);
  return { status: res._getStatusCode(), body: JSON.parse(res._getData()) };
}

describe('POST /api/sessions/create with no mail set up', () => {
  it('does not mark the session sent and returns the link to copy when mail is off', async () => {
    const { sendFillInviteEmail } = require('../../lib/email');
    sendFillInviteEmail.mockResolvedValue({ sent: false, reason: 'mail_off' });
    const updates = setupSupabase();

    const { status, body } = await sendByEmail();

    expect(status).toBe(201);
    expect(sendFillInviteEmail).toHaveBeenCalledTimes(1);
    expect(body.emailSent).toBe(false);
    expect(body.mailOff).toBe(true);
    expect(body.shareUrl).toBe('https://cosign.example.com/en/fill/raw-token');
    expect(body.session.shareUrl).toBe('https://cosign.example.com/en/fill/raw-token');
    expect(body.session.status).not.toBe('sent');
    expect(body.session.sentAt).toBeNull();
    expect(updates.fill_sessions.some((u) => u.status === 'sent')).toBe(false);
    expect(updates.documents.some((u) => u.lifecycle_status === 'sent')).toBe(false);
  });

  it('marks the session sent as before when the mail went out', async () => {
    const { sendFillInviteEmail } = require('../../lib/email');
    sendFillInviteEmail.mockResolvedValue({ sent: true });
    const updates = setupSupabase();

    const { status, body } = await sendByEmail();

    expect(status).toBe(201);
    expect(body.emailSent).toBe(true);
    expect(body.mailOff).toBe(false);
    expect(body.emailDeliveryFailed).toBe(false);
    expect(body.session.status).toBe('sent');
    expect(typeof body.session.sentAt).toBe('string');
    expect(updates.fill_sessions).toEqual([
      expect.objectContaining({ status: 'sent', sent_at: body.session.sentAt }),
    ]);
    expect(updates.documents.some((u) => u.lifecycle_status === 'sent')).toBe(true);
  });

  it('builds the fallback link from the saved site address when there is no Host header and env is blank', async () => {
    writeSaved({ NEXT_PUBLIC_APP_URL: 'https://saved.example.org' });
    const { sendFillInviteEmail } = require('../../lib/email');
    sendFillInviteEmail.mockResolvedValue({ sent: false, reason: 'mail_off' });
    setupSupabase();

    const { status, body } = await sendByEmail({ host: undefined });

    expect(status).toBe(201);
    expect(body.mailOff).toBe(true);
    expect(body.shareUrl).toBe('https://saved.example.org/en/fill/raw-token');
    expect(sendFillInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://saved.example.org' })
    );
  });
});
