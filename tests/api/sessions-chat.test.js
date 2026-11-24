import { createMocks } from 'node-mocks-http';
import handler from '../../pages/api/sessions/[token]/chat';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));
jest.mock('../../lib/sessionAuth', () => ({
  validateSessionToken: jest.fn(),
  isSessionVerified: jest.fn(),
}));
jest.mock('../../lib/rateLimit', () => ({
  rateLimitPublic: jest.fn(),
  consumeDailyQuota: jest.fn(),
}));
jest.mock('../../lib/anthropic', () => ({
  chatWithCo: jest.fn(),
}));
jest.mock('../../lib/chatContext', () => ({
  buildDocumentChatContext: jest.fn(),
}));

describe('/api/sessions/[token]/chat', () => {
  const { createClient } = require('@supabase/supabase-js');
  const { validateSessionToken, isSessionVerified } = require('../../lib/sessionAuth');
  const { rateLimitPublic, consumeDailyQuota } = require('../../lib/rateLimit');
  const { chatWithCo } = require('../../lib/anthropic');
  const { buildDocumentChatContext } = require('../../lib/chatContext');

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    rateLimitPublic.mockResolvedValue(false);
    consumeDailyQuota.mockResolvedValue({ success: true, limit: 200, remaining: 199, reset: 0 });
  });

  it('rejects non-POST requests', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { token: 'abc' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns verification_required when verification token is missing/invalid', async () => {
    createClient.mockReturnValue({
      rpc: jest.fn(),
    });
    validateSessionToken.mockResolvedValue({
      session: {
        id: 'session-1',
        status: 'pending',
        document_id: 'doc-1',
        recipient_email: 'user@example.com',
      },
      error: null,
    });
    isSessionVerified.mockReturnValue(false);

    const { req, res } = createMocks({
      method: 'POST',
      query: { token: 'a'.repeat(64) },
      body: { message: 'hello' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(403);
    expect(JSON.parse(res._getData())).toMatchObject({
      error: 'verification_required',
      errorCode: 'verification_required',
      message: 'Verification is required before chat',
    });
  });

  it('returns chat response for valid token session', async () => {
    const mockRpc = jest.fn().mockResolvedValue({
      data: [{ content: 'vector chunk' }],
      error: null,
    });
    createClient.mockReturnValue({
      rpc: mockRpc,
    });
    validateSessionToken.mockResolvedValue({
      session: {
        id: 'session-2',
        status: 'in_progress',
        document_id: 'doc-2',
        recipient_email: null,
      },
      error: null,
    });
    isSessionVerified.mockReturnValue(true);
    buildDocumentChatContext.mockResolvedValue(['Document: form.pdf\nForm fields (1):\n- Employer Name (text, empty)']);
    chatWithCo.mockResolvedValue({ message: 'AI response' });

    const { req, res } = createMocks({
      method: 'POST',
      query: { token: 'b'.repeat(64) },
      body: {
        message: 'What does this field mean?',
        messages: [{ role: 'user', content: 'previous' }],
        context: 'Field: Employer Name',
      },
      headers: {
        'x-session-verify': 'verification-token',
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({ response: 'AI response' });
    // The context is built by the server from the session's document; the
    // client-sent `context` is ignored (anyone with a signing link could put
    // up to 16,000 characters there, billed to the owner's AI key).
    expect(buildDocumentChatContext).toHaveBeenCalledWith(expect.anything(), 'doc-2', {
      fieldIds: undefined,
      focusFieldId: undefined,
    });
    expect(chatWithCo).toHaveBeenCalledWith(
      'What does this field mean?',
      ['Document: form.pdf\nForm fields (1):\n- Employer Name (text, empty)'],
      [{ role: 'user', content: 'previous' }],
      'en'
    );
  });
});
