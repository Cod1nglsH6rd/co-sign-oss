/**
 * First-run setup in the README (co-sign-355): 'Run it at home' has a
 * '#### First-run setup' part that says how a fresh install sends you to
 * /setup, where the setup code is, what the form asks, that answers are
 * checked live (10 s limit) before saving, how keys are kept and shown,
 * that a host setting wins over a saved one, what 'No mail' means, that
 * changes need an admin sign-in after the first admin, and that
 * `docker compose down -v` deletes the saved settings.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function readme() {
  return fs.readFileSync(path.join(root, 'README.md'), 'utf8');
}

// Collapse line breaks and runs of spaces so wrapping does not matter.
function flat(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// Body after the first line starting with `heading`, up to the next heading
// of level `maxLevel` or higher (fewer #).
function part(lines, heading, maxLevel) {
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const stop = new RegExp(`^#{1,${maxLevel}} `);
  const next = rest.findIndex((l) => stop.test(l));
  return next === -1 ? rest : rest.slice(0, next);
}

function firstRunSetup() {
  const home = part(readme().split('\n'), '### Run it at home', 3);
  expect(home).not.toBeNull();
  const setup = part(home, '#### First-run setup', 4);
  expect(setup).not.toBeNull();
  return flat(setup.join('\n'));
}

describe("README: Run it at home, 'First-run setup'", () => {
  test('is a part of Run it at home', () => {
    firstRunSetup();
  });

  test('says opening the address sends you to /setup', () => {
    const text = firstRunSetup();
    expect(text).toContain('http://localhost:3000');
    expect(text).toMatch(/sent to `?\/setup`?/i);
  });

  test('says where the setup code is', () => {
    const text = firstRunSetup();
    expect(text).toContain('docker compose logs app');
    expect(text).toContain('.cosign/setup-code');
  });

  test('says what it asks', () => {
    const text = firstRunSetup();
    for (const word of ['Anthropic API key', 'Resend', 'From address', 'Site address', 'First admin']) {
      expect(text).toContain(word);
    }
  });

  test('says each answer is checked live before saving, with a 10 s limit', () => {
    const text = firstRunSetup();
    expect(text).toMatch(/checked live/i);
    expect(text).toMatch(/before (it is )?sav/i);
    expect(text).toMatch(/10 (s|seconds)\b/);
  });

  test('says keys are saved on the settings volume, masked, never logged or returned', () => {
    const text = firstRunSetup();
    expect(text).toMatch(/`?settings`? volume/);
    expect(text).toMatch(/mask/i);
    expect(text).toMatch(/last 4/);
    expect(text).toMatch(/never logged/i);
    expect(text).toMatch(/returned/i);
  });

  test("says a host environment value wins and shows as 'Set on the host'", () => {
    const text = firstRunSetup();
    expect(text).toMatch(/host environment/i);
    expect(text).toMatch(/wins/i);
    expect(text).toContain('Set on the host');
  });

  test("says 'No mail' means you copy the signing link", () => {
    const text = firstRunSetup();
    expect(text).toContain('No mail');
    expect(text).toMatch(/copy the signing link/i);
  });

  // 2026-11-21: an owner's, not any admin's: lib/setupAccess.js refuses a
  // signed-in user who is not on the owner list, and the end-to-end run
  // shows an Admin refused (tests/e2e/adminRole.e2e.js). The README also says
  // the page sends no session, so it opens the settings for no one after setup.
  test("says changes need an owner's sign-in after the first admin, and that the page does not send one", () => {
    const text = firstRunSetup();
    expect(text).toMatch(/after the first admin/i);
    expect(text).toMatch(/owner's sign-in/i);
    expect(text).toMatch(/refuses an Admin/);
    expect(text).toMatch(/sends only the setup code, never a session/);
    const access = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'setupAccess.js'), 'utf8');
    expect(access).toContain("'Only an owner can change settings.'");
    const client = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'setupClient.js'), 'utf8');
    expect(client).not.toMatch(/Authorization/);
  });

  test('says docker compose down -v also deletes the saved settings', () => {
    const text = firstRunSetup();
    expect(text).toContain('docker compose down -v');
    expect(text).toMatch(/saved settings/i);
  });
});
