/**
 * lib/exportPdf.js with a photo as the source: the image kind comes from the
 * file's first bytes (not its name), and a JPEG with EXIF orientation 6 or 8
 * gives a page whose sides are swapped with the picture drawn upright.
 *
 * The PNG and JPEG bytes are written out by hand. The page is read back out of
 * the produced PDF, and the image's corners are found by following the page's
 * cm operators up to the Do that draws it.
 */
import zlib from 'zlib';
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

function load() {
  return require('../../lib/exportPdf.js');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// A 3 x 2 RGB PNG.
function png3x2() {
  const ihdr = Buffer.from([0, 0, 0, 3, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  const rows = Buffer.from([
    0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    0, 255, 255, 255, 0, 0, 0, 128, 128, 128,
  ]);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

// A JPEG stored 300 wide and 200 high, with an Exif orientation tag.
function jpeg300x200(orientation) {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe1, 0x00, 0x22, // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II", 42, IFD0 at 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // no next IFD
    0xff, 0xc0, 0x00, 0x11, // SOF0, length 17
    0x08, 0x00, 0xc8, 0x01, 0x2c, 0x03, // 8 bit, height 200, width 300, 3 components
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9, // EOI
  ]);
}

function streamText(stream) {
  const filter = stream.dict.get(PDFName.of('Filter'));
  const raw = Buffer.from(stream.getContents());
  return (filter && filter.toString() === '/FlateDecode' ? zlib.inflateSync(raw) : raw).toString('latin1');
}

function contentText(doc, page) {
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs
    .map((ref) => doc.context.lookup(ref))
    .filter((s) => s instanceof PDFRawStream)
    .map(streamText)
    .join('\n');
}

// Matrices in force at each Do, in the order they were set (innermost last).
function matricesAtDo(text) {
  const draws = [];
  const stack = [[]];
  let nums = [];
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(tok)) { nums.push(parseFloat(tok)); continue; }
    if (tok === 'q') stack.push([...stack[stack.length - 1]]);
    else if (tok === 'Q') stack.pop();
    else if (tok === 'cm') stack[stack.length - 1].push(nums.slice(-6));
    else if (tok === 'Do') draws.push(stack[stack.length - 1]);
    nums = [];
  }
  return draws;
}

// Where the image's unit-square point (u, v) lands on the page.
function place(matrices, u, v) {
  let x = u;
  let y = v;
  for (let i = matrices.length - 1; i >= 0; i -= 1) {
    const [a, b, c, d, e, f] = matrices[i];
    [x, y] = [a * x + c * y + e, b * x + d * y + f];
  }
  // "+ 0" turns -0 into 0, which toEqual tells apart.
  return { x: Math.round(x * 100) / 100 + 0, y: Math.round(y * 100) / 100 + 0 };
}

async function exportOnePage(documentName, sourceBytes) {
  const { generateFilledPdf } = load();
  const bytes = await generateFilledPdf({
    documentName,
    fileUrl: null,
    fileType: 'image',
    sourceBytes,
    fields: [],
  });
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  expect(pages).toHaveLength(1);
  const { width, height } = pages[0].getSize();
  const draws = matricesAtDo(contentText(doc, pages[0]));
  return { width, height, draws };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('generateFilledPdf with a photo', () => {
  it('embeds a PNG named "form" (no extension) instead of giving the blank page', async () => {
    const { width, height, draws } = await exportOnePage('form', png3x2());
    expect({ width, height }).toEqual({ width: 3, height: 2 });
    expect(draws).toHaveLength(1);
    expect(place(draws[0], 0, 0)).toEqual({ x: 0, y: 0 });
    expect(place(draws[0], 1, 1)).toEqual({ x: 3, y: 2 });
  });

  it('embeds a JPEG whose name ends in .png as a JPEG', async () => {
    const { width, height, draws } = await exportOnePage('scan.png', jpeg300x200(1));
    expect({ width, height }).toEqual({ width: 300, height: 200 });
    expect(draws).toHaveLength(1);
  });

  it('keeps a JPEG with orientation 1 as stored', async () => {
    const { width, height, draws } = await exportOnePage('photo.jpg', jpeg300x200(1));
    expect({ width, height }).toEqual({ width: 300, height: 200 });
    expect(place(draws[0], 0, 0)).toEqual({ x: 0, y: 0 });
    expect(place(draws[0], 0, 1)).toEqual({ x: 0, y: 200 });
  });

  it('swaps the sides for orientation 6 and turns the picture a quarter turn clockwise', async () => {
    const { width, height, draws } = await exportOnePage('photo.jpg', jpeg300x200(6));
    expect({ width, height }).toEqual({ width: 200, height: 300 });
    expect(draws).toHaveLength(1);
    // Turned clockwise: the stored top-left lands top-right, the stored
    // top-right lands bottom-right, the stored bottom-left lands top-left.
    expect(place(draws[0], 0, 1)).toEqual({ x: 200, y: 300 });
    expect(place(draws[0], 1, 1)).toEqual({ x: 200, y: 0 });
    expect(place(draws[0], 0, 0)).toEqual({ x: 0, y: 300 });
    expect(place(draws[0], 1, 0)).toEqual({ x: 0, y: 0 });
  });

  it('swaps the sides for orientation 8 and turns the picture a quarter turn anticlockwise', async () => {
    const { width, height, draws } = await exportOnePage('photo.jpg', jpeg300x200(8));
    expect({ width, height }).toEqual({ width: 200, height: 300 });
    expect(draws).toHaveLength(1);
    // Turned anticlockwise: the stored top-left lands bottom-left, the stored
    // top-right lands top-left, the stored bottom-right lands top-right.
    expect(place(draws[0], 0, 1)).toEqual({ x: 0, y: 0 });
    expect(place(draws[0], 1, 1)).toEqual({ x: 0, y: 300 });
    expect(place(draws[0], 1, 0)).toEqual({ x: 200, y: 300 });
    expect(place(draws[0], 0, 0)).toEqual({ x: 200, y: 0 });
  });
});
