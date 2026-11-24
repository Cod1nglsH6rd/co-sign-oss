/**
 * End-to-end test of the main flow (co-sign-416, co-sign-417).
 *
 * Start the stack with the stub OCR, then run this file with node:
 *
 *   docker compose -f docker-compose.yml -f tests/e2e/compose.e2e.yml up -d --build
 *   node tests/e2e/mainFlow.e2e.js
 *
 * It drives Playwright Chromium against COSIGN_URL (default
 * http://localhost:3000). The setup code comes from COSIGN_SETUP_CODE, or
 * else from `docker compose logs app`. The first admin is COSIGN_ADMIN_EMAIL
 * (default owner@example.com) with a password made fresh for each run. No
 * key, password or setup code is kept in this file, and none is printed: a
 * failure report has the setup code and the password taken out.
 *
 * The steps, in order (each takes the page it drives and the run's ctx):
 * - finishSetup: types the setup code, picks 'No mail', sets the Site
 *   address, saves, then makes the first admin.
 * - signIn: signs in as that admin, lands on All Documents and skips the
 *   getting-started guide a first visit opens.
 * - uploadForm: uploads makeFormPdf(), sees the stub read its two fields
 *   ('Full name', 'Signature') on the setup screen, and continues to Send
 *   Links.
 * - sendLink: link mode with a recipient email and last name; it reads the
 *   link from the page and from the clipboard after Copy link.
 * - expiredLink: a second link, made through the API and pushed past its
 *   expiry in the database (docker compose exec db), is refused. Before
 *   that, a database login with a wrong password must be refused. Skipped,
 *   with a line saying so, when the stack is not this checkout's compose.
 * - signAsRecipient: in a fresh browser context it verifies, types the name,
 *   draws a signature with the mouse and submits.
 * - reuseLink: in another fresh context, opening the link again and
 *   verifying shows the completed, read-only state, and a second complete
 *   call is refused.
 * - downloadSignedPdf: the staff call to /api/sessions/signed-pdf, the file
 *   fetched from url, and checkSignedPdf reporting no problems.
 * - then the steps of adding a person at home (2026-11-21), listed in
 *   inviteFlow.e2e.js: the owner adds people on Owner Usage, and each opens
 *   their link in a fresh browser context.
 *
 * main() runs all steps in order and exits non-zero on the first failure.
 */

const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  makeFormPdf, readSetupCode, waitForHealth, randomPassword, checkSignedPdf, writeHandoff,
} = require('./helpers');
const { inviteSteps, hidePrivate } = require('./inviteFlow.e2e');

const DEFAULT_URL = 'http://localhost:3000';
const SLOW_MS = 120000;
const ROOT = path.join(__dirname, '..', '..');
const COMPOSE = ['compose', '-f', 'docker-compose.yml', '-f', 'tests/e2e/compose.e2e.yml'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RECIPIENT = {
  firstName: 'Robin',
  lastName: 'Tester',
  email: 'signer@example.com',
};

function cosignUrl(env = process.env) {
  const value = String((env && env.COSIGN_URL) || '').trim();
  return (value || DEFAULT_URL).replace(/\/+$/, '');
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

// A response predicate that says what it waits for, so a fake page can answer it.
function responseTo(urlPart, method = 'POST') {
  const predicate = (response) => response.url().includes(urlPart) && response.request().method() === method;
  return Object.assign(predicate, { urlPart, method });
}

async function clickAndWait(page, urlPart, selector, method = 'POST') {
  const [response] = await Promise.all([
    page.waitForResponse(responseTo(urlPart, method), { timeout: SLOW_MS }),
    page.click(selector),
  ]);
  return response;
}

async function bodyOf(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function brief(body) {
  return JSON.stringify(body === undefined ? null : body).slice(0, 300);
}

function linkToken(link) {
  const match = /\/fill\/([^/?#]+)/.exec(String(link || ''));
  return match ? match[1] : null;
}

// --- part 1 -----------------------------------------------------------------

async function finishSetup(page, ctx) {
  if (!ctx.adminPassword) ctx.adminPassword = randomPassword();
  await page.goto(`${ctx.baseUrl}/setup`);
  await page.fill('input[name="setupCode"]', ctx.setupCode);
  await page.click('button[type="submit"]:has-text("Continue")');
  await page.waitForSelector('input[name="mail"][value="none"]', { timeout: SLOW_MS });
  await page.check('input[name="mail"][value="none"]');
  await page.fill('input[name="NEXT_PUBLIC_APP_URL"]', ctx.siteAddress || ctx.baseUrl);
  const saved = await clickAndWait(page, '/api/setup/settings', 'button[type="submit"]:text-is("Save")');
  const savedBody = await bodyOf(saved);
  check(saved.status() === 200, `Saving the setup settings answered ${saved.status()}: ${brief(savedBody)}`);

  await page.fill('input[name="adminEmail"]', ctx.adminEmail);
  await page.fill('input[name="adminPassword"]', ctx.adminPassword);
  const made = await clickAndWait(page, '/api/setup/admin', 'button[type="submit"]:has-text("Create admin")');
  const madeBody = await bodyOf(made);
  check(made.status() === 201, `Making the first admin answered ${made.status()}: ${brief(madeBody)}`);
  await page.waitForSelector(`text=Setup is done. Sign in as ${ctx.adminEmail}`);
}

async function signIn(page, ctx) {
  await page.goto(`${ctx.baseUrl}/enterprise/login`);
  await page.fill('input[placeholder="name@company.com"]', ctx.adminEmail);
  await page.fill('input[type="password"]', ctx.adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/enterprise/documents', { timeout: SLOW_MS });
  // A first visit opens the getting-started guide over the page; skip it.
  const guide = '[aria-label="Getting started guide"]';
  await page.click(`${guide} button:text-is("Skip")`, { timeout: SLOW_MS });
  await page.waitForSelector(guide, { state: 'detached' });
}

async function uploadForm(page, ctx) {
  ctx.original = Buffer.from(await makeFormPdf());
  await page.click('button:has-text("New document")');
  await page.setInputFiles('input[type="file"]', {
    name: 'e2e-form.pdf',
    mimeType: 'application/pdf',
    buffer: ctx.original,
  });
  await page.click('button:text-is("Continue")');

  // Confirm uploads to storage, adds the row, then asks /api/ocr (pre_setup).
  const ocr = await clickAndWait(page, '/api/ocr', 'button:has-text("Confirm & Upload")');
  const ocrBody = await bodyOf(ocr);
  check(ocr.status() === 200, `The field reading (/api/ocr) answered ${ocr.status()}: ${brief(ocrBody)}`);
  check(ocrBody && ocrBody.extractionMethod === 'stub', `The fields were not read by the stub: ${brief(ocrBody)}`);
  const names = (ocrBody.fields || []).map((field) => field.field_name);
  check(
    names.length === 2 && names.includes('Full name') && names.includes('Signature'),
    `The stub should give 'Full name' and 'Signature', gave ${brief(names)}`
  );
  const asked = ocr.request().postDataJSON() || {};
  check(UUID.test(String(asked.documentId || '')), `No document id in the /api/ocr request: ${brief(asked)}`);
  check(asked.mode === 'pre_setup', `The upload asked /api/ocr for mode ${brief(asked.mode)}, not pre_setup`);
  ctx.documentId = asked.documentId;

  // The list polls; 'Set up' shows once the document needs setting up.
  const setUp = `a[href="/enterprise/setup?id=${ctx.documentId}"]`;
  await page.waitForSelector(setUp, { timeout: SLOW_MS });
  await page.click(setUp);
  await page.waitForURL(`**/enterprise/setup?id=${ctx.documentId}`, { timeout: SLOW_MS });
  await page.waitForSelector('text="Full name"', { timeout: SLOW_MS });
  await page.waitForSelector('text="Signature"', { timeout: SLOW_MS });

  const save = await clickAndWait(page, '/api/enterprise/setup/save', 'button:has-text("Save & continue")');
  const saveBody = await bodyOf(save);
  check(save.status() === 200, `Saving the setup answered ${save.status()}: ${brief(saveBody)}`);
  await page.waitForURL(`**/enterprise/send-links?documentId=${ctx.documentId}`, { timeout: SLOW_MS });
}

// --- part 2 -----------------------------------------------------------------

function readClipboard() {
  return navigator.clipboard.readText();
}

function readAccessToken() {
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (/^sb-.*-auth-token$/.test(key)) {
      try {
        return JSON.parse(window.localStorage.getItem(key)).access_token || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Runs in the recipient's page: the same complete call the Submit button
// makes, with the page's own verification and CSRF tokens.
async function completeAgain(token) {
  let verify = null;
  try {
    verify = window.sessionStorage.getItem(`cosign_verify_${token}`);
  } catch {
    verify = null;
  }
  const csrf = (document.cookie.match(/(?:^|;\s*)x-csrf-token=([^;]*)/) || [])[1] || '';
  const res = await fetch(`/api/sessions/${token}/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-verify': verify || '',
      'x-csrf-token': csrf,
    },
    body: JSON.stringify({ generatePdf: true }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, hadVerify: Boolean(verify) };
}

async function sendLink(page, ctx) {
  const form = '#create-send-link';
  ctx.recipient = ctx.recipient || { ...RECIPIENT };
  await page.waitForSelector(`${form} option[value="${ctx.documentId}"]:not([disabled])`, {
    state: 'attached',
    timeout: SLOW_MS,
  });
  await page.selectOption(`${form} form select >> nth=0`, ctx.documentId);
  await page.fill(`${form} input[placeholder="Jane"]`, ctx.recipient.firstName);
  await page.fill(`${form} input[placeholder="Miller"]`, ctx.recipient.lastName);
  await page.fill(`${form} input[placeholder="jane@client.com"]`, ctx.recipient.email);

  const created = await clickAndWait(page, '/api/sessions/create', `${form} button[type="submit"]`);
  const body = await bodyOf(created);
  check(created.status() === 201, `Creating the signing link answered ${created.status()}: ${brief(body)}`);
  check(body && body.session && UUID.test(String(body.session.id || '')), `No session id in ${brief(body)}`);
  // Link mode never mails, whatever the mail setting: the link is to copy.
  check(body.emailSent === false, `Link mode should send no email: ${brief({ emailSent: body.emailSent })}`);
  ctx.sessionId = body.session.id;

  await page.waitForSelector(`text=Signing link ready for ${ctx.recipient.firstName} ${ctx.recipient.lastName}`);
  const shown = await page.inputValue('.ent-link-created input');
  check(shown === body.shareUrl, 'The link on the page is not the one the server made');
  check(shown.startsWith(`${ctx.baseUrl}/en/fill/`), `The link does not open on ${ctx.baseUrl}: ${shown.split('/fill/')[0]}`);

  await page.click('.ent-link-created button:has-text("Copy link")');
  await page.waitForSelector('.ent-link-created button:has-text("Copied")');
  const copied = await page.evaluate(readClipboard);
  check(copied === shown, 'The copied link is not the link on the page');
  ctx.link = copied;
  ctx.token = linkToken(copied);
  check(ctx.token, 'No token in the signing link');
}

async function staffAccessToken(page) {
  const token = await page.evaluate(readAccessToken);
  check(typeof token === 'string' && token.length > 0, 'No signed-in session on the staff page');
  return token;
}

// docker compose exec db: a login over the stack's network (host db, as the
// services log in) with a wrong password is refused. With the services logging
// in with the password the keys service made, this shows the database checks
// it, so that password is the one it has. The wrong one is made here and is
// never the real one; psql's message names neither.
function wrongPasswordRefused() {
  let refusal = null;
  try {
    execFileSync('docker', [
      ...COMPOSE, 'exec', '-T', '-e', `PGPASSWORD=wrong-${crypto.randomBytes(12).toString('hex')}`, 'db',
      'psql', '-h', 'db', '-U', 'supabase_admin', '-d', 'postgres', '-tAc', 'select 1',
    ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    refusal = String(error.stderr || '');
  }
  check(refusal !== null, 'The database let supabase_admin in over the network with a wrong password');
  check(/password authentication failed/.test(refusal), `The wrong-password login failed for another reason: ${refusal.trim().split('\n')[0]}`);
}

// docker compose exec db: moves one signing link's expiry into the past. The
// password is the one the keys service made, read from the keys volume inside
// the container, so it is never on a command line or in this process.
function expireInDatabase(sessionId) {
  check(UUID.test(String(sessionId)), 'Not a session id');
  wrongPasswordRefused();
  const sql = `update public.fill_sessions set expires_at = now() - interval '1 minute' where id = '${sessionId}' returning id`;
  const out = execFileSync('docker', [
    ...COMPOSE, 'exec', '-T', 'db', 'sh', '-c',
    'PGPASSWORD="$(cat /keys/db_password)" exec psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -tAc "$0"',
    sql,
  ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  check(out.includes(sessionId), 'The expiry was not changed');
}

async function expiredLink(page, ctx, { fetchFn, expireSession, log = console }) {
  if (!expireSession) {
    log.log('  expiredLink skipped: no way to reach this stack\'s database');
    return 'skipped';
  }
  const access = await staffAccessToken(page);
  const res = await fetchFn(`${ctx.baseUrl}/api/sessions/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify({ documentId: ctx.documentId, sendMethod: 'link', expiresInDays: 1 }),
  });
  const body = await bodyOf(res);
  check(res.status === 201, `Creating the link to expire answered ${res.status}: ${brief(body)}`);
  const token = linkToken(body.shareUrl);
  check(token && body.session && body.session.id, `No link in ${brief(body)}`);

  const before = await fetchFn(`${ctx.baseUrl}/api/sessions/${token}`);
  check(before.status === 200, `The new link should open before it expires, answered ${before.status}`);

  await expireSession(body.session.id);
  const after = await fetchFn(`${ctx.baseUrl}/api/sessions/${token}`);
  const afterBody = await bodyOf(after);
  check(
    after.status === 403 && afterBody && afterBody.errorCode === 'expired',
    `An expired link should be refused with 403 expired, answered ${after.status}: ${brief(afterBody)}`
  );
  return 'refused';
}

// Opens the link and gets past "Verify your access" with the recipient's
// email and last name and the consent box.
async function verifyRecipient(page, ctx) {
  await page.goto(ctx.link);
  await page.waitForSelector('text=Verify your access', { timeout: SLOW_MS });
  await page.fill('input[type="email"][placeholder="name@example.com"]', ctx.recipient.email);
  await page.fill('input[placeholder="Last name"]', ctx.recipient.lastName);
  await page.check('form input[type="checkbox"]');
  const verified = await clickAndWait(page, `/api/sessions/${ctx.token}/verify`, 'button:text-is("Continue")');
  const verifiedBody = await bodyOf(verified);
  check(verified.status() === 200, `Verifying answered ${verified.status()}: ${brief(verifiedBody && verifiedBody.errorCode)}`);
}

async function signAsRecipient(page, ctx) {
  ctx.signerName = `${ctx.recipient.firstName} ${ctx.recipient.lastName}`;
  await verifyRecipient(page, ctx);

  await page.fill('input[placeholder="Full name"]', ctx.signerName, { timeout: SLOW_MS });

  const pad = page.locator('canvas[aria-label="Signature pad"]');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  check(box && box.width > 0 && box.height > 0, 'The signature pad is not on screen');
  const y = box.y + box.height * 0.6;
  await page.mouse.move(box.x + box.width * 0.15, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, y - box.height * 0.3, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.55, y + box.height * 0.1, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.8, y - box.height * 0.2, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector('text=Signature saved');

  const done = await clickAndWait(page, `/api/sessions/${ctx.token}/complete`, 'button[aria-label="Submit Document"]');
  const doneBody = await bodyOf(done);
  check(done.status() === 200, `Submitting answered ${done.status()}: ${brief(doneBody)}`);
  check(doneBody && doneBody.success === true && doneBody.status === 'completed', `Submitting did not complete: ${brief(doneBody)}`);
  check(doneBody.sessionId === ctx.sessionId, 'Submitting completed another session');
  check(doneBody.fillSummary && doneBody.fillSummary.signatureProvided === true, `No signature was saved: ${brief(doneBody.fillSummary)}`);
  await page.waitForSelector('text=Document Submitted');
}

// In a fresh browser: the recipient may verify again to see what they sent
// (the verify route allows a completed link), but the page is read-only and
// a second complete is refused.
async function reuseLink(page, ctx) {
  await verifyRecipient(page, ctx);
  await page.waitForSelector('text=Document Submitted', { timeout: SLOW_MS });
  const submit = await page.$$('button[aria-label="Submit Document"]');
  check(submit.length === 0, 'The completed link still shows Submit');
  const inputs = await page.$$('input[placeholder="Full name"]');
  check(inputs.length === 0, 'The completed link still shows the fields to fill');

  const again = await page.evaluate(completeAgain, ctx.token);
  check(again.hadVerify, 'The page has no verification, so a refused second submit proves nothing');
  check(
    again.status === 403 && again.body && again.body.errorCode === 'already_completed',
    `A second submit should be refused with 403 already_completed, answered ${again.status}: ${brief(again.body)}`
  );
}

async function downloadSignedPdf(page, ctx, { fetchFn }) {
  const access = await staffAccessToken(page);
  const res = await fetchFn(
    `${ctx.baseUrl}/api/sessions/signed-pdf?sessionId=${encodeURIComponent(ctx.sessionId)}`,
    { headers: { Authorization: `Bearer ${access}` } }
  );
  const info = await bodyOf(res);
  check(res.status === 200, `The signed PDF link answered ${res.status}: ${brief(info)}`);
  check(info && typeof info.url === 'string', `No url for the signed PDF: ${brief(info)}`);
  check(new URL(info.url).origin === new URL(ctx.baseUrl).origin, `The signed PDF link is not on ${ctx.baseUrl}`);
  check(/^[0-9a-f]{64}$/.test(String(info.sha256)), `No fingerprint saved for the signed PDF: ${brief(info.sha256)}`);
  check(Number.isInteger(info.bytes) && info.bytes > 0, `No size saved for the signed PDF: ${brief(info.bytes)}`);

  const file = await fetchFn(info.url);
  check(file.status === 200, `Downloading the signed PDF answered ${file.status}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const problems = await checkSignedPdf(bytes, { sha256: info.sha256, bytes: info.bytes, original: ctx.original });
  check(problems.length === 0, `The signed PDF failed its checks: ${problems.join('; ')}`);
  ctx.signedPdf = { sha256: info.sha256, bytes: info.bytes };
}

// --- the run ----------------------------------------------------------------

function composeLogs() {
  return execFileSync('docker', [...COMPOSE, 'logs', '--no-color', 'app'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

// 2026-11-21: also every link and password of the invite steps (ctx.hidden),
// any token field of an address (a Playwright error names the address it
// was at) and anything shaped like a session token.
function redact(text, ctx) {
  let out = String(text);
  const hidden = (ctx && Array.isArray(ctx.hidden)) ? ctx.hidden : [];
  for (const value of [ctx && ctx.setupCode, ctx && ctx.adminPassword, ...hidden]) {
    if (value) out = out.split(value).join('[hidden]');
  }
  return out
    .replace(/Setup code: [0-9a-f]{32}/g, 'Setup code: [hidden]')
    .replace(/((?:^|[?#&\s"'])(?:access_token|refresh_token|provider_token|provider_refresh_token|token|token_hash)=)[^&#\s"']+/g, '$1[hidden]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[hidden]');
}

// Keeps what each page did that may explain a failure.
function watch(page, name, seen) {
  const entry = { name, page, problems: [] };
  seen.push(entry);
  if (typeof page.on !== 'function') return;
  const note = (line) => {
    entry.problems.push(line);
    if (entry.problems.length > 40) entry.problems.shift();
  };
  page.on('response', (response) => {
    if (response.status() >= 400) {
      let where = response.url();
      try {
        const url = new URL(where);
        where = url.pathname;
      } catch {
        // keep it as it came
      }
      note(`${response.status()} ${response.request().method()} ${where}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') note(`console: ${message.text().slice(0, 300)}`);
  });
  page.on('pageerror', (error) => note(`page error: ${String(error && error.message).slice(0, 300)}`));
}

async function report(error, seen, ctx, log) {
  error.reported = true;
  log.error(redact(`\nFAILED at ${error.step || 'start'}: ${error.message}`, ctx));
  for (const { name, page, problems } of seen) {
    let where = '';
    let text = '';
    try {
      where = hidePrivate(page.url());
      text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    } catch {
      // the page may be gone
    }
    log.error(redact(`\n[${name} page] ${where}\n${String(text).slice(0, 1500)}`, ctx));
    if (problems.length) log.error(redact(`[${name} page, last problems]\n${problems.join('\n')}`, ctx));
  }
}

async function run({
  env = process.env,
  chromium = require('playwright').chromium,
  fetchFn = (url, init) => fetch(url, init),
  readLogs = composeLogs,
  expireSession = env.COSIGN_URL ? null : expireInDatabase,
  log = console,
} = {}) {
  const baseUrl = cosignUrl(env);
  await waitForHealth(`${baseUrl}/api/health`, fetchFn, { timeoutMs: 300000, intervalMs: 2000 });
  log.log(`ok health (${baseUrl})`);
  const setupCode = String(env.COSIGN_SETUP_CODE || '').trim() || readSetupCode(readLogs());
  check(setupCode, 'No setup code: set COSIGN_SETUP_CODE or start the stack with docker compose');
  const ctx = {
    baseUrl,
    setupCode,
    adminEmail: String(env.COSIGN_ADMIN_EMAIL || '').trim() || 'owner@example.com',
    adminPassword: randomPassword(),
    recipient: { ...RECIPIENT },
  };

  const browser = await chromium.launch();
  const seen = [];
  try {
    const staffContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const staff = await staffContext.newPage();
    if (typeof staff.setDefaultTimeout === 'function') staff.setDefaultTimeout(60000);
    watch(staff, 'staff', seen);
    let recipient = null;

    const steps = [
      ['finishSetup', () => finishSetup(staff, ctx)],
      ['signIn', () => signIn(staff, ctx)],
      ['uploadForm', () => uploadForm(staff, ctx)],
      ['sendLink', () => sendLink(staff, ctx)],
      ['expiredLink', () => expiredLink(staff, ctx, { fetchFn, expireSession, log })],
      ['signAsRecipient', async () => {
        const fresh = await browser.newContext();
        recipient = await fresh.newPage();
        if (typeof recipient.setDefaultTimeout === 'function') recipient.setDefaultTimeout(60000);
        watch(recipient, 'recipient', seen);
        await signAsRecipient(recipient, ctx);
      }],
      ['reuseLink', async () => {
        const fresh = await browser.newContext();
        const again = await fresh.newPage();
        if (typeof again.setDefaultTimeout === 'function') again.setDefaultTimeout(60000);
        watch(again, 'reuse', seen);
        await reuseLink(again, ctx);
      }],
      ['downloadSignedPdf', () => downloadSignedPdf(staff, ctx, { fetchFn })],
      // 2026-11-21: then the owner adds people (inviteFlow.e2e.js).
      ...inviteSteps({
        staff,
        ctx,
        log,
        openPage: async (name) => {
          const fresh = await browser.newContext();
          const page = await fresh.newPage();
          if (typeof page.setDefaultTimeout === 'function') page.setDefaultTimeout(60000);
          watch(page, name, seen);
          return page;
        },
      }),
    ];

    for (const [name, step] of steps) {
      const started = Date.now();
      try {
        // eslint-disable-next-line no-await-in-loop
        await step();
      } catch (error) {
        error.step = name;
        throw error;
      }
      log.log(`ok ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    }
    return ctx;
  } catch (error) {
    await report(error, seen, ctx, log);
    throw error;
  } finally {
    await browser.close();
  }
}

// 2026-11-21: what the second phase (tests/e2e/siteAddress.e2e.js) needs, in
// the file COSIGN_E2E_HANDOFF names, when it names one. Never printed.
function handoffOf(ctx) {
  return {
    owner: { email: ctx.adminEmail, password: ctx.adminPassword },
    member: ctx.invited ? { email: ctx.invited.email, password: ctx.invited.password } : null,
    documentId: ctx.documentId || null,
  };
}

function main(options = {}) {
  const env = options.env || process.env;
  return run(options).then(
    (ctx) => {
      console.log('End-to-end main flow passed: setup, sign in, upload, fields read, send, sign, reuse refused, signed PDF checked; '
        + 'a person added at home: invite link shown, password chosen before any enterprise page, signed in with it, '
        + 'a fresh link for a member without a password, no link for one with a password.');
      if (env.COSIGN_E2E_HANDOFF) {
        try {
          writeHandoff(env.COSIGN_E2E_HANDOFF, handoffOf(ctx));
        } catch (error) {
          console.error(`FAILED to hand the second phase its data: ${error.code || error.message}`);
          process.exitCode = 1;
          return 1;
        }
        console.log('Handed the second phase what it needs (in a file only this user can read; nothing printed).');
      }
      return 0;
    },
    (error) => {
      if (!error || !error.reported) console.error(redact(`FAILED: ${error && error.message}`));
      process.exitCode = 1;
      return 1;
    }
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  cosignUrl,
  responseTo,
  redact,
  finishSetup,
  signIn,
  uploadForm,
  sendLink,
  expiredLink,
  signAsRecipient,
  reuseLink,
  downloadSignedPdf,
  run,
  main,
  handoffOf,
  watch,
  report,
  RECIPIENT,
};
