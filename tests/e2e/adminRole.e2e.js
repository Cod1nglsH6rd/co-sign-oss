/**
 * End-to-end steps for the Admin role (2026-11-21), run by
 * tests/e2e/siteAddress.e2e.js after its own steps, on the same stack and
 * database as the first phase, at the site address.
 *
 * Who may do what, as the code says it:
 * - The owner is whoever is on the owner list (the admin made at /setup).
 *   Only an owner gets Owner Usage (the sidebar entry and /enterprise/owner),
 *   adds people (/api/admin/users), sees usage (/api/admin/usage) and changes
 *   the setup settings (/api/setup/settings): each checks the owner list, not
 *   the role (pages/api/admin/*.js, lib/setupAccess.js).
 * - An Admin is a member of the organisation with role 'admin'. Besides what
 *   a Member does (the organisation's documents, signing links), an Admin may
 *   rename the organisation (/api/account/update, the Settings page) and set
 *   whether recipients must be verified (POST /api/enterprise/org-settings).
 * - A Member is refused those two.
 *
 * The steps, in order:
 * - adminAdded: the owner adds a new address as Admin on Owner Usage; the
 *   answer and the Current Members list say admin, and the invite link is
 *   the auth service's at the site address.
 * - adminPassword: in a new browser context the link brings them to the
 *   password form; they choose a password and arrive on All Documents.
 * - adminSeesDocuments: All Documents lists the owner's document (one
 *   organisation), and the Admin makes a signing link for it.
 * - adminNoOwnerUsage: /api/admin/me answers owner: false and the sidebar
 *   has no Owner Usage.
 * - adminOwnerPageRefused: /enterprise/owner, opened directly, says it is
 *   for owner accounts and shows no Add User form.
 * - adminCannotAddPeople: adding a person, listing members and the usage
 *   figures are refused (403).
 * - adminSetupRefused: reading and changing the setup settings are refused
 *   (403, 'Only an owner can change settings.').
 * - adminRenamesOrg: on Settings the role reads Admin and the organisation's
 *   name can be saved (it is saved unchanged).
 * - adminOrgSettings: the recipient verification setting can be set (to the
 *   value it has).
 * - memberRefused: the Member of the first phase, signed in at the site
 *   address: Settings says only admins can rename it, and renaming and the
 *   recipient verification setting are refused (403).
 * - ownerStillOwns: the owner reads the setup settings and the member list
 *   (the Admin listed as admin, the Member as member), and adds the address
 *   the Admin was refused: it is a new invite, so the refused call made no
 *   account.
 *
 * As in inviteFlow.e2e.js, every link and password goes into ctx.hidden and
 * nothing prints one.
 */

const {
  SLOW_MS, GUIDE, check, expectResponse, bodyOf, brief, hide, newPerson,
  openOwnerPage, addPerson, checkLink, openLink, choosePassword, menuEmail,
} = require('./inviteFlow.e2e');

const RESTRICTED = 'This dashboard is restricted to owner accounts.';
const OWNER_LINK = '.ent-sidebar a[href="/enterprise/owner"]';
const SAVE_ORG = 'button:has-text("Save organization")';
const ORG_NAME = 'form:has(label:text-is("Organization name")) input[type="text"]';
const ONLY_ADMINS = 'text=Only admins can rename the organization.';

// Runs in the page: one call to the app as the signed-in user (the auth
// client's saved session), with only the status and the answer back.
async function callApi({ path, method = 'GET', body }) {
  let token = null;
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (/^sb-.*-auth-token$/.test(key)) {
      try {
        token = JSON.parse(window.localStorage.getItem(key)).access_token || null;
      } catch {
        token = null;
      }
    }
  }
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json, signedIn: Boolean(token) };
}

async function api(page, path, method = 'GET', body = undefined) {
  const answer = await page.evaluate(callApi, { path, method, body });
  check(answer && answer.signedIn, `${method} ${path}: the page has no signed-in session`);
  return answer;
}

// Expects the call refused with the status (and the error, when given).
async function refused(page, ctx, path, method, body, status, error) {
  const answer = await api(page, path, method, body);
  if (answer.body && answer.body.inviteLink) hide(ctx, answer.body.inviteLink);
  check(
    answer.status === status && (!error || (answer.body && answer.body.error === error)),
    `${method} ${path} should be refused with ${status}${error ? ` '${error}'` : ''}, answered ${answer.status}: ${brief(answer.body)}`
  );
}

async function allowed(page, ctx, path, method, body) {
  const answer = await api(page, path, method, body);
  if (answer.body && answer.body.inviteLink) hide(ctx, answer.body.inviteLink);
  check(answer.status === 200, `${method} ${path} should be allowed, answered ${answer.status}: ${brief(answer.body)}`);
  return answer.body;
}

async function roleInList(page, email) {
  const cell = `.owner-members tr:has(td:text-is("${email}")) td:nth-child(2)`;
  await page.waitForSelector(cell, { timeout: SLOW_MS });
  return (await page.textContent(cell)).trim();
}

async function adminAdded(staff, ctx) {
  const person = newPerson('admin');
  ctx.admin = person;
  await openOwnerPage(staff, ctx);
  const body = await addPerson(staff, person.email, 'admin');
  check(body && body.invited === true, `A new address should be invited: ${brief(body)}`);
  check(typeof body.inviteLink === 'string' && body.inviteLink.length > 0, `No invite link for the Admin with mail off: ${brief(body)}`);
  hide(ctx, body.inviteLink);
  check(body.user && body.user.role === 'admin', `The answer gives the role ${brief(body.user && body.user.role)}, not admin`);
  check(typeof body.orgId === 'string' && body.orgId, `No organisation in the answer: ${brief(body)}`);
  ctx.orgId = body.orgId;
  await staff.waitForSelector(`.owner-success:has-text("send this link to ${person.email}")`, { timeout: SLOW_MS });
  const shown = await staff.inputValue('.owner-invite-link input[aria-label="Invite link"]');
  check(shown === body.inviteLink, 'The link on the owner page is not the one the server made');
  person.link = shown;
  checkLink(person.link, ctx, 'invite');
  const role = await roleInList(staff, person.email);
  check(role === 'admin', `Current Members lists ${person.email} as ${role}, not admin`);
}

async function adminPassword(page, ctx) {
  await openLink(page, ctx, ctx.admin, { type: 'invite' });
  await choosePassword(page, ctx, ctx.admin);
}

async function adminSeesDocuments(page, ctx) {
  check(ctx.documentId, 'The first phase handed over no document');
  await page.goto(`${ctx.baseUrl}/enterprise/documents`, { timeout: SLOW_MS });
  await page.waitForSelector('text=e2e-form', { timeout: SLOW_MS });
  const made = await api(page, '/api/sessions/create', 'POST', { documentId: ctx.documentId, sendMethod: 'link', expiresInDays: 1 });
  if (made.body && made.body.shareUrl) hide(ctx, made.body.shareUrl);
  check(made.status === 201, `The Admin's signing link answered ${made.status}: ${brief(made.body && made.body.error)}`);
  check(String(made.body.shareUrl || '').startsWith(`${ctx.baseUrl}/en/fill/`), 'The Admin\'s signing link does not open at the site address');
}

async function adminNoOwnerUsage(page, ctx) {
  const me = expectResponse(page, '/api/admin/me', 'GET');
  await page.goto(`${ctx.baseUrl}/enterprise/documents`, { timeout: SLOW_MS });
  const res = await me;
  check(res, 'The page never asked /api/admin/me');
  const body = await bodyOf(res);
  check(res.status() === 200 && body && body.owner === false, `/api/admin/me should answer owner: false for an Admin, answered ${res.status()}: ${brief(body)}`);
  await page.waitForSelector('.ent-sidebar a[href="/enterprise/documents"]', { timeout: SLOW_MS });
  const links = await page.$$(OWNER_LINK);
  check(links.length === 0, 'The Admin\'s sidebar has Owner Usage');
}

async function adminOwnerPageRefused(page, ctx) {
  await page.goto(`${ctx.baseUrl}/enterprise/owner`, { timeout: SLOW_MS });
  await page.waitForSelector(`.owner-error:text-is("${RESTRICTED}")`, { timeout: SLOW_MS });
  const forms = await page.$$('.owner-invite-form');
  check(forms.length === 0, 'The owner page shows the Admin the Add User form');
}

async function adminCannotAddPeople(page, ctx) {
  ctx.refused = newPerson('refused');
  await refused(page, ctx, '/api/admin/users', 'POST', { email: ctx.refused.email, role: 'member' }, 403, 'Forbidden');
  await refused(page, ctx, '/api/admin/users', 'POST', { email: ctx.refused.email, role: 'admin' }, 403, 'Forbidden');
  await refused(page, ctx, '/api/admin/users', 'GET', undefined, 403, 'Forbidden');
  await refused(page, ctx, '/api/admin/usage', 'GET', undefined, 403, 'Forbidden');
}

async function adminSetupRefused(page, ctx) {
  const why = 'Only an owner can change settings.';
  await refused(page, ctx, '/api/setup/settings', 'GET', undefined, 403, why);
  await refused(page, ctx, '/api/setup/settings', 'POST', { NEXT_PUBLIC_APP_URL: 'http://refused.example.com' }, 403, why);
}

// Settings, once it shows the role and the organisation's name has loaded.
async function openSettings(page, ctx, role) {
  await page.goto(`${ctx.baseUrl}/en/settings`, { timeout: SLOW_MS });
  await page.waitForSelector(`span:text-is("${role}")`, { timeout: SLOW_MS });
  await page.waitForSelector(ORG_NAME, { timeout: SLOW_MS });
  const deadline = Date.now() + SLOW_MS;
  while (!(await page.inputValue(ORG_NAME)).trim()) {
    check(Date.now() < deadline, 'The organisation\'s name never loaded on Settings');
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
  }
}

async function adminRenamesOrg(page, ctx) {
  await openSettings(page, ctx, 'Admin');
  await page.waitForSelector(SAVE_ORG, { timeout: SLOW_MS });
  check((await page.$$(ONLY_ADMINS)).length === 0, 'Settings tells the Admin that only admins can rename the organisation');
  check(await page.isEnabled(ORG_NAME), 'The organisation\'s name cannot be edited by the Admin');
  const name = await page.inputValue(ORG_NAME);
  ctx.orgName = name.trim();
  const saved = expectResponse(page, '/api/account/update', 'POST');
  await page.click(SAVE_ORG);
  const res = await saved;
  check(res, 'Saving the organisation never reached /api/account/update');
  const body = await bodyOf(res);
  check(res.status() === 200 && body && body.name === ctx.orgName, `Saving the organisation's name answered ${res.status()}: ${brief(body)}`);
}

async function adminOrgSettings(page, ctx) {
  const now = await allowed(page, ctx, '/api/enterprise/org-settings', 'GET');
  check(typeof now.requireRecipientVerification === 'boolean', `No recipient verification setting: ${brief(now)}`);
  ctx.requireRecipientVerification = now.requireRecipientVerification;
  const set = await allowed(page, ctx, '/api/enterprise/org-settings', 'POST', { requireRecipientVerification: now.requireRecipientVerification });
  check(set.success === true, `Setting recipient verification did not succeed: ${brief(set)}`);
}

async function signInAs(page, ctx, email, password) {
  await page.goto(`${ctx.baseUrl}/enterprise/login`, { timeout: SLOW_MS });
  await page.fill('input[placeholder="name@company.com"]', email);
  await page.fill('input[type="password"]', password);
  const signedIn = expectResponse(page, 'grant_type=password', 'POST');
  await page.click('button[type="submit"]');
  const res = await signedIn;
  check(res && res.status() === 200, `Signing in at the site address answered ${res ? res.status() : 'nothing'}`);
  await page.waitForURL('**/enterprise/documents', { timeout: SLOW_MS });
  await page.click(`${GUIDE} button:text-is("Skip")`, { timeout: SLOW_MS });
  await page.waitForSelector(GUIDE, { state: 'detached', timeout: SLOW_MS });
}

async function memberRefused(page, ctx) {
  const member = ctx.member;
  check(member && member.email && member.password, 'The first phase handed over no Member');
  await signInAs(page, ctx, member.email, member.password);
  const email = await menuEmail(page);
  check(email === member.email, `Signed in as ${email || 'no one'}, not the Member`);
  await page.click('.epm-avatar');
  await openSettings(page, ctx, 'Member');
  await page.waitForSelector(ONLY_ADMINS, { timeout: SLOW_MS });
  check((await page.$$(SAVE_ORG)).length === 0, 'Settings shows the Member Save organization');
  check(!(await page.isEnabled(ORG_NAME)), 'The organisation\'s name can be edited by the Member');
  await refused(page, ctx, '/api/account/update', 'POST', { orgId: ctx.orgId, name: `${ctx.orgName || 'Organisation'} (renamed)` }, 403, 'Only admins can update organization details');
  await refused(page, ctx, '/api/enterprise/org-settings', 'POST', { requireRecipientVerification: !ctx.requireRecipientVerification }, 403, 'forbidden');
  await refused(page, ctx, '/api/admin/users', 'GET', undefined, 403, 'Forbidden');
}

async function ownerStillOwns(staff, ctx) {
  const settings = await allowed(staff, ctx, '/api/setup/settings', 'GET');
  check(settings && settings.settings && typeof settings.settings === 'object', 'The owner got no setup settings');
  const list = await allowed(staff, ctx, '/api/admin/users', 'GET');
  const roleOf = (email) => ((list.members || []).find((m) => m.email === email) || {}).role;
  check(roleOf(ctx.admin.email) === 'admin', `The member list gives the Admin the role ${brief(roleOf(ctx.admin.email))}`);
  check(roleOf(ctx.member.email) === 'member', `The member list gives the Member the role ${brief(roleOf(ctx.member.email))}`);
  await openOwnerPage(staff, ctx);
  const body = await addPerson(staff, ctx.refused.email);
  if (body && body.inviteLink) hide(ctx, body.inviteLink);
  check(body && body.invited === true, `The address the Admin was refused should be new to the owner: ${brief(body)}`);
}

// The steps, in order, for siteAddress.e2e.js. openPage(name) gives a page in
// a new browser context, watched for the failure report.
function adminSteps({ staff, ctx, openPage }) {
  let admin = null;
  let member = null;
  return [
    ['adminAdded', () => adminAdded(staff, ctx)],
    ['adminPassword', async () => {
      admin = await openPage('admin');
      await adminPassword(admin, ctx);
    }],
    ['adminSeesDocuments', () => adminSeesDocuments(admin, ctx)],
    ['adminNoOwnerUsage', () => adminNoOwnerUsage(admin, ctx)],
    ['adminOwnerPageRefused', () => adminOwnerPageRefused(admin, ctx)],
    ['adminCannotAddPeople', () => adminCannotAddPeople(admin, ctx)],
    ['adminSetupRefused', () => adminSetupRefused(admin, ctx)],
    ['adminRenamesOrg', () => adminRenamesOrg(admin, ctx)],
    ['adminOrgSettings', () => adminOrgSettings(admin, ctx)],
    ['memberRefused', async () => {
      member = await openPage('member');
      await memberRefused(member, ctx);
    }],
    ['ownerStillOwns', () => ownerStillOwns(staff, ctx)],
  ];
}

module.exports = {
  RESTRICTED,
  callApi,
  adminAdded,
  adminPassword,
  adminSeesDocuments,
  adminNoOwnerUsage,
  adminOwnerPageRefused,
  adminCannotAddPeople,
  adminSetupRefused,
  adminRenamesOrg,
  adminOrgSettings,
  memberRefused,
  ownerStillOwns,
  signInAs,
  adminSteps,
};
