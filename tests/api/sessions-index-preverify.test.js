/**
 * GET /api/sessions/[token] before the recipient has verified.
 *
 * Anyone holding the signing link reaches this response. It says that
 * verification is needed and whether a last name is asked for, and nothing
 * derived from the recipient's address: it used to send a masked email
 * (first letter and the whole domain). The fill page already asks for "the
 * email this link was sent to" without showing any of it.
 */
import { createMocks } from 'node-mocks-http';

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn(() => ({ from: jest.fn() })) }));
jest.mock('../../lib/sessionAuth', () => ({
  validateSessionToken: jest.fn(),
  isSessionVerified: jest.fn(() => false),
}));
jest.mock('../../lib/rateLimit', () => ({ rateLimitPublic: jest.fn(async () => false) }));
jest.mock('../../lib/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../lib/embedOrigin', () => ({ enforceEmbedOriginForSession: jest.fn(() => ({ ok: true })) }));

const { validateSessionToken } = require('../../lib/sessionAuth');
const handler = require('../../pages/api/sessions/[token]/index').default;

async function load(session) {
  validateSessionToken.mockResolvedValue({ session, error: null });
  const { req, res } = createMocks({ method: 'GET', query: { token: 't'.repeat(64) } });
  await handler(req, res);
  return { status: res._getStatusCode(), raw: res._getData(), json: JSON.parse(res._getData()) };
}

describe('GET /api/sessions/[token] before verification', () => {
  it.each([
    ['with a last name', { recipient_last_name: 'Doe' }, true],
    ['without a last name', { recipient_last_name: null }, false],
  ])('holds no part of the recipient address (%s)', async (_name, extra, requiresLastName) => {
    const { status, raw, json } = await load({
      id: 'session-1',
      status: 'sent',
      recipient_email: 'jane.doe@recipient-firm.example',
      ...extra,
    });

    expect(status).toBe(200);
    expect(json).toEqual({ success: true, requiresVerification: true, requiresLastName });
    expect(raw).not.toContain('recipient-firm');
    expect(raw).not.toContain('@');
    expect(raw).not.toMatch(/j\*/);
    expect(raw).not.toContain('Doe');
  });
});
