/**
 * @jest-environment jsdom
 */

/**
 * The enterprise sidebar (components/enterprise/EnterpriseLayout.js) shows the
 * main path only: Send Links and All Documents, plus Owner Usage for owners.
 * Dashboard, Recipients and Templates are not in it, but their pages stay.
 * Rendered on the server; the owner case is also rendered in the browser,
 * where GET /api/admin/me answers. The profile menu, onboarding guide, router,
 * next/link and the Supabase session are replaced by plain stand-ins.
 */

const fs = require('fs');
const path = require('path');
const { render, act } = require('@testing-library/react');

// Under jsdom react-dom/server loads its browser build, which needs TextEncoder.
global.TextEncoder = global.TextEncoder || require('util').TextEncoder;

jest.mock('next/router', () => ({
  useRouter: () => ({ asPath: '/enterprise/documents', pathname: '/enterprise/documents', query: {}, push() {}, replace() {} }),
}));
jest.mock('next/link', () => {
  const ReactInMock = require('react');
  return {
    __esModule: true,
    default: function LinkStub({ href, children, ...rest }) {
      return ReactInMock.createElement('a', { href, ...rest }, children);
    },
  };
});
jest.mock('../../components/EnterpriseProfileMenu', () => ({ __esModule: true, default: () => null }));
jest.mock('../../components/enterprise/OnboardingGuide', () => ({ __esModule: true, default: () => null }));
jest.mock('../../lib/supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));

const OWNER = 'owner@example.com';
let saved;

beforeEach(() => {
  saved = {
    NEXT_PUBLIC_OWNER_EMAILS: process.env.NEXT_PUBLIC_OWNER_EMAILS,
    NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS: process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS,
  };
  process.env.NEXT_PUBLIC_OWNER_EMAILS = OWNER;
  delete process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// The href of every link inside the sidebar's <nav>, sorted.
function sidebarLinks(email) {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const EnterpriseLayout = require('../../components/enterprise/EnterpriseLayout').default;
  const html = renderToStaticMarkup(
    React.createElement(
      EnterpriseLayout,
      { user: { email }, counts: { documents: 3, recipients: 2, templates: 1 } },
      'page',
    ),
  );
  const nav = html.match(/<nav class="[^"]*\bent-sidebar-nav\b[^"]*">([\s\S]*?)<\/nav>/);
  expect(nav).not.toBeNull();
  return [...nav[1].matchAll(/href="([^"]*)"/g)].map((m) => m[1]).sort();
}

describe('enterprise sidebar: main path only', () => {
  it('shows Send Links and All Documents to staff who are not owners', () => {
    expect(sidebarLinks('staff@example.com')).toEqual(['/enterprise/documents', '/enterprise/send-links']);
  });

  // issue #487: Owner Usage follows GET /api/admin/me, not the build-time list (which names OWNER here).
  it.each([
    ['answers owner: true', () => Promise.resolve({ ok: true, status: 200, json: async () => ({ owner: true }) }), true],
    ['answers owner: false', () => Promise.resolve({ ok: true, status: 200, json: async () => ({ owner: false }) }), false],
    ['fails with a 500', () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'x' }) }), false],
    ['cannot be reached', () => Promise.reject(new Error('offline')), false],
  ])('adds Owner Usage for an owner only when the route %s', async (_name, answer, shown) => {
    const mainPath = ['/enterprise/documents', '/enterprise/send-links'];
    // Rendered on the server the route has not answered yet: no owner entry.
    expect(sidebarLinks(OWNER)).toEqual(mainPath);

    const savedFetch = global.fetch;
    global.fetch = jest.fn(answer);
    try {
      const React = require('react');
      const EnterpriseLayout = require('../../components/enterprise/EnterpriseLayout').default;
      const { container } = render(React.createElement(EnterpriseLayout, { user: { email: OWNER }, counts: {} }, 'page'));
      await act(() => new Promise((resolve) => { setTimeout(resolve, 0); }));
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/me', expect.anything());
      const links = [...container.querySelectorAll('nav.ent-sidebar-nav a[href]')].map((a) => a.getAttribute('href')).sort();
      expect(links).toEqual(shown ? ['/enterprise/documents', '/enterprise/owner', '/enterprise/send-links'] : mainPath);
    } finally {
      global.fetch = savedFetch;
    }
  });

  it('leaves Dashboard, Recipients and Templates out of the sidebar but keeps their pages', () => {
    const links = sidebarLinks(OWNER);
    for (const page of ['admin', 'recipients', 'templates']) {
      expect(links).not.toContain(`/enterprise/${page}`);
      expect(fs.existsSync(path.join(__dirname, '../../pages/enterprise', `${page}.js`))).toBe(true);
    }
  });
});
