/**
 * lib/ocrStub.js's ocrProvider(env) picks the OCR provider from OCR_PROVIDER:
 * 'stub' only when the value, trimmed and lower-cased, is 'stub', else
 * 'anthropic'. With no argument it reads the OCR_PROVIDER setting from
 * process.env. (#387 added this read so .env.example can list the setting;
 * #388 adds stubFields() and its own tests.)
 */

function load() {
  return require('../../lib/ocrStub.js');
}

describe('ocrProvider', () => {
  const saved = process.env.OCR_PROVIDER;

  afterEach(() => {
    if (saved === undefined) delete process.env.OCR_PROVIDER;
    else process.env.OCR_PROVIDER = saved;
  });

  it('is anthropic when OCR_PROVIDER is blank or missing', () => {
    const { ocrProvider } = load();
    expect(ocrProvider({})).toBe('anthropic');
    expect(ocrProvider({ OCR_PROVIDER: '' })).toBe('anthropic');
    expect(ocrProvider({ OCR_PROVIDER: '   ' })).toBe('anthropic');
  });

  it('is stub when OCR_PROVIDER is stub after trimming and lower-casing', () => {
    const { ocrProvider } = load();
    expect(ocrProvider({ OCR_PROVIDER: 'stub' })).toBe('stub');
    expect(ocrProvider({ OCR_PROVIDER: ' STUB ' })).toBe('stub');
  });

  it('is anthropic for anything else', () => {
    const { ocrProvider } = load();
    for (const value of ['anthropic', 'stubs', 'st ub', 'fake', 'true', '1']) {
      expect(ocrProvider({ OCR_PROVIDER: value })).toBe('anthropic');
    }
  });

  it('reads the OCR_PROVIDER setting from process.env by default', () => {
    const { ocrProvider } = load();
    process.env.OCR_PROVIDER = ' Stub ';
    expect(ocrProvider()).toBe('stub');
    process.env.OCR_PROVIDER = 'other';
    expect(ocrProvider()).toBe('anthropic');
    delete process.env.OCR_PROVIDER;
    expect(ocrProvider()).toBe('anthropic');
  });
});
