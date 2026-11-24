/**
 * @jest-environment jsdom
 */

/**
 * The first admin on a fresh install (pages/setup.js with
 * components/SetupFirstAdmin.js): the code box says where the setup code is,
 * a right code shows the first-admin email and password fields, and creating
 * the admin POSTs /api/setup/admin with the same x-setup-code. After a 201
 * the page says 'Setup is done. Sign in as <email>' and links to the login.
 * global fetch is a stand-in routed by method and URL; /api/setup/state says
 * setup is needed.
 */

const React = require('react');
const { render, within, fireEvent, waitFor } = require('@testing-library/react');

const CODE = 'abcd-1234';
const EMAIL = 'owner@example.org';
const PASSWORD = 'a long test password 42';
const REFUSED = 'The setup code is missing or wrong.';
const WEAK = 'Use a password of at least 12 characters.';
const SETTINGS = {
  ANTHROPIC_API_KEY: { set: false, source: null, value: '' },
  EMAIL_PROVIDER: { set: false, source: null, value: '' },
  EMAIL_FROM: { set: false, source: null, value: '' },
  NEXT_PUBLIC_APP_URL: { set: false, source: null, value: '' },
};

function reply(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  };
}

function fakeFetch({ settings = reply(200, { settings: SETTINGS }), admin } = {}) {
  return jest.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    if (url === '/api/setup/state' && method === 'GET') return reply(200, { needed: true });
    if (url === '/api/setup/settings' && method === 'GET') return settings;
    if (url === '/api/setup/admin' && method === 'POST' && admin) return admin;
    throw new Error(`unexpected fetch ${method} ${url}`);
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

function submitCode(view, code) {
  fireEvent.change(view.getByLabelText(/setup code/i), { target: { value: code } });
  fireEvent.click(view.getByRole('button', { name: /continue/i }));
}

async function openAdmin() {
  const page = renderPage();
  submitCode(page.view, CODE);
  await waitFor(() => expect(page.view.queryByLabelText(/admin email/i)).not.toBeNull());
  return page;
}

function createAdmin(view) {
  fireEvent.change(view.getByLabelText(/admin email/i), { target: { value: EMAIL } });
  fireEvent.change(view.getByLabelText(/admin password/i), { target: { value: PASSWORD } });
  fireEvent.click(view.getByRole('button', { name: /create admin/i }));
}

function adminCalls() {
  return global.fetch.mock.calls.filter(([url]) => url === '/api/setup/admin');
}

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
});

describe('setup page first admin', () => {
  it('asks for the setup code first and says where to find it, with no admin fields', () => {
    global.fetch = fakeFetch();
    const { view } = renderPage();
    expect(view.getByLabelText(/setup code/i)).toBeTruthy();
    expect(
      view.getByText(/in the server log, or the file \.cosign\/setup-code on the host/),
    ).toBeTruthy();
    expect(view.queryByLabelText(/admin email/i)).toBeNull();
    expect(view.queryByLabelText(/admin password/i)).toBeNull();
  });

  it('a right code shows the first-admin email and password fields', async () => {
    global.fetch = fakeFetch();
    const { view } = await openAdmin();
    expect(view.getByLabelText(/admin email/i).getAttribute('type')).toBe('email');
    expect(view.getByLabelText(/admin password/i).getAttribute('type')).toBe('password');
    const [url, init] = global.fetch.mock.calls.find(([u]) => u === '/api/setup/settings');
    expect(url).toBe('/api/setup/settings');
    expect(init.headers['x-setup-code']).toBe(CODE);
  });

  it('a wrong code shows the API message and no admin fields, then the right code shows them', async () => {
    const answers = [reply(401, { error: REFUSED }), reply(200, { settings: SETTINGS })];
    const inner = fakeFetch();
    global.fetch = jest.fn(async (url, init = {}) =>
      url === '/api/setup/settings' ? answers.shift() : inner(url, init),
    );
    const { view } = renderPage();
    submitCode(view, 'wrong-code');
    await waitFor(() => expect(view.getByText(REFUSED)).toBeTruthy());
    expect(view.queryByLabelText(/admin email/i)).toBeNull();

    submitCode(view, CODE);
    await waitFor(() => expect(view.queryByLabelText(/admin email/i)).not.toBeNull());
    const codes = global.fetch.mock.calls
      .filter(([url]) => url === '/api/setup/settings')
      .map(([, init]) => init.headers['x-setup-code']);
    expect(codes).toEqual(['wrong-code', CODE]);
  });

  it('creating the admin POSTs email and password with the code in x-setup-code', async () => {
    global.fetch = fakeFetch({ admin: reply(201, { email: EMAIL }) });
    const { view } = await openAdmin();
    createAdmin(view);
    await waitFor(() => expect(adminCalls()).toHaveLength(1));
    const [url, init] = adminCalls()[0];
    expect(url).toBe('/api/setup/admin');
    expect(url).not.toContain(CODE);
    expect(init.method).toBe('POST');
    expect(init.headers['x-setup-code']).toBe(CODE);
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it('after a 201 it says setup is done, names the email and links to the login', async () => {
    global.fetch = fakeFetch({ admin: reply(201, { email: EMAIL }) });
    const { container, view } = await openAdmin();
    createAdmin(view);
    await waitFor(() =>
      expect(view.getByText(`Setup is done. Sign in as ${EMAIL}`, { exact: false })).toBeTruthy(),
    );
    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/enterprise/login');
    expect(view.queryByLabelText(/admin password/i)).toBeNull();
  });

  it('a refused admin shows the API message and keeps the fields', async () => {
    global.fetch = fakeFetch({ admin: reply(400, { error: WEAK }) });
    const { view } = await openAdmin();
    createAdmin(view);
    await waitFor(() => expect(view.getByText(WEAK)).toBeTruthy());
    expect(view.getByLabelText(/admin email/i).value).toBe(EMAIL);
    expect(view.queryByText(/Setup is done/)).toBeNull();
  });
});
