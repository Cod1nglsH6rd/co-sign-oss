/**
 * POST /api/sessions/[token]/complete hands the "signing complete" email a
 * signed PDF link that opens later and elsewhere: at home the server signs on
 * http://gateway:3000, and the email link must be on PUBLIC_SUPABASE_URL,
 * else NEXT_PUBLIC_SUPABASE_URL. With neither set the email gets the link
 * unchanged, never one built from the request's Host or x-forwarded-host.
 * The link saved in the session metadata stays as signed. Supabase is mocked.
 */

const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));
jest.mock('../../lib/sessionAuth', () => ({
  validateSessionToken: jest.fn(),
  isSessionVerified: jest.fn(() => true),
}));
jest.mock('../../lib/rateLimit', () => ({ rateLimitPublic: jest.fn(async () => false) }));
jest.mock('../../lib/auditLog', () => ({ logAudit: jest.fn(async () => {}) }));
jest.mock('../../lib/csrf', () => ({ validateCsrfToken: jest.fn(() => true) }));
jest.mock('../../lib/embedOrigin', () => ({ enforceEmbedOriginForSession: jest.fn(() => ({ ok: true })) }));
jest.mock('../../lib/email', () => ({ sendCompletionNotificationEmail: jest.fn(async () => {}) }));
jest.mock('../../lib/exportPdf', () => ({ generateFilledPdf: jest.fn(async () => new Uint8Array([37, 80, 68, 70])) }));
jest.mock('../../lib/documentFetch', () => ({
  DocumentSourceNotAllowedError: class DocumentSourceNotAllowedError extends Error {},
  downloadDocumentBinary: jest.fn(async () => ({ buffer: new Uint8Array([1]) })),
}));

const { requireServiceSupabase } = require('../../lib/supabaseClient');
const { validateSessionToken } = require('../../lib/sessionAuth');
const { sendCompletionNotificationEmail } = require('../../lib/email');

const PATH_AND_QUERY = '/storage/v1/object/sign/filled-documents/d1/s1-filled.pdf?token=abc.def';
const SIGNED = `http://gateway:3000${PATH_AND_QUERY}`;
const VARS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_APP_URL'];
const savedEnv = {};

/** A chainable query that records update patches. */
function query(table, rows, calls) {
  const filters = [];
  let patch = null;
  let head = false;
  const matched = () => rows.filter((row) => filters.every(([col, val]) => String(row[col]) === String(val)));
  const run = () => {
    const found = matched();
    if (patch) {
      calls.updates.push({ table, patch });
      found.forEach((row) => Object.assign(row, patch));
      return { data: found.map((row) => ({ id: row.id })), error: null };
    }
    if (head) return { data: null, count: 0, error: null };
    return { data: found, count: found.length, error: null };
  };
  const builder = {
    select: (_cols, opts) => { if (opts?.head) head = true; return builder; },
    update: (values) => { patch = values; return builder; },
    eq: (col, val) => { filters.push([col, val]); return builder; },
    neq: () => builder,
    in: () => builder,
    order: () => builder,
    single: async () => ({ data: run().data?.[0] || null, error: null }),
    maybeSingle: async () => ({ data: run().data?.[0] || null, error: null }),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return builder;
}

async function complete(headers = {}) {
  const handler = require('../../pages/api/sessions/[token]/complete').default;
  const session = {
    id: 's1',
    document_id: 'd1',
    status: 'in_progress',
    field_filter: null,
    require_signature: false,
    preferred_language: 'en',
    metadata: {},
    client_user_id: 'u1',
    recipient_name: 'Ann',
    // org_id and an org folder path: complete.js now downloads only from the
    // document owner's folder (the old 'd1/lease.pdf' has no owner: 422).
    documents: { org_id: 'o1', file_name: 'Lease.pdf', file_type: 'application/pdf', file_path: 'o1/lease.pdf' },
  };
  const tables = {
    fields: [{ id: 1, document_id: 'd1', sort_order: 1, field_name: 'Full name', field_type: 'text', position: {} }],
    session_fields: [{ id: 'sf1', session_id: 's1', field_id: 1, field_value: 'Ann', signature_data_url: null }],
    fill_sessions: [{ ...session }],
    documents: [{ id: 'd1', completion_count: 0 }],
  };
  const calls = { updates: [] };
  requireServiceSupabase.mockReturnValue({
    from: jest.fn((table) => query(table, tables[table] || [], calls)),
    rpc: jest.fn(async () => ({ error: null })),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(async () => ({ error: null })),
        createSignedUrl: jest.fn(async () => ({ data: { signedUrl: SIGNED }, error: null })),
      })),
    },
    auth: {
      admin: {
        getUserById: jest.fn(async () => ({
          data: { user: { email: 'owner@example.com', user_metadata: { full_name: 'Owner' } } },
        })),
      },
    },
  });
  validateSessionToken.mockResolvedValue({ session: { ...session }, error: null });

  const { req, res } = createMocks({
    method: 'POST',
    query: { token: 't1' },
    body: {},
    headers: { host: 'localhost:3000', ...headers },
  });
  await handler(req, res);
  const completion = calls.updates.find((u) => u.table === 'fill_sessions' && u.patch.status === 'completed');
  return { res, completion };
}

function emailLink() {
  expect(sendCompletionNotificationEmail).toHaveBeenCalledTimes(1);
  return sendCompletionNotificationEmail.mock.calls[0][0].filledPdfUrl;
}

beforeEach(() => {
  VARS.forEach((name) => { savedEnv[name] = process.env[name]; delete process.env[name]; });
  process.env.SUPABASE_URL = 'http://gateway:3000';
  sendCompletionNotificationEmail.mockClear();
  global.fetch = jest.fn(async () => { throw new Error('offline'); });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
  VARS.forEach((name) => {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  });
});

test('the email link is on PUBLIC_SUPABASE_URL when it is set', async () => {
  process.env.PUBLIC_SUPABASE_URL = 'https://db.example.com';
  const { res } = await complete();
  expect(res._getStatusCode()).toBe(200);
  expect(emailLink()).toBe(`https://db.example.com${PATH_AND_QUERY}`);
});

test('the email link falls back to NEXT_PUBLIC_SUPABASE_URL', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://build.example.com';
  const { res } = await complete();
  expect(res._getStatusCode()).toBe(200);
  expect(emailLink()).toBe(`https://build.example.com${PATH_AND_QUERY}`);
});

test('with no public address the email link is unchanged, not built from Host or x-forwarded-host', async () => {
  const { res } = await complete({
    host: '192.168.1.20:3000',
    'x-forwarded-host': 'sign.example.com',
    'x-forwarded-proto': 'https',
  });
  expect(res._getStatusCode()).toBe(200);
  const link = emailLink();
  expect(link).toBe(SIGNED);
  expect(link).not.toContain('192.168.1.20');
  expect(link).not.toContain('sign.example.com');
});

test('the link saved in the session metadata stays as signed', async () => {
  process.env.PUBLIC_SUPABASE_URL = 'https://db.example.com';
  const { res, completion } = await complete();
  expect(res._getStatusCode()).toBe(200);
  expect(completion.patch.metadata.filled_pdf_url).toBe(SIGNED);
});

test('the email helper uses only the configured public address', () => {
  const { publicStorageUrlForEmail } = require('../../lib/publicStorageUrl');
  expect(typeof publicStorageUrlForEmail).toBe('function');
  process.env.PUBLIC_SUPABASE_URL = 'https://db.example.com';
  expect(publicStorageUrlForEmail(SIGNED)).toBe(`https://db.example.com${PATH_AND_QUERY}`);
  delete process.env.PUBLIC_SUPABASE_URL;
  expect(publicStorageUrlForEmail(SIGNED)).toBe(SIGNED);
});
