import { positionValueInBlank, matchFieldsToTextItems } from '../../lib/textLayerPositioning';

describe('positionValueInBlank', () => {
  it('places the value in the underscore run, not on the label', () => {
    const item = { page: 1, x: 10, y: 50, width: 40, text: 'Buyer Name: ____________' };
    const pos = positionValueInBlank(item, 'buyer name', 'text');
    // blank starts ~12 chars into a 24-char item, so x should be well right of the item start
    expect(pos.x).toBeGreaterThan(item.x);
    expect(pos.source).toBe('text-match');
    expect(pos.page).toBe(1);
  });

  it('falls back to just-after-label when there is no underscore run', () => {
    const item = { page: 2, x: 5, y: 30, width: 30, text: 'Phone: ' };
    const pos = positionValueInBlank(item, 'phone', 'text');
    expect(pos.x).toBeGreaterThanOrEqual(item.x);
    expect(pos.page).toBe(2);
  });
});

describe('matchFieldsToTextItems — collision avoidance', () => {
  it('returns [] for no fields', () => {
    expect(matchFieldsToTextItems([], [], 0)).toEqual([]);
    expect(matchFieldsToTextItems(null, [], 0)).toEqual([]);
  });

  it('routes two same-label fields on one row to DIFFERENT columns (no collision)', () => {
    // A two-column form: left "Listing" column and right "Selling" column both
    // print "Phone:" on the same row. The AI returns two fields with the same
    // label_text and the same approx_y but no column hint.
    const textItems = [
      { page: 1, x: 27, y: 40, width: 20, text: 'Phone: __________' }, // left column
      { page: 1, x: 76, y: 40, width: 20, text: 'Phone: __________' }, // right column
    ];
    const fields = [
      { field_name: 'listing_phone', label_text: 'Phone', field_type: 'text', approx_page: 1, approx_y: 40 },
      { field_name: 'selling_phone', label_text: 'Phone', field_type: 'text', approx_page: 1, approx_y: 40 },
    ];

    const out = matchFieldsToTextItems(fields, textItems, 0);
    expect(out).toHaveLength(2);
    expect(out[0].position).not.toBeNull();
    expect(out[1].position).not.toBeNull();

    // The two fields must not collapse onto the same coordinate.
    expect(out[0].position.x).not.toBeCloseTo(out[1].position.x, 1);
    // Reading order: the first field claims the left (smaller x) occurrence.
    expect(out[0].position.x).toBeLessThan(out[1].position.x);
    expect(out.every((f) => f.position.source === 'text-match')).toBe(true);
  });

  it('prefers the same-row occurrence over a closer-x item on another row', () => {
    const textItems = [
      { page: 1, x: 10, y: 80, width: 20, text: 'Date: ______' }, // far row, smallest x
      { page: 1, x: 50, y: 20, width: 20, text: 'Date: ______' }, // target row
    ];
    const fields = [
      { field_name: 'signing_date', label_text: 'Date', field_type: 'date', approx_page: 1, approx_y: 20 },
    ];
    const out = matchFieldsToTextItems(fields, textItems, 0);
    // Row distance dominates: it should claim the y≈20 item even though its x is
    // larger. y is anchored ~2% above baseline 20 (=18), distinct from the y≈80
    // row (=78); x lands in the blank of the right-hand item (>50).
    expect(out[0].position.y).toBeLessThan(30);
    expect(out[0].position.x).toBeGreaterThan(50);
  });

  it('single-column form still positions each distinct field (no regression)', () => {
    const textItems = [
      { page: 1, x: 10, y: 20, width: 40, text: 'Buyer Name: ____________' },
      { page: 1, x: 10, y: 30, width: 40, text: 'Seller Name: ____________' },
      { page: 1, x: 10, y: 40, width: 40, text: 'Sale Price: ____________' },
    ];
    const fields = [
      { field_name: 'buyer_name', label_text: 'Buyer Name', field_type: 'text', approx_page: 1, approx_y: 20 },
      { field_name: 'seller_name', label_text: 'Seller Name', field_type: 'text', approx_page: 1, approx_y: 30 },
      { field_name: 'sale_price', label_text: 'Sale Price', field_type: 'text', approx_page: 1, approx_y: 40 },
    ];
    const out = matchFieldsToTextItems(fields, textItems, 100);
    expect(out).toHaveLength(3);
    const ys = out.map((f) => f.position.y);
    // distinct rows -> distinct y positions
    expect(new Set(ys).size).toBe(3);
    expect(out[0].sort_order).toBe(100);
    expect(out[2].sort_order).toBe(102);
  });

  it('falls back to a nearby unused underscore run when no label matches', () => {
    const textItems = [
      { page: 1, x: 15, y: 60, width: 30, text: '________________' },
    ];
    const fields = [
      { field_name: 'mystery', label_text: 'Nonexistent Label', field_type: 'text', approx_page: 1, approx_y: 60 },
    ];
    const out = matchFieldsToTextItems(fields, textItems, 0);
    expect(out[0].position).not.toBeNull();
    expect(out[0].position.source).toBe('ai-estimated');
  });

  it('does not reuse an underscore run already claimed by a labeled field', () => {
    // One labeled blank and one unlabeled field on the same row: the labeled
    // field claims the item; the unlabeled field must not reuse it.
    const textItems = [
      { page: 1, x: 15, y: 60, width: 30, text: 'Phone: __________' },
    ];
    const fields = [
      { field_name: 'phone', label_text: 'Phone', field_type: 'text', approx_page: 1, approx_y: 60 },
      { field_name: 'other', label_text: 'Nonexistent', field_type: 'text', approx_page: 1, approx_y: 60 },
    ];
    const out = matchFieldsToTextItems(fields, textItems, 0);
    expect(out[0].position.source).toBe('text-match');
    // Second field can't reuse the consumed item; it falls back to the AI coord.
    expect(out[1].position.source).toBe('ai-estimated');
    expect(out[1].position.x).not.toBeCloseTo(out[0].position.x, 1);
  });
});

// Same-line value snapping: label:value templates render the answer as its own
// right-aligned item; the box must land on it, not in the empty middle.
import { findSameLineValueItem } from '../../lib/textLayerPositioning';

describe('findSameLineValueItem', () => {
  const label = { page: 1, x: 44, y: 14.5, width: 7, text: 'INVOICE #' };

  it('finds a right-aligned value on the same line', () => {
    const items = [
      label,
      { page: 1, x: 75, y: 14.4, width: 9, text: 'INV-2026-001' },
    ];
    expect(findSameLineValueItem(label, items, new Set())).toBe(items[1]);
  });

  it('accepts underscore runs as fillable slots', () => {
    const items = [label, { page: 1, x: 60, y: 14.6, width: 20, text: '____________' }];
    expect(findSameLineValueItem(label, items, new Set())).toBe(items[1]);
  });

  it('ignores same-line text without digits or underscores (table headers)', () => {
    const qty = { page: 1, x: 55, y: 29, width: 6, text: 'Quantity' };
    const items = [qty, { page: 1, x: 66, y: 29, width: 7, text: 'Unit Price' }, { page: 1, x: 82, y: 29, width: 6, text: 'Amount' }];
    expect(findSameLineValueItem(qty, items, new Set())).toBe(null);
  });

  it('ignores items on other lines, other pages, or left of the label', () => {
    const items = [
      label,
      { page: 1, x: 75, y: 20, width: 9, text: '123' },       // other line
      { page: 2, x: 75, y: 14.5, width: 9, text: '123' },     // other page
      { page: 1, x: 10, y: 14.5, width: 9, text: '123' },     // left of label
    ];
    expect(findSameLineValueItem(label, items, new Set())).toBe(null);
  });

  it('prefers the nearest value when several qualify', () => {
    const items = [
      label,
      { page: 1, x: 85, y: 14.5, width: 5, text: '999' },
      { page: 1, x: 60, y: 14.5, width: 5, text: '111' },
    ];
    expect(findSameLineValueItem(label, items, new Set()).text).toBe('111');
  });
});

describe('positionValueInBlank with a same-line value item', () => {
  it('snaps the box onto the value item', () => {
    const label = { page: 1, x: 44, y: 14.5, width: 7, text: 'INVOICE #' };
    const value = { page: 1, x: 75, y: 14.4, width: 9, text: 'INV-2026-001' };
    const pos = positionValueInBlank(label, 'invoice #', 'text', value);
    expect(pos.x).toBeCloseTo(74.5, 1);
    expect(pos.y).toBeCloseTo(12.4, 1);
    expect(pos.width).toBeGreaterThanOrEqual(11);
  });

  it('keeps the after-label behavior when no value item is given', () => {
    const label = { page: 1, x: 44, y: 14.5, width: 7, text: 'INVOICE #' };
    const pos = positionValueInBlank(label, 'invoice #', 'text', null);
    expect(pos.x).toBeGreaterThanOrEqual(44);
    expect(pos.source).toBe('text-match');
  });
});

describe('matchFieldsToTextItems same-line snapping integration', () => {
  it('positions a label:value field on the value, not after the label', () => {
    const items = [
      { page: 1, x: 44, y: 14.5, width: 7, text: 'INVOICE #' },
      { page: 1, x: 75, y: 14.4, width: 9, text: 'INV-2026-001' },
    ];
    const fields = [{ field_name: 'Invoice Number', label_text: 'INVOICE #', field_type: 'text', approx_page: 1, approx_y: 14 }];
    const [out] = matchFieldsToTextItems(fields, items, 0);
    expect(out.position.x).toBeGreaterThan(70);
  });

  it('does not snap when the label item already has an inline blank', () => {
    const items = [
      { page: 1, x: 10, y: 30, width: 40, text: 'Buyer Name: ____________' },
      { page: 1, x: 70, y: 30, width: 9, text: '12345' },
    ];
    const fields = [{ field_name: 'Buyer Name', label_text: 'Buyer Name', field_type: 'text', approx_page: 1, approx_y: 30 }];
    const [out] = matchFieldsToTextItems(fields, items, 0);
    expect(out.position.x).toBeLessThan(60);
  });
});

import { findBelowValueItem } from '../../lib/textLayerPositioning';

describe('same-line snapping: first-right-only rule', () => {
  it('does not steal a value that belongs to a different label on the line', () => {
    const customer = { page: 1, x: 8, y: 12.6, width: 8, text: 'CUSTOMER' };
    const items = [
      customer,
      { page: 1, x: 52, y: 12.6, width: 10, text: 'STATEMENT #' },   // first-right, not value-like
      { page: 1, x: 76, y: 12.6, width: 12, text: 'ST-2077-0415' },  // belongs to STATEMENT #
    ];
    expect(findSameLineValueItem(customer, items, new Set())).toBe(null);
  });
});

describe('findBelowValueItem (label-above-value)', () => {
  const label = { page: 1, x: 8, y: 12.6, width: 8, text: 'CUSTOMER' };

  it('finds the left-aligned value on the next line', () => {
    const items = [label, { page: 1, x: 8.2, y: 14.9, width: 12, text: 'Nguyen Van Minh' }];
    expect(findBelowValueItem(label, items, new Set())).toBe(items[1]);
  });

  it('rejects items too far below or not left-aligned', () => {
    const items = [
      label,
      { page: 1, x: 8, y: 18, width: 12, text: 'Too far down' },
      { page: 1, x: 30, y: 14.9, width: 12, text: 'Wrong column' },
    ];
    expect(findBelowValueItem(label, items, new Set())).toBe(null);
  });
});

describe('matchFieldsToTextItems label-above-value integration', () => {
  it('positions CUSTOMER on the name below it, not on another column value', () => {
    const items = [
      { page: 1, x: 8, y: 12.6, width: 8, text: 'CUSTOMER' },
      { page: 1, x: 52, y: 12.6, width: 10, text: 'STATEMENT #' },
      { page: 1, x: 76, y: 12.6, width: 12, text: 'ST-2077-0415' },
      { page: 1, x: 8.2, y: 14.9, width: 12, text: 'Nguyen Van Minh' },
    ];
    const fields = [
      { field_name: 'Customer Name', label_text: 'CUSTOMER', field_type: 'text', approx_page: 1, approx_y: 13 },
      { field_name: 'Statement Number', label_text: 'STATEMENT #', field_type: 'text', approx_page: 1, approx_y: 13 },
    ];
    const [cust, stmt] = matchFieldsToTextItems(fields, items, 0);
    expect(cust.position.x).toBeLessThan(20);
    expect(cust.position.y).toBeGreaterThan(12);
    expect(stmt.position.x).toBeGreaterThan(70);
  });
});

describe('order independence of value snapping', () => {
  const items = () => [
    { page: 1, x: 8, y: 12.6, width: 8, text: 'CUSTOMER' },
    { page: 1, x: 52, y: 12.6, width: 10, text: 'STATEMENT #' },
    { page: 1, x: 76, y: 12.6, width: 12, text: 'ST-2077-0415' },
    { page: 1, x: 8.2, y: 14.9, width: 12, text: 'Nguyen Van Minh' },
  ];
  const fCustomer = { field_name: 'Customer Name', label_text: 'CUSTOMER', field_type: 'text', approx_page: 1, approx_y: 13 };
  const fStatement = { field_name: 'Statement Number', label_text: 'STATEMENT #', field_type: 'text', approx_page: 1, approx_y: 13 };

  it('customer first: correct', () => {
    const [cust, stmt] = matchFieldsToTextItems([fCustomer, fStatement], items(), 0);
    expect(cust.position.x).toBeLessThan(20);
    expect(stmt.position.x).toBeGreaterThan(70);
  });

  it('statement first (claimed-label adjacency): still correct', () => {
    const [stmt, cust] = matchFieldsToTextItems([fStatement, fCustomer], items(), 0);
    expect(stmt.position.x).toBeGreaterThan(70);
    // CUSTOMER must NOT steal ST-2077-0415 just because STATEMENT # was claimed
    expect(cust.position.x).toBeLessThan(20);
    expect(cust.position.y).toBeGreaterThan(12);
  });
});

import { findWrappedLineBlankItem } from '../../lib/textLayerPositioning';

describe('label-fills-item anchoring (comb/boxed fields)', () => {
  it('anchors after the item when the label consumes it entirely', () => {
    // "Social Security Number:" followed by drawn comb boxes the text layer
    // cannot see — the box must not cover the label.
    const item = { page: 1, x: 8.2, y: 20.5, width: 21, text: 'Social Security Number:' };
    const pos = positionValueInBlank(item, 'social security number', 'text', null);
    expect(pos.x).toBeCloseTo(29.2, 1);
  });

  it('still positions inside the item when text follows the label', () => {
    const item = { page: 1, x: 10, y: 30, width: 40, text: 'Name: John' };
    const pos = positionValueInBlank(item, 'name', 'text', null);
    expect(pos.x).toBeLessThan(50);
  });
});

describe('findWrappedLineBlankItem (sentence-wrap blanks)', () => {
  const landlordLabel = { page: 1, x: 54.7, y: 11.6, width: 16, text: 'between the Landlord,' };
  const wrapItems = () => [
    { page: 1, x: 38.1, y: 11.6, width: 15, text: '__________________' },
    landlordLabel,
    { page: 1, x: 8.2, y: 14.1, width: 25.8, text: '______________________________' },
    { page: 1, x: 34.3, y: 14.1, width: 13, text: ', and the Tenant,' },
    { page: 1, x: 47.7, y: 14.1, width: 25.8, text: '______________________________' },
  ];

  it('snaps a line-ending label to the underscore opening the next line', () => {
    const found = findWrappedLineBlankItem(landlordLabel, wrapItems(), new Set());
    expect(found).not.toBe(null);
    expect(found.x).toBeCloseTo(8.2, 1);
  });

  it('returns null when the sentence continues on the same line', () => {
    const items = wrapItems();
    items.push({ page: 1, x: 72, y: 11.6, width: 10, text: 'whose address is' });
    expect(findWrappedLineBlankItem(landlordLabel, items, new Set())).toBe(null);
  });

  it('returns null when the next line does not open with an underscore run', () => {
    const items = [
      landlordLabel,
      { page: 1, x: 8.2, y: 14.1, width: 20, text: 'some continuing prose here' },
    ];
    expect(findWrappedLineBlankItem(landlordLabel, items, new Set())).toBe(null);
  });

  it('integration: the landlord blank lands on the next-line underscore', () => {
    const fields = [
      { field_name: 'Landlord Name', label_text: 'Landlord', field_type: 'text', approx_page: 1, approx_y: 12 },
    ];
    const [out] = matchFieldsToTextItems(fields, wrapItems(), 0);
    expect(out.position.x).toBeLessThan(20);
    expect(out.position.y).toBeGreaterThan(11.5);
  });
});

import { findGlyphLeftOfOption } from '../../lib/textLayerPositioning';

describe('glyph checkbox option positioning', () => {
  // "Marital Status:  [  ] Single   [  ] Married   [  ] Divorced"
  const bracketItems = () => [
    { page: 1, x: 8.2, y: 17.9, width: 12.5, text: 'Marital Status:' },
    { page: 1, x: 29.4, y: 17.9, width: 2.4, text: '[  ]' },
    { page: 1, x: 34.0, y: 17.9, width: 5.5, text: 'Single' },
    { page: 1, x: 49.0, y: 17.9, width: 2.4, text: '[  ]' },
    { page: 1, x: 53.6, y: 17.9, width: 7.0, text: 'Married' },
    { page: 1, x: 70.3, y: 17.9, width: 2.4, text: '[  ]' },
    { page: 1, x: 74.8, y: 17.9, width: 7.8, text: 'Divorced' },
  ];

  it('finds the bracket glyph immediately left of an option', () => {
    const items = bracketItems();
    const married = items[4];
    const glyph = findGlyphLeftOfOption(married, items);
    expect(glyph).not.toBe(null);
    expect(glyph.x).toBeCloseTo(49.0, 1);
  });

  it('positions a checkbox field on its option bracket, not the question label', () => {
    const fields = [
      { field_name: 'Marital Status Married', label_text: 'Marital Status - Married', field_type: 'checkbox', approx_page: 1, approx_y: 18 },
    ];
    const [out] = matchFieldsToTextItems(fields, bracketItems(), 0);
    expect(out.position.x).toBeGreaterThan(45);
    expect(out.position.x).toBeLessThan(53);
  });

  it('falls back to a left offset when the box is drawn graphics (no glyph item)', () => {
    const items = [
      { page: 1, x: 8.2, y: 24.2, width: 14.5, text: 'Preferred Contact:' },
      { page: 1, x: 35.9, y: 24.2, width: 5.0, text: 'Email' },
      { page: 1, x: 55.6, y: 24.2, width: 5.2, text: 'Phone' },
    ];
    const fields = [
      { field_name: 'Preferred Contact Phone', label_text: 'Preferred Contact - Phone', field_type: 'checkbox', approx_page: 1, approx_y: 24 },
    ];
    const [out] = matchFieldsToTextItems(fields, items, 0);
    expect(out.position.x).toBeCloseTo(51.8, 1);
  });

  it('does not option-position non-checkbox fields', () => {
    const items = [
      { page: 1, x: 8.2, y: 30, width: 10, text: 'Married' },
      { page: 1, x: 8.2, y: 40, width: 30, text: 'Married Name: ____________' },
    ];
    const fields = [
      { field_name: 'Married Name', label_text: 'Married Name', field_type: 'text', approx_page: 1, approx_y: 40 },
    ];
    const [out] = matchFieldsToTextItems(fields, items, 0);
    expect(out.position.y).toBeGreaterThan(35);
  });
});

describe('glyph checkbox: merged and question-label-only cases', () => {
  it('finds the option inside a merged "[  ] Married" item', () => {
    const items = [
      { page: 1, x: 8.2, y: 17.9, width: 12.5, text: 'Marital Status:' },
      { page: 1, x: 29.4, y: 17.9, width: 10.1, text: '[  ] Single' },
      { page: 1, x: 49.0, y: 17.9, width: 11.6, text: '[  ] Married' },
    ];
    const fields = [
      { field_name: 'Marital Status Married', label_text: 'Marital Status - Married', field_type: 'checkbox', approx_page: 1, approx_y: 18 },
    ];
    const [out] = matchFieldsToTextItems(fields, items, 0);
    expect(out.position.x).toBeCloseTo(49.0, 1);
  });

  it('does not offset-position on the question label when label_text lacks the option', () => {
    // AI label_text is just "Marital Status"; the option lives in field_name.
    const items = [
      { page: 1, x: 8.2, y: 17.9, width: 12.5, text: 'Marital Status:' },
      { page: 1, x: 29.4, y: 17.9, width: 10.1, text: '[  ] Single' },
      { page: 1, x: 49.0, y: 17.9, width: 11.6, text: '[  ] Married' },
    ];
    const fields = [
      { field_name: 'Marital Status Single', label_text: 'Marital Status', field_type: 'checkbox', approx_page: 1, approx_y: 18 },
    ];
    const [out] = matchFieldsToTextItems(fields, items, 0);
    expect(out.position.x).toBeCloseTo(29.4, 1);
  });

  it('two option fields on one merged line claim distinct spans', () => {
    const items = [
      { page: 1, x: 8.2, y: 17.9, width: 74, text: 'Marital Status:   [  ] Single   [  ] Married' },
    ];
    const fields = [
      { field_name: 'Marital Status Single', label_text: 'Marital Status', field_type: 'checkbox', approx_page: 1, approx_y: 18 },
      { field_name: 'Marital Status Married', label_text: 'Marital Status', field_type: 'checkbox', approx_page: 1, approx_y: 18 },
    ];
    const [single, married] = matchFieldsToTextItems(fields, items, 0);
    expect(single.position.x).toBeGreaterThan(20);
    expect(married.position.x).toBeGreaterThan(single.position.x + 10);
  });
});

import { detectFlatPageBlanks } from '../../lib/textLayerPositioning';

describe('detectFlatPageBlanks (flat-page augmentation for hybrid docs)', () => {
  const widgetFields = () => [
    { field_name: 'policy_number', position: { page: 1, x: 27.7, y: 10.8, width: 36, height: 2.9, source: 'acroform' } },
  ];
  const page2Items = () => [
    { page: 2, x: 13.1, y: 6.6, width: 60, text: 'Insurance Claim — Part 2 (Witness statement)' },
    { page: 2, x: 8.2, y: 12.9, width: 9.5, text: 'Witness Name:' },
    { page: 2, x: 19.5, y: 12.9, width: 40, text: '______________________________' },
    { page: 2, x: 8.2, y: 17.9, width: 10, text: 'Witness Phone:' },
    { page: 2, x: 20.2, y: 17.9, width: 39, text: '_____________________________' },
    { page: 2, x: 8.2, y: 81.1, width: 13, text: 'Witness Signature:' },
    { page: 2, x: 22.5, y: 81.1, width: 30, text: '____________________' },
  ];

  it('creates positioned fields for labeled blanks on widget-less pages', () => {
    const out = detectFlatPageBlanks(widgetFields(), page2Items(), 0);
    const names = out.map(f => f.field_name);
    expect(names).toEqual(expect.arrayContaining(['Witness Name', 'Witness Phone', 'Witness Signature']));
    const name = out.find(f => f.field_name === 'Witness Name');
    expect(name.position.page).toBe(2);
    expect(name.position.x).toBeGreaterThan(15);
    const sig = out.find(f => f.field_name === 'Witness Signature');
    expect(sig.field_type).toBe('signature');
    const phone = out.find(f => f.field_name === 'Witness Phone');
    expect(phone.field_type).toBe('tel');
  });

  it('ignores pages that already have widget fields', () => {
    const items = [
      ...page2Items(),
      { page: 1, x: 8.2, y: 40, width: 30, text: 'Ignored Blank: ________' },
    ];
    const out = detectFlatPageBlanks(widgetFields(), items, 0);
    expect(out.every(f => f.position.page === 2)).toBe(true);
  });

  it('handles merged "Label: ____" single items', () => {
    const items = [{ page: 3, x: 8.2, y: 20, width: 45, text: 'Incident Location: ____________________' }];
    const out = detectFlatPageBlanks(widgetFields(), items, 0);
    expect(out).toHaveLength(1);
    expect(out[0].field_name).toBe('Incident Location');
    expect(out[0].position.x).toBeGreaterThan(8.2 + 10);
  });

  it('returns nothing when no underscore runs exist off-widget pages', () => {
    const items = [{ page: 2, x: 8.2, y: 20, width: 45, text: 'Just some paragraph text here.' }];
    expect(detectFlatPageBlanks(widgetFields(), items, 0)).toHaveLength(0);
  });
});
