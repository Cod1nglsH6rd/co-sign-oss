/**
 * Storage paths read from rows that organisation members can edit.
 *
 * documents.file_path and fill_sessions.metadata are editable by members of
 * the document's organisation, and these routes sign or copy with the
 * service role, so a member who learned another organisation's object path
 * could get a signed URL or a copy of it. Each route now refuses a path
 * outside the document owner's folder (`<org_id>/...`, or `<user_id>/...`
 * for a document with no organisation), and the filled PDF's path is
 * recomputed as `<document id>/<session id>-filled.pdf`.
 */
import { createMocks } from 'node-mocks-http';

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));
jest.mock('../../lib/sessionAuth', () => ({
  validateSessionToken: jest.fn(),
  isSessionVerified: jest.fn(),
}));
jest.mock('../../lib/rateLimit', () => ({ rateLimitPublic: jest.fn() }));
jest.mock('../../lib/embedOrigin', () => ({ enforceEmbedOriginForSession: jest.fn() }));
jest.mock('../../lib/auth', () => ({
  requireBearerUser: jest.fn(),
  requireOrgMembership: jest.fn(),
  requestedOrgId: jest.fn(() => null),
}));

const { requireServiceSupabase } = require('../../lib/supabaseClient');
const { validateSessionToken, isSessionVerified } = require('../../lib/sessionAuth');
const { rateLimitPublic } = require('../../lib/rateLimit');
const { enforceEmbedOriginForSession } = require('../../lib/embedOrigin');
const { requireBearerUser, requireOrgMembership } = require('../../lib/auth');

const ORG_A = 'org-aaaa';
const ORG_B = 'org-bbbb';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  rateLimitPublic.mockResolvedValue(false);
  enforceEmbedOriginForSession.mockReturnValue({ ok: true });
  isSessionVerified.mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/sessions/[token]/document-url', () => {
  const handler = require('../../pages/api/sessions/[token]/document-url').default;

  function setup(documents) {
    const createSignedUrl = jest.fn(async (p) => ({
      data: { signedUrl: `http://localhost:3000/storage/v1/object/sign/documents/${p}?token=x`, expiresAt: null },
      error: null,
    }));
    requireServiceSupabase.mockReturnValue({ storage: { from: jest.fn(() => ({ createSignedUrl })) } });
    validateSessionToken.mockResolvedValue({
      session: { id: 's-1', document_id: 'd-1', status: 'opened', recipient_email: null, documents },
      error: null,
    });
    return { createSignedUrl };
  }

  async function call() {
    const { req, res } = createMocks({
      method: 'GET',
      query: { token: 't'.repeat(64) },
      headers: { host: 'localhost:3000' },
    });
    await handler(req, res);
    return res;
  }

  it('refuses a file_path in another organisation\'s folder and signs nothing', async () => {
    const { createSignedUrl } = setup({ org_id: ORG_A, user_id: 'u-1', file_path: `${ORG_B}/1-secret.pdf` });
    const res = await call();
    expect([403, 404]).toContain(res._getStatusCode());
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses a path that climbs out of the organisation folder', async () => {
    const { createSignedUrl } = setup({ org_id: ORG_A, user_id: 'u-1', file_path: `${ORG_A}/../${ORG_B}/1-secret.pdf` });
    const res = await call();
    expect([403, 404]).toContain(res._getStatusCode());
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('signs the document\'s own path in its organisation folder', async () => {
    const { createSignedUrl } = setup({ org_id: ORG_A, user_id: 'u-1', file_path: `${ORG_A}/1-lease.pdf` });
    const res = await call();
    expect(res._getStatusCode()).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledWith(`${ORG_A}/1-lease.pdf`, expect.any(Number));
  });

  it('for a document with no organisation, accepts only its uploader\'s folder', async () => {
    let { createSignedUrl } = setup({ org_id: null, user_id: 'u-1', created_by: 'u-1', file_path: 'u-1/1-lease.pdf' });
    expect((await call())._getStatusCode()).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);

    ({ createSignedUrl } = setup({ org_id: null, user_id: 'u-1', created_by: 'u-1', file_path: `${ORG_B}/1-secret.pdf` }));
    expect([403, 404]).toContain((await call())._getStatusCode());
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  // The bypass from the PR #483 review: "Owner can insert documents" passes
  // on created_by = the writer, so a signed-in user can write their own
  // document with org_id null, user_id set to another organisation's id (it is
  // text the writer chooses) and file_path in that organisation's folder, add
  // their own session with a token hash of their choosing, and ask for it.
  it('refuses the forged no-organisation row: user_id = another org, created_by = the writer', async () => {
    const { createSignedUrl } = setup({
      org_id: null, created_by: 'u-att', user_id: ORG_B, file_path: `${ORG_B}/1-secret.pdf`,
    });
    const res = await call();
    expect([403, 404]).toContain(res._getStatusCode());
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses the mirrored row: user_id = the writer, created_by = someone else, path in created_by\'s folder', async () => {
    const { createSignedUrl } = setup({
      org_id: null, user_id: 'u-att', created_by: 'u-other', file_path: 'u-other/1-secret.pdf',
    });
    const res = await call();
    expect([403, 404]).toContain(res._getStatusCode());
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses a row whose user_id and created_by differ even in the user_id folder', async () => {
    const { createSignedUrl } = setup({
      org_id: null, user_id: 'u-att', created_by: 'u-other', file_path: 'u-att/1-mine.pdf',
    });
    expect([403, 404]).toContain((await call())._getStatusCode());
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('serves a no-organisation upload whose created_by is null from its user_id folder', async () => {
    const { createSignedUrl } = setup({ org_id: null, user_id: 'u-1', created_by: null, file_path: 'u-1/1-lease.pdf' });
    expect((await call())._getStatusCode()).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledWith('u-1/1-lease.pdf', expect.any(Number));
  });
});

describe('POST /api/enterprise/templates/duplicate', () => {
  const handler = require('../../pages/api/enterprise/templates/duplicate').default;

  function setup(template) {
    const copy = jest.fn(async () => ({ error: null }));
    const createSignedUrl = jest.fn(async () => ({ data: { signedUrl: 'http://localhost/x' }, error: null }));
    const remove = jest.fn(async () => ({ error: null }));
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: async () => ({ data: template, error: null }),
    };
    requireServiceSupabase.mockReturnValue({
      from: jest.fn(() => chain),
      storage: { from: jest.fn(() => ({ copy, createSignedUrl, remove })) },
      rpc: jest.fn(async () => ({ data: { documentId: 'd-new', fileName: 'Copy.pdf' }, error: null })),
    });
    requireBearerUser.mockResolvedValue({ user: { id: 'u-1' } });
    requireOrgMembership.mockResolvedValue({ membership: { org_id: ORG_A, role: 'admin' } });
    return { copy };
  }

  async function call() {
    const { req, res } = createMocks({
      method: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: { templateId: 'd-1', newName: 'Copy' },
    });
    await handler(req, res);
    return res;
  }

  const TEMPLATE = {
    id: 'd-1',
    org_id: ORG_A,
    file_name: 'Lease.pdf',
    phase1_data: { setupCompleted: true },
  };

  it('refuses a template whose file_path is in another organisation\'s folder and copies nothing', async () => {
    const { copy } = setup({ ...TEMPLATE, file_path: `${ORG_B}/1-secret.pdf` });
    const res = await call();
    expect([403, 404]).toContain(res._getStatusCode());
    expect(copy).not.toHaveBeenCalled();
  });

  it('copies the template\'s own file from its organisation folder', async () => {
    const { copy } = setup({ ...TEMPLATE, file_path: `${ORG_A}/1-lease.pdf` });
    const res = await call();
    expect(res._getStatusCode()).toBe(201);
    expect(copy).toHaveBeenCalledWith(`${ORG_A}/1-lease.pdf`, expect.stringMatching(new RegExp(`^${ORG_A}/`)));
  });
});

describe('GET /api/sessions/signed-pdf', () => {
  const handler = require('../../pages/api/sessions/signed-pdf').default;

  function setup(session) {
    const createSignedUrl = jest.fn(async (p) => ({
      data: { signedUrl: `http://localhost:3000/storage/v1/object/sign/filled-documents/${p}?token=x` },
      error: null,
    }));
    const membershipChain = {
      select: () => membershipChain,
      eq: () => membershipChain,
      maybeSingle: async () => ({ data: { org_id: ORG_A }, error: null }),
    };
    requireServiceSupabase.mockReturnValue({
      auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })) },
      from: jest.fn((table) => (table === 'org_memberships'
        ? membershipChain
        : { select: () => ({ eq: () => ({ single: async () => ({ data: session, error: null }) }) }) })),
      storage: { from: jest.fn(() => ({ createSignedUrl })) },
    });
    return { createSignedUrl };
  }

  async function call() {
    const { req, res } = createMocks({
      method: 'GET',
      query: { sessionId: 's-1' },
      headers: { authorization: 'Bearer jwt', host: 'localhost:3000' },
    });
    await handler(req, res);
    return res;
  }

  it('never signs a path taken from metadata that points at another document', async () => {
    const { createSignedUrl } = setup({
      id: 's-1',
      document_id: 'd-1',
      metadata: { filled_pdf_path: 'd-other/s-other-filled.pdf' },
      documents: { org_id: ORG_A, file_name: 'Lease.pdf' },
    });
    const res = await call();
    expect(createSignedUrl).not.toHaveBeenCalledWith('d-other/s-other-filled.pdf', expect.anything(), expect.anything());
    for (const [signedPath] of createSignedUrl.mock.calls) {
      expect(signedPath).toBe('d-1/s-1-filled.pdf');
    }
    expect(res._getData()).not.toContain('d-other');
  });

  it('signs the PDF recomputed from the document and session ids', async () => {
    const { createSignedUrl } = setup({
      id: 's-1',
      document_id: 'd-1',
      metadata: { filled_pdf_path: 'd-1/s-1-filled.pdf' },
      documents: { org_id: ORG_A, file_name: 'Lease.pdf' },
    });
    const res = await call();
    expect(res._getStatusCode()).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl.mock.calls[0][0]).toBe('d-1/s-1-filled.pdf');
  });
});
