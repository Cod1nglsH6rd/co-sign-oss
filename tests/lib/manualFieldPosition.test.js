/**
 * defaultManualPosition: where a field added by hand first appears on the
 * page. Same defaults as the setup screen's ensureFieldHasPosition: x 12%,
 * rows 7% apart from 18% (six rows, then back to the top), signature 28x5,
 * checkbox 4x3, anything else 22x3, all in page percent.
 */

function load() {
  const mod = require('../../lib/manualFieldPosition');
  return mod.defaultManualPosition;
}

describe('defaultManualPosition', () => {
  it('puts a text field in the first row of the given page', () => {
    const defaultManualPosition = load();
    expect(defaultManualPosition('text', 0, 1)).toEqual({
      page: 1, x: 12, y: 18, width: 22, height: 3, source: 'manual',
    });
  });

  it('makes a signature box 28 wide and 5 high, two rows down on page 3', () => {
    const defaultManualPosition = load();
    expect(defaultManualPosition('signature', 2, 3)).toEqual({
      page: 3, x: 12, y: 32, width: 28, height: 5, source: 'manual',
    });
  });

  it('makes a checkbox box 4 wide and 3 high', () => {
    const defaultManualPosition = load();
    expect(defaultManualPosition('checkbox', 1, 2)).toEqual({
      page: 2, x: 12, y: 25, width: 4, height: 3, source: 'manual',
    });
  });

  it('uses the sixth row for index 5 and wraps back to the top at index 6', () => {
    const defaultManualPosition = load();
    expect(defaultManualPosition('text', 5, 1).y).toBe(53);
    expect(defaultManualPosition('text', 6, 1).y).toBe(18);
  });

  it('falls back to page 1 and the first row when page and index are missing', () => {
    const defaultManualPosition = load();
    expect(defaultManualPosition('date')).toEqual({
      page: 1, x: 12, y: 18, width: 22, height: 3, source: 'manual',
    });
  });
});
