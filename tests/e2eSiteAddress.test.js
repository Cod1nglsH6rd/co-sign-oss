// 2026-11-21: the second phase of the end-to-end run
// (tests/e2e/siteAddress.e2e.js) and the Admin role's steps
// (tests/e2e/adminRole.e2e.js), driven offline with a fake page; the handoff
// between the two phases; and that no link, token or password is printed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fakePage, fakeFetch } = require('./e2e/fakePage');

const site = () => require('./e2e/siteAddress.e2e.js');
const admin = () => require('./e2e/adminRole.e2e.js');
const helpers = () => require('./e2e/helpers');

const SITE = 'http://cosign.test:3000';
const LOGIN = `${SITE}/enterprise/login`;
const LINK_BOX = '.owner-invite-link input[aria-label="Invite link"]';
const linkAt = (origin, secret = 'tok-secret') => `${origin}/auth/v1/verify?token=${secret}&type=invite&redirect_to=${encodeURIComponent(`${origin}/enterprise/login`)}`;
const INVITE = linkAt(SITE);

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error.message;
  }
  throw new Error('expected a failure');
}

describe('the site address', () => {
  it('takes an address other than localhost, as its origin', () => {
    expect(site().siteUrl({ COSIGN_SITE_URL: ' http://cosign.test:3000/ ' })).toBe(SITE);
    expect(site().siteUrl({ COSIGN_SITE_URL: 'http://10.1.0.4:3000' })).toBe('http://10.1.0.4:3000');
  });

  it('refuses no address, a broken one, or this machine\'s localhost', () => {
    for (const value of ['', 'not an address', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'http://app.localhost:3000']) {
      expect(() => site().siteUrl({ COSIGN_SITE_URL: value })).toThrow();
    }
  });
});

describe('localhostIsNotTheApp', () => {
  const refused = () => Promise.reject(new Error('connect ECONNREFUSED'));

  it('passes when neither fetch nor the browser reach http://localhost:3000', async () => {
    const page = fakePage();
    page.goto = () => refused();
    await expect(site().localhostIsNotTheApp(page, { baseUrl: SITE }, { fetchFn: refused })).resolves.toBeUndefined();
  });

  it('fails when localhost answers here, to fetch or to the browser', async () => {
    const page = fakePage();
    page.goto = () => refused();
    const byFetch = await failure(site().localhostIsNotTheApp(page, { baseUrl: SITE }, { fetchFn: fakeFetch([['/api/health', { status: 200 }]]) }));
    expect(byFetch).toMatch(/http:\/\/localhost:3000 answered 200: a link built from localhost could have worked here/);
    const browser = fakePage({ gotoResponse: () => ({ status: () => 200 }) });
    expect(await failure(site().localhostIsNotTheApp(browser, { baseUrl: SITE }, { fetchFn: refused }))).toMatch(/opened http:\/\/localhost:3000/);
  });
});

describe('siteInvite', () => {
  const answer = (link) => ({ '/api/admin/users': { status: 200, body: { invited: true, inviteLink: link, mailed: false, mailReason: 'mail_off', orgId: 'org-1' } } });
  const pageFor = (link, extra = {}) => fakePage({
    responses: answer(link),
    inputValues: { [LINK_BOX]: link },
    evaluate: (name) => (name === 'watchCopy' ? { secure: false, clipboard: false } : name === 'readCopied' ? link : null),
    ...extra,
  });
  const quiet = { log: () => {} };

  it('adds a Member, checks the link is the auth service\'s at the site address, and copies it', async () => {
    const ctx = { baseUrl: SITE, hidden: [] };
    const page = pageFor(INVITE);
    await site().siteInvite(page, ctx, quiet);
    expect(ctx.siteInvited.link).toBe(INVITE);
    expect(ctx.hidden).toContain(INVITE);
    expect(page.actions.some((a) => a[0] === 'click' && /Copy/.test(a[1]))).toBe(true);
  });

  it('fails on a link built from localhost, without printing its token', async () => {
    const local = linkAt('http://localhost:3000');
    const message = await failure(site().siteInvite(pageFor(local), { baseUrl: SITE, hidden: [] }, quiet));
    expect(message).toMatch(/localhost, not the site address/);
    expect(message).not.toContain('tok-secret');
  });

  it('fails on a link at another host or port of the site', async () => {
    const message = await failure(site().siteInvite(pageFor(linkAt('http://cosign.test:4000')), { baseUrl: SITE, hidden: [] }, quiet));
    expect(message).toMatch(/host and port are cosign\.test:4000, not the site address's cosign\.test:3000/);
  });

  it('fails with the page\'s words when Copy fails, or when it copies something else', async () => {
    const broken = pageFor(INVITE, {
      elements: { '.owner-failure': 1 },
      texts: { '.owner-failure': 'Could not copy the link: select it and copy it by hand.' },
    });
    expect(await failure(site().siteInvite(broken, { baseUrl: SITE, hidden: [] }, quiet))).toBe('Copy failed at the site address: Could not copy the link: select it and copy it by hand.');
    const other = pageFor(INVITE, { evaluate: (name) => (name === 'watchCopy' ? { secure: false, clipboard: false } : 'something else') });
    expect(await failure(site().siteInvite(other, { baseUrl: SITE, hidden: [] }, quiet))).toBe('Copy did not copy the invite link');
  });
});

describe('the handoff between the two phases', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-handoff-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is written once, readable by this user only, and deleted when read', () => {
    const file = path.join(dir, 'handoff.json');
    helpers().writeHandoff(file, { owner: { email: 'o@example.com', password: 'pw' } });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(() => helpers().writeHandoff(file, {})).toThrow(/EEXIST/);
    expect(helpers().readHandoff(file)).toEqual({ owner: { email: 'o@example.com', password: 'pw' } });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('fails plainly when there is none', () => {
    expect(() => helpers().readHandoff('')).toThrow(/COSIGN_E2E_HANDOFF/);
    expect(() => helpers().readHandoff(path.join(dir, 'none.json'))).toThrow(/left no handoff file \(ENOENT\)/);
  });

  it('carries the owner, the Member of the first phase and the document', () => {
    const { handoffOf } = require('./e2e/mainFlow.e2e.js');
    expect(handoffOf({
      adminEmail: 'owner@example.com', adminPassword: 'p1', invited: { email: 'm@example.com', password: 'p2', link: 'x' }, documentId: 'd1', setupCode: 'c',
    })).toEqual({ owner: { email: 'owner@example.com', password: 'p1' }, member: { email: 'm@example.com', password: 'p2' }, documentId: 'd1' });
  });
});

describe('the Admin role', () => {
  const callsTo = (page) => page.actions.filter((a) => a[0] === 'evaluate' && a[1] === 'callApi').map((a) => `${a[2].method} ${a[2].path}`);

  it('expects the Admin refused adding people, the member list and the usage figures (403)', async () => {
    const page = fakePage({ evaluate: () => ({ status: 403, body: { error: 'Forbidden' }, signedIn: true }) });
    const ctx = { baseUrl: SITE, hidden: [] };
    await admin().adminCannotAddPeople(page, ctx);
    expect(callsTo(page)).toEqual(['POST /api/admin/users', 'POST /api/admin/users', 'GET /api/admin/users', 'GET /api/admin/usage']);
  });

  it('fails when an Admin may add a person, and hides the link that came back', async () => {
    const page = fakePage({ evaluate: () => ({ status: 200, body: { invited: true, inviteLink: INVITE }, signedIn: true }) });
    const ctx = { baseUrl: SITE, hidden: [] };
    const message = await failure(admin().adminCannotAddPeople(page, ctx));
    expect(message).toMatch(/POST \/api\/admin\/users should be refused with 403 'Forbidden', answered 200/);
    expect(message).not.toContain('tok-secret');
    expect(ctx.hidden).toContain(INVITE);
  });

  it('fails when the page has no signed-in session, so a refusal proves nothing', async () => {
    const page = fakePage({ evaluate: () => ({ status: 401, body: { error: 'Missing authorization header' }, signedIn: false }) });
    expect(await failure(admin().adminSetupRefused(page, { baseUrl: SITE, hidden: [] }))).toMatch(/no signed-in session/);
  });

  it('expects the setup settings refused with the owner-only answer', async () => {
    const page = fakePage({ evaluate: () => ({ status: 403, body: { error: 'Only an owner can change settings.' }, signedIn: true }) });
    await admin().adminSetupRefused(page, { baseUrl: SITE, hidden: [] });
    expect(callsTo(page)).toEqual(['GET /api/setup/settings', 'POST /api/setup/settings']);
  });

  it('expects /api/admin/me to say owner: false and no Owner Usage in the sidebar', async () => {
    const ok = fakePage({ responses: { '/api/admin/me': { status: 200, body: { owner: false } } } });
    await admin().adminNoOwnerUsage(ok, { baseUrl: SITE });
    const owner = fakePage({ responses: { '/api/admin/me': { status: 200, body: { owner: true } } } });
    expect(await failure(admin().adminNoOwnerUsage(owner, { baseUrl: SITE }))).toMatch(/owner: false for an Admin/);
    const shown = fakePage({ responses: { '/api/admin/me': { status: 200, body: { owner: false } } }, elements: { '.ent-sidebar a[href="/enterprise/owner"]': 1 } });
    expect(await failure(admin().adminNoOwnerUsage(shown, { baseUrl: SITE }))).toBe('The Admin\'s sidebar has Owner Usage');
  });

  it('expects the owner page to refuse the Admin, with no Add User form', async () => {
    const page = fakePage();
    await admin().adminOwnerPageRefused(page, { baseUrl: SITE });
    expect(page.actions).toContainEqual(['waitForSelector', `.owner-error:text-is("${admin().RESTRICTED}")`, { timeout: 120000 }]);
    const form = fakePage({ elements: { '.owner-invite-form': 1 } });
    expect(await failure(admin().adminOwnerPageRefused(form, { baseUrl: SITE }))).toMatch(/Add User form/);
  });

  it('refuses the Member renaming the organisation and the recipient setting, and fails if either is allowed', async () => {
    const ORG = 'form:has(label:text-is("Organization name")) input[type="text"]';
    const member = { email: 'm@example.com', password: 'pw' };
    const pageWith = (status) => fakePage({
      responses: { 'grant_type=password': { status: 200 } },
      inputValues: { [ORG]: 'Org' },
      enabled: { [ORG]: false },
      texts: { '.epm-dropdown .epm-email': member.email },
      evaluate: (name, arg) => ({
        status,
        body: { error: arg.path === '/api/account/update' ? 'Only admins can update organization details' : arg.path === '/api/admin/users' ? 'Forbidden' : 'forbidden' },
        signedIn: true,
      }),
    });
    const ctx = () => ({ baseUrl: SITE, hidden: [], member, orgId: 'org-1', orgName: 'Org', requireRecipientVerification: false });
    const page = pageWith(403);
    await admin().memberRefused(page, ctx());
    expect(callsTo(page)).toEqual(['POST /api/account/update', 'POST /api/enterprise/org-settings', 'GET /api/admin/users']);
    expect(await failure(admin().memberRefused(pageWith(200), ctx()))).toMatch(/POST \/api\/account\/update should be refused with 403/);
  });

  it('lists the Admin steps in order, each new person in a new browser context', () => {
    const opened = [];
    const steps = admin().adminSteps({ staff: fakePage(), ctx: {}, openPage: async (name) => { opened.push(name); return fakePage(); } });
    expect(steps.map(([name]) => name)).toEqual([
      'adminAdded', 'adminPassword', 'adminSeesDocuments', 'adminNoOwnerUsage', 'adminOwnerPageRefused',
      'adminCannotAddPeople', 'adminSetupRefused', 'adminRenamesOrg', 'adminOrgSettings', 'memberRefused', 'ownerStillOwns',
    ]);
  });
});

describe('the second phase stays out of npm test, and runs the Admin steps', () => {
  it('is named *.e2e.js, and lists its steps with the Admin steps and the storage step last', () => {
    expect('tests/e2e/siteAddress.e2e.js').not.toMatch(/\.test\.js$/);
    const text = fs.readFileSync(path.join(__dirname, 'e2e', 'siteAddress.e2e.js'), 'utf8');
    const order = ['localhostIsNotTheApp', 'siteOwnerSignIn', 'siteInvite', 'siteLinkOpens', 'sitePassword', 'siteStays',
      'siteSignIn', 'siteSigningLink', '...adminSteps(', "['noStorage'"].map((s) => text.indexOf(s.startsWith('...') || s.startsWith('[') ? s : `['${s}'`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
