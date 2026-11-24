/**
 * @jest-environment jsdom
 */

/**
 * The /setup page (pages/setup.js): a setup code box first; submitting a code
 * loads the settings through lib/setupClient.js (GET /api/setup/settings with
 * x-setup-code) and shows SetupForm, or the right message by the code box.
 * global fetch is a stand-in routed by URL.
 */

const React = require('react');
const { render, within, fireEvent, waitFor } = require('@testing-library/react');

const CODE = 'abcd-1234';
const REFUSED = 'That setup code is not right.';
const BROKEN = 'Settings file could not be read.';
const SETTINGS = {
  ANTHROPIC_API_KEY: { set: true, source: 'file', value: 'test…wxyz' },
  EMAIL_PROVIDER: { set: true, source: 'file', value: 'resend' },
  EMAIL_FROM: { set: true, source: 'file', value: 'sign@example.org' },
  NEXT_PUBLIC_APP_URL: { set: true, source: 'file', value: 'https://sign.example.org' },
};

function reply(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  };
}

function routedFetch(routes) {
  return jest.fn(async (url) => {
    const answer = routes[url];
    if (!answer) throw new Error(`unexpected fetch ${url}`);
    return answer;
  });
}

function loadPage() {
  try {
    const mod = require('../../pages/setup');
    return mod && mod.default ? mod.default : mod;
  } catch {
    return null;
  }
}

function renderPage() {
  const SetupPage = loadPage();
  expect(typeof SetupPage).toBe('function');
  const { container } = render(React.createElement(SetupPage));
  return { container, view: within(container) };
}

function codeBox(view) {
  return view.getByLabelText(/setup code/i);
}

function submitCode(view, code) {
  fireEvent.change(codeBox(view), { target: { value: code } });
  fireEvent.click(view.getByRole('button', { name: /continue/i }));
}

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('setup page', () => {
  it('shows a setup code box first and no form', () => {
    global.fetch = routedFetch({});
    const { container, view } = renderPage();
    expect(codeBox(view)).toBeTruthy();
    expect(container.querySelector('input[name="NEXT_PUBLIC_APP_URL"]')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('loads the settings with the code in x-setup-code and shows SetupForm with them', async () => {
    global.fetch = routedFetch({ '/api/setup/settings': reply(200, { settings: SETTINGS }) });
    const { container, view } = renderPage();
    submitCode(view, CODE);

    await waitFor(() =>
      expect(container.querySelector('input[name="NEXT_PUBLIC_APP_URL"]')).not.toBeNull(),
    );
    expect(container.querySelector('input[name="NEXT_PUBLIC_APP_URL"]').value).toBe(
      'https://sign.example.org',
    );
    expect(view.getByText('Saved: test…wxyz')).toBeTruthy();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/setup/settings');
    expect(init.method).toBe('GET');
    expect(init.headers['x-setup-code']).toBe(CODE);
  });

  it('a refused code while setup is needed shows the API error by the code box and no form', async () => {
    global.fetch = routedFetch({
      '/api/setup/settings': reply(401, { error: REFUSED }),
      '/api/setup/state': reply(200, { needed: true }),
    });
    const { container, view } = renderPage();
    submitCode(view, 'wrong-code');

    await waitFor(() => expect(view.getByText(REFUSED)).toBeTruthy());
    expect(codeBox(view)).toBeTruthy();
    expect(container.querySelector('input[name="NEXT_PUBLIC_APP_URL"]')).toBeNull();
  });

  it('a refused code after setup asks to sign in as an admin, links to login, no form', async () => {
    global.fetch = routedFetch({
      '/api/setup/settings': reply(401, { error: REFUSED }),
      '/api/setup/state': reply(200, { needed: false }),
    });
    const { container, view } = renderPage();
    submitCode(view, CODE);

    await waitFor(() =>
      expect(view.getByText(/Sign in as an admin to change settings/)).toBeTruthy(),
    );
    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/enterprise/login');
    expect(container.querySelector('input[name="NEXT_PUBLIC_APP_URL"]')).toBeNull();
  });

  it('a 500 shows the API error text and no form', async () => {
    global.fetch = routedFetch({ '/api/setup/settings': reply(500, { error: BROKEN }) });
    const { container, view } = renderPage();
    submitCode(view, CODE);

    await waitFor(() => expect(view.getByText(BROKEN)).toBeTruthy());
    expect(container.querySelector('input[name="NEXT_PUBLIC_APP_URL"]')).toBeNull();
  });

  it('never writes the code to localStorage, sessionStorage or the URL', async () => {
    global.fetch = routedFetch({ '/api/setup/settings': reply(200, { settings: SETTINGS }) });
    const localSet = jest.spyOn(Storage.prototype, 'setItem');
    const hrefBefore = window.location.href;
    const { container, view } = renderPage();
    submitCode(view, CODE);

    await waitFor(() =>
      expect(container.querySelector('input[name="NEXT_PUBLIC_APP_URL"]')).not.toBeNull(),
    );
    for (const call of localSet.mock.calls) {
      expect(String(call[1])).not.toContain(CODE);
    }
    for (let i = 0; i < window.localStorage.length; i += 1) {
      expect(window.localStorage.getItem(window.localStorage.key(i))).not.toContain(CODE);
    }
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      expect(window.sessionStorage.getItem(window.sessionStorage.key(i))).not.toContain(CODE);
    }
    expect(window.location.href).toBe(hrefBefore);
    expect(window.location.href).not.toContain(CODE);
    const [url] = global.fetch.mock.calls[0];
    expect(url).not.toContain(CODE);
    localSet.mockRestore();
  });
});
