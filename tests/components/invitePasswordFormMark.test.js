/**
 * @jest-environment jsdom
 */

/**
 * InvitePasswordForm POSTs to /api/account/password-set with the session's
 * Bearer token after updateUser succeeds, then refreshes the session, then
 * calls onDone. Since 2026-11-21 a failure of that call is no longer ignored:
 * the form says the password is saved and offers to try only that step again
 * (tests/components/invitePasswordServerMark.test.js has the rest). A failed
 * updateUser makes no call.
 */

const React = require('react');
const { render, screen, act, cleanup, fireEvent } = require('@testing-library/react');

const GOOD = 'a-long-enough-pass';
const mockAuth = { getSession: jest.fn(), updateUser: jest.fn(), refreshSession: jest.fn() };

jest.mock('../../lib/supabaseClient', () => ({ supabase: { auth: mockAuth } }));

let events;
let savedFetch;

beforeEach(() => {
  events = [];
  window.localStorage.clear();
  mockAuth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok-1', user: { id: 'u-new' } } }, error: null });
  mockAuth.updateUser.mockReset();
  mockAuth.updateUser.mockImplementation(async () => {
    events.push('updateUser');
    return { data: { user: { id: 'u-new' } }, error: null };
  });
  mockAuth.refreshSession.mockReset();
  mockAuth.refreshSession.mockImplementation(async () => {
    events.push('refresh');
    const session = { access_token: 'tok-2', user: { id: 'u-new', app_metadata: {} } };
    return { data: { session, user: session.user }, error: null };
  });
  savedFetch = global.fetch;
  global.fetch = jest.fn(async () => {
    events.push('fetch');
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
});

afterEach(() => {
  cleanup();
  global.fetch = savedFetch;
});

async function fillAndSubmit() {
  const InvitePasswordForm = require('../../components/enterprise/InvitePasswordForm').default;
  const onDone = jest.fn(() => { events.push('onDone'); });
  render(React.createElement(InvitePasswordForm, { userId: 'u-new', email: 'new@example.com', onDone }));
  fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: GOOD } });
  fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: GOOD } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /set password/i })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return onDone;
}

describe('InvitePasswordForm marks the password as set on the server', () => {
  it('after a successful updateUser it POSTs with the Bearer token, refreshes the session, then calls onDone', async () => {
    await fillAndSubmit();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/account/password-set');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization || init.headers.authorization).toBe('Bearer tok-1');
    expect(events).toEqual(['updateUser', 'fetch', 'refresh', 'onDone']);
  });

  it.each([
    ['answers 500', async () => ({ ok: false, status: 500, json: async () => ({}) })],
    ['throws', async () => { throw new Error('Failed to fetch'); }],
  ])('when the call %s the form says the password is saved, does not go on, and never asks for it again', async (_name, impl) => {
    global.fetch.mockImplementation(impl);

    const onDone = await fillAndSubmit();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockAuth.updateUser).toHaveBeenCalledTimes(1);
    expect(mockAuth.refreshSession).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/password is saved/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
  });

  it('after a failed updateUser it makes no call and does not go on', async () => {
    mockAuth.updateUser.mockImplementation(async () => ({ data: { user: null }, error: { message: 'Password is too weak' } }));

    const onDone = await fillAndSubmit();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).not.toBe('');
  });
});
