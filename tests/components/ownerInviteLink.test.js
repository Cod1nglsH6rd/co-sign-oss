/**
 * @jest-environment jsdom
 */

/**
 * The Owner Usage page's Add User form. When POST /api/admin/users answers
 * with an inviteLink (the invitation mail did not go out), the page says the
 * mail was not sent, shows the link and a Copy button that puts it on the
 * clipboard. Without a link it shows today's message.
 */

const React = require('react');
const { render, screen, act, cleanup, fireEvent, waitFor } = require('@testing-library/react');

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

const LINK = 'https://auth.example.com/verify?token=one-time-secret-123&type=invite';
const respond = (body) => ({ ok: true, status: 200, json: async () => body });
let addAnswer;

beforeEach(() => {
  global.fetch = jest.fn(async (url, init) => {
    if (url === '/api/admin/me') return respond({ owner: true });
    if (url === '/api/admin/usage') return respond({ metrics: { organizations: 1 }, trends: { labels: [] } });
    if (url === '/api/admin/users' && init?.method === 'POST') return respond(addAnswer);
    return respond({ members: [] });
  });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: jest.fn(async () => {}) }, configurable: true });
});

afterEach(() => {
  cleanup();
  delete global.fetch;
});

async function addUser(answer) {
  addAnswer = answer;
  render(React.createElement(require('../../pages/enterprise/owner').default));
  const input = await screen.findByPlaceholderText('user@company.com');
  fireEvent.change(input, { target: { value: 'new@example.com' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add User' })); });
}

const user = { id: 'u-new', email: 'new@example.com', role: 'member' };

describe('Owner page: the invite link when no mail went out', () => {
  it.each([
    ['mail off', 'mail_off', /not sent/i],
    ['sending failed', 'provider_error', /sending failed/i],
  ])('%s: shows the link, a Copy button and a line to send it to the person', async (_name, mailReason, reasonText) => {
    await addUser({ orgId: 'org-1', invited: true, mailed: false, mailReason, inviteLink: LINK, user });

    const line = await screen.findByText(/send this link to new@example\.com/i);
    expect(line.textContent).toMatch(reasonText);
    expect(screen.getByDisplayValue(LINK)).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINK);
  });

  // 2026-11-21: at a plain-HTTP site address (a LAN address) the browser has
  // no navigator.clipboard; Copy then uses the copy command, as Send Links does.
  it('with no clipboard API (plain HTTP, not localhost), copies the link with the copy command', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const copiedTexts = [];
    document.execCommand = jest.fn((command) => {
      const area = document.activeElement;
      if (command === 'copy' && area && area.tagName === 'TEXTAREA') copiedTexts.push(area.value.slice(area.selectionStart, area.selectionEnd));
      return true;
    });
    await addUser({ orgId: 'org-1', invited: true, mailed: false, mailReason: 'mail_off', inviteLink: LINK, user });
    await screen.findByDisplayValue(LINK);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(copiedTexts).toEqual([LINK]);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('says to copy it by hand when the copy command is refused too', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = jest.fn(() => false);
    await addUser({ orgId: 'org-1', invited: true, mailed: false, mailReason: 'mail_off', inviteLink: LINK, user });
    await screen.findByDisplayValue(LINK);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(screen.getByText('Could not copy the link: select it and copy it by hand.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });

  it.each([
    ['mailed', { invited: true, mailed: true }, 'Invite sent to new@example.com. Membership added.'],
    ['existing account', { invited: false }, 'new@example.com added to your organization.'],
  ])('%s: shows today\'s message and no link', async (_name, answer, message) => {
    await addUser({ orgId: 'org-1', ...answer, user });

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.queryByDisplayValue(LINK)).toBeNull();
  });
});
