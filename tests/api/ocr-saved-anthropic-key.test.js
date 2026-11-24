/**
 * POST /api/ocr takes its Anthropic key through effectiveSetting, the same way
 * lib/anthropic.js does: a non-blank host env value first, then the key saved
 * at /setup in .cosign/settings.json. With neither, full mode answers
 * 'ANTHROPIC_API_KEY not configured' and post_setup finishes without AI
 * (issue #447); neither builds a client.
 * The SDK, Supabase and auth are mocked; every test runs in its own temp
 * folder. The key values are made-up placeholders.
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

const SAVED_KEY = 'fake-saved-key-NOT-REAL-aaaaQWXZ';
const ENV_KEY = 'fake-env-key-NOT-REAL-ccccMNPR';

// Answers every query with the one document row; writes succeed.
function makeSupabase(row) {
  const from = jest.fn((table) => {
    const q = { table, op: null, filters: {} };
    const run = () => {
      if (q.op && q.op !== 'select') return { data: null, error: null };
      if (table !== 'documents') return { data: [], error: null };
      if (q.filters.id !== row.id) return { data: null, error: { message: 'not found' } };
      return { data: { ...row }, error: null };
    };
    const builder = {
      select: () => { if (!q.op) q.op = 'select'; return builder; },
      update: () => { q.op = 'update'; return builder; },
      insert: () => { q.op = 'insert'; return builder; },
      upsert: () => { q.op = 'upsert'; return builder; },
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
const savedEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OCR_PROVIDER;
  delete process.env.CRON_SECRET;
  delete process.env.PROCESS_OCR_CRON_SECRET;
  process.env.OCR_RESUMABLE_ENABLED = 'false';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-ocr-key-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  const { createClient } = require('@supabase/supabase-js');
  createClient.mockReturnValue(makeSupabase({
    id: 'doc-a',
    org_id: 'org-a',
    status: 'ready',
    processing_status: 'idle',
    lifecycle_status: 'setup_required',
    file_url: 'org-a/doc-a.pdf',
    phase1_data: null,
  }));
  const auth = require('../../lib/auth');
  auth.requireBearerUser.mockResolvedValue({ user: { id: 'user-a' } });
  auth.requireOrgMembership.mockResolvedValue({ orgId: 'org-a' });
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

function writeSaved(values) {
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify(values));
}

async function post(mode = 'post_setup') {
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

describe('/api/ocr Anthropic key', () => {
  it('uses the key saved at /setup when the host has none', async () => {
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });

    const res = await post();

    const body = res._getData() ? res._getJSONData() : {};
    expect(body.error).not.toBe('ANTHROPIC_API_KEY not configured');
    expect(builtKeys()).toEqual([SAVED_KEY]);
  });

  it('uses the host key over a saved one', async () => {
    writeSaved({ ANTHROPIC_API_KEY: SAVED_KEY });
    process.env.ANTHROPIC_API_KEY = ENV_KEY;

    const res = await post();

    const body = res._getData() ? res._getJSONData() : {};
    expect(body.error).not.toBe('ANTHROPIC_API_KEY not configured');
    expect(builtKeys()).toEqual([ENV_KEY]);
  });

  it('answers not configured and builds no client when neither has a key (full mode)', async () => {
    // issue #447: post_setup now finishes without a key, so the refusal is checked on full mode.
    const res = await post('full');

    expect(res._getStatusCode()).toBe(500);
    expect(res._getJSONData()).toEqual({ error: 'ANTHROPIC_API_KEY not configured' });
    expect(builtKeys()).toEqual([]);
  });

  it('finishes post_setup and builds no client when neither has a key', async () => {
    const res = await post();

    // issue #447: post_setup with no key answers 200 (was 500 'ANTHROPIC_API_KEY not configured').
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData().metadata).toEqual({ no_fields_reason: 'no_ai_key' });
    expect(builtKeys()).toEqual([]);
  });
});
