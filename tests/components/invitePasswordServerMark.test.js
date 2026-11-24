/**
 * @jest-environment jsdom
 */

/**
 * The password step follows the account's server mark
 * (app_metadata.password_pending, carried in the session's user), not only the
 * browser entry. A marked user sees the form on /enterprise/login and is sent
 * there by the enterprise pages, in any browser. Once the password is saved,
 * POST /api/account/password-set is called and then the session refreshed;
 * if that last step fails, the form says the password is saved and offers to
 * retry only that step, never asking for the password again. A password
 * sign-in by a marked account finishes that step at once.
 *
 * Added 2026-11-21: once this browser knows the password is saved (updateUser
 * succeeded here, or a password sign-in), a mark that could not be cleared no
 * longer holds the person up. passwordStep(user) is the one rule: the form
 * ('choose'), only the last step left ('finish'), or nothing. In 'finish' the
 * enterprise pages let the person through and the sign-in page offers to try
 * again or go on; the next password sign-in tries that step again. The retry
 * acts only for the user the form opened for, and nothing is called twice
 * inside React.StrictMode.
 */

const React = require('react');
const { render, screen, act, cleanup, fireEvent, waitFor } = require('@testing-library/react');

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  asPath: '/enterprise/login',
  pathname: '/enterprise/login',
  query: {},
  isReady: true,
};
let mockSession = null;
const mockAuth = {
  getSession: jest.fn(async () => ({ data: { session: mockSession }, error: null })),
  updateUser: jest.fn(),
  signOut: jest.fn(async () => ({ error: null })),
  signInWithPassword: jest.fn(),
  refreshSession: jest.fn(),
};
let mockAuthState = null;

jest.mock('next/router', () => ({ useRouter: () => mockRouter }));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }));
jest.mock('next/link', () => {
  const ReactInMock = require('react');
  return { __esModule: true, default: ({ href, children, ...rest }) => ReactInMock.createElement('a', { href, ...rest }, children) };
});
jest.mock('next-intl', () => ({ useTranslations: () => (key) => key }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: () => {}, error: () => {} } }));
jest.mock('../../components/EnterpriseProfileMenu', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/enterprise/OnboardingGuide', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/SignatureCanvas', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/SnakeGame', () => ({ __esModule: true, default: () => null }));
jest.mock('../../hooks/useIsOwner', () => ({ useIsOwner: () => false }));
jest.mock('../../hooks/useAuth', () => ({ useAuth: () => mockAuthState }));
jest.mock('../../lib/supabaseClient', () => ({
  supabase: { auth: mockAuth },
  urlAuthType: () => null,
  forgetUrlAuthType: () => {},
}));

const KEY = 'cosign.invitePasswordPending';
const USER_ID = 'u-new';
const EMAIL = 'new@example.com';
const GOOD = 'a-long-enough-pass';
const MARKED = { id: USER_ID, email: EMAIL, app_metadata: { password_pending: true } };
const PLAIN = { id: USER_ID, email: EMAIL, app_metadata: {} };
const ROUTE = '/api/account/password-set';

let events;
let routeOk;
let savedFetch;

function routeCalls() {
  return global.fetch.mock.calls.filter(([url]) => url === ROUTE);
}

beforeEach(() => {
  events = [];
  routeOk = true;
  mockRouter.push.mockReset();
  mockRouter.replace.mockReset();
  mockRouter.pathname = '/enterprise/login';
  mockAuth.updateUser.mockReset();
  mockAuth.updateUser.mockImplementation(async () => {
    events.push('updateUser');
    return { data: { user: PLAIN }, error: null };
  });
  mockAuth.signInWithPassword.mockReset();
  mockAuth.refreshSession.mockReset();
  mockAuth.refreshSession.mockImplementation(async () => {
    events.push('refresh');
    mockSession = { access_token: 'tok-2', user: PLAIN };
    return { data: { session: mockSession, user: PLAIN }, error: null };
  });
  mockSession = { access_token: 'tok-1', user: MARKED };
  mockAuthState = { user: MARKED, loading: true, orgLoading: true, orgId: null, signOut: jest.fn() };
  savedFetch = global.fetch;
  global.fetch = jest.fn(async (url) => {
    if (url !== ROUTE) return { ok: true, status: 200, json: async () => ({}) };
    events.push('route');
    return routeOk
      ? { ok: true, status: 200, json: async () => ({ ok: true }) }
      : { ok: false, status: 500, json: async () => ({}) };
  });
  window.localStorage.clear();
  require('../../lib/invitePassword').clearPasswordPending();
});

afterEach(() => {
  cleanup();
  global.fetch = savedFetch;
});

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

function renderLogin(strict = false) {
  const page = React.createElement(require('../../pages/enterprise/login').default);
  render(strict ? React.createElement(React.StrictMode, null, page) : page);
}

function renderLayout(user) {
  const EnterpriseLayout = require('../../components/enterprise/EnterpriseLayout').default;
  render(React.createElement(EnterpriseLayout, { user, counts: {} }, 'page'));
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

async function click(name) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
  await settle();
}

async function choosePassword(strict = false) {
  renderLogin(strict);
  await screen.findByLabelText(/new password/i);
  fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: GOOD } });
  fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: GOOD } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /set password/i })); });
  await settle();
}

async function signInByPassword(user, strict = false) {
  mockSession = null;
  mockAuth.signInWithPassword.mockImplementation(async () => {
    mockSession = { access_token: 'tok-1', user };
    return { data: { session: mockSession, user }, error: null };
  });
  renderLogin(strict);
  await settle();
  fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: EMAIL } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: GOOD } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /sign in/i })); });
  await settle();
}

describe('/enterprise/login follows the mark', () => {
  it('shows the password form for a marked session with no browser entry', async () => {
    renderLogin();
    await screen.findByLabelText(/new password/i);
    await settle();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('sends a session without the mark and without the entry to Documents', async () => {
    mockSession = { access_token: 'tok-1', user: PLAIN };
    renderLogin();
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents'));
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
  });
});

describe('the enterprise pages follow the mark', () => {
  const layout = () => {
    const EnterpriseLayout = require('../../components/enterprise/EnterpriseLayout').default;
    return React.createElement(EnterpriseLayout, { user: mockAuthState.user, counts: {} }, 'page');
  };
  const setup = () => React.createElement(require('../../pages/enterprise/setup').default);
  const viewer = () => React.createElement(require('../../pages/[locale]/documents/[id]').default);

  it.each([
    ['the layout, marked user', layout, '/enterprise/documents', MARKED, true],
    ['the layout, plain user', layout, '/enterprise/documents', PLAIN, false],
    ['document setup, marked user', setup, '/enterprise/setup', MARKED, true],
    ['document setup, plain user', setup, '/enterprise/setup', PLAIN, false],
    ['the enterprise viewer, marked user', viewer, '/enterprise/documents/[id]', MARKED, true],
    ['the consumer viewer, marked user (not gated)', viewer, '/[locale]/documents/[id]', MARKED, false],
  ])('%s', async (_name, element, pathname, user, redirected) => {
    mockRouter.pathname = pathname;
    mockAuthState = { ...mockAuthState, user };
    render(element());
    await settle();
    if (redirected) expect(mockRouter.replace).toHaveBeenCalledWith('/enterprise/login');
    else expect(mockRouter.replace).not.toHaveBeenCalledWith('/enterprise/login');
  });
});

describe('after the password is saved', () => {
  it('an ok route is followed by one refresh, then the entry is removed and the page goes on', async () => {
    window.localStorage.setItem(KEY, USER_ID);
    await choosePassword();
    expect(events).toEqual(['updateUser', 'route', 'refresh']);
    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('a failed route shows the retry line; the retry calls only the route and the refresh, then goes on', async () => {
    routeOk = false;
    await choosePassword();
    expect(screen.getByRole('alert').textContent).toMatch(/saved/i);
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
    expect(mockAuth.refreshSession).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();

    routeOk = true;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /try again/i })); });
    await settle();
    expect(mockAuth.updateUser).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['updateUser', 'route', 'route', 'refresh']);
    expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents');
  });

  it('after a reload, the same person is shown the retry line, not a new password', async () => {
    routeOk = false;
    await choosePassword();
    cleanup();
    renderLogin();
    await screen.findByRole('button', { name: /try again/i });
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
  });
});

describe('a password sign-in', () => {
  it('by a marked account calls the route once, then refreshes, then goes on', async () => {
    await signInByPassword(MARKED);
    expect(routeCalls()).toHaveLength(1);
    expect(events).toEqual(['route', 'refresh']);
    expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents');
  });

  it.each([
    ['the route fails', () => { routeOk = false; }],
    ['the refresh fails', () => {
      mockAuth.refreshSession.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'down' } });
    }],
  ])('by a marked account when %s shows the retry line, never a new password', async (_name, arrange) => {
    arrange();
    await signInByPassword(MARKED);
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('by an account without the mark makes no call and goes on', async () => {
    await signInByPassword(PLAIN);
    expect(routeCalls()).toHaveLength(0);
    expect(mockAuth.refreshSession).not.toHaveBeenCalled();
    expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents');
  });
});

describe('passwordStep(user): one rule for the gate, the sign-in page and the form', () => {
  // name, step, user, browser entry (id), password known saved here (id)
  it.each([
    ['the mark, nothing in the browser', 'choose', MARKED, null, null],
    ['the entry for this id, no mark', 'choose', PLAIN, USER_ID, null],
    ['the mark and the entry', 'choose', MARKED, USER_ID, null],
    ['the mark, the password saved in this browser', 'finish', MARKED, null, USER_ID],
    ['the mark and the entry, the password saved here', 'finish', MARKED, USER_ID, USER_ID],
    ['the mark, the password saved here for another id', 'choose', MARKED, null, 'someone-else'],
    ['the entry, the password saved here, no mark', null, PLAIN, USER_ID, USER_ID],
    ['neither', null, PLAIN, null, null],
    ['no user', null, null, null, null],
  ])('%s: %s', (_name, step, user, entry, saved) => {
    const lib = require('../../lib/invitePassword');
    if (entry) lib.markPasswordPending(entry);
    if (saved) lib.markPasswordSaved(saved);
    expect(lib.passwordStep(user)).toBe(step);
    expect(lib.needsPassword(user)).toBe(step === 'choose');
  });
});

describe('the enterprise pages, once the password is known saved here', () => {
  const layout = () => {
    const EnterpriseLayout = require('../../components/enterprise/EnterpriseLayout').default;
    return React.createElement(EnterpriseLayout, { user: mockAuthState.user, counts: {} }, 'page');
  };
  const setup = () => React.createElement(require('../../pages/enterprise/setup').default);
  const viewer = () => React.createElement(require('../../pages/[locale]/documents/[id]').default);

  it.each([
    ['the layout', layout, '/enterprise/documents'],
    ['document setup', setup, '/enterprise/setup'],
    ['the enterprise viewer', viewer, '/enterprise/documents/[id]'],
  ])('%s lets a marked user through', async (_name, element, pathname) => {
    require('../../lib/invitePassword').markPasswordSaved(USER_ID);
    mockRouter.pathname = pathname;
    render(element());
    await settle();
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/enterprise/login');
  });

  it('the consumer viewer does not gate on the browser entry either', async () => {
    window.localStorage.setItem(KEY, USER_ID);
    mockRouter.pathname = '/[locale]/documents/[id]';
    mockAuthState = { ...mockAuthState, user: PLAIN };
    render(viewer());
    await settle();
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/enterprise/login');
  });
});

describe('when the last step cannot be finished, the person is never held up', () => {
  it('after a saved password, Go on goes to Documents with no further call; the enterprise pages let them through; the sign-in page shows the retry line again', async () => {
    routeOk = false;
    await choosePassword();
    await click(/go on/i);
    expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents');
    expect(events).toEqual(['updateUser', 'route']);

    cleanup();
    mockRouter.pathname = '/enterprise/documents';
    renderLayout(MARKED);
    await settle();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    cleanup();
    mockRouter.pathname = '/enterprise/login';
    mockRouter.push.mockReset();
    renderLogin();
    await screen.findByRole('button', { name: /try again/i });
    expect(screen.getByRole('button', { name: /go on/i })).toBeTruthy();
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockAuth.updateUser).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['storage works', false],
    ['the browser refuses localStorage', true],
  ])('a password sign-in whose last step fails can go on, and the next sign-in tries that step again (%s)', async (_name, noStorage) => {
    const restore = noStorage ? withoutStorage() : () => {};
    try {
      routeOk = false;
      await signInByPassword(MARKED);
      expect(screen.queryByLabelText(/new password/i)).toBeNull();
      await click(/go on/i);
      expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents');
      expect(routeCalls()).toHaveLength(1);

      cleanup();
      mockRouter.pathname = '/enterprise/documents';
      renderLayout(MARKED);
      await settle();
      expect(mockRouter.replace).not.toHaveBeenCalled();

      cleanup();
      mockRouter.pathname = '/enterprise/login';
      mockRouter.push.mockReset();
      routeOk = true;
      events = [];
      await signInByPassword(MARKED);
      expect(events).toEqual(['route', 'refresh']);
      expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents');
      expect(mockAuth.updateUser).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('the retry acts only for the user the form opened for: with another account signed in from another tab it calls nothing and asks for a reload', async () => {
    routeOk = false;
    await choosePassword();
    routeOk = true;
    mockSession = { access_token: 'tok-other', user: { id: 'someone-else', email: 'other@example.com', app_metadata: { password_pending: true } } };
    await click(/try again/i);
    expect(routeCalls()).toHaveLength(1);
    expect(mockAuth.refreshSession).not.toHaveBeenCalled();
    expect(mockAuth.updateUser).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/reload/i);
  });

  it('a refresh that comes back for another account (signed in from another tab meanwhile) is not taken as done', async () => {
    const other = { id: 'someone-else', email: 'other@example.com', app_metadata: {} };
    mockAuth.refreshSession.mockImplementation(async () => {
      events.push('refresh');
      return { data: { session: { access_token: 'tok-other', user: other }, user: other }, error: null };
    });
    await choosePassword();
    expect(events).toEqual(['updateUser', 'route', 'refresh']);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});

describe('inside React.StrictMode', () => {
  it('choosing the password calls updateUser, the route and the refresh once each, and signs no one out', async () => {
    await choosePassword(true);
    expect(events).toEqual(['updateUser', 'route', 'refresh']);
    expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents');
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  it('a password sign-in by a marked account calls the route and the refresh once each', async () => {
    await signInByPassword(MARKED, true);
    expect(events).toEqual(['route', 'refresh']);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  it('the sign-in page opened with a session whose last step is left calls nothing by itself', async () => {
    require('../../lib/invitePassword').markPasswordSaved(USER_ID);
    renderLogin(true);
    await screen.findByRole('button', { name: /try again/i });
    await settle();
    expect(events).toEqual([]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });
});
