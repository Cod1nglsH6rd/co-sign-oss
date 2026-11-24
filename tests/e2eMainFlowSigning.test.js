// Issue co-sign-417: the second part of the end-to-end run in
// tests/e2e/mainFlow.e2e.js (send, sign through the link, reuse refused,
// signed PDF checked) and main(), driven offline with a fake page and a fake
// fetch.

const crypto = require('crypto');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { fakePage, fakeFetch } = require('./e2e/fakePage');
const { makeFormPdf } = require('./e2e/helpers');

function load() {
  return require('./e2e/mainFlow.e2e.js');
}

const BASE = 'http://cosign.test:4000';
const DOC_ID = '11111111-2222-4333-8444-555555555555';
const SESSION_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const OTHER_SESSION_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const TOKEN = 'tok_abc123';
const LINK = `${BASE}/en/fill/${TOKEN}`;
const LINK_BOX = '.ent-link-created input';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const at = (actions, test) => actions.findIndex(test);

const baseCtx = () => ({
  baseUrl: BASE,
  setupCode: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
  adminEmail: 'owner@example.com',
  adminPassword: 'pw-9f8e7d6c5b4a3f2e1d',
  documentId: DOC_ID,
  recipient: { ...load().RECIPIENT },
});

const createdBody = {
  success: true,
  mailOff: false,
  emailSent: false,
  shareUrl: LINK,
  session: { id: SESSION_ID, token: TOKEN, documentId: DOC_ID },
};

function sendPage(overrides = {}) {
  return fakePage({
    responses: { '/api/sessions/create': { status: 201, body: createdBody }, ...overrides.responses },
    inputValues: { [LINK_BOX]: overrides.shown || LINK },
    evaluate: (name) => (name === 'readClipboard' ? (overrides.copied || LINK) : null),
  });
}

describe('sendLink', () => {
  it('picks the document, fills the recipient with an email and last name, and creates the link', async () => {
    const page = sendPage();
    const ctx = baseCtx();
    await load().sendLink(page, ctx);
    const { actions } = page;
    const pick = at(actions, (a) => a[0] === 'selectOption');
    const last = at(actions, (a) => a[0] === 'fill' && a[2] === ctx.recipient.lastName);
    const email = at(actions, (a) => a[0] === 'fill' && a[2] === ctx.recipient.email);
    const wait = at(actions, (a) => a[0] === 'waitForResponse' && a[1] === '/api/sessions/create');
    const create = at(actions, (a) => a[0] === 'click' && a[1] === '#create-send-link button[type="submit"]');
    expect(actions[pick][2]).toBe(DOC_ID);
    expect(actions[last][1]).toContain('placeholder="Miller"');
    expect(actions[email][1]).toContain('placeholder="jane@client.com"');
    expect(wait).toBeLessThan(create);
    expect(create).toBeGreaterThan(Math.max(pick, last, email));
    expect(ctx.sessionId).toBe(SESSION_ID);
  });

  it('reads the link from the page, copies it, and keeps the copied link and its token', async () => {
    const page = sendPage();
    const ctx = baseCtx();
    await load().sendLink(page, ctx);
    const { actions } = page;
    const read = at(actions, (a) => a[0] === 'inputValue' && a[1] === LINK_BOX);
    const copy = at(actions, (a) => a[0] === 'click' && /Copy link/.test(a[1]));
    const clip = at(actions, (a) => a[0] === 'evaluate' && a[1] === 'readClipboard');
    expect(read).toBeGreaterThan(-1);
    expect(copy).toBeGreaterThan(read);
    expect(clip).toBeGreaterThan(copy);
    expect(ctx.link).toBe(LINK);
    expect(ctx.token).toBe(TOKEN);
    const ready = at(actions, (a) => a[0] === 'waitForSelector' && a[1] === 'text=Signing link ready for Robin Tester');
    expect(ready).toBeGreaterThan(-1);
    expect(ready).toBeLessThan(read);
  });

  it('fails when link mode sent an email', async () => {
    const page = sendPage({ responses: { '/api/sessions/create': { status: 201, body: { ...createdBody, emailSent: true } } } });
    await expect(load().sendLink(page, baseCtx())).rejects.toThrow(/Link mode should send no email/);
  });

  it('fails when the page shows another link than the server made', async () => {
    const page = sendPage({ shown: `${BASE}/en/fill/other` });
    await expect(load().sendLink(page, baseCtx())).rejects.toThrow(/not the one the server made/);
  });

  it('fails when the clipboard holds another link', async () => {
    const page = sendPage({ copied: 'something else' });
    await expect(load().sendLink(page, baseCtx())).rejects.toThrow(/copied link is not/);
  });

  it('fails when the link opens on another address', async () => {
    const elsewhere = 'http://gateway:3000/en/fill/tok_abc123';
    const page = sendPage({
      shown: elsewhere,
      copied: elsewhere,
      responses: { '/api/sessions/create': { status: 201, body: { ...createdBody, shareUrl: elsewhere } } },
    });
    await expect(load().sendLink(page, baseCtx())).rejects.toThrow(/does not open on/);
  });
});

describe('expiredLink', () => {
  const ready = () => ({ ...baseCtx(), sessionId: SESSION_ID, token: TOKEN });
  const staff = () => fakePage({ evaluate: (name) => (name === 'readAccessToken' ? 'staff-jwt' : null) });

  it('makes a second link, expires it in the database, and sees it refused', async () => {
    let expired = false;
    const fetchFn = fakeFetch([
      ['/api/sessions/create', { status: 201, body: { shareUrl: `${BASE}/en/fill/tok_old`, session: { id: OTHER_SESSION_ID } } }],
      ['/api/sessions/tok_old', () => (expired
        ? { status: 403, body: { errorCode: 'expired' } }
        : { status: 200, body: { success: true } })],
    ]);
    const expireSession = jest.fn(async () => { expired = true; });
    const result = await load().expiredLink(staff(), ready(), { fetchFn, expireSession, log: { log() {} } });
    expect(result).toBe('refused');
    expect(expireSession).toHaveBeenCalledWith(OTHER_SESSION_ID);
    expect(fetchFn.calls[0].init.headers.Authorization).toBe('Bearer staff-jwt');
    expect(JSON.parse(fetchFn.calls[0].init.body)).toMatchObject({ documentId: DOC_ID, sendMethod: 'link' });
  });

  it('fails when the expired link still opens', async () => {
    const fetchFn = fakeFetch([
      ['/api/sessions/create', { status: 201, body: { shareUrl: `${BASE}/en/fill/tok_old`, session: { id: OTHER_SESSION_ID } } }],
      ['/api/sessions/tok_old', { status: 200, body: { success: true } }],
    ]);
    await expect(load().expiredLink(staff(), ready(), { fetchFn, expireSession: async () => {}, log: { log() {} } }))
      .rejects.toThrow(/expired link should be refused/);
  });

  it('says it is skipped when it cannot reach the database', async () => {
    const lines = [];
    const result = await load().expiredLink(staff(), ready(), { fetchFn: fakeFetch([]), expireSession: null, log: { log: (l) => lines.push(l) } });
    expect(result).toBe('skipped');
    expect(lines.join('\n')).toMatch(/expiredLink skipped/);
  });
});

describe('signAsRecipient', () => {
  const ready = () => ({ ...baseCtx(), sessionId: SESSION_ID, token: TOKEN, link: LINK });
  const completed = {
    success: true,
    status: 'completed',
    sessionId: SESSION_ID,
    fillSummary: { signatureProvided: true },
  };
  const page = (complete = completed) => fakePage({
    responses: {
      [`/api/sessions/${TOKEN}/verify`]: { status: 200, body: { success: true } },
      [`/api/sessions/${TOKEN}/complete`]: { status: 200, body: complete },
    },
  });

  it('opens the link, verifies with the email and last name, and agrees to the consent', async () => {
    const p = page();
    const ctx = ready();
    await load().signAsRecipient(p, ctx);
    const { actions } = p;
    expect(actions[0]).toEqual(['goto', LINK]);
    const email = at(actions, (a) => a[0] === 'fill' && a[2] === ctx.recipient.email);
    const last = at(actions, (a) => a[0] === 'fill' && a[2] === ctx.recipient.lastName);
    const consent = at(actions, (a) => a[0] === 'check');
    const verify = at(actions, (a) => a[0] === 'waitForResponse' && a[1] === `/api/sessions/${TOKEN}/verify`);
    const go = at(actions, (a) => a[0] === 'click' && /Continue/.test(a[1]));
    expect(verify).toBeLessThan(go);
    expect(go).toBeGreaterThan(Math.max(email, last, consent));
  });

  it('types the name, draws a signature with the mouse, then submits', async () => {
    const p = page();
    const ctx = ready();
    await load().signAsRecipient(p, ctx);
    const { actions } = p;
    const name = at(actions, (a) => a[0] === 'fill' && a[1] === 'input[placeholder="Full name"]');
    const down = at(actions, (a) => a[0] === 'mouse.down');
    const up = at(actions, (a) => a[0] === 'mouse.up');
    const moves = actions.filter((a, i) => a[0] === 'mouse.move' && i > down && i < up);
    const saved = at(actions, (a) => a[0] === 'waitForSelector' && a[1] === 'text=Signature saved');
    const submit = at(actions, (a) => a[0] === 'click' && a[1] === 'button[aria-label="Submit Document"]');
    expect(actions[name][2]).toBe('Robin Tester');
    expect(down).toBeGreaterThan(name);
    expect(moves.length).toBeGreaterThanOrEqual(2);
    // The strokes stay inside the pad (fake box: x 100..620, y 200..360).
    for (const [, x, y] of moves) {
      expect(x).toBeGreaterThan(100);
      expect(x).toBeLessThan(620);
      expect(y).toBeGreaterThan(200);
      expect(y).toBeLessThan(360);
    }
    expect(saved).toBeGreaterThan(up);
    expect(submit).toBeGreaterThan(saved);
    expect(actions[actions.length - 1]).toEqual(['waitForSelector', 'text=Document Submitted']);
  });

  it('fails when submitting does not complete with a signature', async () => {
    await expect(load().signAsRecipient(page({ ...completed, fillSummary: { signatureProvided: false } }), ready()))
      .rejects.toThrow(/No signature was saved/);
  });

  it('fails when another session was completed', async () => {
    await expect(load().signAsRecipient(page({ ...completed, sessionId: OTHER_SESSION_ID }), ready()))
      .rejects.toThrow(/another session/);
  });
});

describe('reuseLink', () => {
  const ready = () => ({ ...baseCtx(), sessionId: SESSION_ID, token: TOKEN, link: LINK });
  const refused = { status: 403, body: { errorCode: 'already_completed' } };
  const verifyOk = { [`/api/sessions/${TOKEN}/verify`]: { status: 200, body: { success: true } } };
  const page = (evaluate, elements) => fakePage({ responses: verifyOk, evaluate, elements });

  it('opens the link again, verifies, sees the read-only completed state, and has a second submit refused', async () => {
    const p = page((name) => (name === 'completeAgain' ? { ...refused, hadVerify: true } : null));
    await load().reuseLink(p, ready());
    const { actions } = p;
    expect(actions[0]).toEqual(['goto', LINK]);
    const verify = at(actions, (a) => a[0] === 'waitForResponse' && a[1] === `/api/sessions/${TOKEN}/verify`);
    const submitted = at(actions, (a) => a[0] === 'waitForSelector' && a[1] === 'text=Document Submitted');
    const again = at(actions, (a) => a[0] === 'evaluate' && a[1] === 'completeAgain' && a[2] === TOKEN);
    expect(submitted).toBeGreaterThan(verify);
    expect(actions.some((a) => a[0] === '$$' && a[1] === 'button[aria-label="Submit Document"]')).toBe(true);
    expect(again).toBeGreaterThan(submitted);
  });

  it('fails when the completed link still shows Submit', async () => {
    const p = page(() => ({ ...refused, hadVerify: true }), { 'button[aria-label="Submit Document"]': 1 });
    await expect(load().reuseLink(p, ready())).rejects.toThrow(/still shows Submit/);
  });

  it('fails when the completed link still shows the fields', async () => {
    const p = page(() => ({ ...refused, hadVerify: true }), { 'input[placeholder="Full name"]': 1 });
    await expect(load().reuseLink(p, ready())).rejects.toThrow(/still shows the fields/);
  });

  it('fails when a second submit is taken', async () => {
    const p = page(() => ({ status: 200, body: { success: true }, hadVerify: true }));
    await expect(load().reuseLink(p, ready())).rejects.toThrow(/second submit should be refused/);
  });

  it('fails when the second submit was refused only for lack of verification', async () => {
    const p = page(() => ({ status: 403, body: { errorCode: 'verification_required' }, hadVerify: false }));
    await expect(load().reuseLink(p, ready())).rejects.toThrow(/has no verification/);
  });
});

describe('downloadSignedPdf', () => {
  async function signedCopy(original) {
    const doc = await PDFDocument.load(original);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.getPage(0).drawText('Robin Tester', { x: 200, y: 700, size: 12, font });
    return Buffer.from(await doc.save());
  }

  async function setUp({ info, file } = {}) {
    const original = Buffer.from(await makeFormPdf());
    const signed = await signedCopy(original);
    const url = `${BASE}/storage/v1/object/sign/filled-documents/x.pdf?token=t`;
    const fetchFn = fakeFetch([
      ['/api/sessions/signed-pdf', { status: 200, body: info || { url, sha256: sha(signed), bytes: signed.length } }],
      ['/storage/v1/', file || { status: 200, bytes: signed }],
    ]);
    const page = fakePage({ evaluate: (name) => (name === 'readAccessToken' ? 'staff-jwt' : null) });
    const ctx = { ...baseCtx(), sessionId: SESSION_ID, original };
    return { fetchFn, page, ctx, signed, url };
  }

  it('asks for the signed PDF as staff, downloads it and finds nothing wrong', async () => {
    const { fetchFn, page, ctx, signed } = await setUp();
    await load().downloadSignedPdf(page, ctx, { fetchFn });
    expect(fetchFn.calls[0].url).toBe(`${BASE}/api/sessions/signed-pdf?sessionId=${SESSION_ID}`);
    expect(fetchFn.calls[0].init.headers.Authorization).toBe('Bearer staff-jwt');
    expect(fetchFn.calls[1].url).toMatch(/\/storage\/v1\/object\/sign\//);
    expect(ctx.signedPdf).toEqual({ sha256: sha(signed), bytes: signed.length });
  });

  it('fails when the download does not match the saved fingerprint', async () => {
    const { fetchFn, page, ctx } = await setUp({ file: { status: 200, bytes: Buffer.from(await makeFormPdf()) } });
    await expect(load().downloadSignedPdf(page, ctx, { fetchFn })).rejects.toThrow(/failed its checks: .*fingerprint/);
  });

  it('fails when no fingerprint was saved', async () => {
    const url = `${BASE}/storage/v1/object/sign/filled-documents/x.pdf?token=t`;
    const { fetchFn, page, ctx } = await setUp({ info: { url, sha256: null, bytes: null } });
    await expect(load().downloadSignedPdf(page, ctx, { fetchFn })).rejects.toThrow(/No fingerprint saved/);
  });

  it('fails when the link points at an address the browser cannot reach', async () => {
    const { fetchFn, page, ctx } = await setUp({ info: { url: 'http://gateway:3000/storage/v1/x', sha256: 'a'.repeat(64), bytes: 9 } });
    await expect(load().downloadSignedPdf(page, ctx, { fetchFn })).rejects.toThrow(/not on http:\/\/cosign.test:4000/);
  });
});

describe('run and main', () => {
  function fakeChromium(pages) {
    const made = [];
    let closed = false;
    const browser = {
      newContext: async (options) => ({
        newPage: async () => {
          const page = pages[made.length];
          made.push({ page, options });
          return page;
        },
      }),
      close: async () => {
        closed = true;
      },
    };
    return { chromium: { launch: async () => browser }, made, closed: () => closed };
  }

  it('waits for health, reads the setup code from the logs, and stops at the first failing step', async () => {
    const staff = fakePage();
    staff.click = () => Promise.reject(new Error('no such button'));
    const fake = fakeChromium([staff]);
    const fetchFn = fakeFetch([['/api/health', { status: 200, body: { status: 'ok' } }]]);
    const errors = [];
    const log = { log() {}, error: (line) => errors.push(line) };
    const code = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    await expect(load().run({
      env: { COSIGN_URL: BASE },
      chromium: fake.chromium,
      fetchFn,
      readLogs: () => `app-1 | [setupLock] Setup code: ${code} (saved in /app/.cosign/setup-code)`,
      log,
    })).rejects.toThrow('no such button');
    expect(fetchFn.calls[0].url).toBe(`${BASE}/api/health`);
    expect(staff.actions.some((a) => a[0] === 'fill' && a[2] === code)).toBe(true);
    expect(fake.closed()).toBe(true);
    expect(fake.made[0].options.permissions).toEqual(expect.arrayContaining(['clipboard-read', 'clipboard-write']));
    const printed = errors.join('\n');
    expect(printed).toMatch(/FAILED at finishSetup: no such button/);
    expect(printed).not.toContain(code);
  });

  it('refuses to start without a setup code', async () => {
    const fake = fakeChromium([]);
    await expect(load().run({
      env: { COSIGN_URL: BASE },
      chromium: fake.chromium,
      fetchFn: fakeFetch([['/api/health', { status: 200 }]]),
      readLogs: () => 'nothing here',
      log: { log() {}, error() {} },
    })).rejects.toThrow(/No setup code/);
  });

  it('main sets a non-zero exit code on failure and prints no setup code', async () => {
    const saved = process.exitCode;
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await load().main({
        env: { COSIGN_URL: BASE },
        chromium: fakeChromium([]).chromium,
        fetchFn: fakeFetch([['/api/health', { status: 200 }]]),
        readLogs: () => 'nothing here',
        log: { log() {}, error() {} },
      });
      expect(result).toBe(1);
      expect(process.exitCode).toBe(1);
      expect(spy.mock.calls.join('\n')).toMatch(/No setup code/);
    } finally {
      process.exitCode = saved;
      spy.mockRestore();
    }
  });
});
