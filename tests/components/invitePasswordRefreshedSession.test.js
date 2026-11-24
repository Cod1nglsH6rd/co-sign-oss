/**
 * @jest-environment jsdom
 */

/**
 * 2026-11-21: after a password sign-in by an account that still carries the
 * server's mark (app_metadata.password_pending), /enterprise/login calls
 * POST /api/account/password-set, refreshes the session, and only then goes
 * on. This runs that path against the installed auth client (no mock of
 * lib/supabaseClient; only fetch answers): refreshSession saves the refreshed
 * session and tells every onAuthStateChange listener before it resolves, so
 * the next page's useAuth, and the invite-password gate that reads its user,
 * never see the old mark and do not send the person back to the form.
 */

const React = require('react');
const { render, screen, act, cleanup, fireEvent, waitFor } = require('@testing-library/react');

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  asPath: '/enterprise/login',
  pathname: '/enterprise/login',
  query: {},
};

jest.mock('next/router', () => ({ useRouter: () => mockRouter }));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
jest.mock('next/link', () => {
  const ReactInMock = require('react');
  return { __esModule: true, default: ({ href, children, ...rest }) => ReactInMock.createElement('a', { href, ...rest }, children) };
});
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: () => {}, error: () => {} } }));

const USER_ID = 'u-new';
const EMAIL = 'new@example.com';
const GOOD = 'a-long-enough-pass';
const ROUTE = '/api/account/password-set';
// Plain short pieces, not token-shaped: the client only passes them on.
const piece = (...parts) => parts.join('-');

let calls;
let markAfterRefresh;

function reply(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function sessionBody(n, marked) {
  const now = Math.round(Date.now() / 1000);
  return {
    access_token: piece('acc', 'ess', String(n)),
    refresh_token: piece('ref', 'resh', String(n)),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: USER_ID,
      email: EMAIL,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: marked ? { provider: 'email', password_pending: true } : { provider: 'email' },
    },
  };
}

// Set before the client is first required: it may keep the fetch it finds.
const savedFetch = global.fetch;
global.fetch = jest.fn(async (url) => {
  const u = String(url);
  if (u === ROUTE) {
    calls.push('route');
    return reply({ ok: true });
  }
  if (u.includes('/auth/v1/token') && u.includes('grant_type=password')) {
    calls.push('sign-in');
    return reply(sessionBody(1, true));
  }
  if (u.includes('/auth/v1/token') && u.includes('grant_type=refresh_token')) {
    calls.push('refresh');
    return reply(sessionBody(2, markAfterRefresh));
  }
  // Anything else the pages ask for (org memberships, bootstrap): nothing.
  return reply([]);
});

let supabase;

beforeAll(() => {
  ({ supabase } = require('../../lib/supabaseClient'));
});

afterAll(() => {
  supabase.auth.stopAutoRefresh();
  global.fetch = savedFetch;
});

beforeEach(() => {
  calls = [];
  markAfterRefresh = false;
  mockRouter.push.mockReset();
  mockRouter.replace.mockReset();
  mockRouter.pathname = '/enterprise/login';
  // The client keeps its session in localStorage: clearing it starts afresh.
  window.localStorage.clear();
  require('../../lib/invitePassword').clearPasswordPending();
});

afterEach(() => {
  cleanup();
});

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}

// An enterprise page as the app builds one: its own useAuth, and the gate
// fed with that hook's user.
function NextPage({ seen }) {
  const { useAuth } = require('../../hooks/useAuth');
  const { useInvitePasswordGate } = require('../../hooks/useInvitePasswordGate');
  const { user } = useAuth();
  useInvitePasswordGate(user);
  if (user) seen.push(user);
  return null;
}

describe('the installed auth client, after a password sign-in by a marked account', () => {
  it('the refresh is saved and every listener has the new user before the sign-in page goes on; the next page is not sent back', async () => {
    const heard = [];
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      heard.push([event, session?.user?.app_metadata?.password_pending === true]);
    });
    let atPush = null;
    mockRouter.push.mockImplementation(() => {
      atPush = heard.slice();
    });
    try {
      render(React.createElement(require('../../pages/enterprise/login').default));
      await settle();
      fireEvent.change(screen.getByPlaceholderText('name@company.com'), { target: { value: EMAIL } });
      fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: GOOD } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /sign in/i })); });
      await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/enterprise/documents'));
      expect(calls).toEqual(['sign-in', 'route', 'refresh']);
      expect(atPush).toContainEqual(['TOKEN_REFRESHED', false]);
      const { data: { session } } = await supabase.auth.getSession();
      expect(session.user.app_metadata.password_pending).toBeUndefined();
    } finally {
      listener.subscription.unsubscribe();
    }

    cleanup();
    mockRouter.pathname = '/enterprise/documents';
    const seen = [];
    render(React.createElement(NextPage, { seen }));
    await settle();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((u) => u.app_metadata.password_pending === undefined)).toBe(true);
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/enterprise/login');
  });

  it('control: the same page with a session that still carries the mark is sent to the form', async () => {
    await supabase.auth.signInWithPassword({ email: EMAIL, password: GOOD });
    mockRouter.pathname = '/enterprise/documents';
    const seen = [];
    render(React.createElement(NextPage, { seen }));
    await settle();
    expect(seen[seen.length - 1].app_metadata.password_pending).toBe(true);
    expect(mockRouter.replace).toHaveBeenCalledWith('/enterprise/login');
  });
});
