/**
 * @jest-environment jsdom
 */

/**
 * The /setup page's Save (pages/setup.js): once the code has loaded the
 * settings, SetupForm's Save POSTs the edited answers to /api/setup/settings
 * with the same x-setup-code header, and the answer goes back to the form.
 * global fetch is a stand-in routed by method and URL; each save reply is
 * queued in order. The "full key" is a made-up string, not a real key shape.
 */

const React = require('react');
const { render, within, fireEvent, waitFor } = require('@testing-library/react');

const CODE = 'abcd-1234';
const FULL_KEY = 'FAKE-FULL-KEY-not-a-secret-0000-1111';
const SETTINGS = {
  ANTHROPIC_API_KEY: { set: true, source: 'file', value: 'FAKE…wxyz' },
  EMAIL_PROVIDER: { set: true, source: 'file', value: 'resend' },
  EMAIL_FROM: { set: true, source: 'file', value: 'sign@example.org' },
  NEXT_PUBLIC_APP_URL: { set: true, source: 'file', value: 'https://sign.example.org' },
};
const SAVED = {
  ...SETTINGS,
  ANTHROPIC_API_KEY: { set: true, source: 'file', value: 'FAKE…1111' },
};

function reply(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  };
}

function fakeFetch({ saves = [], state } = {}) {
  const queue = saves.slice();
  return jest.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    if (url === '/api/setup/settings' && method === 'GET') {
      return reply(200, { settings: SETTINGS });
    }
    if (url === '/api/setup/settings' && method === 'POST') {
      if (!queue.length) throw new Error('unexpected save');
      return queue.shift();
    }
    if (url === '/api/setup/state' && state) return state;
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

function inputNamed(container, name) {
  return container.querySelector(`input[name="${name}"]`);
}

async function openForm() {
  const SetupPage = loadPage();
  expect(typeof SetupPage).toBe('function');
  const { container } = render(React.createElement(SetupPage));
  const view = within(container);
  fireEvent.change(view.getByLabelText(/setup code/i), { target: { value: CODE } });
  fireEvent.click(view.getByRole('button', { name: /continue/i }));
  await waitFor(() => expect(inputNamed(container, 'NEXT_PUBLIC_APP_URL')).not.toBeNull());
  return { container, view };
}

function type(container, name, value) {
  fireEvent.change(inputNamed(container, name), { target: { value } });
}

function save(view) {
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
}

function postCalls() {
  return global.fetch.mock.calls.filter(([, init]) => init && init.method === 'POST');
}

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('setup page Save', () => {
  it('POSTs only the edited names as JSON with the same x-setup-code header', async () => {
    global.fetch = fakeFetch({ saves: [reply(200, { settings: SETTINGS })] });
    const { container, view } = await openForm();
    type(container, 'NEXT_PUBLIC_APP_URL', 'https://new.example.org');
    save(view);

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const [url, init] = postCalls()[0];
    expect(url).toBe('/api/setup/settings');
    expect(init.headers['x-setup-code']).toBe(CODE);
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ NEXT_PUBLIC_APP_URL: 'https://new.example.org' });
    await waitFor(() => expect(view.getByRole('button', { name: 'Save' }).disabled).toBe(false));
    expect(view.queryByText('Could not save, try again.')).toBeNull();
  });

  it('a 400 { errors } shows each message under its field', async () => {
    global.fetch = fakeFetch({
      saves: [
        reply(400, {
          errors: {
            NEXT_PUBLIC_APP_URL: 'Use a full address starting with https://.',
            EMAIL_FROM: 'That is not an email address.',
          },
        }),
      ],
    });
    const { container, view } = await openForm();
    type(container, 'NEXT_PUBLIC_APP_URL', 'not a url');
    type(container, 'EMAIL_FROM', 'nobody');
    save(view);

    await waitFor(() =>
      expect(view.getByText('Use a full address starting with https://.')).toBeTruthy(),
    );
    expect(inputNamed(container, 'NEXT_PUBLIC_APP_URL').getAttribute('aria-describedby')).toBe(
      'NEXT_PUBLIC_APP_URL-error',
    );
    expect(container.querySelector('#NEXT_PUBLIC_APP_URL-error').textContent).toBe(
      'Use a full address starting with https://.',
    );
    expect(container.querySelector('#EMAIL_FROM-error').textContent).toBe(
      'That is not an email address.',
    );
    expect(view.queryByText('Could not save, try again.')).toBeNull();
  });

  it('a 200 { settings } shows the new masks, empties key inputs, and no full key is on the page', async () => {
    global.fetch = fakeFetch({ saves: [reply(200, { settings: SAVED })] });
    const { container, view } = await openForm();
    type(container, 'ANTHROPIC_API_KEY', FULL_KEY);
    save(view);

    await waitFor(() => expect(view.getByText('Saved: FAKE…1111')).toBeTruthy());
    expect(view.queryByText('Saved: FAKE…wxyz')).toBeNull();
    expect(inputNamed(container, 'ANTHROPIC_API_KEY').value).toBe('');
    expect(inputNamed(container, 'RESEND_API_KEY').value).toBe('');
    expect(JSON.parse(postCalls()[0][1].body)).toEqual({ ANTHROPIC_API_KEY: FULL_KEY });
    expect(container.innerHTML).not.toContain(FULL_KEY);
    expect(container.textContent).not.toContain(FULL_KEY);
  });

  it('a 401 during save with { needed: false } swaps the form for the sign-in prompt', async () => {
    global.fetch = fakeFetch({
      saves: [reply(401, { error: 'That setup code is not right.' })],
      state: reply(200, { needed: false }),
    });
    const { container, view } = await openForm();
    type(container, 'ANTHROPIC_API_KEY', FULL_KEY);
    save(view);

    await waitFor(() =>
      expect(view.getByText(/Sign in as an admin to change settings/)).toBeTruthy(),
    );
    expect(inputNamed(container, 'NEXT_PUBLIC_APP_URL')).toBeNull();
    expect(inputNamed(container, 'ANTHROPIC_API_KEY')).toBeNull();
    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/enterprise/login');
    expect(container.innerHTML).not.toContain(FULL_KEY);
  });

  it('never writes the code to localStorage, sessionStorage or the URL while saving', async () => {
    global.fetch = fakeFetch({ saves: [reply(200, { settings: SAVED })] });
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    const hrefBefore = window.location.href;
    const { container, view } = await openForm();
    type(container, 'NEXT_PUBLIC_APP_URL', 'https://new.example.org');
    save(view);

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    await waitFor(() => expect(view.getByRole('button', { name: 'Save' }).disabled).toBe(false));
    for (const call of setItem.mock.calls) {
      expect(String(call[0])).not.toContain(CODE);
      expect(String(call[1])).not.toContain(CODE);
    }
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) {
        expect(store.getItem(store.key(i))).not.toContain(CODE);
      }
    }
    expect(window.location.href).toBe(hrefBefore);
    expect(window.location.href).not.toContain(CODE);
    for (const [url, init] of global.fetch.mock.calls) {
      expect(url).not.toContain(CODE);
      if (init && init.body) expect(init.body).not.toContain(CODE);
    }
    setItem.mockRestore();
  });
});
