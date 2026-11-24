/**
 * Where a field placed by hand first appears on the page, in page percent.
 * Boxes start 12% from the left, in rows 7% apart from 18% down (six rows,
 * then back to the top) so fields added one after another do not stack.
 */
export function defaultManualPosition(fieldType, index = 0, page = 1) {
  const width = fieldType === 'signature' ? 28 : fieldType === 'checkbox' ? 4 : 22;
  const height = fieldType === 'signature' ? 5 : 3;
  const rowOffset = ((index || 0) % 6) * 7;

  return {
    page: page || 1,
    x: 12,
    y: Math.min(82, 18 + rowOffset),
    width,
    height,
    source: 'manual',
  };
}
