/**
 * '/' goes to the enterprise sign-in once first-run setup is done, and to
 * /setup on a fresh install. pages/index.js getServerSideProps decides with
 * lib/setupLock.js setupNeeded(process.env, { cwd: process.cwd() }); each test
 * points the working folder at an empty temp folder (nothing saved there).
 * middleware() must let '/' through to that page instead of sending it to /en/.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_KEYS = ['ADMIN_DASHBOARD_EMAILS', 'NEXT_PUBLIC_OWNER_EMAILS', 'VERCEL'];
let saved;
let cwd;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cosign-home-'));
  jest.resetModules();
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(cwd, { recursive: true, force: true });
});

async function homeRedirect() {
  const { getServerSideProps } = require('../../pages/index');
  jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  const result = await getServerSideProps({ req: {}, res: {}, query: {}, resolvedUrl: '/' });
  return result.redirect;
}

describe("pages/index.js: where '/' goes", () => {
  it('goes to /enterprise/login once setup is done (owner list in env)', async () => {
    process.env.NEXT_PUBLIC_OWNER_EMAILS = 'owner@example.com';
    expect(await homeRedirect()).toEqual({ destination: '/enterprise/login', permanent: false });
  });

  it('goes to /enterprise/login once setup is done (owner list saved by setup)', async () => {
    fs.mkdirSync(path.join(cwd, '.cosign'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.cosign', 'settings.json'),
      JSON.stringify({ ADMIN_DASHBOARD_EMAILS: 'owner@example.com' }),
    );
    expect(await homeRedirect()).toEqual({ destination: '/enterprise/login', permanent: false });
  });

  it('goes to /setup on a fresh install', async () => {
    expect(await homeRedirect()).toEqual({ destination: '/setup', permanent: false });
  });
});

describe("middleware and '/'", () => {
  it("does not send '/' to a locale, so the page above decides", async () => {
    const { NextRequest } = require('next/server');
    const { middleware } = require('../../middleware');
    const res = await middleware(new NextRequest(new URL('/', 'http://localhost:3000')));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
