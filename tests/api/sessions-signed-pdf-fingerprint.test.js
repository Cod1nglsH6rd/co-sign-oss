/**
 * Signed PDF integrity (co-sign-409).
 *
 * POST /api/sessions/[token]/complete saves the signed PDF's SHA-256
 * fingerprint and size in the session metadata (filled_pdf_sha256,
 * filled_pdf_bytes), and GET /api/sessions/signed-pdf answers
 * { url, sha256, bytes } for the asked-for session only, never another
 * session of the same document (PRD §2.7). Supabase is mocked.
 *
 * The PDF writer is mocked to return the 4 bytes "%PDF"; its SHA-256 was
 * worked out by hand with `printf '%%PDF' | sha256sum`.
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

const PDF_SHA256 = '315d429b7714cedb6ad04ac31240145257692630457f3c88253c5beceac76027';
const PDF_BYTES = 4;

/** A chainable query that records filters and update patches. */
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

beforeEach(() => {
  global.fetch = jest.fn(async () => { throw new Error('offline'); });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

describe('POST /api/sessions/[token]/complete saves the signed PDF fingerprint', () => {
  test('stores filled_pdf_sha256 and filled_pdf_bytes matching the uploaded bytes', async () => {
    const handler = require('../../pages/api/sessions/[token]/complete').default;
    const session = {
      id: 's1',
      document_id: 'd1',
      status: 'in_progress',
      field_filter: null,
      require_signature: false,
      preferred_language: 'en',
      metadata: {},
      client_user_id: null,
      // org_id and an org folder path: complete.js now downloads only from
      // the document owner's folder (the old 'd1/lease.pdf' has no owner: 422).
      documents: { org_id: 'o1', file_name: 'Lease.pdf', file_type: 'application/pdf', file_path: 'o1/lease.pdf' },
    };
    const tables = {
      fields: [{ id: 1, document_id: 'd1', sort_order: 1, field_name: 'Full name', field_type: 'text', position: {} }],
      session_fields: [{ id: 'sf1', session_id: 's1', field_id: 1, field_value: 'Ann', signature_data_url: null }],
      fill_sessions: [{ ...session }],
      documents: [{ id: 'd1', completion_count: 0 }],
    };
    const calls = { updates: [] };
    const upload = jest.fn(async () => ({ error: null }));
    requireServiceSupabase.mockReturnValue({
      from: jest.fn((table) => query(table, tables[table] || [], calls)),
      rpc: jest.fn(async () => ({ error: null })),
      storage: {
        from: jest.fn(() => ({
          upload,
          createSignedUrl: jest.fn(async () => ({ data: { signedUrl: 'http://localhost/signed.pdf' }, error: null })),
        })),
      },
      auth: { admin: { getUserById: jest.fn(async () => ({ data: { user: null } })) } },
    });
    validateSessionToken.mockResolvedValue({ session: { ...session }, error: null });

    const { req, res } = createMocks({
      method: 'POST',
      query: { token: 't1' },
      body: {},
      headers: { host: 'localhost:3000' },
    });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(Array.from(upload.mock.calls[0][1])).toEqual([37, 80, 68, 70]);

    const completion = calls.updates.find((u) => u.table === 'fill_sessions' && u.patch.status === 'completed');
    expect(completion).toBeDefined();
    expect(completion.patch.metadata.filled_pdf_path).toBe('d1/s1-filled.pdf');
    expect(completion.patch.metadata.filled_pdf_sha256).toBe(PDF_SHA256);
    expect(completion.patch.metadata.filled_pdf_bytes).toBe(PDF_BYTES);
  });
});

describe('GET /api/sessions/signed-pdf answers { url, sha256, bytes } for the asked-for session', () => {
  function mockSignedPdfSupabase(sessions) {
    const createSignedUrl = jest.fn(async (path) => ({
      data: { signedUrl: `http://localhost:3000/storage/v1/object/sign/filled-documents/${path}?token=x` },
      error: null,
    }));
    const calls = { updates: [] };
    const tables = {
      fill_sessions: sessions,
      org_memberships: [{ org_id: 'o1', user_id: 'u1', status: 'active' }],
    };
    requireServiceSupabase.mockReturnValue({
      auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })) },
      from: jest.fn((table) => query(table, tables[table] || [], calls)),
      storage: { from: jest.fn(() => ({ createSignedUrl })) },
    });
    return { createSignedUrl };
  }

  async function ask(sessionId) {
    const handler = require('../../pages/api/sessions/signed-pdf').default;
    const { req, res } = createMocks({
      method: 'GET',
      query: { sessionId },
      headers: { authorization: 'Bearer jwt', host: 'localhost:3000' },
    });
    await handler(req, res);
    return res;
  }

  const FIRST = {
    id: 's1',
    document_id: 'd1',
    status: 'completed',
    completed_at: '2026-11-18T09:00:00.000Z',
    metadata: { filled_pdf_path: 'd1/s1-filled.pdf', filled_pdf_sha256: PDF_SHA256, filled_pdf_bytes: PDF_BYTES },
    documents: { org_id: 'o1', file_name: 'Lease.pdf' },
  };
  const LATER = {
    id: 's2',
    document_id: 'd1',
    status: 'completed',
    completed_at: '2026-11-18T10:00:00.000Z',
    metadata: {
      filled_pdf_path: 'd1/s2-filled.pdf',
      filled_pdf_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      filled_pdf_bytes: 999,
    },
    documents: { org_id: 'o1', file_name: 'Lease.pdf' },
  };

  test('returns the url with the saved sha256 and bytes', async () => {
    mockSignedPdfSupabase([{ ...FIRST }]);
    const res = await ask('s1');
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.url).toContain('d1/s1-filled.pdf');
    expect(body.sha256).toBe(PDF_SHA256);
    expect(body.bytes).toBe(PDF_BYTES);
  });

  test('returns the first session\'s own PDF even when a later session on the same document has its own', async () => {
    const { createSignedUrl } = mockSignedPdfSupabase([{ ...FIRST }, { ...LATER }]);
    const res = await ask('s1');
    expect(res._getStatusCode()).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl.mock.calls[0][0]).toBe('d1/s1-filled.pdf');
    const body = JSON.parse(res._getData());
    expect(body.url).toContain('d1/s1-filled.pdf');
    expect(body.sha256).toBe(PDF_SHA256);
    expect(body.bytes).toBe(PDF_BYTES);
  });

  test('answers null sha256 and bytes for a PDF saved before they were recorded', async () => {
    mockSignedPdfSupabase([{ ...FIRST, metadata: { filled_pdf_path: 'd1/s1-filled.pdf' } }]);
    const res = await ask('s1');
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.url).toContain('d1/s1-filled.pdf');
    expect(body).toHaveProperty('sha256', null);
    expect(body).toHaveProperty('bytes', null);
  });
});
