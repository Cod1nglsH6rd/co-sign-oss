/**
 * Deterministic checkbox/radio option labeling from AcroForm widget export
 * values. Step 2 vision labeling guesses which stacked checkbox is "Yes" vs
 * "No" and gets it wrong on dense forms. pdf-lib exposes each widget's export
 * value (the `/AP /N` "on"-state name) via `widget.getOnValue()`, which is
 * authoritative — but only for RADIO GROUPS, where each kid widget carries a
 * distinct option value. A standalone checkbox's on-value is typically a
 * generic "Yes", so we never "correct" based on those.
 *
 * Pure helpers here; the pdf-lib extraction lives in pages/api/ocr.js.
 */

/** Map a raw widget export value to a canonical Yes/No, or null if it isn't a clear token. */
export function normalizeOption(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'yes' || s === 'y') return 'Yes';
  if (s === 'no' || s === 'n') return 'No';
  return null; // off / on / numeric / arbitrary → not a clear, trustworthy option
}

/**
 * A display option for a radio widget's export value: a canonical Yes/No when
 * possible, else a short clean token (e.g. "FHA", "VA"), else null. "Off"/"On"
 * are generic appearance states, not real options.
 */
export function displayOption(exportValue) {
  const norm = normalizeOption(exportValue);
  if (norm) return norm;
  const s = String(exportValue ?? '').trim();
  const lower = s.toLowerCase();
  if (s && s.length <= 16 && lower !== 'off' && lower !== 'on' && /^[A-Za-z0-9][A-Za-z0-9 _/-]*$/.test(s)) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return null;
}

/** Strip a leading or trailing Yes/No token to recover the question label. */
export function stripOptionToken(name) {
  return String(name ?? '')
    .replace(/^(yes|no)\b[\s:.\-_]*/i, '')
    .replace(/[\s:.\-_]*\b(yes|no)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Find the extracted widget whose position best matches a field, within a small
 * tolerance (percentage units). Both come from the same `/Rect`, so a true match
 * is near-exact.
 * @param {object} field - has `.position` {page, x, y}
 * @param {Array} widgets - [{ page, x, y, exportValue, fieldKind, groupName }]
 * @param {number} tol - max |dx|+|dy| in % to accept
 */
export function matchWidget(field, widgets, tol = 1.5) {
  const pos = field && field.position;
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  const page = pos.page || 1;
  let best = null;
  let bestDist = Infinity;
  for (const w of widgets || []) {
    if (w.page !== page) continue;
    const dist = Math.abs(w.x - pos.x) + Math.abs(w.y - pos.y);
    if (dist < bestDist) { bestDist = dist; best = w; }
  }
  return best && bestDist <= tol ? best : null;
}

/**
 * Conservatively fix a Yes/No token in an AI-generated checkbox name using the
 * widget's deterministic export value. Only acts when:
 *   - the widget is a radio-group kid (export values are meaningful there), AND
 *   - its export value is a clear Yes/No, AND
 *   - the AI name contains the OPPOSITE token (a genuine contradiction).
 * Returns the original name otherwise (no guessing, no harm).
 */
export function correctOptionInName(aiName, widget) {
  if (!widget || widget.fieldKind !== 'radio') return aiName;
  const opt = normalizeOption(widget.exportValue);
  if (!opt) return aiName;
  const name = String(aiName || '');
  const hasNo = /\bno\b/i.test(name);
  const hasYes = /\byes\b/i.test(name);
  if (opt === 'Yes' && hasNo && !hasYes) return name.replace(/\bno\b/i, 'Yes');
  if (opt === 'No' && hasYes && !hasNo) return name.replace(/\byes\b/i, 'No');
  return aiName;
}
