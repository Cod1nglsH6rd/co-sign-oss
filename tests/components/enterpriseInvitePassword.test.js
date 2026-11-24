/**
 * @jest-environment jsdom
 */

/**
 * /enterprise/login opened from an invite link. The auth service returns the
 * person with a session and `type=invite` in the URL fragment; the page then
 * remembers in localStorage (one entry, the signed-in user's id) that this
 * user still has to choose a password, and shows the password form (email
 * read-only, new password, confirm) instead of going on. While the entry is
 * set for the signed-in user the form comes back after a reload, and the
 * enterprise pages send the person to /enterprise/login. Saving the password
 * removes the entry; an entry for another user is ignored and removed. An
 * ordinary session still goes straight to Documents. Nothing here signs
 * anyone out, also not when React runs effects twice (StrictMode).
 */

const fs = require('fs');
const path = require('path');
const React = require('react');
const { render, screen, act, cleanup, fireEvent, waitFor } = require('@testing-library/react');

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  asPath: '/enterprise/login',
  pathname: '/enterprise/login',
  query: {},
};
let mockAuthType = null;
let mockSession = null;
const mockAuth = {
  getSession: jest.fn(async () => ({ data: { session: mockSession }, error: null })),
  updateUser: jest.fn(),
  signOut: jest.fn(async () => ({ error: null })),
  signInWithPassword: jest.fn(),
  refreshSession: jest.fn(),
};

jest.mock('next/router', () => ({ useRouter: () => mockRouter }));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
jest.mock('next/link', () => {
  const ReactInMock = require('react');
  return { __esModule: true, default: ({ href, children, ...rest }) => ReactInMock.createElement('a', { href, ...rest }, children) };
});
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: () => {}, error: () => {} } }));
jest.mock('../../components/EnterpriseProfileMenu', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/enterprise/OnboardingGuide', () => ({ __esModule: true, default: () => null }));
jest.mock('../../hooks/useIsOwner', () => ({ useIsOwner: () => false }));
jest.mock('../../lib/supabaseClient', () => ({
  supabase: { auth: mockAuth },
  urlAuthType: () => mockAuthType,
  forgetUrlAuthType: () => { mockAuthType = null; },
}));

const ROOT = path.join(__dirname, '..', '..');
const KEY = 'cosign.invitePasswordPending';
const USER_ID = 'u-new';
const EMAIL = 'new@example.com';
const GOOD = 'a-long-enough-pass'; // 18 characters; the app's minimum is 10
const SHORT = 'short1234'; // 9 characters
let savedFetch;

beforeEach(() => {
  mockRouter.push.mockReset();
  mockRouter.replace.mockReset();
  mockRouter.pathname = '/enterprise/login';
  mockAuth.updateUser.mockReset();
  mockAuth.updateUser.mockResolvedValue({ data: { user: { id: USER_ID, email: EMAIL } }, error: null });
  mockAuth.signInWithPassword.mockReset();
  mockAuth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
  mockAuth.signOut.mockClear();
  // Since 2026-11-21 a saved password is followed by the server route and a
  // session refresh (tests/components/invitePasswordServerMark.test.js).
  mockAuth.refreshSession.mockReset();
  mockAuth.refreshSession.mockImplementation(async () => ({ data: { session: mockSession, user: mockSession?.user }, error: null }));
  savedFetch = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  mockSession = { access_token: 'tok', user: { id: USER_ID, email: EMAIL } };
  mockAuthType = null;
  window.localStorage.clear();
  require('../../lib/invitePassword').clearPasswordPending();
});

afterEach(() => {
  cleanup();
  global.fetch = savedFetch;
});

function loginElement() {
  return React.createElement(require('../../pages/enterprise/login').default);
}

function renderMaybeStrict(element, strict) {
  return render(strict ? React.createElement(React.StrictMode, null, element) : element);
}

// Lets getSession resolve and any redirect happen.
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

async function openForm(strict = false) {
  renderMaybeStrict(loginElement(), strict);
  await screen.findByLabelText(/new password/i);
}

async function submit(password, confirm) {
  fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: confirm } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /set password/i })); });
}

// A browser that refuses localStorage (some private modes throw on any use).
function withoutStorage() {
  const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { throw new Error('The operation is insecure.'); },
  });
  return () => {
    if (own) Object.defineProperty(window, 'localStorage', own);
    else delete window.localStorage;
  };
}

describe('reading the invite return from the URL fragment', () => {
  it.each([
    ['#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=invite', 'invite'],
    ['#access_token=abc&type=recovery', 'recovery'],
    ['#access_token=abc', null],
    ['', null],
    [undefined, null],
  ])('%s gives %s', (hash, expected) => {
    expect(require('../../lib/invitePassword').authReturnType(hash)).toBe(expected);
  });

  it('the installed auth client takes the session from an invite fragment and clears it, and the type read at load is kept', async () => {
    // Plain short pieces, not token-shaped: the client only passes them on.
    const access = ['acc', 'ess', '1'].join('-');
    const refresh = ['ref', 'resh', '1'].join('-');
    const now = Math.round(Date.now() / 1000);
    const savedFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ id: USER_ID, email: EMAIL, aud: 'authenticated', role: 'authenticated' }),
    }));
    window.location.hash = `#access_token=${access}&expires_at=${now + 3600}&expires_in=3600&refresh_token=${refresh}&token_type=bearer&type=invite`;
    let client;
    jest.isolateModules(() => { client = jest.requireActual('../../lib/supabaseClient'); });
    try {
      const { data: { session } } = await client.supabase.auth.getSession();
      expect(session.user.id).toBe(USER_ID);
      expect(window.location.hash).toBe('');
      expect(client.urlAuthType()).toBe('invite');
      client.forgetUrlAuthType();
      expect(client.urlAuthType()).toBeNull();
    } finally {
      client.supabase.auth.stopAutoRefresh();
      global.fetch = savedFetch;
      window.location.hash = '';
    }
  });
});

describe('/enterprise/login shows the password form instead of redirecting', () => {
  it.each([
    ['on the invite return (type=invite)', () => { mockAuthType = 'invite'; }, false],
    ['on the invite return inside React.StrictMode', () => { mockAuthType = 'invite'; }, true],
    ['after a reload, while the entry is set for this user', () => { window.localStorage.setItem(KEY, USER_ID); }, false],
    ['after a reload inside React.StrictMode', () => { window.localStorage.setItem(KEY, USER_ID); }, true],
  ])('%s', async (_name, arrange, strict) => {
    arrange();
    await openForm(strict);
    const email = screen.getByDisplayValue(EMAIL);
    expect(email.readOnly).toBe(true);
    expect(screen.getByLabelText(/confirm/i)).toBeTruthy();
    await settle();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBe(USER_ID);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });
});

describe('/enterprise/login redirects to Documents as before', () => {
  it.each([
    ['an ordinary session', () => {}, null],
    ['an entry left for another user (ignored and removed)', () => { window.localStorage.setItem(KEY, 'someone-else'); }, null],
  ])('%s', async (_name, arrange, entryAfter) => {
    arrange();
    render(loginElement());
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents'));
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBe(entryAfter);
  });

  it('a password sign-in removes an entry left for that user, since the account has a password', async () => {
    mockSession = null;
    window.localStorage.setItem(KEY, USER_ID);
    render(loginElement());
    await settle();
    fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: EMAIL } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: GOOD } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /sign in/i })); });
    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: GOOD });
    expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe('choosing the password', () => {
  it('a valid password calls updateUser once with it, removes the entry, then goes to Documents', async () => {
    mockAuthType = 'invite';
    await openForm();
    await submit(GOOD, GOOD);
    expect(mockAuth.updateUser).toHaveBeenCalledTimes(1);
    expect(mockAuth.updateUser).toHaveBeenCalledWith({ password: GOOD });
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents'));
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ['a mismatch', GOOD, `${GOOD}x`, () => {}, 0],
    ['a too-short password', SHORT, SHORT, () => {}, 0],
    ['a failed update', GOOD, GOOD, () => {
      mockAuth.updateUser.mockResolvedValue({ data: { user: null }, error: { message: 'Password is too weak' } });
    }, 1],
    ['an update that throws (network down)', GOOD, GOOD, () => {
      mockAuth.updateUser.mockRejectedValue(new Error('Failed to fetch'));
    }, 1],
    ['another account signed in from another tab since the form opened', GOOD, GOOD, () => {
      mockSession = { access_token: 'tok2', user: { id: 'someone-else', email: 'other@example.com' } };
    }, 0],
  ])('%s shows a message, keeps the entry and stays on the form', async (_name, password, confirm, arrange, updateCalls) => {
    mockAuthType = 'invite';
    await openForm();
    arrange();
    await submit(password, confirm);
    expect(mockAuth.updateUser).toHaveBeenCalledTimes(updateCalls);
    expect((await screen.findByRole('alert')).textContent).not.toBe('');
    expect(screen.getByLabelText(/new password/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /set password/i }).disabled).toBe(false);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBe(USER_ID);
  });
});

describe('a browser that refuses localStorage', () => {
  let restore;
  beforeEach(() => { restore = withoutStorage(); });
  afterEach(() => { restore(); });

  it.each([
    ['plain', false],
    ['inside React.StrictMode', true],
  ])('the invite return still shows the form, and a valid password saves and goes on (%s)', async (_name, strict) => {
    mockAuthType = 'invite';
    await openForm(strict);
    await settle();
    expect(mockRouter.push).not.toHaveBeenCalled();
    await submit(GOOD, GOOD);
    expect(mockAuth.updateUser).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents'));
    expect(require('../../lib/invitePassword').isPasswordPending(USER_ID)).toBe(false);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  it('an ordinary session redirects as before', async () => {
    render(loginElement());
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents'));
  });
});

describe('the enterprise pages', () => {
  function renderLayout(strict) {
    const EnterpriseLayout = require('../../components/enterprise/EnterpriseLayout').default;
    const layout = React.createElement(EnterpriseLayout, { user: { id: USER_ID, email: EMAIL }, counts: {} }, 'page');
    renderMaybeStrict(layout, strict);
  }

  it.each([
    ['the layout sends the person to /enterprise/login while the entry is set for them', USER_ID, false, true, USER_ID],
    ['the same inside React.StrictMode', USER_ID, true, true, USER_ID],
    ['the layout leaves another user where they are and removes the entry', 'someone-else', false, false, null],
    ['the layout leaves the person where they are with no entry', null, false, false, null],
  ])('%s', async (_name, entry, strict, redirected, entryAfter) => {
    mockRouter.pathname = '/enterprise/documents';
    if (entry) window.localStorage.setItem(KEY, entry);
    renderLayout(strict);
    await settle();
    if (redirected) expect(mockRouter.replace).toHaveBeenCalledWith('/enterprise/login');
    else expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBe(entryAfter);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  // The two signed-in enterprise pages that do not use the layout.
  it.each([
    ['pages/enterprise/setup.js', 'useInvitePasswordGate(user)'],
    ['pages/[locale]/documents/[id].js', "useInvitePasswordGate(router.pathname?.startsWith('/enterprise/') ? user : null)"],
  ])('%s checks the entry too', (rel, call) => {
    expect(fs.readFileSync(path.join(ROOT, rel), 'utf8')).toContain(call);
  });
});
