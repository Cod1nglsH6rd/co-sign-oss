import { formatFileSize } from '../../lib/fileSize';

describe('formatFileSize', () => {
  it('picks the unit after rounding bytes up to 1024', () => {
    expect(formatFileSize(1023.6)).toBe('1.0 KB');
  });

  it('picks the unit after rounding KB up to 1024', () => {
    expect(formatFileSize(1048575)).toBe('1.0 MB');
  });

  it('keeps existing outputs unchanged', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
