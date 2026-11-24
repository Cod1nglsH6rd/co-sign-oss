/**
 * lib/adapters.js says which outside services are on, from one env object:
 * supabaseCloud (a *.supabase.co URL), sentry (SENTRY_DSN), resend
 * (EMAIL_PROVIDER=resend and RESEND_API_KEY), upstash (both Upstash vars) and
 * vercel (VERCEL). An empty env turns everything off. lib/email.js sends no
 * mail while Resend is off and logs one line with the subject and the
 * recipient's domain only.
 */

const ALL_OFF = {
  supabaseCloud: 'off',
  sentry: 'off',
  resend: 'off',
  upstash: 'off',
  vercel: 'off',
};

function load() {
  return require('../../lib/adapters.js');
}

describe('adapterStatus', () => {
  it('turns every adapter off for an empty env', () => {
    const { adapterStatus } = load();
    expect(adapterStatus({})).toEqual(ALL_OFF);
  });

  it('turns supabaseCloud on only for a *.supabase.co URL', () => {
    const { adapterStatus } = load();
    expect(adapterStatus({ SUPABASE_URL: 'https://abcd.supabase.co' }).supabaseCloud).toBe('on');
    expect(adapterStatus({ NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co' }).supabaseCloud).toBe('on');
    expect(adapterStatus({ SUPABASE_URL: 'http://127.0.0.1:54321' }).supabaseCloud).toBe('off');
    expect(adapterStatus({ SUPABASE_URL: 'https://supabase.co.evil.example' }).supabaseCloud).toBe('off');
    expect(adapterStatus({ SUPABASE_URL: 'not a url' }).supabaseCloud).toBe('off');
  });

  it('turns sentry on only with SENTRY_DSN', () => {
    const { adapterStatus } = load();
    expect(adapterStatus({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' })).toEqual({ ...ALL_OFF, sentry: 'on' });
    expect(adapterStatus({ SENTRY_DSN: '  ' }).sentry).toBe('off');
  });

  it('turns resend on only with EMAIL_PROVIDER=resend and RESEND_API_KEY', () => {
    const { adapterStatus } = load();
    expect(adapterStatus({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x' })).toEqual({ ...ALL_OFF, resend: 'on' });
    expect(adapterStatus({ EMAIL_PROVIDER: 'resend' }).resend).toBe('off');
    expect(adapterStatus({ RESEND_API_KEY: 're_x' }).resend).toBe('off');
    expect(adapterStatus({ EMAIL_PROVIDER: 'console', RESEND_API_KEY: 're_x' }).resend).toBe('off');
  });

  it('turns upstash on only with both Upstash vars', () => {
    const { adapterStatus } = load();
    const both = { UPSTASH_REDIS_REST_URL: 'https://u.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' };
    expect(adapterStatus(both)).toEqual({ ...ALL_OFF, upstash: 'on' });
    expect(adapterStatus({ UPSTASH_REDIS_REST_URL: 'https://u.upstash.io' }).upstash).toBe('off');
    expect(adapterStatus({ UPSTASH_REDIS_REST_TOKEN: 't' }).upstash).toBe('off');
  });

  it('turns vercel on only when VERCEL is set', () => {
    const { adapterStatus } = load();
    expect(adapterStatus({ VERCEL: '1' })).toEqual({ ...ALL_OFF, vercel: 'on' });
    expect(adapterStatus({ VERCEL: '' }).vercel).toBe('off');
  });
});

describe('sendEmail with Resend off', () => {
  const NAMES = ['EMAIL_PROVIDER', 'RESEND_API_KEY', 'EMAIL_FROM'];
  let saved;
  let savedFetch;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    saved = {};
    for (const name of NAMES) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    savedFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.resetModules();
  });

  afterEach(() => {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    global.fetch = savedFetch;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  async function send() {
    const { sendEmail } = require('../../lib/email.js');
    await expect(
      sendEmail({ to: 'jane@client.example', subject: 'Hello there', html: '<p>secret body text</p>' }),
    ).resolves.toBeUndefined();
  }

  function loggedLines() {
    return logSpy.mock.calls.map((args) => args.join(' '));
  }

  it('makes no fetch call and logs one line with subject and domain only', async () => {
    await send();
    expect(global.fetch).not.toHaveBeenCalled();
    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Hello there');
    expect(lines[0]).toContain('client.example');
    expect(lines[0]).not.toContain('jane');
    expect(lines[0]).not.toContain('secret body text');
  });

  it('with EMAIL_PROVIDER=resend but no key, makes no fetch call and logs one line', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    await send();
    expect(global.fetch).not.toHaveBeenCalled();
    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Hello there');
    expect(lines[0]).toContain('client.example');
    expect(lines[0]).not.toContain('jane');
    expect(lines[0]).not.toContain('secret body text');
  });

  it('with Resend on, posts to Resend', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test';
    // lib/email.js has no built-in sender since the release review: without
    // EMAIL_FROM nothing is posted (tests/lib/emailSenderPrivacy.test.js).
    process.env.EMAIL_FROM = 'sign@sender.example';
    await send();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  });
});
