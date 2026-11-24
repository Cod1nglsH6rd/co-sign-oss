/**
 * POST /api/sessions/[token]/verify under parallel guesses.
 *
 * The route used to read verification_attempts, compare, and then write
 * count + 1, so guesses sent together all read the same count, were all
 * compared, and raised it by one between them. Now each attempt is counted
 * before its details are compared, with a compare-and-set update
 * (where id = X and verification_attempts = N, set N + 1, returning the
 * row): an attempt whose update changed no row re-reads the count and tries
 * again (a bounded number of times), and an attempt is compared only once
 * its own increment has landed. The lockout decision reads the count the
 * update returned.
 *
 * The table is a fake with the same compare-and-set semantics as Postgres:
 * every read and write yields to the event loop, so requests sent together
 * interleave.
 */
import { createMocks } from 'node-mocks-http';

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));
jest.mock('../../lib/sessionAuth', () => ({
  ...jest.requireActual('../../lib/sessionAuth'),
  validateSessionToken: jest.fn(),
}));
jest.mock('../../lib/rateLimit', () => ({ rateLimitPublic: jest.fn(async () => false) }));
jest.mock('../../lib/embedOrigin', () => ({ enforceEmbedOriginForSession: jest.fn(() => ({ ok: true })) }));

const { requireServiceSupabase } = require('../../lib/supabaseClient');
const { validateSessionToken } = require('../../lib/sessionAuth');
const handler = require('../../pages/api/sessions/[token]/verify').default;

const tick = () => new Promise((resolve) => setImmediate(resolve));

// One fill_sessions row behind a PostgREST-like builder.
function fakeTable(initial) {
  const row = { ...initial };
  const writes = [];
  function builder() {
    const q = { op: 'select', payload: null, filters: [], returning: false };
    const matches = () => q.filters.every(([col, val]) => (val === null ? row[col] == null : row[col] === val));
    const run = async () => {
      await tick();
      if (q.op === 'update') {
        if (!matches()) return { data: q.returning ? [] : null, error: null };
        Object.assign(row, q.payload);
        writes.push({ ...q.payload });
        return { data: q.returning ? [{ ...row }] : null, error: null };
      }
      return { data: matches() ? { ...row } : null, error: null };
    };
    const b = {
      update: (payload) => { q.op = 'update'; q.payload = payload; return b; },
      select: () => { if (q.op === 'update') q.returning = true; return b; },
      eq: (col, val) => { q.filters.push([col, val]); return b; },
      is: (col, val) => { q.filters.push([col, val]); return b; },
      maybeSingle: () => run(),
      single: () => run(),
      then: (resolve, reject) => run().then(resolve, reject),
    };
    return b;
  }
  return { row, writes, client: { from: () => builder() } };
}

function useTable(table) {
  requireServiceSupabase.mockReturnValue(table.client);
  // Each request reads the row as it is when it arrives, after a tick.
  validateSessionToken.mockImplementation(async () => {
    const snapshot = { ...table.row };
    await tick();
    return { session: snapshot, error: null };
  });
}

async function guess(body) {
  const { req, res } = createMocks({ method: 'POST', query: { token: 'a'.repeat(64) }, body });
  await handler(req, res);
  return { status: res._getStatusCode(), json: JSON.parse(res._getData()) };
}

const WRONG = { email: 'someone@else.example', lastName: 'Doe' };
const RIGHT = { email: 'jane.doe@example.com', lastName: 'Doe' };
const START = {
  id: 'session-1',
  status: 'sent',
  recipient_email: 'jane.doe@example.com',
  recipient_last_name: 'Doe',
  verification_attempts: 0,
  last_verify_attempt_at: null,
};

let now;
beforeEach(() => {
  jest.clearAllMocks();
  now = Date.parse('2026-11-21T12:00:00.000Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('parallel wrong guesses', () => {
  it('every guess that is compared has raised the counter by one; the others are refused uncompared', async () => {
    const table = fakeTable(START);
    useTable(table);

    const results = await Promise.all(Array.from({ length: 8 }, () => guess(WRONG)));

    const compared = results.filter((r) => r.status === 403);
    const refused = results.filter((r) => r.status === 429);
    expect(compared.length + refused.length).toBe(8);
    expect(compared.length).toBeGreaterThanOrEqual(1);
    expect(table.row.verification_attempts).toBe(compared.length);
    expect(refused.every((r) => r.json.error === 'verify_locked')).toBe(true);
  });

  it('N parallel guesses with no back-off between them raise the counter by N and lock at the limit', async () => {
    const table = fakeTable({ ...START, recipient_last_name: 'Doe' });
    useTable(table);

    // Rounds of parallel guesses, each after the back-off has passed.
    let compared = 0;
    for (let round = 0; round < 8; round += 1) {
      now += 2 * 3600 * 1000;
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all(Array.from({ length: 4 }, () => guess(WRONG)));
      compared += results.filter((r) => r.status === 403).length;
    }

    expect(compared).toBe(5);
    expect(table.row.verification_attempts).toBe(5);

    now += 24 * 3600 * 1000;
    const locked = await guess(RIGHT);
    expect(locked.status).toBe(429);
    expect(locked.json.error).toBe('verify_locked');
    expect(locked.json).not.toHaveProperty('verificationToken');
  });

  it('the lockout reads the count the update returned, not the one read before', async () => {
    // The row reads 4 to the route, but another request lands first and
    // takes it to 5: this attempt must not be compared.
    const table = fakeTable({ ...START, verification_attempts: 4, last_verify_attempt_at: null });
    requireServiceSupabase.mockReturnValue(table.client);
    validateSessionToken.mockImplementation(async () => {
      const snapshot = { ...table.row };
      table.row.verification_attempts = 5;
      table.row.last_verify_attempt_at = new Date(now).toISOString();
      return { session: snapshot, error: null };
    });

    const result = await guess(RIGHT);

    expect(result.status).toBe(429);
    expect(result.json.error).toBe('verify_locked');
    expect(table.row.verification_attempts).toBe(5);
    expect(table.row.verification_token_hash).toBeUndefined();
  });

  it('a right answer after wrong ones still verifies and resets the counter', async () => {
    const table = fakeTable({ ...START, verification_attempts: 2, last_verify_attempt_at: new Date(now - 3600 * 1000).toISOString() });
    useTable(table);

    const result = await guess(RIGHT);

    expect(result.status).toBe(200);
    expect(typeof result.json.verificationToken).toBe('string');
    expect(table.row.verification_attempts).toBe(0);
    expect(table.row.last_verify_attempt_at).toBeNull();
  });
});
