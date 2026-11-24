/**
 * lib/postLoginPath.js getPostLoginPath(email): where /enterprise/login sends
 * someone after sign-in. Everyone, owners included, lands on All Documents.
 */

const OWNER = 'owner@example.com';
let saved;

beforeEach(() => {
  saved = {
    NEXT_PUBLIC_OWNER_EMAILS: process.env.NEXT_PUBLIC_OWNER_EMAILS,
    NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS: process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS,
  };
  process.env.NEXT_PUBLIC_OWNER_EMAILS = OWNER;
  delete process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS;
  jest.resetModules();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function postLoginPath(email) {
  return require('../../lib/postLoginPath').getPostLoginPath(email);
}

describe('getPostLoginPath', () => {
  it('sends an owner to /enterprise/documents', () => {
    expect(postLoginPath(OWNER)).toBe('/enterprise/documents');
  });

  it('sends an owner typed in another case to /enterprise/documents', () => {
    expect(postLoginPath('Owner@Example.com')).toBe('/enterprise/documents');
  });

  it('sends staff who are not owners to /enterprise/documents', () => {
    expect(postLoginPath('staff@example.com')).toBe('/enterprise/documents');
  });

  it('sends a session with no email to /enterprise/documents', () => {
    expect(postLoginPath(undefined)).toBe('/enterprise/documents');
  });
});
