/**
 * The second phase of the end-to-end run (2026-11-21): the app opened from
 * another machine at the address COSIGN_SITE_URL sets.
 *
 * The first phase (tests/e2e/mainFlow.e2e.js) runs on a fresh stack with
 * COSIGN_SITE_URL not set, in a browser that reaches the app at
 * http://localhost:3000. Then the stack is brought up again on the same
 * database with COSIGN_SITE_URL set to an address that is not localhost
 * (docker compose up -d recreates the auth service and the app with it), and
 * this file runs in a browser whose own localhost is not the app: in CI, a
 * container with its own network namespace on the stack's network
 * (self-hosted), or the runner itself at its own non-loopback address
 * (GitHub's runners). It needs:
 * - COSIGN_SITE_URL: the site address, as the stack was given it;
 * - COSIGN_E2E_HANDOFF: the file the first phase wrote (the owner's and a
 *   member's address and password, the uploaded document), deleted here as
 *   soon as it is read.
 *
 * The steps, in order:
 * - localhostIsNotTheApp: from here http://localhost:3000 is not the app, so
 *   a link built from localhost could not open here.
 * - siteOwnerSignIn: the owner signs in at the site address and gets Owner
 *   Usage.
 * - siteInvite: the owner adds a new Member; the invite link is the auth
 *   service's at the site address (host and port) and returns to its sign-in
 *   page, never localhost; Copy copies that link.
 * - siteLinkOpens: in a new browser context the link opens, and the auth
 *   service sends the browser back to the site address with type=invite and
 *   the password form.
 * - sitePassword, siteStays, siteSignIn: the password chosen, they arrive,
 *   a reload keeps them, and they sign in again with the password.
 * - siteSigningLink: a signing link the owner makes (no recipient named) is
 *   at the site address and opens there on the document's form.
 * - then the Admin role's steps (tests/e2e/adminRole.e2e.js).
 * - noStorage: last, a browser that refuses storage (localStorage and
 *   sessionStorage throw) opens a new invite link, chooses a password and
 *   arrives; in another such browser the password signs them in.
 *
 * Nothing here prints a link, a token or a password (ctx.hidden, hidePrivate).
 */

const { waitForHealth, readHandoff, randomPassword } = require('./helpers');
const invite = require('./inviteFlow.e2e');
const { adminSteps, callApi } = require('./adminRole.e2e');
const { signIn, redact, watch, report } = require('./mainFlow.e2e');

const {
  SLOW_MS, check, hide, newPerson, hidePrivate, openOwnerPage, addPerson, checkLink, brief,
  openLink, choosePassword, staysAfterReload, signOutAndIn, menuEmail, expectResponse,
} = invite;

// Where a link built from localhost would have pointed (COSIGN_PORT 3000).
const LOCALHOST = 'http://localhost:3000';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function siteUrl(env = process.env) {
  const value = String((env && env.COSIGN_SITE_URL) || '').trim().replace(/\/+$/, '');
  check(value, 'No site address: set COSIGN_SITE_URL to the address the stack was brought up with');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('COSIGN_SITE_URL is not an address');
  }
  check(!LOOPBACK.has(url.hostname) && !url.hostname.endsWith('.localhost'), 'COSIGN_SITE_URL must be an address other than this machine\'s localhost');
  return url.origin;
}

// --- steps --------------------------------------------------------------------

async function localhostIsNotTheApp(page, ctx, { fetchFn }) {
  let answered = null;
  try {
    const res = await fetchFn(`${LOCALHOST}/api/health`, { signal: AbortSignal.timeout(10000) });
    answered = `answered ${res.status}`;
  } catch {
    answered = null;
  }
  check(answered === null, `From here ${LOCALHOST} ${answered}: a link built from localhost could have worked here`);
  let opened = null;
  try {
    const res = await page.goto(`${LOCALHOST}/enterprise/login`, { timeout: 15000 });
    opened = res && typeof res.status === 'function' ? `answered ${res.status()}` : 'opened';
  } catch {
    opened = null;
  }
  check(opened === null, `The browser here opened ${LOCALHOST} (${opened}): it is not on another machine`);
}

async function siteOwnerSignIn(page, ctx) {
  await signIn(page, ctx);
  check(new URL(page.url()).origin === ctx.baseUrl, `Signed in, but at ${hidePrivate(page.url())}, not the site address`);
  await page.waitForSelector('.ent-sidebar a[href="/enterprise/owner"]', { timeout: SLOW_MS });
}

// Runs in the page: keeps what the next copy command copies.
function watchCopy() {
  window.__e2eCopied = null;
  document.addEventListener('copy', (event) => {
    const target = event.target;
    window.__e2eCopied = target && typeof target.value === 'string'
      ? target.value.slice(target.selectionStart || 0, target.selectionEnd || target.value.length)
      : String(document.getSelection());
  }, true);
  return { secure: window.isSecureContext, clipboard: Boolean(navigator.clipboard) };
}

async function readCopied() {
  if (window.__e2eCopied !== null && window.__e2eCopied !== undefined) return window.__e2eCopied;
  if (window.isSecureContext && navigator.clipboard) return navigator.clipboard.readText();
  return null;
}

async function siteInvite(page, ctx, log = console) {
  const person = newPerson('site');
  ctx.siteInvited = person;
  await openOwnerPage(page, ctx);
  const body = await addPerson(page, person.email);
  check(body && body.invited === true, `A new address should be invited: ${brief(body)}`);
  check(typeof body.inviteLink === 'string' && body.inviteLink.length > 0, `No invite link for the owner with mail off: ${brief(body)}`);
  hide(ctx, body.inviteLink);
  await page.waitForSelector(`.owner-success:has-text("send this link to ${person.email}")`, { timeout: SLOW_MS });
  const shown = await page.inputValue('.owner-invite-link input[aria-label="Invite link"]');
  check(shown === body.inviteLink, 'The link on the owner page is not the one the server made');

  const link = new URL(shown);
  check(!LOOPBACK.has(link.hostname), `The invite link opens at ${hidePrivate(shown)}: localhost, not the site address`);
  check(link.host === new URL(ctx.baseUrl).host, `The invite link's host and port are ${link.host}, not the site address's ${new URL(ctx.baseUrl).host}`);
  checkLink(shown, ctx, 'invite');

  const where = await page.evaluate(watchCopy);
  log.log(`  siteInvite: the page is ${where.secure ? 'a' : 'not a'} secure context, with${where.clipboard ? '' : ' no'} clipboard API`);
  await page.click('.owner-invite-link button:text-is("Copy")');
  await page.waitForSelector('.owner-invite-link button:text-is("Copied"), .owner-failure', { timeout: SLOW_MS });
  const failed = await page.$$('.owner-failure');
  if (failed.length) {
    throw new Error(`Copy failed at the site address: ${(await page.textContent('.owner-failure')).trim()}`);
  }
  const copied = await page.evaluate(readCopied);
  check(copied === shown, 'Copy did not copy the invite link');
  person.link = shown;
}

async function siteSigningLink(staff, ctx, { openPage }) {
  check(ctx.documentId, 'The first phase handed over no document');
  const made = await staff.evaluate(callApi, {
    path: '/api/sessions/create',
    method: 'POST',
    body: { documentId: ctx.documentId, sendMethod: 'link', expiresInDays: 1 },
  });
  if (made.body && made.body.shareUrl) hide(ctx, made.body.shareUrl);
  check(made.status === 201, `Making a signing link answered ${made.status}: ${brief(made.body && made.body.error)}`);
  const share = String(made.body.shareUrl || '');
  check(share.startsWith(`${ctx.baseUrl}/en/fill/`), `The signing link opens at ${hidePrivate(share)}, not ${ctx.baseUrl}/en/fill/`);
  // Made with no recipient, so no verification: it opens on the form itself.
  const page = await openPage('signing link');
  await page.goto(share, { timeout: SLOW_MS });
  await page.waitForSelector('button[aria-label="Submit Document"]', { timeout: SLOW_MS });
  await page.waitForSelector('text=e2e-form', { timeout: SLOW_MS });
}

// Runs in the page: whether either storage can be used at all.
function storageWorks() {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      window[name].getItem('e2e');
      return true;
    } catch {
      // refused, as it should be here
    }
  }
  return false;
}

// Runs before any page script: storage refused as a browser that blocks
// site data does (reading localStorage or sessionStorage throws).
function refuseStorage() {
  for (const name of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(window, name, {
      configurable: true,
      get() {
        throw new DOMException(`${name} is refused here`, 'SecurityError');
      },
    });
  }
}

async function noStorage(staff, ctx, { openPage }) {
  const person = newPerson('nostorage');
  await openOwnerPage(staff, ctx);
  const body = await addPerson(staff, person.email);
  check(body && body.invited === true && typeof body.inviteLink === 'string', `A new address should be invited with a link: ${brief(body)}`);
  hide(ctx, body.inviteLink);
  person.link = body.inviteLink;

  const page = await openPage('no storage', { refuseStorage: true });
  const response = await page.goto(person.link, { timeout: SLOW_MS });
  check(response, 'Opening the link got no answer');
  await page.waitForSelector('h1:text-is("Choose a password")', { timeout: SLOW_MS });
  check(!(await page.evaluate(storageWorks)), 'The browser for this step still has localStorage or sessionStorage');
  const shown = await page.inputValue('#invite-email');
  check(shown === person.email, `The password form shows ${shown || 'no address'}, not the invited address`);
  person.password = randomPassword();
  hide(ctx, person.password);
  await page.fill('#invite-password', person.password);
  await page.fill('#invite-confirm', person.password);
  const updated = expectResponse(page, '/auth/v1/user', 'PUT');
  const cleared = expectResponse(page, '/api/account/password-set', 'POST');
  await page.click('button[type="submit"]:text-is("Set password")');
  const update = await updated;
  check(update && update.status() === 200, `The auth service took no new password: ${update ? update.status() : 'no answer'}`);
  const clear = await cleared;
  check(clear && clear.status() === 200, `Clearing the mark answered ${clear ? clear.status() : 'nothing'}`);
  await page.waitForURL('**/enterprise/documents', { timeout: SLOW_MS });
  const email = await menuEmail(page);
  check(email === person.email, `Arrived signed in as ${email || 'no one'}, not the invited address`);

  const again = await openPage('no storage, again', { refuseStorage: true });
  await again.goto(`${ctx.baseUrl}/enterprise/login`, { timeout: SLOW_MS });
  await again.fill('input[placeholder="name@company.com"]', person.email);
  await again.fill('input[type="password"]', person.password);
  const signedIn = expectResponse(again, 'grant_type=password', 'POST');
  await again.click('button[type="submit"]');
  const res = await signedIn;
  check(res && res.status() === 200, `Signing in with the chosen password answered ${res ? res.status() : 'nothing'}`);
  await again.waitForURL('**/enterprise/documents', { timeout: SLOW_MS });
  const forms = await again.$$('#invite-password');
  check(forms.length === 0, 'Signed in with a password, they are shown the password form again');
}

// --- the run ------------------------------------------------------------------

async function run({
  env = process.env,
  chromium = require('playwright').chromium,
  fetchFn = (url, init) => fetch(url, init),
  log = console,
} = {}) {
  const baseUrl = siteUrl(env);
  const handoff = readHandoff(env.COSIGN_E2E_HANDOFF);
  check(handoff && handoff.owner && handoff.owner.email && handoff.owner.password, 'The handoff file has no owner');
  const ctx = {
    baseUrl,
    adminEmail: handoff.owner.email,
    adminPassword: handoff.owner.password,
    member: handoff.member,
    documentId: handoff.documentId,
    hidden: handoff.member && handoff.member.password ? [handoff.member.password] : [],
  };
  await waitForHealth(`${baseUrl}/api/health`, fetchFn, { timeoutMs: 300000, intervalMs: 2000 });
  log.log(`ok health (${baseUrl})`);

  const browser = await chromium.launch();
  const seen = [];
  const openPage = async (name, { refuseStorage: refuse = false } = {}) => {
    const context = await browser.newContext();
    if (refuse) await context.addInitScript(refuseStorage);
    const page = await context.newPage();
    if (typeof page.setDefaultTimeout === 'function') page.setDefaultTimeout(60000);
    watch(page, name, seen);
    return page;
  };
  try {
    const staff = await openPage('owner');
    let first = null;
    const steps = [
      ['localhostIsNotTheApp', async () => {
        const probe = await openPage('localhost probe');
        await localhostIsNotTheApp(probe, ctx, { fetchFn });
      }],
      ['siteOwnerSignIn', () => siteOwnerSignIn(staff, ctx)],
      ['siteInvite', () => siteInvite(staff, ctx, log)],
      ['siteLinkOpens', async () => {
        first = await openPage('invited at the site');
        await openLink(first, ctx, ctx.siteInvited, { type: 'invite' });
      }],
      ['sitePassword', () => choosePassword(first, ctx, ctx.siteInvited)],
      ['siteStays', () => staysAfterReload(first, ctx, ctx.siteInvited)],
      ['siteSignIn', () => signOutAndIn(first, ctx, ctx.siteInvited)],
      ['siteSigningLink', () => siteSigningLink(staff, ctx, { openPage })],
      ...adminSteps({ staff, ctx, openPage }),
      ['noStorage', () => noStorage(staff, ctx, { openPage })],
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

function main(options) {
  return run(options).then(
    () => {
      console.log('End-to-end second phase passed: at the site address, from a browser whose localhost is not the app, '
        + 'the owner signed in, the invite link opened there, the password was chosen and kept; a signing link opened there; '
        + 'the Admin role: what an Admin may and may not do, against a Member and the owner; a browser refusing storage finished.');
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
  LOCALHOST,
  siteUrl,
  localhostIsNotTheApp,
  siteOwnerSignIn,
  watchCopy,
  readCopied,
  siteInvite,
  siteSigningLink,
  refuseStorage,
  noStorage,
  run,
  main,
};
