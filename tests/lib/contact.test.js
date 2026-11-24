describe('SUPPORT_EMAIL', () => {
  const original = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    else process.env.NEXT_PUBLIC_SUPPORT_EMAIL = original;
  });

  function load() {
    let mod;
    jest.isolateModules(() => {
      mod = require('../../lib/contact');
    });
    return mod;
  }

  it('defaults to support@example.com when NEXT_PUBLIC_SUPPORT_EMAIL is unset', () => {
    delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
    expect(load().SUPPORT_EMAIL).toBe('support@example.com');
  });

  it('defaults to support@example.com when NEXT_PUBLIC_SUPPORT_EMAIL is empty', () => {
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = '';
    expect(load().SUPPORT_EMAIL).toBe('support@example.com');
  });

  it('uses NEXT_PUBLIC_SUPPORT_EMAIL when set', () => {
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = 'help@acme.test';
    expect(load().SUPPORT_EMAIL).toBe('help@acme.test');
  });
});
