/**
 * POST /api/sessions/[token]/complete: each signed PDF carries only its own
 * signer's answers and signature (PRD §2.7).
 *
 * One document can be sent separately to unrelated people, and nothing in
 * fill_sessions marks which sessions belong to one signing (field_filter.ids is
 * set for every recipient whenever setup turned a field off, PRD §2.8). So when
 * a later signer completes, their PDF must hold none of an earlier signer's
 * name, answers or signature, whether both sessions cover the whole form or
 * both have the same field_filter.ids. Combining co-signers' answers is not
 * built (issue #411).
 *
 * Supabase is an in-memory stand-in that answers honestly: if the route asked
 * for other sessions' session_fields (by document, through fill_sessions, or
 * with .in('session_id', …)), it would get the earlier signer's rows, so a
 * change that merged answers across a document's sessions makes these tests
 * fail. The PDF writer is mocked and the tests read the fields handed to it.
 */

const { createMocks } = require('node-mocks-http');

jest.mock('../../lib/supabaseClient', () => ({ requireServiceSupabase: jest.fn() }));
jest.mock('../../lib/sessionAuth', () => ({
  validateSessionToken: jest.fn(),
  isSessionVerified: jest.fn(() => true),
}));
jest.mock('../../lib/rateLimit', () => ({ rateLimitPublic: jest.fn(async () => false) }));
jest.mock('../../lib/auditLog', () => ({ logAudit: jest.fn(async () => {}) }));
jest.mock('../../lib/csrf', () => ({ validateCsrfToken: jest.fn(() => true) }));
jest.mock('../../lib/embedOrigin', () => ({ enforceEmbedOriginForSession: jest.fn(() => ({ ok: true })) }));
jest.mock('../../lib/email', () => ({ sendCompletionNotificationEmail: jest.fn(async () => {}) }));
jest.mock('../../lib/exportPdf', () => ({ generateFilledPdf: jest.fn(async () => new Uint8Array([37, 80, 68, 70])) }));
jest.mock('../../lib/documentFetch', () => ({
  DocumentSourceNotAllowedError: class DocumentSourceNotAllowedError extends Error {},
  downloadDocumentBinary: jest.fn(async () => ({ buffer: new Uint8Array([1]) })),
}));

const { requireServiceSupabase } = require('../../lib/supabaseClient');
const { validateSessionToken } = require('../../lib/sessionAuth');
const { generateFilledPdf } = require('../../lib/exportPdf');
const handler = require('../../pages/api/sessions/[token]/complete').default;

const DOC_ID = 'doc-1';

const EARLIER = {
  name: 'Carol Earlier',
  employer: 'Earlier Employer Inc',
  notes: 'Earlier private note',
  signature: 'data:image/png;base64,RUFSTElFUi1TSUdOQVRVUkU=',
};
const LATER = {
  name: 'Dan Later',
  employer: 'Later Employer LLC',
  signature: 'data:image/png;base64,TEFURVItU0lHTkFUVVJF',
};

const FIELDS = [
  { id: 1, document_id: DOC_ID, sort_order: 1, field_name: 'Full name', field_type: 'text', position: {} },
  { id: 2, document_id: DOC_ID, sort_order: 2, field_name: 'Employer', field_type: 'text', position: {} },
  { id: 3, document_id: DOC_ID, sort_order: 3, field_name: 'Notes (optional)', field_type: 'text', position: {} },
  { id: 4, document_id: DOC_ID, sort_order: 4, field_name: 'Signature', field_type: 'signature', position: {} },
  { id: 5, document_id: DOC_ID, sort_order: 5, field_name: 'Office use (if applicable)', field_type: 'text', position: {} },
];

// Rows as the fill API stores them: one per field per session. The later
// signer leaves the optional notes field blank, which the earlier one filled.
function sessionFieldRows(earlierId, laterId) {
  return [
    { id: 'sf-e1', session_id: earlierId, field_id: 1, field_value: EARLIER.name, signature_data_url: null },
    { id: 'sf-e2', session_id: earlierId, field_id: 2, field_value: EARLIER.employer, signature_data_url: null },
    { id: 'sf-e3', session_id: earlierId, field_id: 3, field_value: EARLIER.notes, signature_data_url: null },
    { id: 'sf-e4', session_id: earlierId, field_id: 4, field_value: null, signature_data_url: EARLIER.signature },
    { id: 'sf-l1', session_id: laterId, field_id: 1, field_value: LATER.name, signature_data_url: null },
    { id: 'sf-l2', session_id: laterId, field_id: 2, field_value: LATER.employer, signature_data_url: null },
    { id: 'sf-l4', session_id: laterId, field_id: 4, field_value: null, signature_data_url: LATER.signature },
  ];
}

function sessionRow(id, overrides = {}) {
  return {
    id,
    document_id: DOC_ID,
    status: 'in_progress',
    completed_at: null,
    field_filter: null,
    require_signature: true,
    preferred_language: 'en',
    metadata: {},
    client_user_id: null,
    recipient_name: null,
    // org_id and an org folder path: complete.js now downloads only from the
    // document owner's folder (the old `${DOC_ID}/...` has no owner: 422).
    documents: { org_id: 'org-1', file_name: 'Application.pdf', file_type: 'application/pdf', file_path: 'org-1/application.pdf' },
    ...overrides,
  };
}

/**
 * In-memory Supabase. Filters, embeds and joins answer from the whole table,
 * so a query for another session's session_fields returns those rows:
 *  - session_fields filtered by document_id / status (or fill_sessions.<col>)
 *    resolve through the row's session;
 *  - selecting fill_sessions with session_fields(...) embeds each session's
 *    rows, and selecting session_fields with fill_sessions(...) embeds the
 *    session;
 *  - filters this stand-in does not model are ignored, which only ever returns
 *    MORE rows, never hides another signer's answers.
 */
function fakeSupabase(tables) {
  const sessionById = (id) => (tables.fill_sessions || []).find((s) => String(s.id) === String(id));

  function columnValue(table, row, col) {
    if (col.includes('.')) {
      const [rel, inner] = col.split('.');
      const joined = table === 'session_fields' && rel === 'fill_sessions' ? sessionById(row.session_id) : row[rel];
      return joined ? joined[inner] : undefined;
    }
    if (col in row) return row[col];
    if (table === 'session_fields') {
      const session = sessionById(row.session_id);
      return session ? session[col] : undefined;
    }
    return undefined;
  }

  function withEmbeds(table, row, cols) {
    const text = String(cols || '');
    if (table === 'fill_sessions' && text.includes('session_fields')) {
      return {
        ...row,
        session_fields: (tables.session_fields || []).filter((sf) => String(sf.session_id) === String(row.id)),
      };
    }
    if (table === 'session_fields' && text.includes('fill_sessions')) {
      return { ...row, fill_sessions: sessionById(row.session_id) || null };
    }
    return row;
  }

  function query(table) {
    const filters = [];
    let op = 'select';
    let patch = null;
    let head = false;
    let cols = '*';

    const matched = () => (tables[table] || []).filter((row) => filters.every((f) => f(row)));
    const run = () => {
      const rows = matched();
      if (op === 'update') {
        rows.forEach((row) => Object.assign(row, patch));
        return { data: rows.map((row) => ({ id: row.id })), count: rows.length, error: null };
      }
      if (head) return { data: null, count: rows.length, error: null };
      return { data: rows.map((row) => withEmbeds(table, row, cols)), count: rows.length, error: null };
    };
    const same = (a, b) => String(a) === String(b);

    const builder = {
      select: (selected, opts) => {
        if (op === 'select') cols = selected || '*';
        if (opts?.head) head = true;
        return builder;
      },
      update: (values) => { op = 'update'; patch = values; return builder; },
      eq: (col, val) => { filters.push((row) => same(columnValue(table, row, col), val)); return builder; },
      neq: (col, val) => { filters.push((row) => !same(columnValue(table, row, col), val)); return builder; },
      in: (col, vals) => {
        filters.push((row) => (vals || []).some((v) => same(columnValue(table, row, col), v)));
        return builder;
      },
      match: (obj) => {
        Object.entries(obj || {}).forEach(([col, val]) => builder.eq(col, val));
        return builder;
      },
      is: (col, val) => {
        filters.push((row) => {
          const value = columnValue(table, row, col);
          return val === null ? value === null || value === undefined : value === val;
        });
        return builder;
      },
      not: () => builder,
      filter: () => builder,
      gt: () => builder,
      gte: () => builder,
      lt: () => builder,
      lte: () => builder,
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      single: async () => {
        const { data } = run();
        return { data: Array.isArray(data) ? data[0] || null : data, error: null };
      },
      maybeSingle: async () => {
        const { data } = run();
        return { data: Array.isArray(data) ? data[0] || null : data, error: null };
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  }

  return {
    from: jest.fn(query),
    rpc: jest.fn(async () => ({ error: null })),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(async () => ({ error: null })),
        createSignedUrl: jest.fn(async () => ({ data: { signedUrl: 'http://localhost/signed.pdf' }, error: null })),
      })),
    },
    auth: { admin: { getUserById: jest.fn(async () => ({ data: { user: null } })) } },
  };
}

// Completes `later` on a document where `earlier` has already completed, and
// returns the fields the route handed to the PDF writer.
async function laterSignersPdfFields({ earlierFilter, laterFilter }) {
  const earlier = sessionRow('s-earlier', {
    status: 'completed',
    completed_at: '2026-11-18T09:00:00.000Z',
    field_filter: earlierFilter,
    metadata: { filled_pdf_path: `${DOC_ID}/s-earlier-filled.pdf` },
  });
  const later = sessionRow('s-later', { field_filter: laterFilter });
  const supabase = fakeSupabase({
    fields: FIELDS.map((f) => ({ ...f })),
    fill_sessions: [earlier, later],
    session_fields: sessionFieldRows(earlier.id, later.id),
    documents: [{ id: DOC_ID, completion_count: 1, lifecycle_status: 'opened' }],
  });
  requireServiceSupabase.mockReturnValue(supabase);
  validateSessionToken.mockResolvedValue({ session: { ...later }, error: null });

  const { req, res } = createMocks({
    method: 'POST',
    query: { token: 'later-token' },
    body: {},
    headers: { host: 'localhost:3000' },
  });
  await handler(req, res);

  expect(res._getStatusCode()).toBe(200);
  expect(generateFilledPdf).toHaveBeenCalledTimes(1);
  return generateFilledPdf.mock.calls[0][0].fields;
}

function expectOnlyLaterSigner(fields) {
  // The later signer's own answers and signature, and nothing else.
  expect(fields.map((f) => [f.field_name, f.field_value])).toEqual([
    ['Full name', LATER.name],
    ['Employer', LATER.employer],
    ['Signature', LATER.signature],
  ]);

  // None of the earlier signer's name, answers or signature, anywhere in what
  // the PDF writer was given.
  const handed = JSON.stringify(fields);
  [EARLIER.name, EARLIER.employer, EARLIER.notes, EARLIER.signature].forEach((value) => {
    expect(handed).not.toContain(value);
  });
}

beforeEach(() => {
  generateFilledPdf.mockClear();
  global.fetch = jest.fn(async () => { throw new Error('offline'); });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

describe('POST /api/sessions/[token]/complete: the signed PDF carries only its own signer\'s answers', () => {
  test('two whole-form sessions (no field_filter) on one document', async () => {
    const fields = await laterSignersPdfFields({ earlierFilter: null, laterFilter: null });
    expectOnlyLaterSigner(fields);
  });

  test('two sessions with the same field_filter.ids on one document', async () => {
    // As /api/sessions/create sets it for every recipient when setup turned
    // field 5 off (PRD §2.8): the same non-empty list for both signers.
    const ids = ['1', '2', '3', '4'];
    const fields = await laterSignersPdfFields({
      earlierFilter: { ids: [...ids] },
      laterFilter: { ids: [...ids] },
    });
    expectOnlyLaterSigner(fields);
  });
});
