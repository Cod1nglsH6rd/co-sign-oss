/**
 * lib/email.js reads EMAIL_PROVIDER, RESEND_API_KEY, EMAIL_FROM and
 * NEXT_PUBLIC_APP_URL through effectiveSetting when mail is sent (env first,
 * then the answers saved at setup in .cosign/settings.json), not when the
 * module loads. sendFillInviteEmail says whether the mail really went:
 * { sent: true } on a Resend success, { sent: false, reason: 'mail_off' }
 * while Resend is off (with the same one log line as before), and
 * { sent: false, reason: 'provider_error' } when Resend fails, without
 * logging the key. fetch is mocked; every test runs in its own temp folder.
 * The key values are made-up placeholders.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const NAMES = ['EMAIL_PROVIDER', 'RESEND_API_KEY', 'EMAIL_FROM', 'NEXT_PUBLIC_APP_URL'];
const SAVED_KEY = 're_fake-saved-NOT-REAL-aaaaQWXZ';
const ENV_KEY = 're_fake-env-NOT-REAL-ccccMNPR';

let cwd;
let savedEnv;
let savedFetch;
let logSpy;
let errorSpy;
let warnSpy;

beforeEach(() => {
  jest.resetModules();
  savedEnv = {};
  for (const name of NAMES) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-email-'));
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  savedFetch = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'email-1' }) }));
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = savedFetch;
  fs.rmSync(cwd, { recursive: true, force: true });
  for (const name of NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

function writeSaved(values) {
  fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify(values));
}

const INVITE = {
  to: 'jane@client.example',
  recipientName: 'Jane',
  documentName: 'Lease',
  token: 'tok123',
  expiresAt: '2030-01-15T12:00:00Z',
  clientName: 'Acme',
};

function sentRequest() {
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, init] = global.fetch.mock.calls[0];
  return { url, headers: init.headers, body: JSON.parse(init.body) };
}

function everyLogLine() {
  return [logSpy, errorSpy, warnSpy]
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
}

describe('sendFillInviteEmail and the saved mail settings', () => {
  it('uses settings saved after the module loaded, and returns { sent: true }', async () => {
    const { sendFillInviteEmail } = require('../../lib/email.js');
    writeSaved({
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: SAVED_KEY,
      EMAIL_FROM: 'Saved Sender <saved@sender.example>',
      NEXT_PUBLIC_APP_URL: 'https://saved.example',
    });

    const result = await sendFillInviteEmail(INVITE);

    expect(result).toEqual({ sent: true });
    const { url, headers, body } = sentRequest();
    expect(url).toBe('https://api.resend.com/emails');
    expect(headers.Authorization).toBe(`Bearer ${SAVED_KEY}`);
    expect(body.from).toBe('Saved Sender <saved@sender.example>');
    expect(body.to).toEqual(['jane@client.example']);
    expect(body.html).toContain('https://saved.example/en/fill/tok123');
  });

  it('env values win over saved ones', async () => {
    writeSaved({
      EMAIL_PROVIDER: 'console',
      RESEND_API_KEY: SAVED_KEY,
      EMAIL_FROM: 'Saved Sender <saved@sender.example>',
      NEXT_PUBLIC_APP_URL: 'https://saved.example',
    });
    const { sendFillInviteEmail } = require('../../lib/email.js');
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = ENV_KEY;
    process.env.EMAIL_FROM = 'Env Sender <env@sender.example>';
    process.env.NEXT_PUBLIC_APP_URL = 'https://env.example';

    const result = await sendFillInviteEmail(INVITE);

    expect(result).toEqual({ sent: true });
    const { headers, body } = sentRequest();
    expect(headers.Authorization).toBe(`Bearer ${ENV_KEY}`);
    expect(body.from).toBe('Env Sender <env@sender.example>');
    expect(body.html).toContain('https://env.example/en/fill/tok123');
    expect(body.html).not.toContain('saved.example');
  });

  it('with mail off, sends nothing, logs the same one line and returns mail_off', async () => {
    writeSaved({ EMAIL_PROVIDER: 'resend' });
    const { sendFillInviteEmail } = require('../../lib/email.js');

    const result = await sendFillInviteEmail(INVITE);

    expect(result).toEqual({ sent: false, reason: 'mail_off' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.map((args) => args.join(' '))).toEqual([
      '[Email] Resend off, not sent: "You\'ve been invited to fill out: Lease" to @client.example',
    ]);
  });

  it('a Resend error returns provider_error and never logs the key', async () => {
    // EMAIL_FROM set: without it nothing is posted (no built-in sender since
    // the release review), and these tests are about a failed post.
    writeSaved({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: SAVED_KEY, EMAIL_FROM: 'sign@sender.example' });
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ statusCode: 401, name: 'validation_error', message: `API key ${SAVED_KEY} is invalid` }),
    }));
    const { sendFillInviteEmail } = require('../../lib/email.js');

    const result = await sendFillInviteEmail(INVITE);

    expect(result).toEqual({ sent: false, reason: 'provider_error' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    for (const line of everyLogLine()) {
      expect(line).not.toContain(SAVED_KEY);
      expect(line).not.toContain('aaaaQWXZ');
    }
  });

  it('a failed request returns provider_error and never logs the key', async () => {
    // EMAIL_FROM set: without it nothing is posted (no built-in sender since
    // the release review), and these tests are about a failed post.
    writeSaved({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: SAVED_KEY, EMAIL_FROM: 'sign@sender.example' });
    global.fetch = jest.fn(async () => {
      throw new Error(`connect failed for Bearer ${SAVED_KEY}`);
    });
    const { sendFillInviteEmail } = require('../../lib/email.js');

    const result = await sendFillInviteEmail(INVITE);

    expect(result).toEqual({ sent: false, reason: 'provider_error' });
    for (const line of everyLogLine()) {
      expect(line).not.toContain(SAVED_KEY);
    }
  });
});
