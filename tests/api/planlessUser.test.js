/**
 * A document owner whose org has no plan record can translate a document into
 * as many languages as they like: no plan lookup, no 402.
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
    messages: {
      create: jest.fn(async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify([
            { field_name: 'Nome', explanation: 'Seu nome', position_hint: 'topo' },
            { field_name: 'Data', explanation: 'Data de hoje', position_hint: 'fim' },
          ]),
        }],
      })),
    },
  })),
}));

// Two fields already translated into three non-English languages (vi, es, fr).
function makeFields() {
  const base = (id, order) => ({
    id,
    document_id: 'doc-a',
    sort_order: order,
    field_name: `Field ${order}`,
    explanation: 'An explanation',
    position_hint: 'top',
    field_name_vi: 'Tên',
    field_name_es: 'Nombre',
    field_name_fr: 'Nom',
  });
  return [base('f1', 1), base('f2', 2)];
}

// In-memory Supabase: documents and fields rows, an organizations table with
// no row for the caller's org, and a log of every executed query.
function makeSupabase(state) {
  const from = jest.fn((table) => {
    const q = { table, op: null, cols: null, filters: {}, payload: null };
    const run = () => {
      state.calls.push(q);
      if (table === 'documents') {
        if (q.filters.id === 'doc-a' && q.filters.org_id === 'org-a') {
          return { data: { id: 'doc-a', org_id: 'org-a', preferred_language: 'en' }, error: null };
        }
        return { data: null, error: { message: 'not found' } };
      }
      if (table === 'organizations') {
        return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      }
      if (table === 'fields') {
        if (q.op === 'update') {
          const row = state.fields.find((f) => f.id === q.filters.id);
          if (row) Object.assign(row, q.payload);
          return { data: null, error: null };
        }
        return { data: state.fields.filter((f) => f.document_id === q.filters.document_id).map((f) => ({ ...f })), error: null };
      }
      return { data: null, error: null };
    };
    const builder = {
      select: (cols) => { q.op = q.op || 'select'; q.cols = cols; return builder; },
      update: (payload) => { q.op = 'update'; q.payload = payload; return builder; },
      eq: (col, val) => { q.filters[col] = val; return builder; },
      order: () => builder,
      single: async () => run(),
      maybeSingle: async () => run(),
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  });
  return { from, auth: { getUser: jest.fn() } };
}

function setup() {
  const state = { calls: [], fields: makeFields() };
  const { createClient } = require('@supabase/supabase-js');
  createClient.mockReturnValue(makeSupabase(state));
  const auth = require('../../lib/auth');
  auth.requireBearerUser.mockResolvedValue({ user: { id: 'user-a' } });
  auth.requireOrgMembership.mockResolvedValue({ orgId: 'org-a' });
  return state;
}

async function translate(language) {
  const handler = require('../../pages/api/documents/[id]/translate').default;
  const { req, res } = createMocks({
    method: 'POST',
    headers: { authorization: 'Bearer user-jwt' },
    query: { id: 'doc-a' },
    body: { language },
  });
  await handler(req, res);
  return res;
}

describe('POST /api/documents/[id]/translate for an org with no plan record', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-placeholder-key';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  it('adds a 4th and a 5th non-English language with 200 each, never 402', async () => {
    const state = setup();

    const fourth = await translate('pt');
    expect(fourth._getStatusCode()).toBe(200);
    expect(fourth._getJSONData().languages.sort()).toEqual(['es', 'fr', 'pt', 'vi']);

    const fifth = await translate('ne');
    expect(fifth._getStatusCode()).toBe(200);
    expect(fifth._getJSONData().languages.sort()).toEqual(['es', 'fr', 'ne', 'pt', 'vi']);

    // Both languages were written to the document's fields.
    expect(state.fields[0].field_name_pt).toBe('Nome');
    expect(state.fields[1].field_name_ne).toBe('Data');
  });

  it('never selects subscription_plan', async () => {
    const state = setup();

    await translate('pt');
    await translate('ne');

    const planSelects = state.calls.filter(
      (c) => c.table === 'organizations' || String(c.cols || '').includes('subscription_plan')
    );
    expect(planSelects).toEqual([]);
  });
});
