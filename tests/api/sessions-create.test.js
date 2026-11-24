import { createMocks } from 'node-mocks-http';
import handler from '../../pages/api/sessions/create';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));
jest.mock('../../lib/sessionAuth', () => ({
  generateSessionToken: jest.fn(),
}));
jest.mock('../../lib/auditLog', () => ({
  logAudit: jest.fn(),
}));
jest.mock('../../lib/email', () => ({
  sendFillInviteEmail: jest.fn(),
}));

function makeSingleChain(result) {
  const chain = {
    eq: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    single: jest.fn(async () => result),
  };
  return chain;
}

describe('/api/sessions/create', () => {
  const { createClient } = require('@supabase/supabase-js');
  const { generateSessionToken } = require('../../lib/sessionAuth');
  const { sendFillInviteEmail } = require('../../lib/email');

  let originalFetch;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    generateSessionToken.mockReturnValue({
      token: 'raw-token',
      tokenHash: 'hashed-token',
    });
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({}),
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    global.fetch = originalFetch;
  });

  function setupSupabase() {
    let insertedSession = {
      id: 'session-1',
      document_id: 'doc-1',
      recipient_email: null,
      recipient_name: null,
      recipient_last_name: null,
      preferred_language: 'en',
      assigned_role: null,
      require_signature: false,
      created_at: '2026-03-18T00:00:00.000Z',
      expires_at: '2026-04-17T00:00:00.000Z',
      sent_at: null,
    };

    const fillSessionsUpdateEq = jest.fn(async () => ({ data: null, error: null }));
    const fillSessionsUpdate = jest.fn(() => ({ eq: fillSessionsUpdateEq }));

    const documentsUpdateEq = jest.fn(async () => ({ data: null, error: null }));
    const documentsUpdate = jest.fn(() => ({ eq: documentsUpdateEq }));

    const fillSessionsInsert = jest.fn((rows) => {
      insertedSession = { ...insertedSession, ...rows[0] };
      return {
        select: jest.fn(() => ({
          single: jest.fn(async () => ({ data: insertedSession, error: null })),
        })),
      };
    });

    const supabase = {
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
          error: null,
        })),
      },
      from: jest.fn((table) => {
        if (table === 'org_memberships') {
          return {
            select: jest.fn(() => makeSingleChain({
              data: { org_id: 'org-1', role: 'admin' },
              error: null,
            })),
          };
        }
        if (table === 'organizations') {
          return {
            select: jest.fn(() => makeSingleChain({
              data: { require_recipient_verification: false },
              error: null,
            })),
          };
        }
        if (table === 'documents') {
          return {
            select: jest.fn(() => makeSingleChain({
              data: {
                id: 'doc-1',
                file_name: 'Doc.pdf',
                status: 'ready',
                lifecycle_status: 'ready_to_send',
                preferred_language: 'en',
                org_id: 'org-1',
                phase1_data: { setupCompleted: true },
              },
              error: null,
            })),
            update: documentsUpdate,
          };
        }
        if (table === 'fields') {
          const fieldsData = [{ id: 1 }, { id: 2 }];
          const makeThenable = (data) => {
            let resolveVal;
            const promise = new Promise((resolve) => { resolveVal = resolve; });
            const proxy = new Proxy(function () {}, {
              get(target, prop) {
                if (prop === 'then') return promise.then.bind(promise);
                if (prop === 'data') return data;
                if (prop === 'error') return null;
                return () => makeThenable(data);
              },
            });
            resolveVal({ data, error: null });
            return proxy;
          };
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => makeThenable(fieldsData)),
            })),
          };
        }
        if (table === 'fill_sessions') {
          return {
            insert: fillSessionsInsert,
            update: fillSessionsUpdate,
          };
        }
        return {
          select: jest.fn(() => ({
            eq: jest.fn(async () => ({ data: null, error: null })),
          })),
        };
      }),
    };

    createClient.mockReturnValue(supabase);
    return { fillSessionsInsert, fillSessionsUpdateEq, documentsUpdateEq };
  }

  it('keeps status pending when sendMethod=email but recipientEmail is missing', async () => {
    const { documentsUpdateEq } = setupSupabase();

    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: {
        documentId: 'doc-1',
        sendMethod: 'email',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const payload = JSON.parse(res._getData());
    expect(payload.session.status).toBe('pending');
    expect(payload.emailDeliveryFailed).toBe(false);
    expect(sendFillInviteEmail).not.toHaveBeenCalled();
    expect(documentsUpdateEq).not.toHaveBeenCalled();
  });

  it('marks status sent only after successful email delivery', async () => {
    const { fillSessionsUpdateEq, documentsUpdateEq } = setupSupabase();

    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: {
        documentId: 'doc-1',
        sendMethod: 'email',
        recipientEmail: 'recipient@example.com',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const payload = JSON.parse(res._getData());
    expect(payload.session.status).toBe('sent');
    expect(sendFillInviteEmail).toHaveBeenCalledTimes(1);
    expect(fillSessionsUpdateEq).toHaveBeenCalledWith('id', 'session-1');
    expect(documentsUpdateEq).toHaveBeenCalledWith('id', 'doc-1');
  });

  it('does not mark lifecycle sent when email delivery fails', async () => {
    const { fillSessionsUpdateEq, documentsUpdateEq } = setupSupabase();
    sendFillInviteEmail.mockRejectedValue(new Error('SMTP unavailable'));

    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: {
        documentId: 'doc-1',
        sendMethod: 'email',
        recipientEmail: 'recipient@example.com',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const payload = JSON.parse(res._getData());
    expect(payload.session.status).toBe('pending');
    expect(payload.emailDeliveryFailed).toBe(true);
    expect(fillSessionsUpdateEq).not.toHaveBeenCalled();
    expect(documentsUpdateEq).not.toHaveBeenCalled();
  });

  it('marks lifecycle sent immediately for sendMethod=link', async () => {
    const { fillSessionsUpdateEq, documentsUpdateEq } = setupSupabase();

    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: {
        documentId: 'doc-1',
        sendMethod: 'link',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const payload = JSON.parse(res._getData());
    expect(payload.session.status).toBe('pending');
    expect(payload.emailDeliveryFailed).toBe(false);
    expect(sendFillInviteEmail).not.toHaveBeenCalled();
    expect(fillSessionsUpdateEq).not.toHaveBeenCalled();
    expect(documentsUpdateEq).toHaveBeenCalledWith('id', 'doc-1');
  });

  // The signing link used to be built from the request's Host (or
  // X-Forwarded-Host) first. Whoever sends the request chooses those, so
  // the saved site address now wins and the Host is only a last resort.
  it('a forged Host does not change the signing link when a site address is set', async () => {
    setupSupabase();

    const { req, res } = createMocks({
      method: 'POST',
      headers: {
        authorization: 'Bearer jwt',
        host: 'forged.example.test',
        'x-forwarded-host': 'forged-too.example.test',
        'x-forwarded-proto': 'http',
      },
      body: {
        documentId: 'doc-1',
        sendMethod: 'link',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const payload = JSON.parse(res._getData());
    expect(payload.shareUrl).toBe('https://app.example.com/en/fill/raw-token');
    expect(payload.session.embedCode).toContain('src="https://app.example.com/embed/raw-token"');
    expect(res._getData()).not.toContain('forged');
  });

  it('a forged Host does not change the link when the address is only saved at setup', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-create-link-'));
    fs.mkdirSync(path.join(cwd, '.cosign'));
    fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify({ NEXT_PUBLIC_APP_URL: 'https://saved.example.test' }));
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    delete process.env.NEXT_PUBLIC_APP_URL;
    try {
      setupSupabase();
      const { req, res } = createMocks({
        method: 'POST',
        headers: { authorization: 'Bearer jwt', host: 'forged.example.test' },
        body: { documentId: 'doc-1', sendMethod: 'link' },
      });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(201);
      expect(JSON.parse(res._getData()).shareUrl).toBe('https://saved.example.test/en/fill/raw-token');
    } finally {
      cwdSpy.mockRestore();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('with no site address, the platform host name still comes before a forged Host', async () => {
    const savedVercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'prod.example.test';
    const emptyCwd = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'cosign-create-vercel-'));
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(emptyCwd);
    try {
      setupSupabase();
      const { req, res } = createMocks({
        method: 'POST',
        headers: { authorization: 'Bearer jwt', host: 'forged.example.test' },
        body: { documentId: 'doc-1', sendMethod: 'link' },
      });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(201);
      expect(JSON.parse(res._getData()).shareUrl).toBe('https://prod.example.test/en/fill/raw-token');
    } finally {
      cwdSpy.mockRestore();
      require('fs').rmSync(emptyCwd, { recursive: true, force: true });
      if (savedVercel === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
      else process.env.VERCEL_PROJECT_PRODUCTION_URL = savedVercel;
    }
  });

  it('uses recipient preferred language when provided', async () => {
    setupSupabase();

    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: {
        documentId: 'doc-1',
        sendMethod: 'link',
        preferredLanguage: 'vi',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(201);
    const payload = JSON.parse(res._getData());
    expect(payload.session.preferredLanguage).toBe('vi');
  });

  it('returns structured validation errors for invalid request body', async () => {
    setupSupabase();

    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: {
        documentId: '',
        sendMethod: 'invalid',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const payload = JSON.parse(res._getData());
    expect(payload.errorCode).toBe('invalid_request_body');
    expect(typeof payload.message).toBe('string');
    expect(payload.error).toBe(payload.message);
  });
});
