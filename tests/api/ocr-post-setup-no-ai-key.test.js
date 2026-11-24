/**
 * POST /api/ocr in post_setup mode with no Anthropic key anywhere (no host env
 * value, nothing saved at /setup) and the provider not stub (#447): after
 * "Save & continue" the document must not stay on 'finalizing'. Like pre_setup
 * (#391) it answers 200, leaves processing_status 'idle' and merges the reason
 * 'no_ai_key' into the document metadata, next to its other keys.
 * A key saved at /setup still takes the normal post_setup path.
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

const SAVED_KEY = 'fake-saved-key-NOT-REAL-ddddHJKW';

// Records every query as it is awaited and applies documents updates to the row.
function makeSupabase(calls, row) {
  const from = jest.fn((table) => {
    const q = { table, op: null, filters: {}, payload: null };
    const run = () => {
      calls.push(q);
      if (q.op === 'update') {
        if (table === 'documents' && q.filters.id === row.id) Object.assign(row, q.payload);
        return { data: null, error: null };
      }
      if (q.op === 'insert' || q.op === 'delete' || q.op === 'upsert') return { data: null, error: null };
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
const savedEnv = { ...process.env };

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
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-ocr-post-nokey-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  calls = [];
  // A document whose setup was just saved ("Save & continue").
  row = {
    id: 'doc-a',
    org_id: 'org-a',
    status: 'uploaded',
    processing_status: 'idle',
    lifecycle_status: 'setup_required',
    file_url: 'org-a/doc-a.pdf',
    phase1_data: { setupCompleted: true },
    metadata: { source: 'upload', page_count: 3 },
  };
  const { createClient } = require('@supabase/supabase-js');
  createClient.mockReturnValue(makeSupabase(calls, row));
  const auth = require('../../lib/auth');
  auth.requireBearerUser.mockResolvedValue({ user: { id: 'user-a' } });
  auth.requireOrgMembership.mockResolvedValue({ orgId: 'org-a' });
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

async function post() {
  const handler = require('../../pages/api/ocr').default;
  const { req, res } = createMocks({
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt' },
    body: { documentId: 'doc-a', userId: 'user-a', mode: 'post_setup' },
  });
  await handler(req, res);
  return res;
}

function builtKeys() {
  const Anthropic = require('@anthropic-ai/sdk').default;
  return Anthropic.mock.calls.map((args) => args[0] && args[0].apiKey);
}

function wroteNoAiKeyReason() {
  return calls.some((c) => c.table === 'documents' && c.op === 'update'
    && c.payload && c.payload.metadata && c.payload.metadata.no_fields_reason === 'no_ai_key');
}

describe('/api/ocr post_setup with no AI key', () => {
  it('answers 200 instead of a 500', async () => {
    const res = await post();

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().success).toBe(true);
  });

  it('leaves the document idle, not stuck on finalizing', async () => {
    await post();

    expect(row.processing_status).toBe('idle');
    expect(wroteNoAiKeyReason()).toBe(true);
  });

  it("merges 'no_ai_key' into the existing metadata, keeping every other key", async () => {
    await post();

    expect(row.metadata).toEqual({ source: 'upload', page_count: 3, no_fields_reason: 'no_ai_key' });
  });

  it('records the reason when the document had no metadata', async () => {
    row.metadata = null;

    await post();

    expect(row.metadata).toEqual({ no_fields_reason: 'no_ai_key' });
  });

  it('never constructs the Anthropic client', async () => {
    const res = await post();

    expect(res._getStatusCode()).toBe(200);
    expect(builtKeys()).toEqual([]);
  });

  it('with a key saved at /setup, takes the normal post_setup path', async () => {
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });

    await post();

    expect(builtKeys()).toEqual([SAVED_KEY]);
    expect(wroteNoAiKeyReason()).toBe(false);
    const finalizing = calls.some((c) => c.table === 'documents' && c.op === 'update'
      && c.payload && c.payload.processing_status === 'finalizing');
    expect(finalizing).toBe(true);
  });
});
