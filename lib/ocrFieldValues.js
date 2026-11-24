/**
 * Preserve user-entered field values across OCR re-runs (pure, unit-testable).
 *
 * The OCR save step deletes every `fields` row for the document and re-inserts
 * the freshly detected set. Without carry-over, that wipes anything the user
 * already typed (retry-analysis button, cron resumes that reach the save step).
 * These helpers snapshot existing values before the delete and re-apply them to
 * the new rows by field identity.
 *
 * Identity is name-based: (normalized field_name, page) first, then normalized
 * field_name alone when it is unambiguous in BOTH the old and new sets. A
 * renamed/moved field simply loses its value — never gets someone else's.
 */

const normName = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
const pageOf = (position) => {
  const p = position && typeof position === 'object' ? Number(position.page) : NaN;
  return Number.isFinite(p) ? p : null;
};
const hasValue = (v) => v !== null && v !== undefined && String(v) !== '';

/**
 * Build a snapshot of existing rows' values.
 * rows: [{ field_name, field_value, position }]
 * Returns { byNamePage: Map<'name|page', value>, byName: Map<name, value|AMBIGUOUS> }
 */
export function buildValueSnapshot(rows) {
  const AMBIGUOUS = Symbol('ambiguous');
  const byNamePage = new Map();
  const byName = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !hasValue(row.field_value)) continue;
    const name = normName(row.field_name);
    if (!name) continue;
    const page = pageOf(row.position);
    if (page !== null) {
      const key = `${name}|${page}`;
      // First value wins (reading order) — a duplicate name on the same page is
      // itself ambiguous, keep the earliest rather than silently overwriting.
      if (!byNamePage.has(key)) byNamePage.set(key, row.field_value);
    }
    if (byName.has(name)) byName.set(name, AMBIGUOUS);
    else byName.set(name, row.field_value);
  }
  return { byNamePage, byName, AMBIGUOUS };
}

/**
 * Apply a snapshot to the freshly built insert rows (mutates + returns them).
 * Only fills field_value when the row doesn't already carry one.
 */
export function applyPreservedValues(fieldsToInsert, snapshot) {
  if (!snapshot) return fieldsToInsert;
  const rows = Array.isArray(fieldsToInsert) ? fieldsToInsert : [];
  // Name-only fallback must also be unambiguous among the NEW rows.
  const newNameCounts = new Map();
  for (const row of rows) {
    const name = normName(row.field_name);
    newNameCounts.set(name, (newNameCounts.get(name) || 0) + 1);
  }
  let restored = 0;
  for (const row of rows) {
    if (hasValue(row.field_value)) continue;
    const name = normName(row.field_name);
    if (!name) continue;
    const page = pageOf(row.position);
    let value;
    if (page !== null && snapshot.byNamePage.has(`${name}|${page}`)) {
      value = snapshot.byNamePage.get(`${name}|${page}`);
    } else if (
      snapshot.byName.has(name) &&
      snapshot.byName.get(name) !== snapshot.AMBIGUOUS &&
      newNameCounts.get(name) === 1
    ) {
      value = snapshot.byName.get(name);
    }
    if (hasValue(value)) {
      row.field_value = value;
      restored += 1;
    }
  }
  return { fields: rows, restored };
}
