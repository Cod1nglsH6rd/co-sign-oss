/**
 * POST /api/ocr must confirm the document belongs to the caller's org before
 * it writes anything (progress, status, metadata) to that document.
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

// setupCompleted + no fields: post_setup runs to a 200 "no_fields_to_enrich"
// answer without touching storage or Anthropic.
const ROWS = {
  'doc-a': { id: 'doc-a', org_id: 'org-a', phase1_data: { setupCompleted: true } },
  'doc-b': { id: 'doc-b', org_id: 'org-b', phase1_data: { setupCompleted: true } },
};

// Records every query in the order it is executed (awaited):
// { table, op: 'select' | 'update', filters, payload }.
function makeSupabase(calls) {
  const from = jest.fn((table) => {
    const q = { table, op: null, filters: {}, payload: null };
    const run = () => {
      calls.push(q);
      if (q.op === 'update') return { data: null, error: null };
      if (table !== 'documents') return { data: [], error: null };
      const row = ROWS[q.filters.id];
      if (!row || (q.filters.org_id !== undefined && q.filters.org_id !== row.org_id)) {
        return { data: null, error: { message: 'not found' } };
      }
      return { data: row, error: null };
    };
    const builder = {
      select: (cols) => { q.op = 'select'; q.cols = cols; return builder; },
      update: (payload) => { q.op = 'update'; q.payload = payload; return builder; },
      eq: (col, val) => { q.filters[col] = val; return builder; },
      order: () => builder,
      single: async () => run(),
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  });
  return { from, auth: { getUser: jest.fn() } };
}

function setup() {
  const calls = [];
  const { createClient } = require('@supabase/supabase-js');
  createClient.mockReturnValue(makeSupabase(calls));
  const auth = require('../../lib/auth');
  auth.requireBearerUser.mockResolvedValue({ user: { id: 'user-a' } });
  auth.requireOrgMembership.mockResolvedValue({ orgId: 'org-a' });
  return { calls, auth };
}

async function post(body, headers = { authorization: 'Bearer user-jwt' }) {
  const handler = require('../../pages/api/ocr').default;
  const { req, res } = createMocks({ method: 'POST', headers, body });
  await handler(req, res);
  return res;
}

const isDocUpdate = (c) => c.table === 'documents' && c.op === 'update';
const isScopedSelect = (id, orgId) => (c) => c.table === 'documents' && c.op === 'select'
  && c.filters.id === id && c.filters.org_id === orgId;

describe('/api/ocr document ownership', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-placeholder-key';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    delete process.env.CRON_SECRET;
    delete process.env.PROCESS_OCR_CRON_SECRET;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  it.each(['full', 'pre_setup', 'post_setup'])(
    'answers 404 and never updates a document from another org (mode %s)',
    async (mode) => {
      const { calls } = setup();

      const res = await post({ documentId: 'doc-b', userId: 'user-a', mode });

      expect(res._getStatusCode()).toBe(404);
      // The 404 comes from the lookup scoped to the caller's org.
      expect(calls.some(isScopedSelect('doc-b', 'org-a'))).toBe(true);
      expect(calls.filter(isDocUpdate)).toHaveLength(0);
    }
  );

  it('loads the document scoped to the caller org before the first documents update', async () => {
    const { calls } = setup();

    const res = await post({ documentId: 'doc-a', userId: 'user-a', mode: 'post_setup' });

    expect(res._getStatusCode()).toBe(200);
    const scopedSelect = calls.findIndex(isScopedSelect('doc-a', 'org-a'));
    const firstUpdate = calls.findIndex(isDocUpdate);
    expect(scopedSelect).toBeGreaterThanOrEqual(0);
    expect(firstUpdate).toBeGreaterThanOrEqual(0);
    expect(scopedSelect).toBeLessThan(firstUpdate);
    // The run still starts by writing its progress to the caller's document.
    expect(calls[firstUpdate].filters).toEqual({ id: 'doc-a' });
    expect(calls[firstUpdate].payload).toMatchObject({
      processing_status: 'finalizing',
      metadata: { post_setup: true, processing_step: 0 },
    });
  });

  it('cron-authorized requests resolve the org from the document row and proceed', async () => {
    const { calls, auth } = setup();
    process.env.CRON_SECRET = 'cron-secret';

    const res = await post(
      { documentId: 'doc-b', userId: 'cron', mode: 'post_setup' },
      { authorization: 'Bearer cron-secret' }
    );

    // No user auth on the cron path; the caller's own org (org-a) plays no part.
    expect(auth.requireBearerUser).not.toHaveBeenCalled();
    expect(auth.requireOrgMembership).not.toHaveBeenCalled();

    // First an id-only lookup of the row's org, then the lookup scoped to it.
    const docSelects = calls.filter((c) => c.table === 'documents' && c.op === 'select');
    expect(docSelects[0].filters).toEqual({ id: 'doc-b' });
    expect(docSelects[1].filters).toEqual({ id: 'doc-b', org_id: 'org-b' });

    // It proceeds through the pipeline to a finished post-setup run.
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toMatchObject({ success: true, fieldsCount: 0 });
    expect(calls.some((c) => c.table === 'fields' && c.filters.document_id === 'doc-b')).toBe(true);
    const updates = calls.filter(isDocUpdate);
    expect(updates.map((u) => u.payload.processing_status)).toEqual(['finalizing', 'idle']);
    expect(updates.every((u) => u.filters.id === 'doc-b')).toBe(true);
  });
});
