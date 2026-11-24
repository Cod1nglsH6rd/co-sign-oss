/**
 * Releasing queued invites when a document finishes processing (/api/ocr,
 * mode 'full'). Sessions store only token_hash (sessions/create.js never
 * saves the plaintext token), so the release used to send `session.token`,
 * which is undefined: the email linked to /fill/undefined and the session
 * was marked sent. The release now mints a fresh token the way create.js
 * does, stores its hash, and the email carries that token; a session whose
 * email did not go out is not marked sent.
 *
 * The real lib/email.js runs with Resend on; fetch is mocked and records the
 * email body. The provider key is a short fake value.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');

const { releaseQueuedSessions } = require('../../lib/queuedInvites');

const ENV = ['EMAIL_PROVIDER', 'RESEND_API_KEY', 'EMAIL_FROM', 'NEXT_PUBLIC_APP_URL'];
const savedEnv = {};
let cwd;
let realFetch;

beforeEach(() => {
  ENV.forEach((name) => { savedEnv[name] = process.env[name]; });
  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 'fake';
  // Needed since the release review: lib/email.js has no built-in sender.
  process.env.EMAIL_FROM = 'sign@sender.example';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-queued-invites-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  realFetch = global.fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
  ENV.forEach((name) => {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  });
});

// A queued email session as sessions/create.js stores it: token_hash, no token.
const QUEUED = {
  id: 's-1',
  document_id: 'd-1',
  status: 'queued',
  send_method: 'email',
  recipient_email: 'signer@example.test',
  recipient_name: 'Ana',
  client_user_id: null,
  preferred_language: 'vi',
  expires_at: '2026-12-21T00:00:00.000Z',
  token_hash: 'old-hash-from-create',
};

function fakeSupabase(sessions) {
  const rows = new Map(sessions.map((s) => [s.id, { ...s }]));
  const updates = [];
  return {
    rows,
    updates,
    auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
    from(table) {
      if (table !== 'fill_sessions') throw new Error(`unexpected table ${table}`);
      const q = { filters: {}, payload: null, op: 'select' };
      const run = () => {
        if (q.op === 'update') {
          updates.push({ id: q.filters.id, payload: q.payload });
          const row = rows.get(q.filters.id);
          if (row) Object.assign(row, q.payload);
          return { data: null, error: null };
        }
        const data = [...rows.values()].filter((r) => Object.entries(q.filters).every(([k, v]) => r[k] === v));
        return { data: JSON.parse(JSON.stringify(data)), error: null };
      };
      const b = {
        select: () => b,
        update: (payload) => { q.op = 'update'; q.payload = payload; return b; },
        eq: (col, val) => { q.filters[col] = val; return b; },
        then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
      };
      return b;
    },
  };
}

function mockMail(ok = true) {
  const sent = [];
  global.fetch = jest.fn(async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok, status: ok ? 200 : 500 };
  });
  return sent;
}

describe('releaseQueuedSessions', () => {
  it('emails a /fill/<token> link whose hash is the one stored on the session, then marks it sent', async () => {
    const sent = mockMail(true);
    const supabase = fakeSupabase([QUEUED]);

    await releaseQueuedSessions({ supabase, documentId: 'd-1', documentName: 'Lease.pdf' });

    expect(sent).toHaveLength(1);
    const match = sent[0].html.match(/https:\/\/app\.example\.test\/vi\/fill\/([^"'\s<]+)/);
    expect(match).not.toBeNull();
    const token = match[1];
    expect(token).not.toBe('undefined');
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const row = supabase.rows.get('s-1');
    expect(row.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row.status).toBe('sent');
    expect(row.sent_at).toEqual(expect.any(String));
    expect(JSON.stringify(supabase.updates)).not.toContain(token);
  });

  it('does not mark the session sent when the email fails, and keeps the link made at creation working', async () => {
    mockMail(false);
    const supabase = fakeSupabase([QUEUED]);

    await releaseQueuedSessions({ supabase, documentId: 'd-1', documentName: 'Lease.pdf' });

    const row = supabase.rows.get('s-1');
    expect(row.status).not.toBe('sent');
    expect(row.status).toBe('pending');
    expect(row.sent_at).toBeUndefined();
    expect(row.token_hash).toBe('old-hash-from-create');
  });

  it('does not mark the session sent when mail is off', async () => {
    process.env.EMAIL_PROVIDER = 'none';
    const sent = mockMail(true);
    const supabase = fakeSupabase([QUEUED]);

    await releaseQueuedSessions({ supabase, documentId: 'd-1', documentName: 'Lease.pdf' });

    expect(sent).toHaveLength(0);
    expect(supabase.rows.get('s-1').status).toBe('pending');
  });

  it('marks a queued link session pending without minting a token', async () => {
    const sent = mockMail(true);
    const supabase = fakeSupabase([{ ...QUEUED, send_method: 'link' }]);

    await releaseQueuedSessions({ supabase, documentId: 'd-1', documentName: 'Lease.pdf' });

    expect(sent).toHaveLength(0);
    const row = supabase.rows.get('s-1');
    expect(row.status).toBe('pending');
    expect(row.token_hash).toBe('old-hash-from-create');
  });
});

describe('/api/ocr release step', () => {
  it('uses releaseQueuedSessions and never sends the stored session token', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../pages/api/ocr.js'), 'utf8');
    expect(source).toContain('releaseQueuedSessions(');
    expect(source).not.toMatch(/token:\s*session\.token/);
  });
});
