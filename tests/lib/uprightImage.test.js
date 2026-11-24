/**
 * lib/uprightImage.js: prepareImageUpload(file, deps) plans the upright copy
 * of a phone photo. file is { bytes, type, name }; deps.decode(bytes) gives
 * { width, height, ... } and deps.encode(decoded, { orientation, width, height })
 * gives the upright JPEG bytes. Both are faked here.
 */

function load() {
  return require('../../lib/uprightImage.js');
}

// A JPEG whose only Exif tag is the orientation (little-endian TIFF).
function jpegWithOrientation(orientation) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x22,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0xff, 0xd9,
  ]);
}

const ENCODED = Buffer.from('upright-jpeg');

function fakeDeps(width, height) {
  const calls = { decode: [], encode: [] };
  const decoded = { width, height, pixels: 'decoded-pixels' };
  return {
    calls,
    decoded,
    deps: {
      decode: async (bytes) => {
        calls.decode.push(bytes);
        return decoded;
      },
      encode: async (image, plan) => {
        calls.encode.push({ image, plan });
        return ENCODED;
      },
    },
  };
}

describe('prepareImageUpload', () => {
  it('returns a PDF unchanged without decoding it', async () => {
    const { prepareImageUpload } = load();
    const { deps, calls } = fakeDeps(100, 100);
    const file = { bytes: Buffer.from('%PDF-1.7'), type: 'application/pdf', name: 'lease.pdf' };
    await expect(prepareImageUpload(file, deps)).resolves.toBe(file);
    expect(calls.decode).toHaveLength(0);
    expect(calls.encode).toHaveLength(0);
  });

  it('returns a PNG unchanged without decoding it', async () => {
    const { prepareImageUpload } = load();
    const { deps, calls } = fakeDeps(5000, 5000);
    const file = { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), type: 'image/png', name: 'scan.png' };
    await expect(prepareImageUpload(file, deps)).resolves.toBe(file);
    expect(calls.decode).toHaveLength(0);
    expect(calls.encode).toHaveLength(0);
  });

  it('returns an upright JPEG of 3000 px or less unchanged', async () => {
    const { prepareImageUpload } = load();
    const { deps, calls } = fakeDeps(3000, 2000);
    const file = { bytes: jpegWithOrientation(1), type: 'image/jpeg', name: 'a.jpg' };
    await expect(prepareImageUpload(file, deps)).resolves.toBe(file);
    expect(calls.encode).toHaveLength(0);
  });

  it('re-encodes a rotated JPEG upright, swapping sides and shrinking to 3000 px', async () => {
    const { prepareImageUpload } = load();
    const { deps, calls, decoded } = fakeDeps(4000, 3000);
    const bytes = jpegWithOrientation(6);
    const file = { bytes, type: 'image/jpeg', name: 'IMG_0001.jpg' };
    const out = await prepareImageUpload(file, deps);
    expect(calls.decode).toEqual([bytes]);
    expect(calls.encode).toEqual([
      { image: decoded, plan: { orientation: 6, width: 2250, height: 3000 } },
    ]);
    expect(out).toEqual({ bytes: ENCODED, type: 'image/jpeg', name: 'IMG_0001.jpg' });
  });

  it('re-encodes a small upside-down JPEG at its own size', async () => {
    const { prepareImageUpload } = load();
    const { deps, calls } = fakeDeps(1200, 800);
    const file = { bytes: jpegWithOrientation(3), type: 'image/jpeg', name: 'b.jpg' };
    const out = await prepareImageUpload(file, deps);
    expect(calls.encode.map((c) => c.plan)).toEqual([{ orientation: 3, width: 1200, height: 800 }]);
    expect(out.bytes).toBe(ENCODED);
  });

  it('shrinks an upright JPEG whose longest side is over 3000 px', async () => {
    const { prepareImageUpload } = load();
    const { deps, calls } = fakeDeps(6000, 2000);
    const file = { bytes: jpegWithOrientation(1), type: 'image/jpeg', name: 'wide.jpg' };
    const out = await prepareImageUpload(file, deps);
    expect(calls.encode.map((c) => c.plan)).toEqual([{ orientation: 1, width: 3000, height: 1000 }]);
    expect(out.type).toBe('image/jpeg');
    expect(out.bytes).toBe(ENCODED);
  });

  it('refuses HEIC by type and HEIF by file name', async () => {
    const { prepareImageUpload } = load();
    const { deps, calls } = fakeDeps(4000, 3000);
    const message = 'Save the photo as JPEG or PNG and try again';
    await expect(
      prepareImageUpload({ bytes: Buffer.from('x'), type: 'image/heic', name: 'IMG.HEIC' }, deps)
    ).rejects.toThrow(message);
    await expect(
      prepareImageUpload({ bytes: Buffer.from('x'), type: '', name: 'photo.heif' }, deps)
    ).rejects.toThrow(message);
    expect(calls.decode).toHaveLength(0);
  });
});
