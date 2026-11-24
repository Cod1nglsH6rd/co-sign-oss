/**
 * @jest-environment node
 */

/**
 * The invite password step on the server (2026-11-21): there is no window, so
 * the URL fragment is not read when lib/supabaseClient.js loads, the
 * localStorage entry counts as absent, and /enterprise/login renders the
 * ordinary sign-in form; the first browser render then matches it.
 */

const React = require('react');
const { renderToString } = require('react-dom/server');

jest.mock('next/router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), pathname: '/enterprise/login', asPath: '/enterprise/login', query: {} }),
}));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
jest.mock('next/link', () => {
  const ReactInMock = require('react');
  return { __esModule: true, default: ({ href, children, ...rest }) => ReactInMock.createElement('a', { href, ...rest }, children) };
});

describe('the invite password step without a window', () => {
  it('reads no return type at load', () => {
    expect(typeof window).toBe('undefined');
    expect(require('../../lib/supabaseClient').urlAuthType()).toBeNull();
  });

  it('treats the entry as absent and never throws', () => {
    const lib = require('../../lib/invitePassword');
    expect(() => lib.clearPasswordPending()).not.toThrow();
    expect(lib.isPasswordPending('u-new')).toBe(false);
  });

  it('renders the ordinary sign-in page', () => {
    const html = renderToString(React.createElement(require('../../pages/enterprise/login').default));
    expect(html).toContain('Enterprise Login');
    expect(html).not.toContain('Choose a password');
  });
});
