/**
 * The in-process text reader (lib/pdfjsTextItems.js) on a real PDF (2026-11-21).
 * tests/lib/pdfjsTextItems.test.js mocks pdfjs; this one builds a PDF with
 * pdf-lib, runs the real extractTextItemsInProcess on it with the real pdfjs-dist
 * in a child Node process (tests/fixtures/extractTextItems.mjs; pdfjs-dist 5 is
 * ES modules only, which Jest's CommonJS runtime cannot load), and checks the
 * items against where pdf-lib drew each string.
 *
 * The coordinate system is the consumers' own: percent of the page width and
 * height, origin at the TOP-left, y on the text's baseline.
 * - lib/exportPdf.js, which draws answers back at field positions:
 *   `// pos.x, pos.y are percentages from top-left`.
 * - lib/textLayerPositioning.js positionValueInBlank, which turns the OCR
 *   route's matched item into a field box:
 *   `const baselineY = typeof item?.y === 'number' ? item.y : 0;` and
 *   `y: Math.round(Math.max(0, baselineY - 2) * 10) / 10` (the box starts 2%
 *   above the baseline, 3% tall); x and width are read the same way, in percent
 *   of the page width (`valueX = itemX + (blankCharIdx / totalLen) * itemWidth`).
 * pdf-lib's drawText puts the baseline's left end at (x, y) in PDF points from
 * the BOTTOM-left, so the expected item is
 *   x = x / pageWidth * 100,  y = (pageHeight - y) / pageHeight * 100,
 *   width = font.widthOfTextAtSize(text, size) / pageWidth * 100,
 *   height = size / pageHeight * 100.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import zlib from 'zlib';
import { PDFDocument, PageSizes, StandardFonts } from 'pdf-lib';
import { matchFieldsToTextItems } from '../../lib/textLayerPositioning';

const READER = path.join(__dirname, '..', 'fixtures', 'extractTextItems.mjs');

// Percentage points. pdf-lib's widthOfTextAtSize adds kerning that its drawn
// text does not use, which moves a width by about 0.1.
const TOL = 0.25;

function readTextItems(pdfBytes) {
  const out = execFileSync(process.execPath, [READER], {
    input: Buffer.from(pdfBytes),
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60000,
  });
  return JSON.parse(out.toString('utf8'));
}

function expectClose(actual, expected, label) {
  if (Math.abs(actual - expected) > TOL) {
    throw new Error(`${label}: got ${actual}, expected ${expected.toFixed(2)} (within ${TOL})`);
  }
}

const LETTER = [612, 792];
const A4 = PageSizes.A4; // [595.28, 841.89]

// Two pages of different sizes; the title is drawn larger than the rest.
const DRAWN = [
  { page: 1, text: 'Lease Agreement', x: 200, y: 740, size: 20 },
  { page: 1, text: 'Name: ____________', x: 72, y: 700, size: 12 },
  { page: 1, text: 'Date', x: 400, y: 600, size: 10 },
  { page: 2, text: 'Signature: ____________', x: 60, y: 120, size: 11 },
  { page: 2, text: 'Thank you', x: 300, y: 400, size: 9 },
];
const SIZES = { 1: LETTER, 2: A4 };

async function twoPagePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = { 1: doc.addPage(LETTER), 2: doc.addPage(A4) };
  for (const s of DRAWN) pages[s.page].drawText(s.text, { x: s.x, y: s.y, size: s.size, font });
  return { bytes: await doc.save(), font };
}

function expectedItem(s, font) {
  const [w, h] = SIZES[s.page];
  return {
    x: (s.x / w) * 100,
    y: ((h - s.y) / h) * 100,
    width: (font.widthOfTextAtSize(s.text, s.size) / w) * 100,
    height: (s.size / h) * 100,
  };
}

// A small grey PNG made here, so no image file is added to the repository.
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
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

function greyPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits per sample, greyscale, no interlace
  const rows = Buffer.alloc((width + 1) * height, 0x80);
  for (let r = 0; r < height; r += 1) rows[r * (width + 1)] = 0; // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('extractTextItemsInProcess on a real PDF', () => {
  let font;
  let items;

  beforeAll(async () => {
    const built = await twoPagePdf();
    font = built.font;
    const result = readTextItems(built.bytes);
    expect(result.error).toBeUndefined();
    items = result.items;
  });

  test('finds each drawn string once, on its page, and nothing else', () => {
    for (const s of DRAWN) {
      const found = items.filter((i) => i.text === s.text);
      expect(found.map((i) => i.page)).toEqual([s.page]);
    }
    expect(items).toHaveLength(DRAWN.length);
  });

  test('gives each string the position and size pdf-lib drew it at, in percent from the top left', () => {
    for (const s of DRAWN) {
      const item = items.find((i) => i.text === s.text);
      const want = expectedItem(s, font);
      for (const key of ['x', 'y', 'width', 'height']) {
        expectClose(item[key], want[key], `${s.text} ${key}`);
      }
    }
  });

  test('the OCR route places a field named after the label on its underscores', () => {
    const name = DRAWN.find((s) => s.text.startsWith('Name:'));
    const want = expectedItem(name, font);
    const [w] = SIZES[name.page];
    const blankStart = ((name.x + font.widthOfTextAtSize('Name: ', name.size)) / w) * 100;
    const blankEnd = want.x + want.width;

    // The fields the text-layer step's model returns, then the call it makes
    // next (pages/api/ocr.js: matchFieldsToTextItems(deduplicatedFields, textItems, ...)).
    const [field] = matchFieldsToTextItems(
      [{ field_name: 'Name', label_text: 'Name', field_type: 'text', approx_page: 1, approx_y: 12 }],
      items,
    );
    const box = field.position;

    expect(box.page).toBe(1);
    expect(box.source).toBe('text-match');
    // The box starts where the underscores start (the matcher counts characters,
    // not glyph widths, hence the wider tolerance) and ends where they end ...
    expect(Math.abs(box.x - blankStart)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(box.x + box.width - blankEnd)).toBeLessThanOrEqual(0.5);
    // ... and spans the line the underscores are drawn on.
    expect(box.y).toBeLessThan(want.y);
    expect(box.y + box.height).toBeGreaterThan(want.y);
  });
});

describe('extractTextItemsInProcess on pages with no text, and on bytes that are not a PDF', () => {
  test('an empty page and an image-only page give no items', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage(LETTER);
    const imagePage = doc.addPage(LETTER);
    const png = await doc.embedPng(greyPng(40, 20));
    imagePage.drawImage(png, { x: 72, y: 400, width: 400, height: 200 });
    doc.addPage(LETTER).drawText('Only text page', { x: 72, y: 700, size: 12, font });

    const result = readTextItems(await doc.save());

    expect(result.error).toBeUndefined();
    expect(result.items.map((i) => [i.page, i.text])).toEqual([[3, 'Only text page']]);
  });

  test('bytes that are not a PDF throw the reader\'s own error', () => {
    const result = readTextItems(Buffer.from('this is not a PDF file at all'));

    expect(result.items).toBeUndefined();
    expect(result.error).toMatch(/^Cannot read the PDF text layer: the PDF could not be opened \(.+\)$/);
  });
});
