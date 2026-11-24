/**
 * Issue #494: a text PDF without form fields must have its text layer read in
 * the app's own process (pdfjs-dist), not by the `extract-text-layer` edge
 * function, which is not in this repository.
 *
 * pdfjs-dist 5 ships only ES modules, which Jest's CommonJS runtime cannot
 * load, so pdfjs is mocked here: a fake document whose pages return known text
 * items and a known viewport size.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: jest.fn() }));
jest.mock('pdfjs-dist/legacy/build/pdf.worker.mjs', () => ({}));

// A US Letter page: 612 x 792 points.
const PAGE_W = 612;
const PAGE_H = 792;

function fakePage(items) {
  return {
    getViewport: () => ({ width: PAGE_W, height: PAGE_H, scale: 1, rotation: 0 }),
    getTextContent: async () => ({ items, styles: {} }),
  };
}

function fakeDocument(pagesItems) {
  return {
    numPages: pagesItems.length,
    getPage: jest.fn(async (n) => fakePage(pagesItems[n - 1])),
    destroy: jest.fn(async () => {}),
  };
}

function textItem(str, x, y, width, height) {
  return {
    str,
    dir: 'ltr',
    transform: [height, 0, 0, height, x, y],
    width,
    height,
    fontName: 'g_d0_f1',
    hasEOL: false,
  };
}

function openWith(doc) {
  getDocument.mockReturnValue({ promise: Promise.resolve(doc), destroy: jest.fn() });
}

const PAGE_ONE = [
  // x 61.2 of 612 = 10%; baseline 712.8 from the bottom = 79.2 from the top = 10%;
  // width 122.4 = 20%; height 15.84 = 2%.
  textItem('Buyer Name: ________', 61.2, 712.8, 122.4, 15.84),
  // x 306 = 50%; baseline 396 = 50%; width 61.2 = 10%; height 7.92 = 1%.
  textItem('Date', 306, 396, 61.2, 7.92),
];
const PAGE_TWO = [
  // x 153 = 25%; baseline 79.2 from the bottom = 712.8 from the top = 90%;
  // width 183.6 = 30%; height 11.88 = 1.5%.
  textItem('Signature', 153, 79.2, 183.6, 11.88),
];

beforeEach(() => {
  getDocument.mockReset();
});

describe('extractTextItemsInProcess', () => {
  test('returns every page\'s text with its page number and positions in percent from the top left', async () => {
    const { extractTextItemsInProcess } = require('../../lib/pdfjsTextItems.js');
    const doc = fakeDocument([PAGE_ONE, PAGE_TWO]);
    openWith(doc);

    const items = await extractTextItemsInProcess(Buffer.from('%PDF-1.7 two pages'));

    expect(items).toHaveLength(3);
    const [name, date, signature] = items;

    expect(name.text).toBe('Buyer Name: ________');
    expect(name.page).toBe(1);
    expect(name.x).toBeCloseTo(10, 1);
    expect(name.y).toBeCloseTo(10, 1);
    expect(name.width).toBeCloseTo(20, 1);
    expect(name.height).toBeCloseTo(2, 1);

    expect(date.text).toBe('Date');
    expect(date.page).toBe(1);
    expect(date.x).toBeCloseTo(50, 1);
    expect(date.y).toBeCloseTo(50, 1);
    expect(date.width).toBeCloseTo(10, 1);
    expect(date.height).toBeCloseTo(1, 1);

    expect(signature.text).toBe('Signature');
    expect(signature.page).toBe(2);
    expect(signature.x).toBeCloseTo(25, 1);
    expect(signature.y).toBeCloseTo(90, 1);
    expect(signature.width).toBeCloseTo(30, 1);
    expect(signature.height).toBeCloseTo(1.5, 1);

    expect(doc.destroy).toHaveBeenCalled();
  });

  test('an empty or image-only page gives no items', async () => {
    const { extractTextItemsInProcess } = require('../../lib/pdfjsTextItems.js');
    const blankOnly = [
      textItem('   ', 61.2, 712.8, 10, 12),
      textItem('', 61.2, 700, 0, 12),
      { type: 'beginMarkedContent', id: 'mc0' },
      { type: 'endMarkedContent' },
    ];
    openWith(fakeDocument([[], blankOnly, PAGE_TWO]));

    const items = await extractTextItemsInProcess(Buffer.from('%PDF-1.7 scanned'));

    expect(items.map((i) => [i.page, i.text])).toEqual([[3, 'Signature']]);
  });

  test('a broken PDF throws an error that says the PDF could not be read', async () => {
    const { extractTextItemsInProcess } = require('../../lib/pdfjsTextItems.js');
    getDocument.mockReturnValue({
      promise: Promise.reject(new Error('Invalid PDF structure.')),
      destroy: jest.fn(),
    });

    await expect(extractTextItemsInProcess(Buffer.from('not a pdf'))).rejects.toThrow(
      /PDF.*Invalid PDF structure/,
    );
  });

  test('no PDF bytes throws before pdfjs is asked to open anything', async () => {
    const { extractTextItemsInProcess } = require('../../lib/pdfjsTextItems.js');

    await expect(extractTextItemsInProcess(Buffer.alloc(0))).rejects.toThrow(/PDF/);
    await expect(extractTextItemsInProcess(null)).rejects.toThrow(/PDF/);
    expect(getDocument).not.toHaveBeenCalled();
  });
});

describe('extractTextItems', () => {
  const savedFetch = global.fetch;
  const savedEnv = { ...process.env };

  afterEach(() => {
    global.fetch = savedFetch;
    process.env = { ...savedEnv };
  });

  test('reads the text layer in-process and makes no network request', async () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_ANON_KEY = 'your-anon-key-here';
    global.fetch = jest.fn(async () => {
      throw new Error('network request made');
    });
    openWith(fakeDocument([PAGE_ONE, PAGE_TWO]));
    const { extractTextItems } = require('../../lib/pdfTextExtraction.js');

    const items = await extractTextItems(Buffer.from('%PDF-1.7 two pages'));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(items.map((i) => [i.page, i.text])).toEqual([
      [1, 'Buyer Name: ________'],
      [1, 'Date'],
      [2, 'Signature'],
    ]);
  });

  test('works with no Supabase settings at all', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    global.fetch = jest.fn(async () => {
      throw new Error('network request made');
    });
    openWith(fakeDocument([PAGE_TWO]));
    const { extractTextItems } = require('../../lib/pdfTextExtraction.js');

    const items = await extractTextItems(Buffer.from('%PDF-1.7 one page'));

    expect(items.map((i) => [i.page, i.text])).toEqual([[1, 'Signature']]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
