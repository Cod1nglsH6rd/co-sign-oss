/**
 * Stub OCR provider (#388).
 *
 * ocrProvider(env) returns 'stub' only when OCR_PROVIDER, trimmed and
 * lower-cased, is 'stub', and returns 'anthropic' otherwise, including when it
 * is blank. It reads the env object it is given, by default the OCR_PROVIDER
 * setting from process.env.
 *
 * stubFields(documentId) returns fixed fields, a 'Full name' text field and a
 * 'Signature' field on page 1, as rows in the shape /api/ocr inserts into the
 * fields table. Positions are percentages of the page with source 'stub'.
 *
 * This file was started by hand in #387 so that .env.example can list
 * OCR_PROVIDER (the env sync test refuses a listed setting no code reads).
 */

export function ocrProvider(env = { OCR_PROVIDER: process.env.OCR_PROVIDER }) {
  const raw = env.OCR_PROVIDER;
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === 'stub' ? 'stub' : 'anthropic';
}

export function stubFields(documentId = null) {
  return [
    {
      document_id: documentId,
      field_name: 'Full name',
      field_type: 'text',
      explanation: 'Your full legal name.',
      position_hint: '',
      sort_order: 1,
      position: { page: 1, x: 10, y: 20, width: 40, height: 4, source: 'stub' },
    },
    {
      document_id: documentId,
      field_name: 'Signature',
      field_type: 'signature',
      explanation: 'Sign here.',
      position_hint: '',
      sort_order: 2,
      position: { page: 1, x: 10, y: 80, width: 40, height: 6, source: 'stub' },
    },
  ];
}
