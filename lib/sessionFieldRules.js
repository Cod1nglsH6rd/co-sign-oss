import { getAllTranslations } from './fieldTranslations';

const OPTIONAL_LABEL_MARKERS = [
  'optional',
  'not required',
  'if applicable',
  'if any',
  'opcional',
  'si aplica',
  'khong bat buoc',
  'không bắt buộc',
  'neu co',
  'nếu có',
  'tuy chon',
  'tùy chọn',
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function collectFieldLabelText(field) {
  return Object.values(getAllTranslations(field))
    .filter(Boolean)
    .map((item) => normalizeText(item))
    .join(' ');
}

function hasOptionalLabelMarker(field) {
  const labelText = collectFieldLabelText(field);
  if (!labelText) return false;
  return OPTIONAL_LABEL_MARKERS.some((marker) => labelText.includes(marker));
}

function getRequiredFieldIdSet(fields, session) {
  const requiredIdValues = session?.field_filter?.requiredIds || session?.field_filter?.required_ids;
  const hasExplicitRequiredList = Array.isArray(requiredIdValues) && requiredIdValues.length > 0;
  const explicitRequiredIds = hasExplicitRequiredList
    ? new Set(requiredIdValues.map((id) => String(id)))
    : null;

  const requiredIds = new Set();
  for (const field of fields || []) {
    const fieldId = String(field.id);
    const fieldType = field?.field_type || field?.fieldType || 'text';

    if (fieldType === 'checkbox') {
      continue;
    }

    if (fieldType === 'signature') {
      if (session?.require_signature) {
        requiredIds.add(fieldId);
      }
      continue;
    }

    if (hasExplicitRequiredList) {
      if (explicitRequiredIds.has(fieldId)) {
        requiredIds.add(fieldId);
      }
      continue;
    }

    if (!hasOptionalLabelMarker(field)) {
      requiredIds.add(fieldId);
    }
  }

  return requiredIds;
}

function isFieldRequired(field, session, requiredFieldIdSet = null) {
  const requiredIds = requiredFieldIdSet || getRequiredFieldIdSet([field], session);
  return requiredIds.has(String(field?.id));
}

export {
  getRequiredFieldIdSet,
  isFieldRequired,
};
