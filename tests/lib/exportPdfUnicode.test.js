/**
 * Issue #72: Vietnamese letters must survive the export, both when values are
 * drawn over the page and when they are written into a fillable (AcroForm) PDF.
 *
 * The PDFs are produced by the real generateFilledPdf and the text is read back
 * out of the produced bytes with pdfjs-dist (see tests/fixtures/extractPdfText.mjs).
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { generateFilledPdf } from '../../lib/exportPdf';

const ROOT = path.join(__dirname, '..', '..');
const FONT_PATH = path.join(ROOT, 'public', 'fonts', 'NotoSans-Regular.ttf');
const EXTRACT_SCRIPT = path.join(ROOT, 'tests', 'fixtures', 'extractPdfText.mjs');

const VALUE = 'Đặng Thị Ngọc, 123 Lê Lợi'.normalize('NFC');
const SANITIZED = '?ang Thi Ngoc, 123 Le Loi';

function extractText(pdfBytes) {
  const out = execFileSync(process.execPath, [EXTRACT_SCRIPT], {
    input: Buffer.from(pdfBytes),
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(out.toString('utf8')).join('\n').normalize('NFC');
}

// BaseFont names of the fonts a page actually uses (from its /Resources /Font).
async function baseFonts(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes);
  const names = new Set();
  for (const page of doc.getPages()) {
    const fontDict = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (!fontDict) continue;
    for (const [, ref] of fontDict.entries()) {
      const font = doc.context.lookup(ref, PDFDict);
      const base = font.lookupMaybe(PDFName.of('BaseFont'), PDFName);
      if (base) names.add(base.decodeText().replace(/^[A-Z]{6}\+/, ''));
    }
  }
  return [...names].sort();
}

async function onePagePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

async function acroFormPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const field = doc.getForm().createTextField('Full Name');
  field.addToPage(page, { x: 50, y: 700, width: 450, height: 24 });
  return doc.save();
}

const overlayField = {
  id: 'f1',
  field_name: 'Full name and address',
  field_type: 'text',
  field_value: VALUE,
  position: { page: 1, x: 10, y: 10, width: 80, height: 3 },
};

const acroField = {
  id: 'f1',
  field_name: 'Full Name',
  field_type: 'text',
  field_value: VALUE,
};

describe('generateFilledPdf keeps Vietnamese letters (issue #72)', () => {
  let fontBytes;
  let warnSpy;

  beforeAll(() => {
    fontBytes = fs.readFileSync(FONT_PATH);
  });

  beforeEach(() => {
    // The no-font fallback logs a warning by design; keep test output clean.
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('keeps the exact text in an overlay field when fontBytes is passed', async () => {
    const pdf = await generateFilledPdf({
      documentName: 'form.pdf',
      fileType: 'pdf',
      sourceBytes: await onePagePdf(),
      fields: [overlayField],
      fontBytes,
    });
    expect(extractText(pdf)).toContain(VALUE);
  });

  it('writes decomposed input (letter + combining mark) as the same letters', async () => {
    const pdf = await generateFilledPdf({
      documentName: 'form.pdf',
      fileType: 'pdf',
      sourceBytes: await onePagePdf(),
      fields: [{ ...overlayField, field_value: VALUE.normalize('NFD') }],
      fontBytes,
    });
    expect(extractText(pdf)).toContain(VALUE);
  });

  it('keeps the exact text in a flattened AcroForm text field when fontBytes is passed', async () => {
    const source = await acroFormPdf();
    const pdf = await generateFilledPdf({
      documentName: 'form.pdf',
      fileType: 'pdf',
      sourceBytes: source,
      fields: [acroField],
      fontBytes,
    });
    expect(extractText(pdf)).toContain(VALUE);
    // The form was flattened, so no interactive field is left behind.
    const out = await PDFDocument.load(pdf);
    expect(out.getForm().getFields()).toHaveLength(0);
  });

  it('without fontBytes in Node, keeps today\'s behaviour (Helvetica and sanitize)', async () => {
    expect(typeof window).toBe('undefined');
    const overlayPdf = await generateFilledPdf({
      documentName: 'form.pdf',
      fileType: 'pdf',
      sourceBytes: await onePagePdf(),
      fields: [overlayField],
    });
    const overlayText = extractText(overlayPdf);
    expect(overlayText).toContain(SANITIZED);
    expect(overlayText).not.toContain(VALUE);

    const acroPdf = await generateFilledPdf({
      documentName: 'form.pdf',
      fileType: 'pdf',
      sourceBytes: await acroFormPdf(),
      fields: [acroField],
    });
    expect(extractText(acroPdf)).toContain(SANITIZED);

    expect(await baseFonts(overlayPdf)).toEqual(['Helvetica']);
  });

  it('embeds the Unicode font (and not only Helvetica) when fontBytes is passed', async () => {
    const pdf = await generateFilledPdf({
      documentName: 'form.pdf',
      fileType: 'pdf',
      sourceBytes: await onePagePdf(),
      fields: [overlayField],
      fontBytes,
    });
    expect((await baseFonts(pdf)).some((name) => /NotoSans/.test(name))).toBe(true);
  });
});
