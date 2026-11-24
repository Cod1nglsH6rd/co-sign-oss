/**
 * Stable per-field colors so a field's sidebar entry and its box on the PDF can
 * be visually linked. Color is assigned by the field's index in the (ordered)
 * field list, so the sidebar and the viewer — which both receive the same list —
 * agree as long as they look up the same index.
 */

export const FIELD_PALETTE = [
  { border: '#2563eb', bg: 'rgba(37,99,235,0.14)', dot: '#2563eb' },  // blue
  { border: '#16a34a', bg: 'rgba(22,163,74,0.14)', dot: '#16a34a' },  // green
  { border: '#ea580c', bg: 'rgba(234,88,12,0.15)', dot: '#ea580c' },  // orange
  { border: '#db2777', bg: 'rgba(219,39,119,0.14)', dot: '#db2777' }, // pink
  { border: '#7c3aed', bg: 'rgba(124,58,237,0.14)', dot: '#7c3aed' }, // violet
  { border: '#0891b2', bg: 'rgba(8,145,178,0.14)', dot: '#0891b2' },  // cyan
  { border: '#ca8a04', bg: 'rgba(202,138,4,0.16)', dot: '#ca8a04' },  // gold
  { border: '#dc2626', bg: 'rgba(220,38,38,0.14)', dot: '#dc2626' },  // red
];

export function colorForIndex(index) {
  const n = FIELD_PALETTE.length;
  const i = ((Number(index) || 0) % n + n) % n;
  return FIELD_PALETTE[i];
}
