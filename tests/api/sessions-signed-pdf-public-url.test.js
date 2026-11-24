/**
 * GET /api/sessions/signed-pdf hands back a download link the browser can
 * open: at home the server signs on http://gateway:3000, and the link must
 * come back on PUBLIC_SUPABASE_URL, else the build-time
 * NEXT_PUBLIC_SUPABASE_URL, else the page's own origin (on the scheme the
 * page was reached with). The auth checks (bearer token, active org
 * membership) stay as they were. Supabase is mocked.
 */

const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));

const { requireServiceSupabase } = require('../../lib/supabaseClient');
const handler = require('../../pages/api/sessions/signed-pdf').default;

const PATH_AND_QUERY = '/storage/v1/object/sign/filled-documents/d1/s1-filled.pdf?token=abc.def';
const VARS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_URL'];
const savedEnv = {};

function mockSupabase({ user = { id: 'u1' }, membership = { org_id: 'o1' } } = {}) {
  const createSignedUrl = jest.fn(async () => ({
    data: { signedUrl: `http://gateway:3000${PATH_AND_QUERY}` },
    error: null,
  }));
  // document_id added: the route now recomputes the filled PDF's path from
  // the document and session ids instead of reading it from metadata.
  const session = {
    id: 's1',
    document_id: 'd1',
    metadata: { filled_pdf_path: 'd1/s1-filled.pdf' },
    documents: { org_id: 'o1', file_name: 'Lease.pdf' },
  };
  const from = jest.fn((table) => {
    if (table === 'fill_sessions') {
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: session, error: null }) }) }),
      };
    }
    if (table === 'org_memberships') {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: membership, error: null }),
      };
      return chain;
    }
    throw new Error(`unexpected table ${table}`);
  });
  const supabase = {
    auth: {
      getUser: jest.fn(async () => (user
        ? { data: { user }, error: null }
        : { data: { user: null }, error: { message: 'bad jwt' } })),
    },
    from,
    storage: { from: jest.fn(() => ({ createSignedUrl })) },
  };
  requireServiceSupabase.mockReturnValue(supabase);
  return { supabase, createSignedUrl };
}

function request(headers = {}) {
  return createMocks({
    method: 'GET',
    query: { sessionId: 's1' },
    headers: { authorization: 'Bearer jwt', host: 'localhost:3000', ...headers },
  });
}

beforeEach(() => {
  VARS.forEach((name) => { savedEnv[name] = process.env[name]; delete process.env[name]; });
  process.env.SUPABASE_URL = 'http://gateway:3000';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  VARS.forEach((name) => {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  });
});

test('returns the link on the request origin when no public Supabase URL is set', async () => {
  mockSupabase();
  const { req, res } = request({ host: 'localhost:3000' });
  await handler(req, res);
  expect(res._getStatusCode()).toBe(200);
  expect(JSON.parse(res._getData()).url).toBe(`http://localhost:3000${PATH_AND_QUERY}`);
});

test('keeps plain http for a home-network address reached without a proxy', async () => {
  mockSupabase();
  const { req, res } = request({ host: '192.168.1.20:3000' });
  await handler(req, res);
  expect(res._getStatusCode()).toBe(200);
  expect(JSON.parse(res._getData()).url).toBe(`http://192.168.1.20:3000${PATH_AND_QUERY}`);
});

test('uses the scheme and host a proxy forwarded', async () => {
  mockSupabase();
  const { req, res } = request({
    host: 'app:3000',
    'x-forwarded-host': 'sign.example.com',
    'x-forwarded-proto': 'https',
  });
  await handler(req, res);
  expect(res._getStatusCode()).toBe(200);
  expect(JSON.parse(res._getData()).url).toBe(`https://sign.example.com${PATH_AND_QUERY}`);
});

test('returns the link on the public Supabase URL when one is set', async () => {
  process.env.PUBLIC_SUPABASE_URL = 'https://db.example.com';
  mockSupabase();
  const { req, res } = request();
  await handler(req, res);
  expect(res._getStatusCode()).toBe(200);
  expect(JSON.parse(res._getData()).url).toBe(`https://db.example.com${PATH_AND_QUERY}`);
});

test('falls back to NEXT_PUBLIC_SUPABASE_URL before the request origin', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://build.example.com';
  mockSupabase();
  const { req, res } = request();
  await handler(req, res);
  expect(res._getStatusCode()).toBe(200);
  expect(JSON.parse(res._getData()).url).toBe(`https://build.example.com${PATH_AND_QUERY}`);
});

test('still refuses a caller with no bearer token', async () => {
  const { createSignedUrl } = mockSupabase();
  const { req, res } = request();
  delete req.headers.authorization;
  await handler(req, res);
  expect(res._getStatusCode()).toBe(401);
  expect(createSignedUrl).not.toHaveBeenCalled();
});

test('still refuses a caller who is not a member of the document org', async () => {
  const { createSignedUrl } = mockSupabase({ membership: null });
  const { req, res } = request();
  await handler(req, res);
  expect(res._getStatusCode()).toBe(403);
  expect(createSignedUrl).not.toHaveBeenCalled();
});
