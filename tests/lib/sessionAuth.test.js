import {
  validateSessionToken,
  isSessionVerified,
  hashToken,
  generateSessionToken,
  authenticateClient,
} from '../../lib/sessionAuth';

function createSupabaseMock(singleResponses = []) {
  const queue = [...singleResponses];
  const updateEq = jest.fn(async () => ({ data: null, error: null }));
  const update = jest.fn(() => ({ eq: updateEq }));

  const from = jest.fn(() => ({
    select: jest.fn(() => {
      const chain = {
        eq: jest.fn(() => chain),
        single: jest.fn(async () => queue.shift() || { data: null, error: { message: 'not found' } }),
      };
      return chain;
    }),
    update,
  }));

  return { from, update, updateEq };
}

describe('sessionAuth.validateSessionToken', () => {
  it('rejects invalid token format', async () => {
    const supabase = createSupabaseMock();
    const result = await validateSessionToken('short', supabase);
    expect(result).toEqual({ error: 'invalid_token' });
  });

  it('rejects revoked hashed sessions', async () => {
    const supabase = createSupabaseMock([
      { data: { id: 's1', status: 'revoked' }, error: null },
    ]);

    const result = await validateSessionToken('a'.repeat(64), supabase);
    expect(result).toEqual({ error: 'revoked' });
  });

  it('rejects completed hashed sessions when allowCompleted=false', async () => {
    const supabase = createSupabaseMock([
      { data: { id: 's1', status: 'completed' }, error: null },
    ]);

    const result = await validateSessionToken('b'.repeat(64), supabase);
    expect(result).toEqual({ error: 'already_completed' });
  });

  it('expires hashed sessions that are past due', async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const supabase = createSupabaseMock([
      { data: { id: 's1', status: 'pending', expires_at: expiredAt }, error: null },
    ]);

    const result = await validateSessionToken('c'.repeat(64), supabase);

    expect(result).toEqual({ error: 'expired' });
    expect(supabase.update).toHaveBeenCalledWith({ status: 'expired' });
    expect(supabase.updateEq).toHaveBeenCalledWith('id', 's1');
  });

  // The plaintext-token fallback is OFF by default now (strict-hash). These
  // cover the opt-in legacy path, so they explicitly disable strict mode.
  describe('legacy plaintext-token fallback (opt-in, non-strict)', () => {
    const FLAG = 'COSIGN_SESSION_TOKEN_HASH_STRICT';
    let prev;
    beforeEach(() => { prev = process.env[FLAG]; process.env[FLAG] = 'false'; });
    afterEach(() => { if (prev === undefined) delete process.env[FLAG]; else process.env[FLAG] = prev; });

    it('applies status checks to legacy raw-token fallback sessions', async () => {
      const supabase = createSupabaseMock([
        { data: null, error: { message: 'not found' } },
        { data: { id: 'legacy', status: 'revoked' }, error: null },
      ]);

      const result = await validateSessionToken('d'.repeat(64), supabase);
      expect(result).toEqual({ error: 'revoked' });
    });

    it('returns legacy session when fallback is valid', async () => {
      const legacy = { id: 'legacy-2', status: 'pending', expires_at: null };
      const supabase = createSupabaseMock([
        { data: null, error: { message: 'not found' } },
        { data: legacy, error: null },
      ]);

      const result = await validateSessionToken('e'.repeat(64), supabase);
      expect(result).toEqual({ session: legacy });
    });
  });

  it('rejects unknown token under strict default (no plaintext fallback)', async () => {
    const supabase = createSupabaseMock([
      { data: null, error: { message: 'not found' } },
    ]);
    const result = await validateSessionToken('f'.repeat(64), supabase);
    expect(result).toEqual({ error: 'not_found' });
  });
});

describe('sessionAuth.isSessionVerified', () => {
  it('requires verification token when recipient email exists', () => {
    const session = {
      recipient_email: 'user@example.com',
      recipient_last_name: null,
      verification_token_hash: 'abc',
    };

    expect(isSessionVerified(session, undefined)).toBe(false);
  });

  it('returns true for sessions without recipient email', () => {
    expect(isSessionVerified({ recipient_email: null }, undefined)).toBe(true);
  });

  it('returns true when token hash matches', () => {
    const token = 'verification-token';
    const session = {
      recipient_email: 'user@example.com',
      verification_token_hash: hashToken(token),
    };
    expect(isSessionVerified(session, token)).toBe(true);
  });
});

describe('sessionAuth helpers', () => {
  it('hashToken is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('xyz'));
  });

  it('generateSessionToken returns token and hash', () => {
    const { token, tokenHash } = generateSessionToken();
    expect(token).toHaveLength(64);
    expect(tokenHash).toBe(hashToken(token));
  });

  it('authenticateClient returns missing_auth without bearer header', async () => {
    const req = { headers: {} };
    const result = await authenticateClient(req, { auth: { getUser: jest.fn() } });
    expect(result).toEqual({ error: 'missing_auth' });
  });

  it('authenticateClient returns invalid_auth for bad token', async () => {
    const req = { headers: { authorization: 'Bearer bad-token' } };
    const supabase = {
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: null },
          error: { message: 'invalid' },
        })),
      },
    };
    const result = await authenticateClient(req, supabase);
    expect(result).toEqual({ error: 'invalid_auth' });
  });

  it('authenticateClient returns user for valid token', async () => {
    const req = { headers: { authorization: 'Bearer good-token' } };
    const supabase = {
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
        })),
      },
    };
    const result = await authenticateClient(req, supabase);
    expect(result).toEqual({ user: { id: 'user-1' } });
  });
});
