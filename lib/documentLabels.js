const DOCUMENT_TYPE_LABELS = {
  'single-form': 'Single Form',
  rental: 'Rental Agreement',
  employment: 'Employment Form',
  nda: 'NDA',
  sales: 'Sales Agreement',
  'other-contract': 'Other Contract',
  unknown: 'Document',
};

export function getDocumentTypeLabel(documentType) {
  if (!documentType) return '';
  return DOCUMENT_TYPE_LABELS[documentType] || '';
}

export function getDocumentDisplayTitle({ documentType, fileName }) {
  const safeFileName = fileName || 'Document';
  const label = getDocumentTypeLabel(documentType);
  if (!label || documentType === 'unknown') return safeFileName;
  return `${label} (${safeFileName})`;
}
