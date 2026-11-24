/**
 * lib/email.js: what the send log holds, and the sender address.
 *
 * - A sent mail is logged with the recipient's domain only, like the
 *   mail-off line, never the whole address.
 * - With Resend on and no EMAIL_FROM (neither in env nor saved at setup),
 *   nothing is sent: one logged line names EMAIL_FROM, and the caller gets
 *   { sent: false, reason: 'no_sender' }, a "not sent" result every caller
 *   already treats as not sent. There is no built-in sender address.
 * - lib/queuedInvites.js (the release after OCR) leaves such a session
 *   pending, not sent.
 *
 * fetch is mocked; every test runs in its own temp folder. The key is a
 * made-up placeholder and every address is at an example domain.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const NAMES = ['EMAIL_PROVIDER', 'RESEND_API_KEY', 'EMAIL_FROM', 'NEXT_PUBLIC_APP_URL'];
const KEY = 're_fake-NOT-REAL-sender-test';

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
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-email-sender-'));
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

const INVITE = {
  to: 'jane.signer@client.example',
  recipientName: 'Jane',
  documentName: 'Lease',
  token: 'tok123',
  expiresAt: '2030-01-15T12:00:00Z',
  clientName: 'Acme',
};

function everyLogLine() {
  return [logSpy, errorSpy, warnSpy]
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
}

describe('the send log', () => {
  it('names the recipient domain only', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = KEY;
    process.env.EMAIL_FROM = 'Signing <sign@sender.example>';
    const { sendFillInviteEmail } = require('../../lib/email.js');

    const result = await sendFillInviteEmail(INVITE);

    expect(result).toEqual({ sent: true });
    const lines = everyLogLine();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain('jane.signer');
    }
    expect(lines.some((line) => line.includes('@client.example'))).toBe(true);
  });

  it('the completion notice is logged the same way', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = KEY;
    process.env.EMAIL_FROM = 'sign@sender.example';
    const { sendCompletionNotificationEmail } = require('../../lib/email.js');

    const result = await sendCompletionNotificationEmail({
      to: 'owner.person@firm.example', documentName: 'Lease', documentId: 'd-1', sessionId: 's-1',
    });

    expect(result).toEqual({ sent: true });
    for (const line of everyLogLine()) expect(line).not.toContain('owner.person');
  });
});

describe('no sender address', () => {
  it('with Resend on and no EMAIL_FROM, sends nothing and says why', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = KEY;
    const { sendFillInviteEmail } = require('../../lib/email.js');

    const result = await sendFillInviteEmail(INVITE);

    expect(result).toEqual({ sent: false, reason: 'no_sender' });
    expect(global.fetch).not.toHaveBeenCalled();
    const lines = everyLogLine();
    expect(lines.some((line) => line.includes('EMAIL_FROM'))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain('jane.signer');
      expect(line).not.toContain(KEY);
    }
  });

  it('a blank saved EMAIL_FROM counts as none', async () => {
    fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.cosign', 'settings.json'), JSON.stringify({
      EMAIL_PROVIDER: 'resend', RESEND_API_KEY: KEY, EMAIL_FROM: '   ',
    }));
    const { sendFillInviteEmail } = require('../../lib/email.js');

    expect(await sendFillInviteEmail(INVITE)).toEqual({ sent: false, reason: 'no_sender' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('lib/email.js holds no sender address of its own', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../lib/email.js'), 'utf8');
    // Any name@domain.tld in the file (comments included).
    expect(source.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)).toBeNull();
  });

  it('a queued invite released without a sender stays pending, not sent', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = KEY;
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
    const { releaseQueuedSessions } = require('../../lib/queuedInvites');
    const row = {
      id: 's-1',
      document_id: 'd-1',
      status: 'queued',
      send_method: 'email',
      recipient_email: 'signer@example.test',
      preferred_language: 'en',
      expires_at: '2030-01-15T12:00:00Z',
      token_hash: 'old-hash',
    };
    const updates = [];
    const supabase = {
      from() {
        const q = { op: 'select', payload: null };
        const b = {
          select: () => b,
          update: (payload) => { q.op = 'update'; q.payload = payload; return b; },
          eq: () => b,
          then: (resolve, reject) => Promise.resolve().then(() => {
            if (q.op === 'update') { updates.push(q.payload); Object.assign(row, q.payload); return { data: null, error: null }; }
            return { data: [{ ...row }], error: null };
          }).then(resolve, reject),
        };
        return b;
      },
    };

    await releaseQueuedSessions({ supabase, documentId: 'd-1', documentName: 'Lease.pdf' });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(row.status).toBe('pending');
    expect(row.sent_at).toBeUndefined();
    expect(row.token_hash).toBe('old-hash');
  });
});
