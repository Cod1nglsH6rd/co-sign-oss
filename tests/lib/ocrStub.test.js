/**
 * lib/ocrStub.js (#388): ocrProvider(env) picks 'stub' only when OCR_PROVIDER,
 * trimmed and lower-cased, is 'stub', else 'anthropic'; stubFields() gives a
 * fixed 'Full name' text field and a 'Signature' field on page 1, as rows in
 * the shape /api/ocr inserts into the fields table, with percent positions and
 * source 'stub'.
 */

function load() {
  return require('../../lib/ocrStub.js');
}

// The columns /api/ocr's fieldsToInsert rows carry (pages/api/ocr.js).
const ROW_KEYS = [
  'document_id',
  'explanation',
  'field_name',
  'field_type',
  'position',
  'position_hint',
  'sort_order',
].sort();

describe('ocrProvider', () => {
  it('is stub when OCR_PROVIDER trimmed and lower-cased is stub', () => {
    const { ocrProvider } = load();
    expect(ocrProvider({ OCR_PROVIDER: 'stub' })).toBe('stub');
    expect(ocrProvider({ OCR_PROVIDER: '  StUb\n' })).toBe('stub');
  });

  it('is anthropic when OCR_PROVIDER is blank or missing', () => {
    const { ocrProvider } = load();
    expect(ocrProvider({})).toBe('anthropic');
    expect(ocrProvider({ OCR_PROVIDER: '' })).toBe('anthropic');
    expect(ocrProvider({ OCR_PROVIDER: ' \t ' })).toBe('anthropic');
    expect(ocrProvider({ OCR_PROVIDER: undefined })).toBe('anthropic');
  });

  it('is anthropic for any other value', () => {
    const { ocrProvider } = load();
    for (const value of ['anthropic', 'stubbed', 'not stub', 'mock']) {
      expect(ocrProvider({ OCR_PROVIDER: value })).toBe('anthropic');
    }
  });
});

describe('stubFields', () => {
  it('returns a Full name text field then a Signature field', () => {
    const { stubFields } = load();
    expect(typeof stubFields).toBe('function');
    const fields = stubFields();
    expect(fields).toHaveLength(2);
    expect(fields[0].field_name).toBe('Full name');
    expect(fields[0].field_type).toBe('text');
    expect(fields[1].field_name).toBe('Signature');
    expect(fields[1].field_type).toBe('signature');
  });

  it('puts both on page 1 with percent positions and source stub', () => {
    const { stubFields } = load();
    expect(typeof stubFields).toBe('function');
    for (const field of stubFields()) {
      const { position } = field;
      expect(position.page).toBe(1);
      expect(position.source).toBe('stub');
      for (const key of ['x', 'y', 'width', 'height']) {
        expect(typeof position[key]).toBe('number');
        expect(position[key]).toBeGreaterThanOrEqual(0);
        expect(position[key]).toBeLessThanOrEqual(100);
      }
      expect(position.x + position.width).toBeLessThanOrEqual(100);
      expect(position.y + position.height).toBeLessThanOrEqual(100);
      expect(position.width).toBeGreaterThan(0);
      expect(position.height).toBeGreaterThan(0);
    }
  });

  it('gives rows in the shape /api/ocr inserts into the fields table', () => {
    const { stubFields } = load();
    expect(typeof stubFields).toBe('function');
    const fields = stubFields('doc-1');
    fields.forEach((field) => {
      expect(Object.keys(field).sort()).toEqual(ROW_KEYS);
      expect(field.document_id).toBe('doc-1');
      expect(typeof field.explanation).toBe('string');
      expect(typeof field.position_hint).toBe('string');
      expect(Number.isInteger(field.sort_order)).toBe(true);
    });
    expect(fields[0].sort_order).toBeLessThan(fields[1].sort_order);
  });

  it('returns fresh rows each call, so a caller cannot change the next', () => {
    const { stubFields } = load();
    expect(typeof stubFields).toBe('function');
    const first = stubFields();
    first[0].position.x = 99;
    first[0].field_name = 'changed';
    const second = stubFields();
    expect(second[0].field_name).toBe('Full name');
    expect(second[0].position.x).not.toBe(99);
  });
});
