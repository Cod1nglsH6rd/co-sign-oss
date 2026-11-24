/**
 * Image uploads for vision detection (#392).
 *
 * toVisionImage(buffer, mediaType, loadSharp) returns
 * { buffer, mediaType, width, height } for the image /api/ocr sends to the
 * vision model. When sharp loads, the upload is normalized to PNG and its size
 * read. sharp is optional: when it fails to load, a JPEG or PNG is returned
 * unchanged with its own media type (size 0, so no coordinate grid is drawn),
 * and any other type is refused with an error naming it.
 */

const PASS_THROUGH = ['image/jpeg', 'image/png'];

const loadDefaultSharp = async () => (await import('sharp')).default;

export async function toVisionImage(buffer, mediaType, loadSharp = loadDefaultSharp) {
  let sharp = null;
  try {
    sharp = await loadSharp();
  } catch {
    sharp = null;
  }
  if (sharp) {
    const png = await sharp(buffer).png().toBuffer();
    const meta = await sharp(png).metadata();
    return { buffer: png, mediaType: 'image/png', width: meta.width || 0, height: meta.height || 0 };
  }
  if (PASS_THROUGH.includes(mediaType)) {
    return { buffer, mediaType, width: 0, height: 0 };
  }
  throw new Error(`Image type ${mediaType} needs sharp, which is not installed; upload a JPEG or PNG instead`);
}
