/**
 * POST /api/ocr in pre_setup mode with no Anthropic key anywhere (no host env
 * value, nothing saved at /setup) and the provider not stub (#391): the
 * document still finishes, with zero fields, so the setup screen opens; the
 * reason is kept as 'no_ai_key' in the document metadata, next to its other keys.
 * A key saved at /setup still takes the normal provider path.
 * The SDK, Supabase and auth are mocked; every test runs in its own temp folder.
 * The key value is a made-up placeholder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMocks } = require('node-mocks-http');

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('../../lib/auth', () => ({
  requireBearerUser: jest.fn(),
  requireOrgMembership: jest.fn(),
  requestedOrgId: jest.fn(() => null),
}));
jest.mock('../../lib/rateLimit', () => ({ rateLimitAuth: jest.fn(async () => false) }));
jest.mock('@anthropic-ai/sdk', () => {
  const Anthropic = jest.fn(function Anthropic(options) {
    this.apiKey = options.apiKey;
    this.messages = {
      create: jest.fn(async () => { throw new Error('no AI call in this test'); }),
    };
  });
  return { __esModule: true, default: Anthropic };
});

const SAVED_KEY = 'fake-saved-key-NOT-REAL-bbbbKLTV';

// Records every query as it is awaited and applies documents updates to the row.
// fieldRows are the fields already saved for documents (by document_id).
// With failMetadataUpdate, a documents update that carries metadata errors.
function makeSupabase(calls, row, fieldRows, { failMetadataUpdate = false } = {}) {
  const from = jest.fn((table) => {
    const q = { table, op: null, filters: {}, payload: null };
    const run = () => {
      calls.push(q);
      if (q.op === 'update') {
        if (table === 'documents' && failMetadataUpdate && 'metadata' in q.payload) {
          return { data: null, error: { message: 'update failed' } };
        }
        if (table === 'documents' && q.filters.id === row.id) Object.assign(row, q.payload);
        return { data: null, error: null };
      }
      if (q.op === 'insert' || q.op === 'delete' || q.op === 'upsert') return { data: null, error: null };
      if (table === 'fields') {
        const data = fieldRows.filter((f) => q.filters.document_id === undefined || f.document_id === q.filters.document_id);
        return { data: JSON.parse(JSON.stringify(data)), error: null };
      }
      if (table !== 'documents') return { data: [], error: null };
      if (q.filters.id !== row.id || (q.filters.org_id !== undefined && q.filters.org_id !== row.org_id)) {
        return { data: null, error: { message: 'not found' } };
      }
      return { data: JSON.parse(JSON.stringify(row)), error: null };
    };
    const builder = {
      select: (cols) => { if (!q.op) q.op = 'select'; q.cols = cols; return builder; },
      update: (payload) => { q.op = 'update'; q.payload = payload; return builder; },
      insert: (payload) => { q.op = 'insert'; q.payload = payload; return builder; },
      upsert: (payload) => { q.op = 'upsert'; q.payload = payload; return builder; },
      delete: () => { q.op = 'delete'; return builder; },
      eq: (col, val) => { q.filters[col] = val; return builder; },
      in: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => builder,
      single: async () => run(),
      maybeSingle: async () => run(),
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  });
  return { from, auth: { getUser: jest.fn() }, storage: { from: jest.fn() } };
}

let cwd;
let calls;
let row;
let fieldRows;
const savedEnv = { ...process.env };

function useSupabase(options) {
  const { createClient } = require('@supabase/supabase-js');
  createClient.mockReturnValue(makeSupabase(calls, row, fieldRows, options));
}

function writeSaved(values) {
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify(values));
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OCR_PROVIDER;
  delete process.env.CRON_SECRET;
  delete process.env.PROCESS_OCR_CRON_SECRET;
  process.env.OCR_RESUMABLE_ENABLED = 'false';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  // An empty folder: no .cosign/settings.json, so no saved key either.
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-ocr-nokey-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  calls = [];
  fieldRows = [];
  row = {
    id: 'doc-a',
    org_id: 'org-a',
    status: 'uploaded',
    processing_status: 'queued',
    lifecycle_status: 'draft',
    file_url: 'org-a/doc-a.pdf',
    phase1_data: null,
    metadata: null,
  };
  useSupabase();
  const auth = require('../../lib/auth');
  auth.requireBearerUser.mockResolvedValue({ user: { id: 'user-a' } });
  auth.requireOrgMembership.mockResolvedValue({ orgId: 'org-a' });
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

async function post(mode) {
  const handler = require('../../pages/api/ocr').default;
  const { req, res } = createMocks({
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt' },
    body: { documentId: 'doc-a', userId: 'user-a', mode },
  });
  await handler(req, res);
  return res;
}

function builtKeys() {
  const Anthropic = require('@anthropic-ai/sdk').default;
  return Anthropic.mock.calls.map((args) => args[0] && args[0].apiKey);
}

describe('/api/ocr pre_setup with no AI key', () => {
  it('answers success with zero fields instead of a 500', async () => {
    const res = await post('pre_setup');

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toMatchObject({ success: true, fields: [], fieldsCount: 0 });
  });

  it('saves no fields and builds no Anthropic client', async () => {
    await post('pre_setup');

    const writes = calls.filter((c) => c.table === 'fields' && ['insert', 'upsert', 'delete', 'update'].includes(c.op));
    expect(writes).toEqual([]);
    expect(builtKeys()).toEqual([]);
  });

  it('leaves the document on the setup screen, not stuck processing', async () => {
    await post('pre_setup');

    expect(row.status).toBe('uploaded');
    expect(row.processing_status).toBe('idle');
    expect(row.lifecycle_status).toBe('setup_required');
  });

  it("records 'no_ai_key' as the reason in the document metadata", async () => {
    await post('pre_setup');

    expect(row.metadata).toEqual({ no_fields_reason: 'no_ai_key' });
  });

  it('keeps the metadata keys the document already had', async () => {
    row.metadata = { source: 'upload', page_count: 3 };

    await post('pre_setup');

    expect(row.metadata).toEqual({ source: 'upload', page_count: 3, no_fields_reason: 'no_ai_key' });
  });

  it('answers with the merged metadata the document now has', async () => {
    row.metadata = { source: 'upload', page_count: 3 };

    const res = await post('pre_setup');

    expect(res._getJSONData().metadata).toEqual({ source: 'upload', page_count: 3, no_fields_reason: 'no_ai_key' });
  });

  it('on a retry, answers with the fields the document already has and keeps them', async () => {
    fieldRows = [
      { id: 'f-1', document_id: 'doc-a', field_name: 'Name', field_value: 'Ada' },
      { id: 'f-9', document_id: 'doc-other', field_name: 'Other', field_value: null },
    ];
    useSupabase();

    const res = await post('pre_setup');

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toMatchObject({
      success: true,
      fields: [{ id: 'f-1', document_id: 'doc-a', field_name: 'Name', field_value: 'Ada' }],
      fieldsCount: 1,
    });
    const writes = calls.filter((c) => c.table === 'fields' && ['insert', 'upsert', 'delete', 'update'].includes(c.op));
    expect(writes).toEqual([]);
  });

  it('does not report success when the reason cannot be saved', async () => {
    useSupabase({ failMetadataUpdate: true });

    const res = await post('pre_setup');

    const tried = calls.some((c) => c.table === 'documents' && c.op === 'update'
      && c.payload.metadata && c.payload.metadata.no_fields_reason === 'no_ai_key');
    expect(tried).toBe(true);
    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData().success).not.toBe(true);
    // No fallback write finishes the document without the reason.
    expect(row.lifecycle_status).toBe('draft');
  });

  it('only touches a document in the caller org', async () => {
    const auth = require('../../lib/auth');
    auth.requireOrgMembership.mockResolvedValue({ orgId: 'org-b' });

    const res = await post('pre_setup');

    expect(res._getStatusCode()).toBe(404);
    expect(row.lifecycle_status).toBe('draft');
    expect(row.metadata).toBeNull();
  });

  it('still answers not configured outside pre_setup', async () => {
    const res = await post('full');

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'ANTHROPIC_API_KEY not configured' });
    expect(row.lifecycle_status).toBe('draft');
  });

  it('with a key saved at /setup, takes the normal provider path instead', async () => {
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });

    const res = await post('pre_setup');

    expect(builtKeys()).toEqual([SAVED_KEY]);
    const wroteReason = calls.some((c) => c.table === 'documents' && c.op === 'update'
      && c.payload && c.payload.metadata && c.payload.metadata.no_fields_reason === 'no_ai_key');
    expect(wroteReason).toBe(false);
    const body = res._getData() ? res._getJSONData() : {};
    expect(body.metadata && body.metadata.no_fields_reason).toBeUndefined();
  });
});
