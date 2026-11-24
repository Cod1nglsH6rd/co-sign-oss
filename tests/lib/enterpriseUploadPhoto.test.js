/**
 * The enterprise upload box takes a phone photo (JPEG or PNG) as well as a
 * PDF. uploadEnterpriseDocument runs prepareImageUpload in the browser
 * (createImageBitmap with imageOrientation 'from-image', then a canvas) before
 * uploading. Supabase, createImageBitmap, the canvas and fetch are faked here.
 */

jest.mock('../../lib/supabaseClient', () => {
  const calls = { uploads: [], inserts: [] };
  const supabase = {
    storage: {
      from: () => ({
        upload: async (path, body, opts) => {
          calls.uploads.push({ path, body, opts });
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path) => ({
          data: { signedUrl: `https://storage.test/${path}?token=t` },
          error: null,
        }),
      }),
    },
    from: () => ({
      insert: (rows) => {
        calls.inserts.push(rows);
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: 'doc-1',
                file_name: rows[0].file_name,
                file_path: rows[0].file_path,
                file_size: rows[0].file_size,
                status: 'uploaded',
                processing_status: 'prepping',
                lifecycle_status: 'uploaded',
                preferred_language: null,
                created_at: '2026-11-18T00:00:00Z',
                created_by: rows[0].created_by,
                phase1_data: null,
              },
              error: null,
            }),
          }),
        };
      },
    }),
  };
  return { supabase, __calls: calls };
});

// A JPEG whose only Exif tag is orientation 6 (a quarter turn), little-endian.
const ROTATED_JPEG = Buffer.from([
  0xff, 0xd8,
  0xff, 0xe1, 0x00, 0x22,
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
  0x01, 0x00,
  0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0xff, 0xd9,
]);

const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n');
const ENCODED = Buffer.from('upright-jpeg-bytes');

function fakeFile(bytes, type, name) {
  return {
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
}

async function bytesOf(body) {
  return Buffer.from(await body.arrayBuffer());
}

let bitmapCalls;
let canvases;

beforeEach(() => {
  jest.resetModules();
  bitmapCalls = [];
  canvases = [];
  // With imageOrientation 'from-image' the browser hands back the upright
  // picture: stored 4000 x 3000, turned a quarter, so 3000 wide x 4000 high.
  global.createImageBitmap = jest.fn(async (source, options) => {
    bitmapCalls.push({ source, options });
    return { width: 3000, height: 4000, close: () => {} };
  });
  global.document = {
    createElement: (tag) => {
      const draws = [];
      const canvas = {
        tag,
        width: 0,
        height: 0,
        draws,
        getContext: () => ({ drawImage: (...args) => draws.push(args) }),
        toBlob: (cb, type) => cb(new Blob([ENCODED], { type })),
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  delete global.createImageBitmap;
  delete global.document;
  delete global.fetch;
});

function load() {
  const { uploadEnterpriseDocument } = require('../../lib/enterpriseUpload');
  const { __calls } = require('../../lib/supabaseClient');
  return { uploadEnterpriseDocument, calls: __calls };
}

describe('uploadEnterpriseDocument prepares a phone photo before uploading', () => {
  it('uploads a PDF unchanged, with no image decoding, and file_type pdf', async () => {
    const { uploadEnterpriseDocument, calls } = load();
    const file = fakeFile(PDF_BYTES, 'application/pdf', 'form.pdf');

    await uploadEnterpriseDocument({ file, orgId: 'org-1', userId: 'user-1' });

    expect(global.createImageBitmap).not.toHaveBeenCalled();
    expect(calls.uploads).toHaveLength(1);
    expect(calls.uploads[0].body).toBe(file);
    expect(calls.inserts[0][0].file_type).toBe('pdf');
    expect(calls.inserts[0][0].file_size).toBe(PDF_BYTES.length);
  });

  it('re-encodes a rotated JPEG upright through createImageBitmap and a canvas', async () => {
    const { uploadEnterpriseDocument, calls } = load();
    const file = fakeFile(ROTATED_JPEG, 'image/jpeg', 'IMG_0001.JPEG');

    await uploadEnterpriseDocument({ file, orgId: 'org-1', userId: 'user-1' });

    expect(bitmapCalls).toHaveLength(1);
    expect(bitmapCalls[0].options).toEqual({ imageOrientation: 'from-image' });

    // Upright 3000 x 4000, longest side shrunk to 3000: 2250 x 3000.
    const canvas = canvases.find((c) => c.tag === 'canvas');
    expect(canvas).toBeDefined();
    expect(canvas.width).toBe(2250);
    expect(canvas.height).toBe(3000);
    expect(canvas.draws).toHaveLength(1);
    expect(canvas.draws[0].slice(1)).toEqual([0, 0, 2250, 3000]);

    expect(calls.uploads).toHaveLength(1);
    const { body } = calls.uploads[0];
    expect(body).not.toBe(file);
    expect(body.type).toBe('image/jpeg');
    expect((await bytesOf(body)).toString()).toBe('upright-jpeg-bytes');

    const row = calls.inserts[0][0];
    expect(row.file_type).toBe('jpg');
    expect(row.file_size).toBe(ENCODED.length);
  });

  it('refuses a HEIC with the refusal message and uploads nothing', async () => {
    const { uploadEnterpriseDocument, calls } = load();
    const file = fakeFile(Buffer.from('heic-bytes'), 'image/heic', 'IMG_0002.HEIC');

    await expect(
      uploadEnterpriseDocument({ file, orgId: 'org-1', userId: 'user-1' }),
    ).rejects.toThrow('Save the photo as JPEG or PNG and try again');

    expect(calls.uploads).toHaveLength(0);
    expect(calls.inserts).toHaveLength(0);
  });
});

describe('EnterpriseUploadModal', () => {
  it('accepts a PDF, JPEG or PNG and asks for a PDF or photo', () => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const EnterpriseUploadModal = require('../../components/enterprise/EnterpriseUploadModal').default;

    const html = renderToStaticMarkup(
      React.createElement(EnterpriseUploadModal, { open: true, onClose: () => {}, onConfirm: () => {} }),
    );

    const accept = (html.match(/accept="([^"]*)"/) || [])[1] || '';
    expect(accept.split(',').map((s) => s.trim()).sort()).toEqual(
      ['application/pdf', 'image/jpeg', 'image/png'],
    );
    expect(html).toContain('Click to select a PDF or photo');
  });
});
