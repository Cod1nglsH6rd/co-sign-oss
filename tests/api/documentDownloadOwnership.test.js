/**
 * Service-role reads and deletes of storage paths taken from rows members can
 * edit (the PR #483 review, part 2).
 *
 * documents.file_path is editable by the document's organisation (and by the
 * writer of a no-organisation row), fill_sessions.metadata by its session's
 * client. Pointed at another organisation's object:
 * - POST /api/sessions/[token]/complete built a filled PDF from it;
 * - POST /api/ocr (mode full) and POST /api/reprocess-positions wrote fields
 *   read from it into the caller's document;
 * - the retention cron deleted the filled PDF named in metadata.
 * Each download now refuses a file_path outside the owner's folder (422
 * document_source_not_allowed, nothing downloaded), and the cron deletes the
 * filled PDF recomputed from the document and session ids.
 */
import { createMocks } from 'node-mocks-http';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));
jest.mock('../../lib/sessionAuth', () => ({
  validateSessionToken: jest.fn(),
  isSessionVerified: jest.fn(() => true),
}));
jest.mock('../../lib/rateLimit', () => ({
  rateLimitPublic: jest.fn(async () => false),
  rateLimitAuth: jest.fn(async () => false),
  rateLimitCron: jest.fn(async () => false),
}));
jest.mock('../../lib/auditLog', () => ({ logAudit: jest.fn() }));
jest.mock('../../lib/csrf', () => ({ validateCsrfToken: jest.fn(() => true) }));
jest.mock('../../lib/embedOrigin', () => ({ enforceEmbedOriginForSession: jest.fn(() => ({ ok: true })) }));
jest.mock('../../lib/exportPdf', () => ({ generateFilledPdf: jest.fn(async () => new Uint8Array([1])) }));
jest.mock('../../lib/email', () => ({ sendCompletionNotificationEmail: jest.fn() }));
jest.mock('../../lib/sessionFieldRules', () => ({ getRequiredFieldIdSet: jest.fn(() => new Set()) }));
jest.mock('../../lib/pdfTextExtraction', () => ({ refineFieldPositions: jest.fn(async (f) => f) }));
jest.mock('../../lib/documentFetch', () => ({
  ...jest.requireActual('../../lib/documentFetch'),
  downloadDocumentBinary: jest.fn(),
}));
jest.mock('../../lib/auth', () => ({
  requireBearerUser: jest.fn(),
  requireOrgMembership: jest.fn(),
  requestedOrgId: jest.fn(() => null),
}));
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn(async () => { throw new Error('no AI call in this test'); }) },
  })),
}));

const { createClient } = require('@supabase/supabase-js');
const { requireServiceSupabase } = require('../../lib/supabaseClient');
const { validateSessionToken } = require('../../lib/sessionAuth');
const { downloadDocumentBinary } = require('../../lib/documentFetch');
const auth = require('../../lib/auth');

const ORG_A = 'org-aaaa';
const ORG_B = 'org-bbbb';
const VARS = [
  'ANTHROPIC_API_KEY', 'OCR_PROVIDER', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY', 'RETENTION_CRON_SECRET', 'CRON_SECRET',
];
const savedEnv = {};

beforeEach(() => {
  jest.clearAllMocks();
  VARS.forEach((name) => { savedEnv[name] = process.env[name]; delete process.env[name]; });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  downloadDocumentBinary.mockResolvedValue({ buffer: Buffer.from('pdf'), contentType: 'application/pdf', source: 'storage' });
  auth.requireBearerUser.mockResolvedValue({ user: { id: 'user-a' } });
  auth.requireOrgMembership.mockResolvedValue({ orgId: ORG_A, membership: { org_id: ORG_A } });
});

afterEach(() => {
  jest.restoreAllMocks();
  VARS.forEach((name) => {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  });
});

// A query builder that answers every query from `tables` and records writes.
function fakeSupabase(tables, extra = {}) {
  const writes = [];
  const from = jest.fn((table) => {
    const q = { table, op: 'select', filters: {}, payload: null };
    const run = () => {
      if (q.op !== 'select') {
        writes.push({ table, op: q.op, payload: q.payload, filters: { ...q.filters } });
        return { data: q.op === 'update' ? [{ id: q.filters.id }] : null, error: null, count: 0 };
      }
      const rows = (tables[table] || []).filter((row) => Object.entries(q.filters)
        .every(([col, val]) => row[col] === undefined || row[col] === val));
      return { data: JSON.parse(JSON.stringify(rows)), error: null, count: 0 };
    };
    const b = {
      select: () => b,
      update: (payload) => { q.op = 'update'; q.payload = payload; return b; },
      insert: (payload) => { q.op = 'insert'; q.payload = payload; return b; },
      upsert: (payload) => { q.op = 'upsert'; q.payload = payload; return b; },
      delete: () => { q.op = 'delete'; return b; },
      eq: (col, val) => { q.filters[col] = val; return b; },
      neq: () => b,
      in: () => b,
      not: () => b,
      lt: () => b,
      gte: () => b,
      order: () => b,
      limit: () => b,
      single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error }; },
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: null }; },
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    };
    return b;
  });
  return {
    writes,
    from,
    rpc: jest.fn(async () => ({ data: null, error: null })),
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'user-a' } }, error: null })), admin: { getUserById: async () => ({ data: { user: null } }) } },
    storage: { from: jest.fn(() => ({ upload: async () => ({ error: { message: 'skip' } }), createSignedUrl: async () => ({ data: null, error: { message: 'skip' } }) })) },
    ...extra,
  };
}

const FORGED_FOREIGN_ORG = { org_id: ORG_A, user_id: 'user-a', created_by: 'user-a', file_path: `${ORG_B}/1-secret.pdf` };
const FORGED_NO_ORG = { org_id: null, user_id: ORG_B, created_by: 'user-a', file_path: `${ORG_B}/1-secret.pdf` };
const OWN = { org_id: ORG_A, user_id: 'user-a', created_by: 'user-a', file_path: `${ORG_A}/1-lease.pdf` };

describe('POST /api/sessions/[token]/complete', () => {
  const handler = require('../../pages/api/sessions/[token]/complete').default;

  async function complete(documentPath) {
    const supabase = fakeSupabase({ fields: [{ id: 1, document_id: 'd-1', field_name: 'Name', field_type: 'text', position: {} }] });
    requireServiceSupabase.mockReturnValue(supabase);
    validateSessionToken.mockResolvedValue({
      session: {
        id: 's-1',
        document_id: 'd-1',
        status: 'opened',
        metadata: {},
        documents: { id: 'd-1', file_name: 'a.pdf', file_type: 'application/pdf', ...documentPath },
      },
      error: null,
    });
    const { req, res } = createMocks({ method: 'POST', query: { token: 'tok' }, body: {}, headers: { host: 'localhost:3000' } });
    await handler(req, res);
    return { res, supabase };
  }

  it.each([['another organisation', FORGED_FOREIGN_ORG], ['a forged no-organisation row', FORGED_NO_ORG]])(
    'refuses a file_path in %s folder: no download, not completed',
    async (_name, documentPath) => {
      const { res, supabase } = await complete(documentPath);
      expect(downloadDocumentBinary).not.toHaveBeenCalled();
      expect(res._getStatusCode()).toBe(422);
      expect(res._getJSONData().errorCode).toBe('document_source_not_allowed');
      expect(supabase.writes.some((w) => w.table === 'fill_sessions' && w.op === 'update')).toBe(false);
    }
  );

  it('downloads the document from its own organisation folder', async () => {
    const { res } = await complete(OWN);
    expect(downloadDocumentBinary).toHaveBeenCalledTimes(1);
    expect(downloadDocumentBinary.mock.calls[0][0].filePath).toBe(`${ORG_A}/1-lease.pdf`);
    expect(res._getStatusCode()).toBe(200);
  });
});

describe('POST /api/ocr (mode full)', () => {
  async function ocr(documentPath) {
    process.env.ANTHROPIC_API_KEY = 'fake';
    const row = {
      id: 'doc-a', status: 'uploaded', processing_status: 'queued', lifecycle_status: 'draft',
      file_url: null, file_type: 'pdf', file_name: 'a.pdf', phase1_data: null, ...documentPath,
    };
    const supabase = fakeSupabase({ documents: [row], fields: [], fill_sessions: [] });
    createClient.mockReturnValue(supabase);
    const handler = require('../../pages/api/ocr').default;
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt' },
      body: { documentId: 'doc-a', userId: 'user-a', mode: 'full' },
    });
    await handler(req, res);
    return res;
  }

  it('refuses a file_path in another organisation folder and downloads nothing', async () => {
    const res = await ocr(FORGED_FOREIGN_ORG);
    expect(downloadDocumentBinary).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(422);
    expect(res._getJSONData().errorCode).toBe('document_source_not_allowed');
  });

  it('downloads the document from its own organisation folder', async () => {
    await ocr(OWN);
    expect(downloadDocumentBinary).toHaveBeenCalledTimes(1);
    expect(downloadDocumentBinary.mock.calls[0][0].filePath).toBe(`${ORG_A}/1-lease.pdf`);
  });
});

describe('POST /api/reprocess-positions', () => {
  const handler = require('../../pages/api/reprocess-positions').default;

  async function reprocess(documentPath) {
    const supabase = fakeSupabase({
      documents: [{ id: 'doc-a', file_type: 'pdf', file_name: 'a.pdf', file_url: null, ...documentPath }],
      fields: [{ id: 1, document_id: 'doc-a', field_name: 'Name', position: null }],
    });
    createClient.mockReturnValue(supabase);
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt' },
      body: { documentId: 'doc-a' },
    });
    await handler(req, res);
    return res;
  }

  it('refuses a file_path in another organisation folder and downloads nothing', async () => {
    const res = await reprocess(FORGED_FOREIGN_ORG);
    expect(downloadDocumentBinary).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(422);
    expect(res._getJSONData().errorCode).toBe('document_source_not_allowed');
  });

  it('downloads the document from its own organisation folder', async () => {
    const res = await reprocess(OWN);
    expect(downloadDocumentBinary).toHaveBeenCalledTimes(1);
    expect(res._getStatusCode()).toBe(200);
  });
});

describe('GET /api/cron/retention', () => {
  const handler = require('../../pages/api/cron/retention').default;

  it('deletes the filled PDF recomputed from the ids, never the path in metadata', async () => {
    process.env.RETENTION_CRON_SECRET = 'cron-test';
    const remove = jest.fn(async () => ({ error: null }));
    const supabase = fakeSupabase(
      {
        organizations: [{ id: ORG_A, retention_days: 30 }],
        fill_sessions: [{
          id: 's-1',
          document_id: 'd-1',
          metadata: { filled_pdf_path: 'd-other/s-other-filled.pdf' },
          documents: { id: 'd-1', org_id: ORG_A },
        }],
      },
    );
    supabase.storage = { from: jest.fn(() => ({ remove })) };
    requireServiceSupabase.mockReturnValue(supabase);

    const { req, res } = createMocks({ method: 'POST', headers: { 'x-cron-secret': 'cron-test' } });
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(['d-1/s-1-filled.pdf']);
  });
});

// Release review batch 2: a refused file_url fetch answers 422 with a fixed
// message. The refusal's details (the host name, the address it resolved to,
// the URL) are logged on the server, never sent to the caller.
describe('a refused document fetch answers without its details', () => {
  const { DocumentSourceNotAllowedError } = jest.requireActual('../../lib/documentFetch');
  const BY_URL = { org_id: ORG_A, user_id: 'user-a', created_by: 'user-a', file_path: null, file_url: 'http://inside.example.com/x.pdf' };

  beforeEach(() => {
    downloadDocumentBinary.mockRejectedValue(new DocumentSourceNotAllowedError('Document hostname resolved to a private IP', {
      hostname: 'inside.example.com', ip: '10.9.8.7', url: 'http://inside.example.com/x.pdf',
    }));
  });

  function expectNoDetails(res) {
    expect(res._getStatusCode()).toBe(422);
    const body = res._getJSONData();
    expect(body.errorCode).toBe('document_source_not_allowed');
    expect(body).not.toHaveProperty('details');
    const text = JSON.stringify(body);
    expect(text).not.toContain('10.9.8.7');
    expect(text).not.toContain('inside.example.com');
    expect(text).not.toContain('private IP');
    const logged = [console.error, console.warn].flatMap((spy) => spy.mock.calls).map((args) => JSON.stringify(args.map(String)) + JSON.stringify(args)).join('\n');
    expect(logged).toContain('10.9.8.7');
  }

  async function complete(documentPath) {
    const handler = require('../../pages/api/sessions/[token]/complete').default;
    requireServiceSupabase.mockReturnValue(fakeSupabase({ fields: [{ id: 1, document_id: 'd-1', field_name: 'Name', field_type: 'text', position: {} }] }));
    validateSessionToken.mockResolvedValue({
      session: {
        id: 's-1', document_id: 'd-1', status: 'opened', metadata: {},
        documents: { id: 'd-1', file_name: 'a.pdf', file_type: 'application/pdf', ...documentPath },
      },
      error: null,
    });
    const { req, res } = createMocks({ method: 'POST', query: { token: 'tok' }, body: {}, headers: { host: 'localhost:3000' } });
    await handler(req, res);
    return res;
  }

  // complete.js fetches inside the PDF step, which never fails completion:
  // a refused file_url leaves the session without a filled PDF (as before)
  // and nothing about the refusal reaches the signer.
  it('POST /api/sessions/[token]/complete: a refused file_url is not reported to the signer', async () => {
    const res = await complete(BY_URL);
    expect(downloadDocumentBinary).toHaveBeenCalledTimes(1);
    expect(res._getStatusCode()).toBe(200);
    const text = JSON.stringify(res._getJSONData());
    expect(text).not.toContain('10.9.8.7');
    expect(text).not.toContain('inside.example.com');
  });

  it('POST /api/sessions/[token]/complete: its 422 (a file_path outside the owner folder) has no details', async () => {
    const res = await complete(FORGED_FOREIGN_ORG);
    expect(res._getStatusCode()).toBe(422);
    const body = res._getJSONData();
    expect(body.errorCode).toBe('document_source_not_allowed');
    expect(body).not.toHaveProperty('details');
    expect(JSON.stringify(body)).not.toContain('owner folder');
  });

  it('POST /api/ocr (mode full)', async () => {
    process.env.ANTHROPIC_API_KEY = 'fake';
    const row = {
      id: 'doc-a', status: 'uploaded', processing_status: 'queued', lifecycle_status: 'draft',
      file_type: 'pdf', file_name: 'a.pdf', phase1_data: null, ...BY_URL,
    };
    createClient.mockReturnValue(fakeSupabase({ documents: [row], fields: [], fill_sessions: [] }));
    const handler = require('../../pages/api/ocr').default;
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt' },
      body: { documentId: 'doc-a', userId: 'user-a', mode: 'full' },
    });
    await handler(req, res);
    expect(downloadDocumentBinary).toHaveBeenCalledTimes(1);
    expectNoDetails(res);
  });

  it('POST /api/reprocess-positions', async () => {
    const handler = require('../../pages/api/reprocess-positions').default;
    createClient.mockReturnValue(fakeSupabase({
      documents: [{ id: 'doc-a', file_type: 'pdf', file_name: 'a.pdf', ...BY_URL }],
      fields: [{ id: 1, document_id: 'doc-a', field_name: 'Name', position: null }],
    }));
    const { req, res } = createMocks({ method: 'POST', headers: { authorization: 'Bearer user-jwt' }, body: { documentId: 'doc-a' } });
    await handler(req, res);
    expect(downloadDocumentBinary).toHaveBeenCalledTimes(1);
    expectNoDetails(res);
  });
});
