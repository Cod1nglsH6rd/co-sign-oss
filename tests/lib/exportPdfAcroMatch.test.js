/**
 * AcroForm matching in the PDF export (lib/exportPdf.js): which form field
 * gets which answer. Exact name first (case-insensitive, trimmed), then a
 * contains() match only when exactly one candidate fits; each form field is
 * used once; fields filled there are not drawn again by the overlay.
 *
 * The forms are built with pdf-lib and filled by the real generateFilledPdf.
 * flatten() is stubbed so the produced PDF keeps its fields and their values
 * can be read back; drawText is watched to see what the overlay drew.
 */
import { PDFDocument, PDFForm, PDFPage } from 'pdf-lib';
import * as exportPdf from '../../lib/exportPdf';

async function formPdf(textNames = [], checkBoxNames = []) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  let y = 740;
  for (const name of textNames) {
    form.createTextField(name).addToPage(page, { x: 50, y, width: 300, height: 20 });
    y -= 30;
  }
  for (const name of checkBoxNames) {
    form.createCheckBox(name).addToPage(page, { x: 50, y, width: 15, height: 15 });
    y -= 30;
  }
  return doc.save();
}

function answer(id, name, value, type = 'text') {
  return {
    id,
    field_name: name,
    field_value: value,
    field_type: type,
    position: { page: 1, x: 10, y: 50, width: 40, height: 3 },
  };
}

let drawTextSpy;

beforeEach(() => {
  jest.spyOn(PDFForm.prototype, 'flatten').mockImplementation(() => {});
  drawTextSpy = jest.spyOn(PDFPage.prototype, 'drawText');
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function fill(sourceBytes, fields) {
  const out = await exportPdf.generateFilledPdf({
    documentName: 'form.pdf',
    fileType: 'pdf',
    sourceBytes,
    fields,
  });
  return (await PDFDocument.load(out)).getForm();
}

function drawnTexts() {
  return drawTextSpy.mock.calls.map((call) => call[0]);
}

describe('generateFilledPdf AcroForm matching', () => {
  test('an exact name match wins over a looser one', async () => {
    const form = await fill(await formPdf(['Company Name', 'name']), [
      answer('a1', 'Name', 'Ada Lovelace'),
    ]);
    expect(form.getTextField('name').getText()).toBe('Ada Lovelace');
    expect(form.getTextField('Company Name').getText()).toBeUndefined();
  });

  test('exact match ignores case and surrounding spaces', async () => {
    const form = await fill(await formPdf(['Email Address', 'EMAIL']), [
      answer('a1', '  email ', 'ada@example.com'),
    ]);
    expect(form.getTextField('EMAIL').getText()).toBe('ada@example.com');
    expect(form.getTextField('Email Address').getText()).toBeUndefined();
  });

  test('a single contains() candidate is filled', async () => {
    const form = await fill(await formPdf(['Full Name', 'Date']), [
      answer('a1', 'Name', 'Ada Lovelace'),
    ]);
    expect(form.getTextField('Full Name').getText()).toBe('Ada Lovelace');
    expect(form.getTextField('Date').getText()).toBeUndefined();
  });

  test('an ambiguous contains() match fills nothing and falls back to the overlay', async () => {
    const form = await fill(await formPdf(['First Name', 'Last Name']), [
      answer('a1', 'Name', 'Ada Lovelace'),
    ]);
    expect(form.getTextField('First Name').getText()).toBeUndefined();
    expect(form.getTextField('Last Name').getText()).toBeUndefined();
    expect(drawnTexts()).toContain('Ada Lovelace');
  });

  test('one form field is never filled twice', async () => {
    const form = await fill(await formPdf(['Email']), [
      answer('a1', 'Email', 'first@example.com'),
      answer('a2', 'email', 'second@example.com'),
    ]);
    expect(form.getTextField('Email').getText()).toBe('first@example.com');
    // The second answer found no free form field, so the overlay draws it.
    expect(drawnTexts()).toContain('second@example.com');
    expect(drawnTexts()).not.toContain('first@example.com');
  });

  test('a checkbox is checked only for "true"', async () => {
    const form = await fill(await formPdf([], ['Agree', 'Subscribe', 'Adult']), [
      answer('c1', 'Agree', 'true', 'checkbox'),
      answer('c2', 'Subscribe', 'yes', 'checkbox'),
      answer('c3', 'Adult', 'false', 'checkbox'),
    ]);
    expect(form.getCheckBox('Agree').isChecked()).toBe(true);
    expect(form.getCheckBox('Subscribe').isChecked()).toBe(false);
    expect(form.getCheckBox('Adult').isChecked()).toBe(false);
  });

  test('a field filled through the AcroForm is not also drawn by the overlay', async () => {
    const form = await fill(await formPdf(['Company']), [
      answer('a1', 'Company', 'Acme Ltd'),
      answer('a2', 'Phone', '555-0100'),
    ]);
    expect(form.getTextField('Company').getText()).toBe('Acme Ltd');
    const drawn = drawnTexts();
    expect(drawn).not.toContain('Acme Ltd');
    // The unmatched answer is still drawn, so the overlay pass did run.
    expect(drawn).toContain('555-0100');
  });
});

describe('matchFormField', () => {
  async function formFields(names) {
    const doc = await PDFDocument.load(await formPdf(names));
    return doc.getForm().getFields();
  }
  const byName = (fields, name) => fields.find((f) => f.getName() === name);
  function match(fields, name, used) {
    expect(exportPdf.matchFormField).toEqual(expect.any(Function));
    return exportPdf.matchFormField(fields, name, used);
  }

  test('prefers the exact name, case-insensitive and trimmed', async () => {
    const fields = await formFields(['Company Name', 'NAME']);
    expect(match(fields, ' name ', new Set())).toBe(byName(fields, 'NAME'));
  });

  test('returns null when contains() fits more than one field', async () => {
    const fields = await formFields(['First Name', 'Last Name']);
    expect(match(fields, 'Name', new Set())).toBeNull();
  });

  test('returns the only contains() candidate', async () => {
    const fields = await formFields(['First Name', 'Date']);
    expect(match(fields, 'Name', new Set())).toBe(byName(fields, 'First Name'));
  });

  test('skips form fields already used', async () => {
    const fields = await formFields(['Name', 'Company Name']);
    const used = new Set([byName(fields, 'Name')]);
    // Exact is taken, so the one remaining contains() candidate is used.
    expect(match(fields, 'Name', used)).toBe(byName(fields, 'Company Name'));
    used.add(byName(fields, 'Company Name'));
    expect(match(fields, 'Name', used)).toBeNull();
  });

  test('returns null for an empty name', async () => {
    const fields = await formFields(['Name']);
    expect(match(fields, '   ', new Set())).toBeNull();
  });
});
