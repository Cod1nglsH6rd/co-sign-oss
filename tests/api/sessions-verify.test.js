import { createMocks } from 'node-mocks-http';
import handler from '../../pages/api/sessions/[token]/verify';

// The recipient verification gate in front of every signing link that has a
// recipient email. Supabase, the token lookup, the rate limiter and the embed
// origin check are stubbed; generateSessionToken / hashToken stay real so the
// stored hash can be checked against the token the response hands out.
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));
jest.mock('../../lib/sessionAuth', () => ({
  ...jest.requireActual('../../lib/sessionAuth'),
  validateSessionToken: jest.fn(),
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

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const TOKEN = 'a'.repeat(64);

// Since the release review the route counts an attempt with a compare-and-set
// update (.eq('id').eq('verification_attempts', N).select(...)) that returns
// the row, before comparing; the reset on success is a plain .eq('id').
// The mock records every filter in updateEq and answers the counting update
// with the row as one request alone would leave it.
// (tests/api/sessions-verify-race.test.js covers requests sent together.)
function setupSupabase() {
  const updateEq = jest.fn();
  const update = jest.fn((payload) => {
    const chain = {
      eq: (...args) => { updateEq(...args); return chain; },
      is: (...args) => { updateEq(...args); return chain; },
      select: async () => ({ data: [{ verification_attempts: payload.verification_attempts }], error: null }),
      then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
    return chain;
  });
  const from = jest.fn((table) => (table === 'fill_sessions' ? { update } : {}));
  return { from, update, updateEq };
}

function session(overrides = {}) {
  return {
    id: 'session-1',
    status: 'pending',
    recipient_email: 'jane.doe@example.com',
    recipient_last_name: 'Doe',
    verification_attempts: 0,
    last_verify_attempt_at: null,
    ...overrides,
  };
}

async function verify(body) {
  const { req, res } = createMocks({ method: 'POST', query: { token: TOKEN }, body });
  await handler(req, res);
  return { status: res._getStatusCode(), raw: res._getData(), json: JSON.parse(res._getData()) };
}

describe('/api/sessions/[token]/verify', () => {
  const { createClient } = require('@supabase/supabase-js');
  const { validateSessionToken, hashToken } = require('../../lib/sessionAuth');
  const { rateLimitPublic } = require('../../lib/rateLimit');
  const { enforceEmbedOriginForSession } = require('../../lib/embedOrigin');
  let supabase;

  function withSession(s) {
    validateSessionToken.mockResolvedValue({ session: s, error: null });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    supabase = setupSupabase();
    createClient.mockReturnValue(supabase);
    rateLimitPublic.mockResolvedValue(false);
    enforceEmbedOriginForSession.mockReturnValue({ ok: true });
    withSession(session());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts the right email and last name, returns a verification token and resets the counter', async () => {
    withSession(session({ verification_attempts: 2, last_verify_attempt_at: new Date(NOW - 10 * 60 * 1000).toISOString() }));
    const { status, json } = await verify({ email: 'jane.doe@example.com', lastName: 'Doe' });

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(typeof json.verificationToken).toBe('string');
    expect(json.verificationToken.length).toBeGreaterThan(0);
    expect(json.maskedEmail).toBe('j***e@example.com');

    // Two updates now: the attempt is counted first (2 -> 3, only where the
    // count is still 2), then the right answer resets it. Was one update.
    expect(supabase.update).toHaveBeenCalledTimes(2);
    expect(supabase.update.mock.calls[0][0]).toEqual({ verification_attempts: 3, last_verify_attempt_at: expect.any(String) });
    expect(supabase.updateEq).toHaveBeenCalledWith('verification_attempts', 2);
    const fields = supabase.update.mock.calls[1][0];
    expect(fields).toMatchObject({ verification_attempts: 0, last_verify_attempt_at: null });
    expect(fields.verification_token_hash).toBe(hashToken(json.verificationToken));
    expect(supabase.updateEq).toHaveBeenCalledWith('id', 'session-1');
  });

  it('refuses a wrong email with 403, counts the attempt and does not echo the masked email', async () => {
    withSession(session({ verification_attempts: 1, last_verify_attempt_at: new Date(NOW - 60 * 1000).toISOString() }));
    const { status, json, raw } = await verify({ email: 'someone@else.com', lastName: 'Doe' });

    expect(status).toBe(403);
    expect(json.error).toBe('verification_failed');
    expect(json).not.toHaveProperty('maskedEmail');
    expect(json).not.toHaveProperty('verificationToken');
    expect(raw).not.toContain('example.com');

    expect(supabase.update).toHaveBeenCalledTimes(1);
    const counted = supabase.update.mock.calls[0][0];
    expect(counted).toEqual({
      verification_attempts: 2,
      last_verify_attempt_at: expect.any(String),
    });
    // Only where the count is still the one read (compare-and-set).
    expect(supabase.updateEq).toHaveBeenCalledWith('verification_attempts', 1);
    // The route stamps the attempt with new Date() (wall clock, not Date.now()).
    expect(new Date(counted.last_verify_attempt_at).toISOString()).toBe(counted.last_verify_attempt_at);
  });

  it('refuses a right email with a wrong last name the same way', async () => {
    const { status, json } = await verify({ email: 'jane.doe@example.com', lastName: 'Smith' });
    expect(status).toBe(403);
    expect(json.error).toBe('verification_failed');
    expect(json).not.toHaveProperty('maskedEmail');
    expect(supabase.update.mock.calls[0][0].verification_attempts).toBe(1);
  });

  it('locks the link on the sixth attempt after five failures (429 verify_locked), without checking details', async () => {
    withSession(session({ verification_attempts: 5, last_verify_attempt_at: new Date(NOW - 24 * 3600 * 1000).toISOString() }));
    const { status, json } = await verify({ email: 'jane.doe@example.com', lastName: 'Doe' });

    expect(status).toBe(429);
    expect(json.error).toBe('verify_locked');
    expect(json).not.toHaveProperty('verificationToken');
    expect(supabase.update).not.toHaveBeenCalled();
  });

  it.each([
    // attempts so far, seconds since the last attempt, back-off, seconds left
    [1, 10, 30, 20],
    [2, 10, 60, 50],
    [3, 100, 300, 200],
    [4, 600, 900, 300],
  ])(
    'after %i failed attempt(s), an attempt %is later is refused with 429 and the seconds left (back-off %is)',
    async (attempts, ago, _backoff, left) => {
      withSession(
        session({
          verification_attempts: attempts,
          last_verify_attempt_at: new Date(NOW - ago * 1000).toISOString(),
        })
      );
      const { status, json } = await verify({ email: 'jane.doe@example.com', lastName: 'Doe' });

      expect(status).toBe(429);
      expect(json.error).toBe('verify_locked');
      expect(json.retryAfter).toBe(left);
      expect(json.message).toBe(`Too many failed attempts. Try again in ${left} seconds.`);
      expect(supabase.update).not.toHaveBeenCalled();
    }
  );

  it('lets an attempt through once the back-off has passed', async () => {
    withSession(session({ verification_attempts: 2, last_verify_attempt_at: new Date(NOW - 61 * 1000).toISOString() }));
    const { status } = await verify({ email: 'jane.doe@example.com', lastName: 'Doe' });
    expect(status).toBe(200);
  });

  it('compares email and last name case-insensitively and trimmed', async () => {
    const { status, json } = await verify({ email: '  JANE.DOE@Example.COM ', lastName: ' dOE  ' });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
  });

  it('does not ask for a last name when the session has none', async () => {
    withSession(session({ recipient_last_name: null }));
    const { status } = await verify({ email: 'jane.doe@example.com' });
    expect(status).toBe(200);
  });

  it('passes a token error through without counting an attempt', async () => {
    validateSessionToken.mockResolvedValue({ session: null, error: 'not_found' });
    const { status, json } = await verify({ email: 'jane.doe@example.com', lastName: 'Doe' });
    expect(status).toBe(404);
    expect(json.error).toBe('session_not_found');
    expect(supabase.update).not.toHaveBeenCalled();
  });
});
