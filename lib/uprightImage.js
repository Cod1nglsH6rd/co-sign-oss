/**
 * prepareImageUpload(file, deps) plans the upright copy of a phone photo.
 *
 * file is { bytes, type, name }. A PDF or PNG (or any non-JPEG) comes back
 * unchanged. A JPEG whose EXIF orientation is not 1, or whose longest side is
 * over 3000 px, is re-encoded: deps.decode(bytes) gives { width, height, ... }
 * as stored, and deps.encode(decoded, { orientation, width, height }) must
 * return upright JPEG bytes of that upright size (at most 3000 px). HEIC/HEIF
 * is refused, since it cannot be read here.
 */

import { readJpegOrientation } from './jpegOrientation';

export const MAX_SIDE = 3000;
export const HEIC_MESSAGE = 'Save the photo as JPEG or PNG and try again';

const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
const JPEG_TYPES = ['image/jpeg', 'image/jpg', 'image/pjpeg'];

function lowerType(file) {
  return String(file.type || '').toLowerCase();
}

function isHeic(file) {
  return HEIC_TYPES.includes(lowerType(file)) || /\.(heic|heif)$/i.test(String(file.name || ''));
}

export async function prepareImageUpload(file, deps) {
  if (isHeic(file)) throw new Error(HEIC_MESSAGE);
  if (!JPEG_TYPES.includes(lowerType(file))) return file;

  const orientation = readJpegOrientation(file.bytes);
  const decoded = await deps.decode(file.bytes);
  // Orientations 5 to 8 turn the picture a quarter turn, so the sides swap.
  const turned = orientation >= 5;
  const uprightWidth = turned ? decoded.height : decoded.width;
  const uprightHeight = turned ? decoded.width : decoded.height;
  const longest = Math.max(uprightWidth, uprightHeight);
  if (orientation === 1 && longest <= MAX_SIDE) return file;

  const scale = longest > MAX_SIDE ? MAX_SIDE / longest : 1;
  const plan = {
    orientation,
    width: Math.max(1, Math.round(uprightWidth * scale)),
    height: Math.max(1, Math.round(uprightHeight * scale)),
  };
  const bytes = await deps.encode(decoded, plan);
  return { ...file, bytes, type: 'image/jpeg' };
}

/**
 * browserImageDeps() gives prepareImageUpload its decode and encode in the
 * browser. createImageBitmap with imageOrientation 'from-image' already turns
 * the picture upright, so decode reports the sides as stored (prepareImageUpload
 * swaps them back), and encode draws the bitmap onto a canvas of the planned
 * size and saves it as JPEG.
 */
export function browserImageDeps() {
  return {
    decode: async (bytes) => {
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), {
        imageOrientation: 'from-image',
      });
      const turned = readJpegOrientation(bytes) >= 5;
      return {
        bitmap,
        width: turned ? bitmap.height : bitmap.width,
        height: turned ? bitmap.width : bitmap.height,
      };
    },
    encode: async ({ bitmap }, { width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the photo'))), 'image/jpeg', 0.9);
      });
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}
