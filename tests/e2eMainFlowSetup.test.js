// Issue co-sign-416: the first part of the end-to-end run in
// tests/e2e/mainFlow.e2e.js (setup, sign in, upload, fields read), driven
// offline with a fake page that records what each step does.

const { PDFDocument } = require('pdf-lib');
const { fakePage } = require('./e2e/fakePage');

function load() {
  return require('./e2e/mainFlow.e2e.js');
}

const DOC_ID = '11111111-2222-4333-8444-555555555555';

const ctx = () => ({
  baseUrl: 'http://cosign.test:4000',
  setupCode: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
  adminEmail: 'owner@example.com',
  adminPassword: 'pw-9f8e7d6c5b4a3f2e1d',
});

const setupResponses = {
  '/api/setup/settings': { status: 200, body: { settings: {} } },
  '/api/setup/admin': { status: 201, body: { email: 'owner@example.com' } },
};

const uploadResponses = {
  '/api/ocr': {
    status: 200,
    body: {
      success: true,
      extractionMethod: 'stub',
      fields: [{ field_name: 'Full name' }, { field_name: 'Signature' }],
    },
    requestBody: { documentId: DOC_ID, mode: 'pre_setup' },
  },
  '/api/enterprise/setup/save': { status: 200, body: { success: true } },
};

const at = (actions, test) => actions.findIndex(test);

describe('finishSetup', () => {
  it('opens /setup on the site and types the setup code', async () => {
    const page = fakePage({ responses: setupResponses });
    const run = ctx();
    await load().finishSetup(page, run);
    expect(page.actions[0]).toEqual(['goto', 'http://cosign.test:4000/setup']);
    const code = at(page.actions, (a) => a[0] === 'fill' && a[2] === run.setupCode);
    expect(code).toBeGreaterThan(0);
    expect(page.actions[code][1]).toBe('input[name="setupCode"]');
  });

  it("picks 'No mail', sets the Site address, and saves before making the first admin", async () => {
    const page = fakePage({ responses: setupResponses });
    const run = ctx();
    await load().finishSetup(page, run);
    const { actions } = page;
    const noMail = at(actions, (a) => a[0] === 'check' && a[1] === 'input[name="mail"][value="none"]');
    const site = at(actions, (a) => a[0] === 'fill' && a[1] === 'input[name="NEXT_PUBLIC_APP_URL"]');
    const waitSave = at(actions, (a) => a[0] === 'waitForResponse' && a[1] === '/api/setup/settings');
    const save = at(actions, (a) => a[0] === 'click' && /Save/.test(a[1]));
    const email = at(actions, (a) => a[0] === 'fill' && a[2] === run.adminEmail);
    const password = at(actions, (a) => a[0] === 'fill' && a[2] === run.adminPassword);
    const create = at(actions, (a) => a[0] === 'click' && /Create admin/.test(a[1]));
    expect(noMail).toBeGreaterThan(-1);
    expect(actions[site][2]).toBe('http://cosign.test:4000');
    expect(actions[waitSave][2]).toBe('POST');
    expect(waitSave).toBeLessThan(save);
    expect(save).toBeGreaterThan(Math.max(noMail, site));
    expect(email).toBeGreaterThan(save);
    expect(actions[email][1]).toBe('input[name="adminEmail"]');
    expect(actions[password][1]).toBe('input[name="adminPassword"]');
    expect(create).toBeGreaterThan(Math.max(email, password));
  });

  it("ends by waiting for 'Setup is done' with the admin's email", async () => {
    const page = fakePage({ responses: setupResponses });
    await load().finishSetup(page, ctx());
    const last = page.actions[page.actions.length - 1];
    expect(last[0]).toBe('waitForSelector');
    expect(last[1]).toBe('text=Setup is done. Sign in as owner@example.com');
  });

  it('stops when the settings save is refused, before any admin is made', async () => {
    const page = fakePage({
      responses: { ...setupResponses, '/api/setup/settings': { status: 400, body: { errors: { NEXT_PUBLIC_APP_URL: 'bad' } } } },
    });
    await expect(load().finishSetup(page, ctx())).rejects.toThrow(/Saving the setup settings answered 400/);
    expect(page.actions.some((a) => a[0] === 'fill' && a[1] === 'input[name="adminEmail"]')).toBe(false);
  });

  it('stops when the first admin is not made', async () => {
    const page = fakePage({
      responses: { ...setupResponses, '/api/setup/admin': { status: 409, body: { error: 'Setup is already done on this host.' } } },
    });
    await expect(load().finishSetup(page, ctx())).rejects.toThrow(/Making the first admin answered 409/);
  });

  it('makes a password when the context has none, and keeps it for sign in', async () => {
    const page = fakePage({ responses: setupResponses });
    const run = { ...ctx(), adminPassword: undefined };
    await load().finishSetup(page, run);
    expect(typeof run.adminPassword).toBe('string');
    expect(run.adminPassword.length).toBeGreaterThanOrEqual(16);
    const password = page.actions.find((a) => a[0] === 'fill' && a[1] === 'input[name="adminPassword"]');
    expect(password[2]).toBe(run.adminPassword);
  });
});

describe('signIn', () => {
  it('signs in as the first admin and waits for All Documents', async () => {
    const page = fakePage();
    const run = ctx();
    await load().signIn(page, run);
    const { actions } = page;
    expect(actions[0]).toEqual(['goto', 'http://cosign.test:4000/enterprise/login']);
    const email = at(actions, (a) => a[0] === 'fill' && a[2] === run.adminEmail);
    const password = at(actions, (a) => a[0] === 'fill' && a[2] === run.adminPassword);
    const submit = at(actions, (a) => a[0] === 'click');
    const landed = at(actions, (a) => a[0] === 'waitForURL');
    expect(email).toBeGreaterThan(0);
    expect(password).toBeGreaterThan(0);
    expect(submit).toBeGreaterThan(Math.max(email, password));
    expect(actions[landed][1]).toBe('**/enterprise/documents');
    expect(landed).toBeGreaterThan(submit);
  });

  it('skips the getting-started guide the first visit opens, and waits for it to go', async () => {
    const page = fakePage();
    await load().signIn(page, ctx());
    const { actions } = page;
    const landed = at(actions, (a) => a[0] === 'waitForURL');
    const skip = at(actions, (a) => a[0] === 'click' && a[1] === '[aria-label="Getting started guide"] button:text-is("Skip")');
    expect(skip).toBeGreaterThan(landed);
    expect(actions[actions.length - 1]).toEqual(['waitForSelector', '[aria-label="Getting started guide"]', { state: 'detached' }]);
  });
});

describe('uploadForm', () => {
  it('uploads the one-page form PDF from makeFormPdf() and keeps it as the original', async () => {
    const page = fakePage({ responses: uploadResponses });
    const run = ctx();
    await load().uploadForm(page, run);
    const upload = page.actions.find((a) => a[0] === 'setInputFiles');
    expect(upload[1]).toBe('input[type="file"]');
    const file = upload[2];
    expect(file.mimeType).toBe('application/pdf');
    expect(file.name).toMatch(/\.pdf$/);
    expect(Buffer.from(file.buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(file.buffer);
    expect(doc.getPageCount()).toBe(1);
    expect(Buffer.from(run.original).equals(Buffer.from(file.buffer))).toBe(true);
  });

  it('waits for the stub to read both fields, then opens Set up for that document', async () => {
    const page = fakePage({ responses: uploadResponses });
    const run = ctx();
    await load().uploadForm(page, run);
    const { actions } = page;
    const file = at(actions, (a) => a[0] === 'setInputFiles');
    const waitOcr = at(actions, (a) => a[0] === 'waitForResponse' && a[1] === '/api/ocr');
    const confirm = at(actions, (a) => a[0] === 'click' && /Confirm & Upload/.test(a[1]));
    const setUp = at(actions, (a) => a[0] === 'click' && a[1] === `a[href="/enterprise/setup?id=${DOC_ID}"]`);
    const fullName = at(actions, (a) => a[0] === 'waitForSelector' && a[1] === 'text="Full name"');
    const signature = at(actions, (a) => a[0] === 'waitForSelector' && a[1] === 'text="Signature"');
    expect(run.documentId).toBe(DOC_ID);
    expect(waitOcr).toBeGreaterThan(file);
    expect(confirm).toBeGreaterThan(waitOcr);
    expect(setUp).toBeGreaterThan(confirm);
    expect(fullName).toBeGreaterThan(setUp);
    expect(signature).toBeGreaterThan(setUp);
  });

  it('continues from the setup screen to Send Links', async () => {
    const page = fakePage({ responses: uploadResponses });
    await load().uploadForm(page, ctx());
    const { actions } = page;
    const signature = at(actions, (a) => a[0] === 'waitForSelector' && a[1] === 'text="Signature"');
    const go = at(actions, (a) => a[0] === 'click' && /Save & continue/.test(a[1]));
    expect(go).toBeGreaterThan(signature);
    const last = actions[actions.length - 1];
    expect(last).toEqual(['waitForURL', `**/enterprise/send-links?documentId=${DOC_ID}`, { timeout: 120000 }]);
  });

  it('fails when the fields were not read by the stub', async () => {
    const page = fakePage({
      responses: {
        ...uploadResponses,
        '/api/ocr': { status: 200, body: { success: true, extractionMethod: 'none', fields: [] }, requestBody: { documentId: DOC_ID, mode: 'pre_setup' } },
      },
    });
    await expect(load().uploadForm(page, ctx())).rejects.toThrow(/not read by the stub/);
  });

  it('fails when the stub gives other fields', async () => {
    const page = fakePage({
      responses: {
        ...uploadResponses,
        '/api/ocr': { status: 200, body: { extractionMethod: 'stub', fields: [{ field_name: 'Full name' }] }, requestBody: { documentId: DOC_ID, mode: 'pre_setup' } },
      },
    });
    await expect(load().uploadForm(page, ctx())).rejects.toThrow(/should give 'Full name' and 'Signature'/);
  });

  it('fails when the setup save is refused', async () => {
    const page = fakePage({
      responses: { ...uploadResponses, '/api/enterprise/setup/save': { status: 500, body: { success: false } } },
    });
    await expect(load().uploadForm(page, ctx())).rejects.toThrow(/Saving the setup answered 500/);
  });
});

describe('cosignUrl', () => {
  it('reads COSIGN_URL, without a trailing slash', () => {
    expect(load().cosignUrl({ COSIGN_URL: 'http://cosign.test:4000/' })).toBe('http://cosign.test:4000');
  });

  it('defaults to http://localhost:3000', () => {
    expect(load().cosignUrl({})).toBe('http://localhost:3000');
    expect(load().cosignUrl({ COSIGN_URL: '  ' })).toBe('http://localhost:3000');
  });
});

describe('redact', () => {
  it('takes the setup code and the password out of any text it prints', () => {
    const run = ctx();
    const text = `Setup code: ${run.setupCode} and ${run.adminPassword} and Setup code: ffffffffffffffffffffffffffffffff`;
    const out = load().redact(text, run);
    expect(out).not.toContain(run.setupCode);
    expect(out).not.toContain(run.adminPassword);
    expect(out).not.toContain('ffffffffffffffffffffffffffffffff');
  });
});
