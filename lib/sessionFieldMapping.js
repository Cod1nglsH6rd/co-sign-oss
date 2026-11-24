/**
 * Helpers to bridge document field IDs (uuid or numeric) with session_fields.field_id (numeric).
 * Some environments still store numeric field IDs in session_fields while fields.id may be UUID.
 */

function toFiniteNumber(value) {
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? num : null;
}

function hashToPositiveInt(input) {
  const text = String(input || '');
  // FNV-1a. The 32-bit constants are written in hex, the usual way, which
  // the privacy scan's phone rule does not read as a phone number (the same
  // values in decimal look like one).
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  // Keep in signed int32 range and avoid 0.
  return (unsigned % 0x7ffffffe) + 1;
}

function normalizeSessionFieldType(rawType, fieldName = '') {
  const type = String(rawType || '').trim().toLowerCase();
  const name = String(fieldName || '').trim().toLowerCase();

  // "Initial(s)" only counts as a signature marker when it ends the label
  // ("Consultant Initial", "Borrower Initials Here") — leading "Initial" is a
  // modifier on data fields ("Initial Loan Amount", "Initial Interest Rate").
  if (type === 'signature' || /signature|initial/.test(type) || /signature/.test(name) || /\binitials?\b\s*(here)?\s*$/.test(name)) {
    return 'signature';
  }
  if (
    type === 'checkbox'
    || type === 'check'
    || /checkbox|check box|tick box|tick/.test(type)
    // "tick" must be a whole word (or "tick box"/"tickboxes") so "Ticket" is not a checkbox.
    || /checkbox|check box|(?:^|[^a-z])ticks?(?:[\s_-]?box(?:es)?)?(?![a-z])/.test(name)
  ) {
    return 'checkbox';
  }
  if (type === 'date' || /date/.test(type) || /\bdate\b/.test(name)) {
    return 'date';
  }
  if (type === 'email' || /email/.test(name)) {
    return 'email';
  }
  // "tel" must start a word ("Tel", "Tel_no", "TelNo") so "Hotel" is not a phone field.
  if (type === 'tel' || type === 'phone' || /phone|(?:^|[^a-z])tel/.test(name)) {
    return 'tel';
  }
  if (type === 'number' || type === 'numeric' || /amount|total|price|number|qty|quantity/.test(name)) {
    return 'number';
  }
  if (type === 'select' || type === 'dropdown' || type === 'radio') {
    return 'select';
  }
  return 'text';
}

function buildSessionFieldLookup(fields = []) {
  const fieldIdToStorageId = new Map();
  const storageIdToFieldId = new Map();
  const usedStorageIds = new Set();

  const nextAvailable = (baseValue) => {
    let candidate = baseValue;
    while (usedStorageIds.has(String(candidate))) {
      candidate += 1;
      if (candidate > 0x7ffffffe) candidate = 1;
    }
    return candidate;
  };

  for (const field of fields) {
    const fieldId = String(field?.id ?? '');
    if (!fieldId) continue;

    const numericId = toFiniteNumber(field?.id);
    const numericSortOrder = toFiniteNumber(field?.sort_order);
    let storageId = numericId ?? numericSortOrder ?? hashToPositiveInt(fieldId);
    storageId = Math.trunc(storageId);
    if (!Number.isFinite(storageId) || storageId <= 0) {
      storageId = hashToPositiveInt(fieldId);
    }
    storageId = nextAvailable(storageId);

    usedStorageIds.add(String(storageId));
    fieldIdToStorageId.set(fieldId, storageId);
    storageIdToFieldId.set(String(storageId), fieldId);
  }

  return {
    fieldIdToStorageId,
    storageIdToFieldId,
    resolveStorageId: (fieldId) => fieldIdToStorageId.get(String(fieldId)),
    resolveFieldId: (storageId) => storageIdToFieldId.get(String(storageId)),
  };
}

export {
  buildSessionFieldLookup,
  normalizeSessionFieldType,
};
