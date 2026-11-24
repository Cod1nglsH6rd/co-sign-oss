/**
 * POST /api/account/update renames the org and returns { id, name } only:
 * it no longer selects or returns the organization's plan.
 */

import { createMocks } from 'node-mocks-http';

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));

// In-memory Supabase: an active admin membership for user-1 on org-a, and an
// organizations row that still has a plan column. Records every select string.
function makeSupabase(selects) {
  const orgRow = { id: 'org-a', name: 'Old Name', plan: 'pro' };
  return {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
    from: jest.fn((table) => {
      const q = { table, op: 'select', cols: null, filters: {}, payload: null };
      const builder = {
        select(cols) { q.cols = cols; selects.push({ table, cols }); return builder; },
        update(payload) { q.op = 'update'; q.payload = payload; return builder; },
        eq(col, val) { q.filters[col] = val; return builder; },
        async single() {
          if (table === 'org_memberships') {
            if (q.filters.org_id === 'org-a' && q.filters.user_id === 'user-1') {
              return { data: { role: 'admin', status: 'active' }, error: null };
            }
            return { data: null, error: { message: 'not found' } };
          }
          if (table === 'organizations' && q.op === 'update' && q.filters.id === 'org-a') {
            const updated = { ...orgRow, ...q.payload };
            const cols = (q.cols || '*').split(',').map((c) => c.trim());
            const row = cols.includes('*')
              ? updated
              : Object.fromEntries(cols.map((c) => [c, updated[c]]));
            return { data: row, error: null };
          }
          return { data: null, error: { message: 'unexpected query' } };
        },
      };
      return builder;
    }),
  };
}

async function callUpdate(selects) {
  const { requireServiceSupabase } = require('../../lib/supabaseClient');
  requireServiceSupabase.mockReturnValue(makeSupabase(selects));
  const handler = require('../../pages/api/account/update').default;
  const { req, res } = createMocks({
    method: 'POST',
    headers: { authorization: 'Bearer good-token' },
    body: { orgId: 'org-a', name: '  New Name  ' },
  });
  await handler(req, res);
  return res;
}

describe('POST /api/account/update without plan', () => {
  test('selects only id and name from organizations after the update', async () => {
    const selects = [];
    const res = await callUpdate(selects);
    expect(res._getStatusCode()).toBe(200);
    const orgSelects = selects.filter((s) => s.table === 'organizations');
    expect(orgSelects).toHaveLength(1);
    expect(orgSelects[0].cols).not.toMatch(/plan/);
    expect(orgSelects[0].cols.split(',').map((c) => c.trim())).toEqual(['id', 'name']);
  });

  test('responds with id and name and no plan key', async () => {
    const res = await callUpdate([]);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body).not.toHaveProperty('plan');
    expect(body).toEqual({ id: 'org-a', name: 'New Name' });
  });
});
