/**
 * POST /api/ocr in pre_setup mode with OCR_PROVIDER=stub (#389): no Anthropic
 * key needed, no SDK built, the fixed stub fields saved, and the document left
 * where a finished real pre_setup run leaves it.
 */

import { createMocks } from 'node-mocks-http';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('../../lib/auth', () => ({
  requireBearerUser: jest.fn(),
  requireOrgMembership: jest.fn(),
  requestedOrgId: jest.fn(() => null),
}));
jest.mock('../../lib/rateLimit', () => ({ rateLimitAuth: jest.fn(async () => false) }));
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn(async () => { throw new Error('Anthropic must not be called'); }) },
  })),
}));

// Records every query as it is awaited and applies documents updates to the row,
// so the test can read the document's state after the run.
function makeSupabase(calls, row) {
  const from = jest.fn((table) => {
    const q = { table, op: null, filters: {}, payload: null };
    const run = () => {
      calls.push(q);
      if (q.op === 'update') {
        if (table === 'documents' && q.filters.id === row.id) Object.assign(row, q.payload);
        return { data: null, error: null };
      }
      if (q.op === 'insert' || q.op === 'delete') return { data: null, error: null };
      if (table !== 'documents') return { data: [], error: null };
      if (q.filters.id !== row.id || (q.filters.org_id !== undefined && q.filters.org_id !== row.org_id)) {
        return { data: null, error: { message: 'not found' } };
      }
      return { data: { ...row }, error: null };
    };
    const builder = {
      select: (cols) => { if (!q.op) q.op = 'select'; q.cols = cols; return builder; },
      update: (payload) => { q.op = 'update'; q.payload = payload; return builder; },
      insert: (payload) => { q.op = 'insert'; q.payload = payload; return builder; },
      delete: () => { q.op = 'delete'; return builder; },
      eq: (col, val) => { q.filters[col] = val; return builder; },
      not: () => builder,
      order: () => builder,
      single: async () => run(),
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  });
  return { from, auth: { getUser: jest.fn() }, storage: { from: jest.fn() } };
}

function setup() {
  const calls = [];
  const row = {
    id: 'doc-a',
    org_id: 'org-a',
    status: 'uploaded',
    processing_status: 'queued',
    lifecycle_status: 'draft',
    file_url: 'org-a/doc-a.pdf',
    phase1_data: null,
  };
  const { createClient } = require('@supabase/supabase-js');
  createClient.mockReturnValue(makeSupabase(calls, row));
  const auth = require('../../lib/auth');
  auth.requireBearerUser.mockResolvedValue({ user: { id: 'user-a' } });
  auth.requireOrgMembership.mockResolvedValue({ orgId: 'org-a' });
  return { calls, row };
}

async function post(body) {
  const handler = require('../../pages/api/ocr').default;
  const { req, res } = createMocks({
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt' },
    body,
  });
  await handler(req, res);
  return res;
}

describe('/api/ocr with OCR_PROVIDER=stub (pre_setup)', () => {
  const savedEnv = { ...process.env };
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OCR_PROVIDER = 'stub';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    delete process.env.CRON_SECRET;
    delete process.env.PROCESS_OCR_CRON_SECRET;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  it('answers success without an Anthropic key', async () => {
    setup();

    const res = await post({ documentId: 'doc-a', userId: 'user-a', mode: 'pre_setup' });

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toMatchObject({ success: true, fieldsCount: 2 });
  });

  it('finishes the run without ever constructing the Anthropic SDK', async () => {
    setup();

    const res = await post({ documentId: 'doc-a', userId: 'user-a', mode: 'pre_setup' });

    expect(res._getStatusCode()).toBe(200);
    const Anthropic = require('@anthropic-ai/sdk').default;
    expect(Anthropic).not.toHaveBeenCalled();
  });

  it('inserts the fixed stub fields for the document', async () => {
    const { calls } = setup();

    await post({ documentId: 'doc-a', userId: 'user-a', mode: 'pre_setup' });

    const inserts = calls.filter((c) => c.table === 'fields' && c.op === 'insert');
    expect(inserts).toHaveLength(1);
    const rows = inserts[0].payload;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      document_id: 'doc-a',
      field_name: 'Full name',
      field_type: 'text',
      position: { page: 1, x: 10, y: 20, width: 40, height: 4, source: 'stub' },
    });
    expect(rows[1]).toMatchObject({
      document_id: 'doc-a',
      field_name: 'Signature',
      field_type: 'signature',
      position: { page: 1, x: 10, y: 80, width: 40, height: 6, source: 'stub' },
    });
  });

  it('leaves the document where a finished real pre_setup run does', async () => {
    const { row } = setup();

    await post({ documentId: 'doc-a', userId: 'user-a', mode: 'pre_setup' });

    // A real pre_setup run never touches status, ends with processing_status
    // 'idle', lifecycle_status 'setup_required' and the progress metadata cleared.
    expect(row.status).toBe('uploaded');
    expect(row.processing_status).toBe('idle');
    expect(row.lifecycle_status).toBe('setup_required');
    expect(row.metadata).toBeNull();
  });

  it('logs one line saying the stub ran', async () => {
    setup();

    await post({ documentId: 'doc-a', userId: 'user-a', mode: 'pre_setup' });

    const stubLines = logSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && /stub/i.test(args[0])
    );
    expect(stubLines).toHaveLength(1);
  });
});
