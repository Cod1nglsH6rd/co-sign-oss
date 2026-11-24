import { normalizeSessionFieldType } from '../../lib/sessionFieldMapping';

describe('normalizeSessionFieldType field-name matching', () => {
  it.each(['Hotel name', 'Ticket'])('maps %s to text', (name) => {
    expect(normalizeSessionFieldType('', name)).toBe('text');
  });

  it('maps Ticket number to number (number rule unchanged)', () => {
    expect(normalizeSessionFieldType('', 'Ticket number')).toBe('number');
  });

  it.each(['Telephone', 'Phone', 'Mobile Phone', 'Tel', 'Tel_no', 'telno', 'TelNo'])(
    'still maps %s to tel',
    (name) => {
      expect(normalizeSessionFieldType('', name)).toBe('tel');
    },
  );

  it.each(['Tick box', 'Tickbox', 'tick_box', 'Tickboxes', 'Tick', 'Checkbox'])(
    'still maps %s to checkbox',
    (name) => {
      expect(normalizeSessionFieldType('', name)).toBe('checkbox');
    },
  );
});
