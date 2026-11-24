import { buildValueSnapshot, applyPreservedValues } from '../../lib/ocrFieldValues';

const row = (field_name, field_value, page) => ({
  field_name,
  field_value,
  position: page != null ? { page, x: 1, y: 1 } : null,
});

describe('buildValueSnapshot', () => {
  it('keeps only rows with non-empty values', () => {
    const snap = buildValueSnapshot([
      row('Name', 'Alice', 1),
      row('Empty', '', 1),
      row('Nullish', null, 1),
    ]);
    expect(snap.byNamePage.get('name|1')).toBe('Alice');
    expect(snap.byNamePage.has('empty|1')).toBe(false);
    expect(snap.byName.has('nullish')).toBe(false);
  });

  it('normalizes names (trim, case, inner whitespace)', () => {
    const snap = buildValueSnapshot([row('  First   Name ', 'x', 2)]);
    expect(snap.byNamePage.get('first name|2')).toBe('x');
  });

  it('marks duplicate names as ambiguous for the name-only fallback', () => {
    const snap = buildValueSnapshot([row('Phone', 'a', 1), row('Phone', 'b', 2)]);
    expect(snap.byName.get('phone')).toBe(snap.AMBIGUOUS);
    // ...but page-scoped lookups still work
    expect(snap.byNamePage.get('phone|1')).toBe('a');
    expect(snap.byNamePage.get('phone|2')).toBe('b');
  });

  it('first value wins for duplicate name+page', () => {
    const snap = buildValueSnapshot([row('SSN', 'first', 1), row('SSN', 'second', 1)]);
    expect(snap.byNamePage.get('ssn|1')).toBe('first');
  });

  it('handles rows without positions', () => {
    const snap = buildValueSnapshot([row('Notes', 'hello', null)]);
    expect(snap.byName.get('notes')).toBe('hello');
    expect(snap.byNamePage.size).toBe(0);
  });
});

describe('applyPreservedValues', () => {
  it('restores by name+page', () => {
    const snap = buildValueSnapshot([row('Name', 'Alice', 1), row('Name', 'Bob', 2)]);
    const inserts = [row('Name', undefined, 1), row('Name', undefined, 2)];
    const { restored } = applyPreservedValues(inserts, snap);
    expect(restored).toBe(2);
    expect(inserts[0].field_value).toBe('Alice');
    expect(inserts[1].field_value).toBe('Bob');
  });

  it('falls back to unambiguous name-only match when the page moved', () => {
    const snap = buildValueSnapshot([row('Email', 'a@b.c', 1)]);
    const inserts = [row('Email', undefined, 3)];
    const { restored } = applyPreservedValues(inserts, snap);
    expect(restored).toBe(1);
    expect(inserts[0].field_value).toBe('a@b.c');
  });

  it('never applies an ambiguous old value via the name-only fallback', () => {
    const snap = buildValueSnapshot([row('Phone', 'a', 1), row('Phone', 'b', 2)]);
    // New set has the field on a NEW page (5), so no page match — must not guess.
    const inserts = [row('Phone', undefined, 5)];
    const { restored } = applyPreservedValues(inserts, snap);
    expect(restored).toBe(0);
    expect(inserts[0].field_value).toBeUndefined();
  });

  it('skips the name-only fallback when the NEW set has duplicate names', () => {
    const snap = buildValueSnapshot([row('Date', '2026-01-01', 1)]);
    const inserts = [row('Date', undefined, 3), row('Date', undefined, 4)];
    const { restored } = applyPreservedValues(inserts, snap);
    expect(restored).toBe(0);
  });

  it('does not overwrite a value already on the new row', () => {
    const snap = buildValueSnapshot([row('Name', 'old', 1)]);
    const inserts = [row('Name', 'new', 1)];
    const { restored } = applyPreservedValues(inserts, snap);
    expect(restored).toBe(0);
    expect(inserts[0].field_value).toBe('new');
  });

  it('renamed fields simply lose their value', () => {
    const snap = buildValueSnapshot([row('Old Label', 'keepme', 1)]);
    const inserts = [row('New Label', undefined, 1)];
    const { restored } = applyPreservedValues(inserts, snap);
    expect(restored).toBe(0);
  });

  it('tolerates null snapshot and empty inputs', () => {
    expect(applyPreservedValues([], buildValueSnapshot([]))).toEqual({ fields: [], restored: 0 });
    expect(applyPreservedValues([row('A', undefined, 1)], null)).toEqual([row('A', undefined, 1)]);
  });
});
