import { FIELD_PALETTE, colorForIndex } from '../../lib/fieldColors';

describe('colorForIndex', () => {
  it('returns a palette entry for each index', () => {
    for (let i = 0; i < FIELD_PALETTE.length; i += 1) {
      expect(colorForIndex(i)).toBe(FIELD_PALETTE[i]);
    }
  });
  it('cycles through the palette', () => {
    expect(colorForIndex(FIELD_PALETTE.length)).toBe(FIELD_PALETTE[0]);
    expect(colorForIndex(FIELD_PALETTE.length + 2)).toBe(FIELD_PALETTE[2]);
  });
  it('is stable for the same index (sidebar ↔ box match)', () => {
    expect(colorForIndex(5)).toBe(colorForIndex(5));
  });
  it('handles negatives and non-numbers safely', () => {
    expect(FIELD_PALETTE).toContain(colorForIndex(-1));
    expect(colorForIndex(undefined)).toBe(FIELD_PALETTE[0]);
    expect(colorForIndex(null)).toBe(FIELD_PALETTE[0]);
  });
});
