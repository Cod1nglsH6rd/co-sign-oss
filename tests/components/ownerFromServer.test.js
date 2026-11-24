/**
 * @jest-environment jsdom
 */

/**
 * The Owner Usage page and the sidebar's Owner Usage entry ask the server
 * (GET /api/admin/me) who the owner is, rather than the build-time list, which
 * is empty here as in the Docker image. Until the route answers, the page shows
 * its loading state and the sidebar no owner entry; after it says owner: true,
 * both appear. A new signed-in user never sees the last user's answer.
 */

const React = require('react');
const { render, screen, act, cleanup, waitFor } = require('@testing-library/react');

jest.mock('next/router', () => ({
  useRouter: () => ({ asPath: '/enterprise/owner', pathname: '/enterprise/owner', query: {}, push() {}, replace() {} }),
}));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
jest.mock('next/link', () => {
  const ReactInMock = require('react');
  return {
    __esModule: true,
    default: ({ href, children, ...rest }) => ReactInMock.createElement('a', { href, ...rest }, children),
  };
});
jest.mock('../../components/EnterpriseProfileMenu', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/enterprise/OnboardingGuide', () => ({ __esModule: true, default: () => null }));
jest.mock('../../lib/supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));
const USER = { id: 'user-1', email: 'owner@example.com' };
jest.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'owner@example.com' }, orgId: 'org-1', memberships: [], switchOrg: () => {} }),
}));

const USAGE = { metrics: { organizations: 7 }, trends: { labels: [] }, generatedAt: '2026-11-21T00:00:00Z' };
let meAnswers;
let savedOwners;

const respond = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  savedOwners = process.env.NEXT_PUBLIC_OWNER_EMAILS;
  process.env.NEXT_PUBLIC_OWNER_EMAILS = '';
  meAnswers = [];
  global.fetch = jest.fn((url) => {
    if (url === '/api/admin/me') return new Promise((resolve) => { meAnswers.push(resolve); });
    if (url === '/api/admin/usage') return Promise.resolve(respond(USAGE));
    return Promise.resolve(respond({ members: [] }));
  });
});

afterEach(() => {
  cleanup();
  delete global.fetch;
  if (savedOwners === undefined) delete process.env.NEXT_PUBLIC_OWNER_EMAILS;
  else process.env.NEXT_PUBLIC_OWNER_EMAILS = savedOwners;
});

const ownerLink = (root) => root.querySelector('a[href="/enterprise/owner"]');
const answerOwner = () => act(async () => { meAnswers.forEach((resolve) => resolve(respond({ owner: true }))); });

describe('owner parts come from GET /api/admin/me', () => {
  it.each([
    [
      'the sidebar Owner Usage entry',
      () => {
        const EnterpriseLayout = require('../../components/enterprise/EnterpriseLayout').default;
        return React.createElement(EnterpriseLayout, { user: USER, counts: {} }, 'page');
      },
      (container) => expect(ownerLink(container)).toBeNull(),
      (container) => waitFor(() => expect(ownerLink(container)).not.toBeNull()),
    ],
    [
      'the Owner Usage page',
      () => React.createElement(require('../../pages/enterprise/owner').default),
      () => {
        expect(screen.queryByText('Loading usage metrics...')).not.toBeNull();
        expect(screen.queryByText('Organizations')).toBeNull();
        expect(screen.queryByText(/restricted to owner accounts/)).toBeNull();
      },
      () => waitFor(() => {
        expect(screen.getByText('Organizations')).toBeInTheDocument();
        expect(screen.getByText('7')).toBeInTheDocument();
      }),
    ],
  ])('%s shows only after the route says owner', async (_name, element, before, after) => {
    const { container } = render(element());
    await act(async () => {});
    before(container);
    expect(global.fetch).toHaveBeenCalledWith('/api/admin/me', expect.objectContaining({
      headers: { Authorization: 'Bearer tok' },
    }));

    await answerOwner();
    await after(container);
  });

  it('the sidebar drops Owner Usage in the same render the signed-in user changes', async () => {
    const EnterpriseLayout = require('../../components/enterprise/EnterpriseLayout').default;
    const commits = [];
    // Records, at each commit, whether the owner entry is on the page.
    function Probe() {
      React.useLayoutEffect(() => { commits.push(Boolean(ownerLink(document))); });
      return null;
    }
    const view = (user) => React.createElement(EnterpriseLayout, { user, counts: {} }, React.createElement(Probe));
    const { container, rerender } = render(view(USER));
    await act(async () => {});
    await answerOwner();
    expect(ownerLink(container)).not.toBeNull();

    commits.length = 0;
    rerender(view({ id: 'user-2', email: 'staff@example.com' }));
    expect(commits.length).toBeGreaterThan(0);
    expect(commits).not.toContain(true);
  });
});
