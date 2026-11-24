import { safeEqual, isCronAuthorized } from '../../lib/cronAuth';

describe('safeEqual', () => {
  it('is true for identical strings', () => {
    expect(safeEqual('secret-token', 'secret-token')).toBe(true);
  });
  it('is false for different strings (incl. length mismatch)', () => {
    expect(safeEqual('secret-token', 'secret-toketx')).toBe(false);
    expect(safeEqual('short', 'a-much-longer-secret')).toBe(false);
  });
  it('is false for non-strings', () => {
    expect(safeEqual(undefined, 'x')).toBe(false);
    expect(safeEqual('x', null)).toBe(false);
    expect(safeEqual(123, 123)).toBe(false);
  });
});

describe('isCronAuthorized', () => {
  it('is false when no secret is configured', () => {
    expect(isCronAuthorized({ headers: { authorization: 'Bearer anything' } }, [])).toBe(false);
  });
  it('authorizes a matching Bearer token', () => {
    expect(isCronAuthorized({ headers: { authorization: 'Bearer s3cr3t' } }, ['s3cr3t'])).toBe(true);
  });
  it('authorizes a matching x-cron-secret header', () => {
    expect(isCronAuthorized({ headers: { 'x-cron-secret': 's3cr3t' } }, ['s3cr3t'])).toBe(true);
  });
  it('accepts any of multiple configured secrets', () => {
    expect(isCronAuthorized({ headers: { authorization: 'Bearer second' } }, ['first', 'second'])).toBe(true);
  });
  it('rejects a wrong token', () => {
    expect(isCronAuthorized({ headers: { authorization: 'Bearer nope' } }, ['s3cr3t'])).toBe(false);
  });
  it('rejects a missing header', () => {
    expect(isCronAuthorized({ headers: {} }, ['s3cr3t'])).toBe(false);
    expect(isCronAuthorized({}, ['s3cr3t'])).toBe(false);
  });
  it('is case-insensitive on the Bearer prefix', () => {
    expect(isCronAuthorized({ headers: { authorization: 'bearer s3cr3t' } }, ['s3cr3t'])).toBe(true);
  });
});
