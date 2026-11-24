// Field translation accessors.
// Convention: bare column = English (`field_name`, `explanation`, `position_hint`).
// Other languages use `<base>_<iso>` (`field_name_vi`, `explanation_vi`, `position_hint_vi`, etc.).
// To add a new language: add ISO code to SUPPORTED_LANGUAGES and add three `<base>_<code>` columns.

const SUPPORTED_LANGUAGES = ['en', 'vi', 'es', 'pt', 'fr', 'zh', 'yue', 'ht', 'ne'];

function normalizeLang(lang) {
  const l = String(lang || 'en').toLowerCase();
  return SUPPORTED_LANGUAGES.includes(l) ? l : 'en';
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).length > 0) return v;
  }
  return '';
}

// Conservative, display-only tidy-up for detected field labels. Detected names
// can carry layout noise (collapsed runs of spaces, stray leading bullets, a
// trailing colon). We intentionally do NOT strip leading numbers or words —
// those are often meaningful on forms (line numbers, "1099", dollar amounts) —
// so this only removes clearly non-semantic artifacts. The original value is
// preserved on the field for chat context and tooltips.
// Humanize a *technical* field name (no spaces, XFA/dotted/camelCase) into
// readable words — e.g. "topmostSubform[0].Page1[0].BusinessName[0]" ->
// "Business Name", "SignatureOfEmployee" -> "Signature Of Employee". Returns
// null when there's no useful signal (opaque names like "f1_01", "c1_1"),
// so the caller leaves those to the existing generic-label handling.
function humanizeTechnicalName(raw) {
  const v = String(raw || '').trim();
  if (!v || /\s/.test(v)) return null; // has spaces → already human
  const looksTechnical = /[.\[\]_]/.test(v) || /[a-z][A-Z]/.test(v);
  if (!looksTechnical) return null;
  // Last dotted segment, drop trailing [n] indices.
  let seg = v.split('.').pop().replace(/\[\d+\]/g, '').trim();
  // Split camelCase and separators into words.
  let words = seg
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop obvious structural noise tokens.
  words = words.split(' ').filter(w => !/^(topmostSubform|form\d*|subform|page\d*)$/i.test(w)).join(' ');
  // Reject opaque results (empty, or generic field codes like f1 01 / c1 1).
  if (!words) return null;
  if (/^[a-z]?\d/i.test(words.replace(/\s/g, '')) && !/[a-z]{3,}/i.test(words)) return null;
  if (!/[a-z]{2,}/i.test(words)) return null;
  // Title-case.
  return words.replace(/\b\w/g, c => c.toUpperCase());
}

function prettifyLabel(value) {
  const humanized = humanizeTechnicalName(value);
  let s = String(humanized || value || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[•·\-–—*•\s]+/, '');   // stray leading bullets/dashes
  s = s.replace(/\s*:\s*$/, '');                // trailing colon
  // Collapse consecutive duplicate words (case-insensitive), e.g.
  // "Account Number Number" -> "Account Number". Conservative: only adjacent
  // identical words, so distinct phrases like "Given Name First Name" stay.
  s = s.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');
  return s.trim() || String(value || '').trim();
}

function getLabel(field, lang) {
  const l = normalizeLang(lang);
  const raw = l === 'en'
    ? firstNonEmpty(field?.field_name)
    : firstNonEmpty(field?.[`field_name_${l}`], field?.field_name);
  return prettifyLabel(raw);
}

function getExplanation(field, lang) {
  const l = normalizeLang(lang);
  if (l === 'en') return firstNonEmpty(field?.explanation);
  return firstNonEmpty(field?.[`explanation_${l}`], field?.explanation);
}

function getPositionHint(field, lang) {
  const l = normalizeLang(lang);
  if (l === 'en') return firstNonEmpty(field?.position_hint);
  return firstNonEmpty(field?.[`position_hint_${l}`], field?.position_hint);
}

function getAllTranslations(field) {
  const out = {};
  for (const l of SUPPORTED_LANGUAGES) out[l] = getLabel(field, l);
  return out;
}

export {
  SUPPORTED_LANGUAGES,
  getLabel,
  getExplanation,
  getPositionHint,
  getAllTranslations,
  prettifyLabel,
};
