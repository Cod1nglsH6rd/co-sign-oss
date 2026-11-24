// 2026-11-21: the steps of adding a person at home in
// tests/e2e/inviteFlow.e2e.js, which tests/e2e/mainFlow.e2e.js runs after its
// own steps, driven offline with a fake page. Also that no link, token or
// password reaches what the run prints.

const { fakePage } = require('./e2e/fakePage');

function load() {
  return require('./e2e/inviteFlow.e2e.js');
}

const BASE = 'http://cosign.test:4000';
const LOGIN = `${BASE}/enterprise/login`;
const ONE = 'invited-one-1a2b3c4d@example.com';
const TWO = 'invited-two-5e6f7a8b@example.com';
const LINK_BOX = '.owner-invite-link input[aria-label="Invite link"]';
const linkOf = (type, secret) => `${BASE}/auth/v1/verify?token=${secret}&type=${type}&redirect_to=${encodeURIComponent(LOGIN)}`;
const INVITE = linkOf('invite', 'pkce-free-one');
const FRESH = linkOf('magiclink', 'pkce-free-two');
const at = (actions, test) => actions.findIndex(test);

const baseCtx = () => ({ baseUrl: BASE, hidden: [] });

// What page.goto(link) resolves to: the page, redirected from the auth service.
function landedAt(location, status = 200) {
  return {
    status: () => status,
    request: () => ({
      redirectedFrom: () => (location ? { response: async () => ({ headers: () => ({ location }) }) } : null),
    }),
  };
}
const back = (type) => `${LOGIN}#access_token=at-secret&expires_in=3600&refresh_token=rt-secret&token_type=bearer&type=${type}`;

describe('hidePrivate and checkLink', () => {
  it('prints an address without its query or fragment, keeping only type and error fields', () => {
    const { hidePrivate } = load();
    expect(hidePrivate(back('invite'))).toBe(`${LOGIN} (type=invite)`);
    expect(hidePrivate(INVITE)).toBe(`${BASE}/auth/v1/verify (type=invite)`);
    expect(hidePrivate(`${BASE}/en/fill/tok_1`)).toBe(`${BASE}/en/fill/[token]`);
    expect(hidePrivate('not an address')).toBe('[an address]');
  });

  it('takes an invite link of the auth service on the site that returns to the sign-in page', () => {
    expect(load().checkLink(INVITE, baseCtx(), 'invite')).toBe('invite');
  });

  it('refuses a link elsewhere, of another type, or returning elsewhere, and never prints its token', () => {
    const { checkLink } = load();
    const errors = [
      () => checkLink(INVITE.replace(BASE, 'http://auth:9999'), baseCtx(), 'invite'),
      () => checkLink(FRESH, baseCtx(), 'invite'),
      () => checkLink(INVITE.replace(encodeURIComponent(LOGIN), encodeURIComponent(`${BASE}/`)), baseCtx(), 'invite'),
    ].map((fn) => {
      try {
        fn();
        return null;
      } catch (error) {
        return error.message;
      }
    });
    expect(errors[0]).toMatch(/does not open the auth service/);
    expect(errors[1]).toMatch(/type magiclink, not invite/);
    expect(errors[2]).toMatch(/returns to/);
    for (const message of errors) expect(message).not.toContain('pkce-free');
  });
});

describe('invitePerson', () => {
  const added = { orgId: 'o1', invited: true, mailed: false, mailReason: 'mail_off', inviteLink: INVITE, user: { email: ONE } };
  function ownerPage({ body = added, shown = INVITE, copied = INVITE, status = 200 } = {}) {
    return fakePage({
      responses: { '/api/admin/users': { status, body } },
      inputValues: { [LINK_BOX]: shown },
      evaluate: (name) => (name === 'readClipboard' ? copied : null),
    });
  }
  const withEmail = (ctx) => {
    ctx.hidden = [];
    return ctx;
  };

  it('opens Owner Usage, adds a new address as a Member, and reads and copies the link it shows', async () => {
    const page = ownerPage();
    const ctx = withEmail(baseCtx());
    await load().invitePerson(page, ctx);
    const { actions } = page;
    expect(actions[0]).toEqual(['goto', `${BASE}/enterprise/owner`, expect.any(Object)]);
    const fill = at(actions, (a) => a[0] === 'fill' && a[1] === '.owner-invite-form input[type="email"]');
    const role = at(actions, (a) => a[0] === 'selectOption' && a[2] === 'member');
    const wait = at(actions, (a) => a[0] === 'waitForResponse' && a[1] === '/api/admin/users' && a[2] === 'POST');
    const add = at(actions, (a) => a[0] === 'click' && a[1] === '.owner-invite-form button[type="submit"]');
    const line = at(actions, (a) => a[0] === 'waitForSelector' && /mail is off\): send this link to invited-one-/.test(a[1]));
    const read = at(actions, (a) => a[0] === 'inputValue' && a[1] === LINK_BOX);
    const copy = at(actions, (a) => a[0] === 'click' && a[1] === '.owner-invite-link button:text-is("Copy")');
    const clip = at(actions, (a) => a[0] === 'evaluate' && a[1] === 'readClipboard');
    expect(actions[fill][2]).toBe(ctx.invited.email);
    expect(ctx.invited.email).toMatch(/^invited-one-[0-9a-f]{8}@example\.com$/);
    expect(Math.min(fill, role)).toBeGreaterThan(-1);
    expect(wait).toBeLessThan(add);
    expect(add).toBeGreaterThan(Math.max(fill, role));
    expect(line).toBeGreaterThan(add);
    expect(read).toBeGreaterThan(line);
    expect(copy).toBeGreaterThan(read);
    expect(clip).toBeGreaterThan(copy);
    expect(ctx.invited.link).toBe(INVITE);
    expect(ctx.hidden).toContain(INVITE);
  });

  it('fails when the address is not invited, or no link comes back, without printing a link', async () => {
    await expect(load().invitePerson(ownerPage({ body: { ...added, invited: false } }), baseCtx())).rejects.toThrow(/should be invited/);
    const noLink = load().invitePerson(ownerPage({ body: { ...added, inviteLink: null } }), baseCtx());
    await expect(noLink).rejects.toThrow(/No invite link/);
    const refused = load().invitePerson(ownerPage({ status: 500, body: { error: 'Failed to invite user' } }), baseCtx());
    await expect(refused).rejects.toThrow(/answered 500: .*Failed to invite user/);
  });

  it('fails when the invite was mailed or the page shows or copies another link', async () => {
    const mailed = { ...added, mailed: true, mailReason: undefined };
    await expect(load().invitePerson(ownerPage({ body: mailed }), baseCtx())).rejects.toThrow(/should not be mailed/);
    await expect(load().invitePerson(ownerPage({ shown: FRESH }), baseCtx())).rejects.toThrow(/not the one the server made/);
    await expect(load().invitePerson(ownerPage({ copied: 'other' }), baseCtx())).rejects.toThrow(/copied link is not/);
  });

  it('hides the link in a failure about the answer', async () => {
    const body = { ...added, invited: false };
    const error = await load().invitePerson(ownerPage({ body }), baseCtx()).catch((e) => e);
    expect(error.message).toContain('"inviteLink":"[hidden]"');
    expect(error.message).not.toContain('pkce-free');
  });
});

describe('openLink', () => {
  const person = () => ({ email: ONE, link: INVITE });
  function personPage({ location = back('invite'), shown = ONE, user = { id: 'u1', email: ONE, pending: true } } = {}) {
    return fakePage({
      gotoResponse: (url) => (url === INVITE ? landedAt(location) : undefined),
      inputValues: { '#invite-email': shown },
      evaluate: (name) => (name === 'readSessionUser' ? user : null),
      url: LOGIN,
    });
  }

  it('opens the link, sees the auth service return to the sign-in page with type=invite, and the form for that address', async () => {
    const page = personPage();
    const p = person();
    await load().openLink(page, baseCtx(), p, { type: 'invite' });
    expect(page.actions[0]).toEqual(['goto', INVITE, expect.any(Object)]);
    const form = at(page.actions, (a) => a[0] === 'waitForSelector' && a[1] === 'h1:text-is("Choose a password")');
    const email = at(page.actions, (a) => a[0] === 'inputValue' && a[1] === '#invite-email');
    expect(form).toBeGreaterThan(0);
    expect(email).toBeGreaterThan(form);
    expect(p.returnType).toBe('invite');
    expect(p.userId).toBe('u1');
  });

  it('fails with the auth service\'s error code when it refuses the link, printing no token', async () => {
    const location = `${LOGIN}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`;
    const error = await load().openLink(personPage({ location }), baseCtx(), person()).catch((e) => e);
    expect(error.message).toMatch(/refused the link: otp_expired \(Email link is invalid or has expired\)/);
    expect(error.message).not.toContain('pkce-free');
  });

  it('fails when the link was not redirected, returned elsewhere, or with another type', async () => {
    await expect(load().openLink(personPage({ location: null }), baseCtx(), person())).rejects.toThrow(/did not send the browser on/);
    const elsewhere = back('invite').replace('/enterprise/login', '/');
    const error = await load().openLink(personPage({ location: elsewhere }), baseCtx(), person()).catch((e) => e);
    expect(error.message).toMatch(/returned to http:\/\/cosign.test:4000\/ \(type=invite\), not/);
    expect(error.message).not.toMatch(/at-secret|rt-secret/);
    await expect(load().openLink(personPage({ location: back('signup') }), baseCtx(), person(), { type: 'invite' }))
      .rejects.toThrow(/type=signup, not type=invite/);
  });

  it('fails when the form shows another address, or the session lacks the mark', async () => {
    await expect(load().openLink(personPage({ shown: TWO }), baseCtx(), person())).rejects.toThrow(/form shows invited-two/);
    const user = { id: 'u1', email: ONE, pending: false };
    await expect(load().openLink(personPage({ user }), baseCtx(), person())).rejects.toThrow(/password_pending mark/);
  });
});

describe('gateSendsBack', () => {
  it('opens All Documents directly and is sent back to the form for the same address', async () => {
    const page = fakePage({ inputValues: { '#invite-email': ONE } });
    await load().gateSendsBack(page, baseCtx(), { email: ONE });
    expect(page.actions[0]).toEqual(['goto', `${BASE}/enterprise/documents`, expect.any(Object)]);
    expect(page.actions[1]).toEqual(['waitForURL', '**/enterprise/login', expect.any(Object)]);
    expect(page.actions[2][1]).toBe('h1:text-is("Choose a password")');
  });
});

describe('choosePassword, staysAfterReload, signOutAndIn', () => {
  const signedIn = { id: 'u1', email: ONE, pending: false };
  function docsPage({ responses = {}, user = signedIn, menu = ONE, url = `${BASE}/enterprise/documents`, forms = 0 } = {}) {
    return fakePage({
      responses: {
        '/auth/v1/user': { status: 200, body: { id: 'u1' } },
        '/api/account/password-set': { status: 200, body: { ok: true } },
        'grant_type=refresh_token': { status: 200, body: {} },
        'grant_type=password': { status: 200, body: {} },
        ...responses,
      },
      texts: { '.epm-dropdown .epm-email': menu },
      evaluate: (name) => (name === 'readSessionUser' ? user : null),
      elements: { '#invite-password': forms },
      url,
    });
  }

  it('types the password twice, waits for the auth service, the clear and the refresh, then arrives with no mark', async () => {
    const page = docsPage();
    const ctx = baseCtx();
    const person = { email: ONE };
    await load().choosePassword(page, ctx, person);
    const { actions } = page;
    expect(person.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(ctx.hidden).toContain(person.password);
    const typed = actions.filter((a) => a[0] === 'fill').map((a) => [a[1], a[2] === person.password]);
    expect(typed).toEqual([['#invite-password', true], ['#invite-confirm', true]]);
    const save = at(actions, (a) => a[0] === 'click' && a[1] === 'button[type="submit"]:text-is("Set password")');
    for (const part of ['/auth/v1/user', '/api/account/password-set', 'grant_type=refresh_token']) {
      expect(at(actions, (a) => a[0] === 'waitForResponse' && a[1] === part)).toBeLessThan(save);
    }
    const arrive = at(actions, (a) => a[0] === 'waitForURL' && a[1] === '**/enterprise/documents');
    const skip = at(actions, (a) => a[0] === 'click' && /Getting started guide/.test(a[1]));
    const settle = at(actions, (a) => a[0] === 'waitForTimeout');
    expect(arrive).toBeGreaterThan(save);
    expect(skip).toBeGreaterThan(arrive);
    expect(settle).toBeGreaterThan(skip);
    expect(actions[settle][1]).toBeGreaterThan(0);
  });

  it('fails with what the auth service said when it refuses the password, and never prints the password', async () => {
    const responses = { '/auth/v1/user': { status: 422, body: { code: 422, error_code: 'weak_password', msg: 'Password is too weak' } } };
    const ctx = baseCtx();
    const person = { email: ONE };
    const error = await load().choosePassword(docsPage({ responses }), ctx, person).catch((e) => e);
    expect(error.message).toMatch(/refused the new password: 422 error_code: weak_password/);
    expect(error.message).not.toContain(person.password);
  });

  it('fails when the mark is not cleared or the session still carries it', async () => {
    const responses = { '/api/account/password-set': { status: 500, body: { error: 'Failed to update account' } } };
    await expect(load().choosePassword(docsPage({ responses }), baseCtx(), { email: ONE })).rejects.toThrow(/Clearing the mark answered 500/);
    const marked = { ...signedIn, pending: true };
    await expect(load().choosePassword(docsPage({ user: marked }), baseCtx(), { email: ONE })).rejects.toThrow(/still carries the password_pending mark/);
  });

  it('fails when a reload goes back to the form', async () => {
    await expect(load().staysAfterReload(docsPage({ url: LOGIN }), baseCtx(), { email: ONE })).rejects.toThrow(/After a reload: the page went on to/);
    await expect(load().staysAfterReload(docsPage({ forms: 1 }), baseCtx(), { email: ONE })).rejects.toThrow(/password form is shown/);
    await expect(load().staysAfterReload(docsPage({ menu: TWO }), baseCtx(), { email: ONE })).rejects.toThrow(/signed in as invited-two/);
  });

  it('logs out from the profile menu, then signs in with the address and the password', async () => {
    let session = signedIn;
    const page = docsPage();
    page.evaluate = (fn) => {
      page.actions.push(['evaluate', fn.name]);
      return Promise.resolve(fn.name === 'readSessionUser' ? session : null);
    };
    const click = page.click;
    page.click = (selector, ...rest) => {
      if (/Log out/.test(selector)) session = null;
      if (selector === 'button[type="submit"]') session = signedIn;
      return click(selector, ...rest);
    };
    const person = { email: ONE, password: 'chosen-at-run-time' };
    await load().signOutAndIn(page, baseCtx(), person);
    const { actions } = page;
    const out = at(actions, (a) => a[0] === 'click' && /Log out/.test(a[1]));
    const login = at(actions, (a) => a[0] === 'waitForURL' && a[1] === '**/enterprise/login');
    const email = at(actions, (a) => a[0] === 'fill' && a[2] === ONE);
    const pass = at(actions, (a) => a[0] === 'fill' && a[2] === person.password);
    const wait = at(actions, (a) => a[0] === 'waitForResponse' && a[1] === 'grant_type=password');
    const submit = at(actions, (a) => a[0] === 'click' && a[1] === 'button[type="submit"]');
    const docs = at(actions, (a) => a[0] === 'waitForURL' && a[1] === '**/enterprise/documents');
    expect(out).toBeGreaterThan(-1);
    expect(login).toBeGreaterThan(out);
    expect(Math.min(email, pass)).toBeGreaterThan(login);
    expect(wait).toBeLessThan(submit);
    expect(docs).toBeGreaterThan(submit);
  });

  // 2026-11-21, from the end-to-end run: the 'Welcome back!' toast covered the
  // avatar and stayed while the pointer was on it.
  it('waits for any toast to go before opening the profile menu', async () => {
    const page = docsPage();
    await load().staysAfterReload(page, baseCtx(), { email: ONE });
    const toast = at(page.actions, (a) => a[0] === 'waitForSelector' && a[1] === '[data-rht-toaster] [role="status"]' && a[2].state === 'detached');
    const avatar = at(page.actions, (a) => a[0] === 'click' && a[1] === '.epm-avatar');
    expect(toast).toBeGreaterThan(-1);
    expect(toast).toBeLessThan(avatar);
  });

  it('fails when the password sign-in is refused', async () => {
    const page = docsPage({ responses: { 'grant_type=password': { status: 400, body: { error_code: 'invalid_credentials' } } } });
    let session = signedIn;
    page.evaluate = (fn) => Promise.resolve(fn.name === 'readSessionUser' ? session : null);
    const click = page.click;
    page.click = (selector, ...rest) => {
      if (/Log out/.test(selector)) session = null;
      return click(selector, ...rest);
    };
    await expect(load().signOutAndIn(page, baseCtx(), { email: ONE, password: 'chosen-at-run-time' }))
      .rejects.toThrow(/chosen password answered 400: error_code: invalid_credentials/);
  });
});

describe('freshLink and addAgainNoLink', () => {
  const invite = { invited: true, mailed: false, mailReason: 'mail_off', inviteLink: INVITE };
  const fresh = { invited: false, mailed: false, mailReason: 'mail_off', inviteLink: FRESH };
  const plain = { invited: false, user: { email: ONE } };

  it('adds a second address, then again: a new link and the new sign-in link line', async () => {
    const page = fakePage({ responses: { '/api/admin/users': [{ status: 200, body: invite }, { status: 200, body: fresh }] }, inputValues: { [LINK_BOX]: FRESH } });
    const ctx = baseCtx();
    const lines = [];
    await load().freshLink(page, ctx, { log: (l) => lines.push(l) });
    const adds = page.actions.filter((a) => a[0] === 'click' && a[1] === '.owner-invite-form button[type="submit"]');
    expect(adds).toHaveLength(2);
    const filled = page.actions.filter((a) => a[0] === 'fill').map((a) => a[2]);
    expect(filled).toEqual([ctx.second.email, ctx.second.email]);
    expect(page.actions.some((a) => a[0] === 'waitForSelector' && /This is a new sign-in link for invited-two-/.test(a[1]))).toBe(true);
    expect(ctx.second.link).toBe(FRESH);
    expect(ctx.hidden).toEqual(expect.arrayContaining([INVITE, FRESH]));
    expect(lines).toEqual(['  freshLink: the new link is of type magiclink']);
  });

  it('fails when the second add gives no link, or the same one', async () => {
    const none = fakePage({ responses: { '/api/admin/users': [{ body: invite }, { body: { invited: false } }] } });
    await expect(load().freshLink(none, baseCtx(), { log() {} })).rejects.toThrow(/No new sign-in link/);
    const same = fakePage({ responses: { '/api/admin/users': [{ body: invite }, { body: { ...fresh, inviteLink: INVITE } }] } });
    await expect(load().freshLink(same, baseCtx(), { log() {} })).rejects.toThrow(/is the invite link again/);
  });

  it('adds a member who has a password again: no link, the plain line, no link box', async () => {
    const page = fakePage({ responses: { '/api/admin/users': { body: plain } } });
    await load().addAgainNoLink(page, { ...baseCtx(), invited: { email: ONE } });
    expect(page.actions.some((a) => a[0] === 'waitForSelector' && a[1] === `.owner-success:has-text("${ONE} added to your organization.")`)).toBe(true);
    expect(page.actions.some((a) => a[0] === '$$' && a[1] === '.owner-invite-link')).toBe(true);
  });

  it('fails when a member who has a password gets a link', async () => {
    const page = fakePage({ responses: { '/api/admin/users': { body: { ...fresh } } } });
    const error = await load().addAgainNoLink(page, { ...baseCtx(), invited: { email: ONE } }).catch((e) => e);
    expect(error.message).toMatch(/got a new sign-in link/);
    expect(error.message).not.toContain('pkce-free');
  });
});

describe('inviteSteps in the run', () => {
  it('lists the steps in order, each new person in a new browser context', async () => {
    const opened = [];
    const steps = load().inviteSteps({ staff: fakePage(), ctx: baseCtx(), openPage: async (name) => { opened.push(name); return fakePage(); } });
    expect(steps.map(([name]) => name)).toEqual([
      'invitePerson', 'inviteLinkOpens', 'inviteGate', 'invitePassword', 'inviteStays', 'inviteSignIn',
      'freshLink', 'freshLinkOpens', 'noLinkWithPassword',
    ]);
  });

  it('runs after every step of the main flow, and the summary names them', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, 'e2e', 'mainFlow.e2e.js'), 'utf8');
    expect(source.indexOf("['downloadSignedPdf'")).toBeLessThan(source.indexOf('...inviteSteps('));
    expect(source).toMatch(/a person added at home/);
  });

  it("the run's redaction hides each link and password and any token field or session token", () => {
    const { redact } = require('./e2e/mainFlow.e2e.js');
    const ctx = { setupCode: 'a'.repeat(32), adminPassword: 'admin-pw', hidden: [INVITE, 'person-pw'] };
    const jwtShaped = ['eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxIn0', '.', 'c2lnbmF0dXJl'].join('');
    const text = `goto ${INVITE} failed; navigated to "${back('invite')}"; ${jwtShaped}; person-pw; ${FRESH}`;
    const out = redact(text, ctx);
    for (const secret of ['pkce-free', 'at-secret', 'rt-secret', jwtShaped, 'person-pw']) expect(out).not.toContain(secret);
    expect(out).toContain('type=invite');
  });
});
