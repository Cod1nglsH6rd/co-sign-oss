/**
 * lib/visionImage.js (#392): toVisionImage(buffer, mediaType, loadSharp) gives
 * the image /api/ocr sends to vision detection. With sharp it is PNG; without
 * sharp a JPEG or PNG goes through unchanged with its own media type, and any
 * other type is refused with an error that names it.
 */

function load() {
  return require('../../lib/visionImage.js');
}

const INPUT = Buffer.from('original-bytes');
const PNG_OUT = Buffer.from('png-from-sharp');

// A fake sharp: sharp(buf).png().toBuffer() and sharp(buf).metadata().
function fakeSharp() {
  const calls = [];
  const sharp = (buf) => {
    calls.push(buf);
    return {
      png: () => ({ toBuffer: async () => PNG_OUT }),
      metadata: async () => ({ width: 640, height: 480, format: 'png' }),
    };
  };
  return { sharp, calls };
}

const failingLoader = async () => {
  throw new Error("Cannot find module 'sharp'");
};

describe('toVisionImage with sharp', () => {
  it('returns the PNG from sharp with its size', async () => {
    const { toVisionImage } = load();
    const { sharp, calls } = fakeSharp();
    const out = await toVisionImage(INPUT, 'image/webp', async () => sharp);
    expect(calls[0]).toBe(INPUT);
    expect(out.mediaType).toBe('image/png');
    expect(Buffer.from(out.buffer).equals(PNG_OUT)).toBe(true);
    expect(out.width).toBe(640);
    expect(out.height).toBe(480);
  });
});

describe('toVisionImage when sharp fails to load', () => {
  it('returns a JPEG unchanged as image/jpeg', async () => {
    const { toVisionImage } = load();
    const out = await toVisionImage(INPUT, 'image/jpeg', failingLoader);
    expect(out.buffer).toBe(INPUT);
    expect(out.mediaType).toBe('image/jpeg');
  });

  it('returns a PNG unchanged as image/png', async () => {
    const { toVisionImage } = load();
    const out = await toVisionImage(INPUT, 'image/png', failingLoader);
    expect(out.buffer).toBe(INPUT);
    expect(out.mediaType).toBe('image/png');
  });

  it('refuses another type with an error naming it', async () => {
    const { toVisionImage } = load();
    await expect(toVisionImage(INPUT, 'image/heic', failingLoader)).rejects.toThrow(/image\/heic/);
  });
});
