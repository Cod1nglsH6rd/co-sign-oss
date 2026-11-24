/**
 * End-to-end steps for adding a person at home (2026-11-21), run by
 * tests/e2e/mainFlow.e2e.js after its own steps, on the same stack: the first
 * admin made at /setup is signed in on the staff page and is the owner. Mail
 * is off ('No mail' at /setup), so every link comes back to the owner page.
 *
 * - invitePerson: on Owner Usage the owner adds a new address as a Member;
 *   the page shows the invite link with its Copy button, and the copied link
 *   is the one the server made, an invite link of the stack's auth service
 *   that returns to /enterprise/login.
 * - inviteLinkOpens: in a new browser context the link is opened; the auth
 *   service sends the browser back to /enterprise/login with type=invite and a
 *   session in the fragment, the page shows the password form with that
 *   address, and the session carries the account's password_pending mark.
 * - inviteGate: /enterprise/documents, opened directly, sends them back to
 *   the form.
 * - invitePassword: they choose a password (the auth service takes it, the
 *   app clears the mark and the session is refreshed) and arrive on All
 *   Documents with a session that no longer carries the mark.
 * - inviteStays: a reload keeps them there, with no form.
 * - inviteSignIn: Log out, then sign in at /enterprise/login with the address
 *   and the password: they arrive with no form.
 * - freshLink: the owner adds a second new address and does not open its
 *   link, then adds it again: a new link, and the 'new sign-in link' line.
 * - freshLinkOpens: in a third context that link brings them to the form;
 *   they choose a password and arrive.
 * - noLinkWithPassword: the first address added again (it has a password
 *   now) gets no link and the plain 'added' line.
 *
 * Nothing here prints a link, a token or a password: each link and password
 * is put in ctx.hidden, which the run's report takes out of what it prints,
 * and addresses are printed by hidePrivate() (no query, no fragment).
 */

const crypto = require('crypto');
const { randomPassword } = require('./helpers');

const SLOW_MS = 120000;
// After the page shows who is signed in, the time left for any redirect.
const SETTLE_MS = 3000;
const GUIDE = '[aria-label="Getting started guide"]';
const FORM_TITLE = 'h1:text-is("Choose a password")';
const OWNER_FORM = '.owner-invite-form';
const LINK_BOX = '.owner-invite-link input[aria-label="Invite link"]';
const TOAST = '[data-rht-toaster] [role="status"]';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function responseTo(urlPart, method = 'POST') {
  const predicate = (response) => response.url().includes(urlPart) && response.request().method() === method;
  return Object.assign(predicate, { urlPart, method });
}

// Waits for one response; null when none came in time (never an unhandled rejection).
function expectResponse(page, urlPart, method = 'POST', timeout = SLOW_MS) {
  return page.waitForResponse(responseTo(urlPart, method), { timeout }).then((r) => r, () => null);
}

async function bodyOf(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// What an auth or app error answer says, without any other field.
function errorOf(body) {
  if (!body || typeof body !== 'object') return 'no body';
  const parts = ['error_code', 'code', 'error', 'msg', 'message', 'error_description']
    .filter((k) => body[k] !== undefined && body[k] !== null)
    .map((k) => `${k}: ${String(body[k]).slice(0, 200)}`);
  return parts.length ? parts.join(', ') : 'no error given';
}

// An address as it may be printed: origin and path, and only the type and
// error fields of its query or fragment (where the tokens are). A signing
// link's token in the path is taken out too.
function hidePrivate(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return '[an address]';
  }
  const keep = new URLSearchParams();
  for (const params of [url.searchParams, new URLSearchParams(url.hash.replace(/^#/, ''))]) {
    for (const name of ['type', 'error', 'error_code', 'error_description']) {
      const v = params.get(name);
      if (v) keep.set(name, v);
    }
  }
  const pathname = url.pathname.replace(/\/fill\/[^/]+/, '/fill/[token]');
  const rest = keep.toString();
  return `${url.origin}${pathname}${rest ? ` (${rest})` : ''}`;
}

function hide(ctx, value) {
  if (!value) return;
  if (!Array.isArray(ctx.hidden)) ctx.hidden = [];
  ctx.hidden.push(value);
}

function newPerson(label) {
  return { label, email: `invited-${label}-${crypto.randomBytes(4).toString('hex')}@example.com` };
}

function linkWithoutPrivate(body) {
  if (!body || typeof body !== 'object') return body;
  const { inviteLink, ...rest } = body;
  return inviteLink ? { ...rest, inviteLink: '[hidden]' } : rest;
}

function brief(body) {
  const shown = linkWithoutPrivate(body);
  return JSON.stringify(shown === undefined ? null : shown).slice(0, 300);
}

// Runs in the page: the signed-in user of the auth client's saved session,
// with only its id, email and whether it carries the password_pending mark.
function readSessionUser() {
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (/^sb-.*-auth-token$/.test(key)) {
      try {
        const user = JSON.parse(window.localStorage.getItem(key)).user || {};
        return {
          id: user.id || null,
          email: user.email || null,
          pending: Boolean(user.app_metadata && user.app_metadata.password_pending === true),
        };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function readClipboard() {
  return navigator.clipboard.readText();
}

// The link the owner copies: the auth service's verify address on the site,
// of the given type, returning to /enterprise/login.
function checkLink(link, ctx, type) {
  let url;
  try {
    url = new URL(String(link));
  } catch {
    throw new Error('The link the owner got is not an address');
  }
  const base = new URL(ctx.baseUrl);
  check(
    url.origin === base.origin && url.pathname === '/auth/v1/verify',
    `The link does not open the auth service at ${ctx.baseUrl}/auth/v1/verify: it opens ${hidePrivate(link)}`
  );
  if (type) check(url.searchParams.get('type') === type, `The link is of type ${url.searchParams.get('type')}, not ${type}`);
  const back = url.searchParams.get('redirect_to');
  check(back === `${ctx.baseUrl}/enterprise/login`, `The link returns to ${back ? hidePrivate(back) : 'nowhere given'}, not ${ctx.baseUrl}/enterprise/login`);
  return url.searchParams.get('type');
}

async function openOwnerPage(page, ctx) {
  await page.goto(`${ctx.baseUrl}/enterprise/owner`, { timeout: SLOW_MS });
  await page.waitForSelector(OWNER_FORM, { timeout: SLOW_MS });
}

// Adds email under Add User, as a Member unless role says 'admin', and
// returns the server's answer.
async function addPerson(page, email, role = 'member') {
  await page.fill(`${OWNER_FORM} input[type="email"]`, email);
  await page.selectOption(`${OWNER_FORM} select`, role);
  const answered = expectResponse(page, '/api/admin/users', 'POST');
  await page.click(`${OWNER_FORM} button[type="submit"]`);
  const res = await answered;
  check(res, `Adding ${email} got no answer from /api/admin/users`);
  const body = await bodyOf(res);
  check(res.status() === 200, `Adding ${email} answered ${res.status()}: ${brief(body)}`);
  return body;
}

// The link on the owner page: shown with Copy, the one the server made.
async function linkOnPage(page, body, { copy }) {
  await page.waitForSelector(LINK_BOX, { timeout: SLOW_MS });
  const shown = await page.inputValue(LINK_BOX);
  check(shown === body.inviteLink, 'The link on the owner page is not the one the server made');
  await page.waitForSelector('.owner-invite-link button:text-is("Copy")', { timeout: SLOW_MS });
  if (!copy) return shown;
  await page.click('.owner-invite-link button:text-is("Copy")');
  await page.waitForSelector('.owner-invite-link button:text-is("Copied")', { timeout: SLOW_MS });
  const copied = await page.evaluate(readClipboard);
  check(copied === shown, 'The copied link is not the link on the owner page');
  return copied;
}

async function invitePerson(page, ctx) {
  const person = newPerson('one');
  ctx.invited = person;
  await openOwnerPage(page, ctx);
  const body = await addPerson(page, person.email);
  check(body && body.invited === true, `A new address should be invited: ${brief(body)}`);
  check(typeof body.inviteLink === 'string' && body.inviteLink.length > 0, `No invite link for the owner with mail off: ${brief(body)}`);
  hide(ctx, body.inviteLink);
  check(body.mailed === false && body.mailReason === 'mail_off', `With 'No mail' the invite should not be mailed (mail_off): ${brief(body)}`);
  await page.waitForSelector(`.owner-success:has-text("The invitation mail was not sent (mail is off): send this link to ${person.email}")`, { timeout: SLOW_MS });
  person.link = await linkOnPage(page, body, { copy: true });
  checkLink(person.link, ctx, 'invite');
}

// Where the auth service sent the browser that opened a link: the Location
// of the last redirect before the page, or null.
async function redirectLocation(response) {
  if (!response || typeof response.request !== 'function') return null;
  const from = response.request().redirectedFrom();
  if (!from) return null;
  const answer = await from.response();
  if (!answer) return null;
  const headers = answer.headers();
  return headers.location || null;
}

// Opens person.link in its own page and expects the password form.
async function openLink(page, ctx, person, { type } = {}) {
  const response = await page.goto(person.link, { timeout: SLOW_MS });
  const location = await redirectLocation(response);
  const status = response && typeof response.status === 'function' ? response.status() : 'no answer';
  check(location, `The auth service did not send the browser on: the page answered ${status} at ${hidePrivate(page.url())}`);
  const landed = new URL(location, ctx.baseUrl);
  const fragment = new URLSearchParams(landed.hash.replace(/^#/, ''));
  const refused = fragment.get('error_code') || fragment.get('error');
  check(!refused, `The auth service refused the link: ${refused} (${fragment.get('error_description') || 'no description'})`);
  check(
    landed.origin === new URL(ctx.baseUrl).origin && landed.pathname === '/enterprise/login',
    `The link returned to ${hidePrivate(landed.href)}, not ${ctx.baseUrl}/enterprise/login`
  );
  check(fragment.get('access_token') && fragment.get('refresh_token'), 'The link returned with no session in the fragment');
  person.returnType = fragment.get('type');
  if (type) check(person.returnType === type, `The link returned with type=${person.returnType}, not type=${type}`);

  await page.waitForSelector(FORM_TITLE, { timeout: SLOW_MS });
  const shown = await page.inputValue('#invite-email');
  check(shown === person.email, `The password form shows ${shown || 'no address'}, not ${person.email}`);
  const user = await page.evaluate(readSessionUser);
  check(user && user.email === person.email, `The browser is not signed in as ${person.email}: ${JSON.stringify(user && user.email)}`);
  check(user.pending === true, 'The session does not carry the account\'s password_pending mark');
  person.userId = user.id;
}

async function gateSendsBack(page, ctx, person) {
  await page.goto(`${ctx.baseUrl}/enterprise/documents`, { timeout: SLOW_MS });
  await page.waitForURL('**/enterprise/login', { timeout: SLOW_MS });
  await page.waitForSelector(FORM_TITLE, { timeout: SLOW_MS });
  const shown = await page.inputValue('#invite-email');
  check(shown === person.email, `Sent back to a form for ${shown || 'no address'}, not ${person.email}`);
}

async function skipGuide(page) {
  await page.click(`${GUIDE} button:text-is("Skip")`, { timeout: SLOW_MS });
  await page.waitForSelector(GUIDE, { state: 'detached', timeout: SLOW_MS });
}

// Opens the profile menu and returns the signed-in address it shows, then closes it.
// A toast ('Password set', 'Welcome back!') sits over the avatar until it
// goes, and stays while the pointer is on it, so the menu waits for it first.
async function menuEmail(page) {
  await page.waitForSelector(TOAST, { state: 'detached', timeout: SLOW_MS });
  await page.click('.epm-avatar', { timeout: SLOW_MS });
  await page.waitForSelector('.epm-dropdown .epm-email', { timeout: SLOW_MS });
  const email = (await page.textContent('.epm-dropdown .epm-email')).trim();
  return email;
}

// On All Documents as person, and still there after SETTLE_MS, with no form.
async function staysOnDocuments(page, person, what) {
  const email = await menuEmail(page);
  check(email === person.email, `${what}: the page is signed in as ${email || 'no one'}, not ${person.email}`);
  await page.click('.epm-avatar');
  await page.waitForTimeout(SETTLE_MS);
  check(new URL(page.url()).pathname === '/enterprise/documents', `${what}: the page went on to ${hidePrivate(page.url())}`);
  const forms = await page.$$('#invite-password');
  check(forms.length === 0, `${what}: the password form is shown`);
  const user = await page.evaluate(readSessionUser);
  check(user && user.email === person.email, `${what}: the saved session is not ${person.email}'s`);
  check(user.pending === false, `${what}: the session still carries the password_pending mark`);
}

async function choosePassword(page, ctx, person) {
  person.password = randomPassword();
  hide(ctx, person.password);
  await page.fill('#invite-password', person.password);
  await page.fill('#invite-confirm', person.password);
  const updated = expectResponse(page, '/auth/v1/user', 'PUT');
  const cleared = expectResponse(page, '/api/account/password-set', 'POST');
  const refreshed = expectResponse(page, 'grant_type=refresh_token', 'POST');
  await page.click('button[type="submit"]:text-is("Set password")');

  const update = await updated;
  check(update, 'Setting the password never reached the auth service (no PUT /auth/v1/user)');
  check(update.status() === 200, `The auth service refused the new password: ${update.status()} ${errorOf(await bodyOf(update))}`);
  const clear = await cleared;
  check(clear, 'The app was never asked to clear the mark (no POST /api/account/password-set)');
  check(clear.status() === 200, `Clearing the mark answered ${clear.status()}: ${errorOf(await bodyOf(clear))}`);
  const refresh = await refreshed;
  check(refresh, 'The session was never refreshed after the mark was cleared');
  check(refresh.status() === 200, `Refreshing the session answered ${refresh.status()}: ${errorOf(await bodyOf(refresh))}`);

  await page.waitForURL('**/enterprise/documents', { timeout: SLOW_MS });
  await skipGuide(page);
  await staysOnDocuments(page, person, 'After choosing a password');
}

async function staysAfterReload(page, ctx, person) {
  await page.reload({ timeout: SLOW_MS });
  await staysOnDocuments(page, person, 'After a reload');
}

async function signOutAndIn(page, ctx, person) {
  const email = await menuEmail(page);
  check(email === person.email, `Signed in as ${email || 'no one'}, not ${person.email}`);
  await page.click('.epm-dropdown button:has-text("Log out")');
  await page.waitForURL('**/enterprise/login', { timeout: SLOW_MS });
  await page.waitForSelector('input[placeholder="name@company.com"]', { timeout: SLOW_MS });
  check((await page.evaluate(readSessionUser)) === null, 'A session is still saved after Log out');

  await page.fill('input[placeholder="name@company.com"]', person.email);
  await page.fill('input[type="password"]', person.password);
  const signedIn = expectResponse(page, 'grant_type=password', 'POST');
  await page.click('button[type="submit"]');
  const res = await signedIn;
  check(res, 'Signing in never reached the auth service');
  check(res.status() === 200, `Signing in with the chosen password answered ${res.status()}: ${errorOf(await bodyOf(res))}`);
  await page.waitForURL('**/enterprise/documents', { timeout: SLOW_MS });
  await staysOnDocuments(page, person, 'After signing in with the password');
}

async function freshLink(page, ctx, log = console) {
  const person = newPerson('two');
  ctx.second = person;
  await openOwnerPage(page, ctx);
  const first = await addPerson(page, person.email);
  check(first && first.invited === true && typeof first.inviteLink === 'string', `The second address should be invited with a link: ${brief(first)}`);
  hide(ctx, first.inviteLink);
  await page.waitForSelector(`.owner-success:has-text("send this link to ${person.email}")`, { timeout: SLOW_MS });

  const again = await addPerson(page, person.email);
  check(again && again.invited === false, `Adding the address again should not invite again: ${brief(again)}`);
  check(typeof again.inviteLink === 'string' && again.inviteLink.length > 0, `No new sign-in link for a member who has not chosen a password: ${brief(again)}`);
  hide(ctx, again.inviteLink);
  check(again.inviteLink !== first.inviteLink, 'The new sign-in link is the invite link again');
  check(again.mailed === false && again.mailReason === 'mail_off', `With 'No mail' the new link should not be mailed (mail_off): ${brief(again)}`);
  await page.waitForSelector(`.owner-success:has-text("This is a new sign-in link for ${person.email}, who has not chosen a password yet.")`, { timeout: SLOW_MS });
  person.link = await linkOnPage(page, again, { copy: false });
  const type = checkLink(person.link, ctx, null);
  log.log(`  freshLink: the new link is of type ${type}`);
}

async function addAgainNoLink(page, ctx) {
  const person = ctx.invited;
  const body = await addPerson(page, person.email);
  check(body && body.invited === false, `Adding a member again should not invite: ${brief(body)}`);
  check(!body.inviteLink, 'A member who has a password got a new sign-in link');
  if (body.inviteLink) hide(ctx, body.inviteLink);
  check(body.mailed === undefined, `Nothing should be mailed for a member who has a password: ${brief(body)}`);
  await page.waitForSelector(`.owner-success:has-text("${person.email} added to your organization.")`, { timeout: SLOW_MS });
  const boxes = await page.$$('.owner-invite-link');
  check(boxes.length === 0, 'The owner page shows a link for a member who has a password');
}

// The steps, in order, for the run in mainFlow.e2e.js. openPage(name) gives a
// page in a new browser context, watched for the failure report.
function inviteSteps({ staff, ctx, openPage, log = console }) {
  let first = null;
  let second = null;
  return [
    ['invitePerson', () => invitePerson(staff, ctx)],
    ['inviteLinkOpens', async () => {
      first = await openPage('invited');
      await openLink(first, ctx, ctx.invited, { type: 'invite' });
    }],
    ['inviteGate', () => gateSendsBack(first, ctx, ctx.invited)],
    ['invitePassword', () => choosePassword(first, ctx, ctx.invited)],
    ['inviteStays', () => staysAfterReload(first, ctx, ctx.invited)],
    ['inviteSignIn', () => signOutAndIn(first, ctx, ctx.invited)],
    ['freshLink', () => freshLink(staff, ctx, log)],
    ['freshLinkOpens', async () => {
      second = await openPage('second invited');
      await openLink(second, ctx, ctx.second);
      log.log(`  freshLinkOpens: returned to the sign-in page with type=${ctx.second.returnType}`);
      await choosePassword(second, ctx, ctx.second);
    }],
    ['noLinkWithPassword', () => addAgainNoLink(staff, ctx)],
  ];
}

module.exports = {
  SLOW_MS,
  GUIDE,
  TOAST,
  check,
  expectResponse,
  bodyOf,
  errorOf,
  brief,
  hide,
  newPerson,
  readSessionUser,
  openOwnerPage,
  addPerson,
  skipGuide,
  menuEmail,
  hidePrivate,
  checkLink,
  invitePerson,
  openLink,
  gateSendsBack,
  choosePassword,
  staysAfterReload,
  signOutAndIn,
  freshLink,
  addAgainNoLink,
  inviteSteps,
};
