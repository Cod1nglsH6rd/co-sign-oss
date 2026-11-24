import {
  normalizeOption, matchWidget, correctOptionInName, displayOption, stripOptionToken,
} from '../../lib/checkboxWidgets';

describe('displayOption', () => {
  it('returns canonical Yes/No', () => {
    expect(displayOption('Yes')).toBe('Yes');
    expect(displayOption('n')).toBe('No');
  });
  it('returns a short clean token capitalized', () => {
    expect(displayOption('FHA')).toBe('FHA');
    expect(displayOption('va')).toBe('Va');
  });
  it('rejects generic appearance states and junk', () => {
    expect(displayOption('Off')).toBeNull();
    expect(displayOption('On')).toBeNull();
    expect(displayOption('')).toBeNull();
    expect(displayOption('a very long arbitrary value here')).toBeNull();
  });
});

describe('stripOptionToken', () => {
  it('removes a trailing Yes/No', () => {
    expect(stripOptionToken('Interest Rate Rise No')).toBe('Interest Rate Rise');
    expect(stripOptionToken('Loan Balance Rise Yes')).toBe('Loan Balance Rise');
  });
  it('removes a leading Yes/No', () => {
    expect(stripOptionToken('No Monthly Escrow Payment')).toBe('Monthly Escrow Payment');
  });
  it('leaves names without a token alone', () => {
    expect(stripOptionToken('Cash To Seller')).toBe('Cash To Seller');
  });
});

describe('normalizeOption', () => {
  it('maps clear yes/no tokens', () => {
    expect(normalizeOption('Yes')).toBe('Yes');
    expect(normalizeOption('y')).toBe('Yes');
    expect(normalizeOption('NO')).toBe('No');
    expect(normalizeOption('n')).toBe('No');
  });
  it('returns null for generic / ambiguous export values', () => {
    for (const v of ['On', 'Off', '1', '2', 'true', 'Choice3', '', null, undefined]) {
      expect(normalizeOption(v)).toBeNull();
    }
  });
});

describe('matchWidget', () => {
  const widgets = [
    { page: 3, x: 48.4, y: 59.5, exportValue: 'No', fieldKind: 'radio' },
    { page: 3, x: 48.6, y: 61.7, exportValue: 'Yes', fieldKind: 'radio' },
    { page: 1, x: 21.2, y: 14.1, exportValue: 'FHA', fieldKind: 'radio' },
  ];
  it('matches the nearest same-page widget within tolerance', () => {
    const f = { position: { page: 3, x: 48.4, y: 59.6 } };
    expect(matchWidget(f, widgets)).toBe(widgets[0]);
  });
  it('does not match across pages', () => {
    const f = { position: { page: 2, x: 48.4, y: 59.5 } };
    expect(matchWidget(f, widgets)).toBeNull();
  });
  it('does not match when no widget is within tolerance', () => {
    const f = { position: { page: 3, x: 10, y: 10 } };
    expect(matchWidget(f, widgets)).toBeNull();
  });
  it('returns null without a usable position', () => {
    expect(matchWidget({ position: null }, widgets)).toBeNull();
    expect(matchWidget({}, widgets)).toBeNull();
  });
});

describe('correctOptionInName', () => {
  it('fixes a contradicting Yes/No token on a radio widget', () => {
    // Widget is really the "Yes" option but AI labeled it "...No"
    expect(correctOptionInName('Interest Rate Rise No', { fieldKind: 'radio', exportValue: 'Yes' }))
      .toBe('Interest Rate Rise Yes');
    expect(correctOptionInName('Loan Balance Rise Yes', { fieldKind: 'radio', exportValue: 'No' }))
      .toBe('Loan Balance Rise No');
  });
  it('leaves the name alone when it already agrees', () => {
    expect(correctOptionInName('Interest Rate Rise No', { fieldKind: 'radio', exportValue: 'No' }))
      .toBe('Interest Rate Rise No');
  });
  it('does not touch standalone checkboxes (generic export values)', () => {
    expect(correctOptionInName('Cash To Seller', { fieldKind: 'checkbox', exportValue: 'Yes' }))
      .toBe('Cash To Seller');
  });
  it('does nothing when the export value is not a clear yes/no', () => {
    expect(correctOptionInName('Some Option No', { fieldKind: 'radio', exportValue: '1' }))
      .toBe('Some Option No');
  });
  it('does not touch a name with both or neither token', () => {
    expect(correctOptionInName('Interest Rate Rise', { fieldKind: 'radio', exportValue: 'Yes' }))
      .toBe('Interest Rate Rise');
  });
});
