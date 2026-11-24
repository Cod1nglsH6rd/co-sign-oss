/**
 * lib/jpegOrientation.js: readJpegOrientation(bytes) reads the EXIF
 * orientation (1 to 8) a phone writes into a JPEG, or 1 when there is none or
 * the bytes are not a JPEG. The bytes below are written out by hand.
 */

function load() {
  return require('../../lib/jpegOrientation.js');
}

// A JPEG with one APP1 Exif segment whose IFD0 holds only the orientation tag.
function littleEndianJpeg(orientation) {
  return Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe1, 0x00, 0x22, // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II", 42, IFD0 at 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // no next IFD
    0xff, 0xd9, // EOI
  ]);
}

function bigEndianJpegAfterJfif(orientation) {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, // APP0 (JFIF), length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xe1, 0x00, 0x2e, // APP1, length 46
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 at 8
    0x00, 0x02, // two entries
    0x01, 0x0f, 0x00, 0x02, 0x00, 0x00, 0x00, 0x04, 0x41, 0x42, 0x43, 0x00, // Make "ABC"
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0xff, 0xd9,
  ]);
}

describe('readJpegOrientation', () => {
  it('returns each orientation 1 to 8 from a little-endian Exif block', () => {
    const { readJpegOrientation } = load();
    for (let o = 1; o <= 8; o += 1) {
      expect(readJpegOrientation(littleEndianJpeg(o))).toBe(o);
    }
  });

  it('reads a big-endian Exif block that follows a JFIF segment', () => {
    const { readJpegOrientation } = load();
    expect(readJpegOrientation(bigEndianJpegAfterJfif(6))).toBe(6);
    expect(readJpegOrientation(bigEndianJpegAfterJfif(3))).toBe(3);
  });

  it('accepts a Uint8Array as well as a Buffer', () => {
    const { readJpegOrientation } = load();
    expect(readJpegOrientation(new Uint8Array(littleEndianJpeg(8)))).toBe(8);
  });

  it('returns 1 for a JPEG with no Exif block', () => {
    const { readJpegOrientation } = load();
    const plain = Buffer.from([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10,
      0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xff, 0xda, 0x00, 0x02,
      0xff, 0xd9,
    ]);
    expect(readJpegOrientation(plain)).toBe(1);
  });

  it('returns 1 when the orientation value is outside 1 to 8', () => {
    const { readJpegOrientation } = load();
    expect(readJpegOrientation(littleEndianJpeg(0))).toBe(1);
    expect(readJpegOrientation(littleEndianJpeg(9))).toBe(1);
  });

  it('returns 1 for bytes that are not a JPEG', () => {
    const { readJpegOrientation } = load();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(readJpegOrientation(png)).toBe(1);
    expect(readJpegOrientation(Buffer.from('%PDF-1.7'))).toBe(1);
    expect(readJpegOrientation(Buffer.alloc(0))).toBe(1);
    expect(readJpegOrientation(null)).toBe(1);
  });

  it('returns 1 instead of throwing on a cut-off Exif block', () => {
    const { readJpegOrientation } = load();
    const cut = littleEndianJpeg(6).subarray(0, 24);
    expect(readJpegOrientation(cut)).toBe(1);
  });
});
