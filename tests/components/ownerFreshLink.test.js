/**
 * @jest-environment jsdom
 */

/**
 * The Owner Usage page's Add User form, when POST /api/admin/users answers
 * with a link for an account that already exists (invited: false): the page
 * shows the link with the Copy button and says it is a new sign-in link and
 * the person will be asked to choose a password.
 */

const React = require('react');
const { render, screen, act, cleanup, fireEvent } = require('@testing-library/react');

jest.mock('next/router', () => ({
  useRouter: () => ({ asPath: '/enterprise/owner', pathname: '/enterprise/owner', query: {}, push() {}, replace() {} }),
}));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
jest.mock('next/link', () => {
  const ReactInMock = require('react');
  return { __esModule: true, default: ({ href, children, ...rest }) => ReactInMock.createElement('a', { href, ...rest }, children) };
});
jest.mock('../../components/EnterpriseProfileMenu', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/enterprise/OnboardingGuide', () => ({ __esModule: true, default: () => null }));
jest.mock('../../lib/supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));
jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'owner@example.com' }, orgId: 'org-1', memberships: [], switchOrg: () => {} }),
}));

const LINK = 'https://auth.example.com/verify?token=fresh-secret-456&type=magiclink';
const respond = (body) => ({ ok: true, status: 200, json: async () => body });
const ANSWER = { orgId: 'org-1', invited: false, mailed: false, mailReason: 'mail_off', inviteLink: LINK, user: { id: 'u-old', email: 'old@example.com', role: 'member' } };

beforeEach(() => {
  global.fetch = jest.fn(async (url, init) => {
    if (url === '/api/admin/me') return respond({ owner: true });
    if (url === '/api/admin/usage') return respond({ metrics: { organizations: 1 }, trends: { labels: [] } });
    if (url === '/api/admin/users' && init?.method === 'POST') return respond(ANSWER);
    return respond({ members: [] });
  });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: jest.fn(async () => {}) }, configurable: true });
});

afterEach(() => {
  cleanup();
  delete global.fetch;
});

it('an existing account with a link: shows the link, Copy, and says it is a new sign-in link and a password will be asked for', async () => {
  render(React.createElement(require('../../pages/enterprise/owner').default));
  const input = await screen.findByPlaceholderText('user@company.com');
  fireEvent.change(input, { target: { value: 'old@example.com' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add User' })); });

  const line = await screen.findByText(/new sign-in link/i);
  expect(line.textContent).toMatch(/old@example\.com/);
  expect(line.textContent).toMatch(/choose a password/i);
  expect(line.textContent).not.toMatch(/set up their account/i);
  expect(screen.getByDisplayValue(LINK)).toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINK);
});
