/**
 * readJpegOrientation(bytes) returns the EXIF orientation (1 to 8) a phone
 * writes into a JPEG, or 1 when it is missing, out of range, cut off, or the
 * bytes are not a JPEG. Reads only the APP1 Exif segment's IFD0.
 */

const ORIENTATION_TAG = 0x0112;
const TYPE_SHORT = 3;

function read16(b, at, little) {
  return little ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1];
}

function read32(b, at, little) {
  return little
    ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
    : ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function isExifHeader(b, at) {
  // "Exif\0\0"
  return (
    b[at] === 0x45 && b[at + 1] === 0x78 && b[at + 2] === 0x69 &&
    b[at + 3] === 0x66 && b[at + 4] === 0x00 && b[at + 5] === 0x00
  );
}

function orientationFromTiff(b, start, end) {
  if (start + 8 > end) return 1;
  let little;
  if (b[start] === 0x49 && b[start + 1] === 0x49) little = true;
  else if (b[start] === 0x4d && b[start + 1] === 0x4d) little = false;
  else return 1;
  if (read16(b, start + 2, little) !== 42) return 1;

  const ifd = start + read32(b, start + 4, little);
  if (ifd + 2 > end) return 1;
  const count = read16(b, ifd, little);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (read16(b, entry, little) !== ORIENTATION_TAG) continue;
    if (read16(b, entry + 2, little) !== TYPE_SHORT) return 1;
    const value = read16(b, entry + 8, little);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

export function readJpegOrientation(bytes) {
  const b = bytes;
  if (!b || typeof b.length !== 'number' || b.length < 4) return 1;
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;

  let offset = 2;
  while (offset + 4 <= b.length) {
    if (b[offset] !== 0xff) return 1;
    const marker = b[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return 1; // end of image, start of scan
    const length = read16(b, offset + 2, false);
    const end = offset + 2 + length;
    if (length < 2 || end > b.length) return 1;
    if (marker === 0xe1 && length >= 8 && isExifHeader(b, offset + 4)) {
      return orientationFromTiff(b, offset + 10, end);
    }
    offset = end;
  }
  return 1;
}
