import { createMocks } from 'node-mocks-http';
import handler from '../../pages/api/sessions/[token]/sign';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));
jest.mock('../../lib/sessionAuth', () => ({
  validateSessionToken: jest.fn(),
  isSessionVerified: jest.fn(),
}));
jest.mock('../../lib/rateLimit', () => ({
  rateLimitPublic: jest.fn(),
}));
jest.mock('../../lib/auditLog', () => ({
  logAudit: jest.fn(),
}));
jest.mock('../../lib/csrf', () => ({
  validateCsrfToken: jest.fn(),
}));
jest.mock('../../lib/embedOrigin', () => ({
  enforceEmbedOriginForSession: jest.fn(),
}));
jest.mock('../../lib/sessionFieldMapping', () => ({
  buildSessionFieldLookup: jest.fn(),
  normalizeSessionFieldType: jest.fn(),
}));

function setupSupabase() {
  const deleteEqField = jest.fn(async () => ({ data: null, error: null }));
  const deleteEqSession = jest.fn(() => ({ eq: deleteEqField }));
  const deleteFn = jest.fn(() => ({ eq: deleteEqSession }));

  const upsertSingle = jest.fn(async () => ({ data: { id: 99 }, error: null }));
  const upsertSelect = jest.fn(() => ({ single: upsertSingle }));
  const upsertFn = jest.fn(() => ({ select: upsertSelect }));

  const updateEq = jest.fn(async () => ({ data: null, error: null }));
  const updateFn = jest.fn(() => ({ eq: updateEq }));

  const fieldsSingle = jest.fn(async () => ({
    data: { id: 11, field_name: 'Signature', field_type: 'signature' },
    error: null,
  }));
  const fieldsEqDoc = jest.fn(() => ({ single: fieldsSingle }));
  const fieldsEqId = jest.fn(() => ({ eq: fieldsEqDoc }));
  const fieldsSelect = jest.fn(() => ({ eq: fieldsEqId }));

  const from = jest.fn((table) => {
    if (table === 'fields') {
      return { select: fieldsSelect };
    }
    if (table === 'session_fields') {
      return { delete: deleteFn, upsert: upsertFn };
    }
    if (table === 'fill_sessions') {
      return { update: updateFn };
    }
    return {};
  });

  return {
    from,
    deleteEqField,
    upsertFn,
    updateEq,
  };
}

describe('/api/sessions/[token]/sign', () => {
  const { createClient } = require('@supabase/supabase-js');
  const { validateSessionToken, isSessionVerified } = require('../../lib/sessionAuth');
  const { rateLimitPublic } = require('../../lib/rateLimit');
  const { validateCsrfToken } = require('../../lib/csrf');
  const { enforceEmbedOriginForSession } = require('../../lib/embedOrigin');
  const { buildSessionFieldLookup, normalizeSessionFieldType } = require('../../lib/sessionFieldMapping');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    rateLimitPublic.mockResolvedValue(false);
    validateSessionToken.mockResolvedValue({
      session: {
        id: 'session-1',
        document_id: 'doc-1',
        status: 'pending',
        recipient_email: null,
        field_filter: null,
      },
      error: null,
    });
    isSessionVerified.mockReturnValue(true);
    validateCsrfToken.mockReturnValue(true);
    enforceEmbedOriginForSession.mockReturnValue({ ok: true });
    normalizeSessionFieldType.mockReturnValue('signature');
    buildSessionFieldLookup.mockReturnValue({
      resolveStorageId: jest.fn((id) => id),
    });
  });

  it('clears signature when signatureDataUrl is null', async () => {
    const supabase = setupSupabase();
    createClient.mockReturnValue(supabase);

    const { req, res } = createMocks({
      method: 'POST',
      query: { token: 'a'.repeat(64) },
      body: { fieldId: 11, signatureDataUrl: null },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());
    expect(payload.success).toBe(true);
    expect(supabase.deleteEqField).toHaveBeenCalledWith('field_id', 11);
  });

  it('saves signature when a data URL is provided', async () => {
    const supabase = setupSupabase();
    createClient.mockReturnValue(supabase);

    const { req, res } = createMocks({
      method: 'POST',
      query: { token: 'b'.repeat(64) },
      body: { fieldId: 11, signatureDataUrl: 'data:image/png;base64,abc123' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const payload = JSON.parse(res._getData());
    expect(payload.success).toBe(true);
    expect(supabase.upsertFn).toHaveBeenCalled();
    expect(supabase.updateEq).toHaveBeenCalledWith('id', 'session-1');
  });

  it('rejects non-image signature payloads', async () => {
    const supabase = setupSupabase();
    createClient.mockReturnValue(supabase);

    const { req, res } = createMocks({
      method: 'POST',
      query: { token: 'c'.repeat(64) },
      body: { fieldId: 11, signatureDataUrl: 'not-a-data-url' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toMatchObject({
      error: 'invalid_request_body',
      errorCode: 'invalid_request_body',
      message: 'Valid signature data URL is required',
    });
  });
});
