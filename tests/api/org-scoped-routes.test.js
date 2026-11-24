/**
 * Org-scoped routes must act on the org the caller selected (X-Org-Id) when
 * they are an active member of it, and otherwise fall back to their default
 * membership exactly as lib/auth.js requireOrgMembership does.
 */

import { createMocks } from 'node-mocks-http';
import { createClient } from '@supabase/supabase-js';
import archiveHandler from '../../pages/api/documents/[id]/archive';
import restoreHandler from '../../pages/api/documents/[id]/restore';
import sessionsHandler from '../../pages/api/documents/[id]/sessions';
import duplicateHandler from '../../pages/api/enterprise/templates/duplicate';
import createSessionHandler from '../../pages/api/sessions/create';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ORG_C = '33333333-3333-4333-8333-333333333333';

// Membership rows per user, in the order Postgres happens to return them.
const MEMBERSHIPS = {
  'user-multi': [
    { org_id: ORG_A, role: 'member', status: 'active' },
    { org_id: ORG_B, role: 'admin', status: 'active' },
  ],
  'user-single': [{ org_id: ORG_A, role: 'admin', status: 'active' }],
};

// file_path sits in the owning organisation's folder, as uploads store it:
// templates/duplicate now refuses to copy a path outside that folder (it was
// 'a/A.pdf' and 'b/B.pdf', which the route would now refuse with 403).
const DOCS = {
  'doc-a': { id: 'doc-a', org_id: ORG_A, file_name: 'A.pdf', file_path: `${ORG_A}/A.pdf`, phase1_data: { setupCompleted: true } },
  'doc-b': { id: 'doc-b', org_id: ORG_B, file_name: 'B.pdf', file_path: `${ORG_B}/B.pdf`, phase1_data: { setupCompleted: true } },
};

// A fake Supabase client that records every executed query:
// { table, op, filters, single }.
function makeSupabase(userId, calls) {
  const from = (table) => {
    const q = { table, op: 'select', filters: {}, payload: null };
    const run = (mode) => {
      q.mode = mode;
      calls.push(q);
      if (table === 'org_memberships') {
        const rows = (MEMBERSHIPS[q.filters.user_id] || []).filter((m) =>
          (q.filters.status === undefined || m.status === q.filters.status)
          && (q.filters.org_id === undefined || m.org_id === q.filters.org_id));
        if (mode === 'maybeSingle') return { data: rows[0] || null, error: null };
        if (rows.length === 0) return { data: null, error: { message: 'no rows' } };
        return { data: rows[0], error: null };
      }
      if (table === 'documents') {
        const row = DOCS[q.filters.id];
        if (!row || (q.filters.org_id !== undefined && q.filters.org_id !== row.org_id)) {
          return { data: null, error: { message: 'not found' } };
        }
        if (q.op === 'update') return { data: { ...row, ...q.payload }, error: null };
        return { data: row, error: null };
      }
      if (mode === 'single') return { data: null, error: null };
      return { data: [], error: null, count: 0 };
    };
    const builder = {
      select: () => builder,
      update: (payload) => { q.op = 'update'; q.payload = payload; return builder; },
      eq: (col, val) => { q.filters[col] = val; return builder; },
      in: () => builder,
      order: () => builder,
      range: () => builder,
      limit: () => builder,
      single: async () => run('single'),
      maybeSingle: async () => run('maybeSingle'),
      then: (resolve, reject) => Promise.resolve().then(() => run('many')).then(resolve, reject),
    };
    return builder;
  };
  return {
    from,
    auth: {
      getUser: async () => ({ data: { user: { id: userId, email: `${userId}@example.com` } }, error: null }),
    },
    storage: {
      from: () => ({
        copy: async () => ({ error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/x' }, error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    rpc: jest.fn(async () => ({ data: { documentId: 'new-doc', fileName: 'Copy.pdf' }, error: null })),
  };
}

const ROUTES = [
  {
    name: 'POST /api/documents/[id]/archive',
    call: (docId, headers) => ({ handler: archiveHandler, method: 'POST', headers, query: { id: docId } }),
    okStatus: 200,
  },
  {
    name: 'POST /api/documents/[id]/restore',
    call: (docId, headers) => ({ handler: restoreHandler, method: 'POST', headers, query: { id: docId } }),
    okStatus: 200,
  },
  {
    name: 'GET /api/documents/[id]/sessions',
    call: (docId, headers) => ({ handler: sessionsHandler, method: 'GET', headers, query: { id: docId } }),
    okStatus: 200,
  },
  {
    name: 'POST /api/enterprise/templates/duplicate',
    call: (docId, headers) => ({
      handler: duplicateHandler, method: 'POST', headers, body: { templateId: docId, newName: 'Copy' },
    }),
    okStatus: 201,
  },
  {
    // The fake document has no fields, so a create that found the document
    // stops at the "no extracted fields" 400 (a 404 means it was not found).
    name: 'POST /api/sessions/create',
    call: (docId, headers) => ({
      handler: createSessionHandler, method: 'POST', headers, body: { documentId: docId, sendMethod: 'link' },
    }),
    okStatus: 400,
  },
];

async function invoke(route, userId, docId, extraHeaders = {}) {
  const calls = [];
  const supabase = makeSupabase(userId, calls);
  createClient.mockReturnValue(supabase);
  const { handler, method, headers, query, body } = route.call(docId, {
    authorization: 'Bearer user-jwt',
    ...extraHeaders,
  });
  const { req, res } = createMocks({ method, headers, query, body });
  await handler(req, res);
  return { res, calls, supabase };
}

const documentLookups = (calls) => calls.filter((c) => c.table === 'documents' && c.op === 'select');

describe.each(ROUTES)('$name org selection', (route) => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('acts on org B for a user in orgs A and B who sends X-Org-Id: B', async () => {
    const { res, calls } = await invoke(route, 'user-multi', 'doc-b', { 'x-org-id': ORG_B });

    expect(res._getStatusCode()).toBe(route.okStatus);
    const lookups = documentLookups(calls);
    expect(lookups.length).toBeGreaterThan(0);
    expect(lookups[0].filters).toEqual({ id: 'doc-b', org_id: ORG_B });
  });

  it('uses the only membership for a single-org user without the header', async () => {
    const { res, calls } = await invoke(route, 'user-single', 'doc-a');

    expect(res._getStatusCode()).toBe(route.okStatus);
    expect(documentLookups(calls)[0].filters).toEqual({ id: 'doc-a', org_id: ORG_A });
  });

  it('falls back to the default membership when X-Org-Id names an org the user is not in', async () => {
    const { res, calls } = await invoke(route, 'user-multi', 'doc-b', { 'x-org-id': ORG_C });

    // The default membership is org A, so org B's document stays out of reach.
    expect(res._getStatusCode()).toBe(404);
    expect(documentLookups(calls)[0].filters).toEqual({ id: 'doc-b', org_id: ORG_A });
  });

  it('answers 403 when the user has no active membership', async () => {
    const { res, calls } = await invoke(route, 'user-none', 'doc-a', { 'x-org-id': ORG_A });

    expect(res._getStatusCode()).toBe(403);
    expect(res._getJSONData()).toEqual({ error: 'User is not a member of any organization' });
    expect(documentLookups(calls)).toHaveLength(0);
  });
});

describe('POST /api/enterprise/templates/duplicate under the selected org', () => {
  it('copies the template into org B storage and creates the copy in org B', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { res, supabase } = await invoke(ROUTES[3], 'user-multi', 'doc-b', { 'x-org-id': ORG_B });

    expect(res._getStatusCode()).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith('enterprise_duplicate_template_tx', expect.objectContaining({
      p_template_id: 'doc-b',
      p_org_id: ORG_B,
      p_user_id: 'user-multi',
    }));
    expect(supabase.rpc.mock.calls[0][1].p_new_file_path.startsWith(`${ORG_B}/`)).toBe(true);
    jest.restoreAllMocks();
  });
});
