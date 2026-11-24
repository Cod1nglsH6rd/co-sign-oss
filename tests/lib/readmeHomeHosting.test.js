/**
 * Run it at home (co-sign-298): README.md has a '### Run it at home' section
 * that gives the one command, the address, the named volumes that hold the
 * data (read from docker-compose.yml, so the README matches the compose
 * file), how `docker compose down -v` deletes them, how each adapter is
 * turned on, that AI needs ANTHROPIC_API_KEY and that parked OCR jobs
 * resume after a restart. The Status section points to it, so Vercel is no
 * longer the only way it runs.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// Collapse line breaks and runs of spaces so wrapping does not matter.
function flat(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// The body of the first '### ' section whose heading starts with `prefix`.
function readmeSection(prefix) {
  const lines = read('README.md').split('\n');
  const start = lines.findIndex((l) => l.startsWith(prefix));
  expect(start).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((l) => /^#{1,3} /.test(l));
  return flat((next === -1 ? rest : rest.slice(0, next)).join('\n'));
}

// Names under the top-level `volumes:` key of docker-compose.yml.
function composeVolumeNames() {
  const lines = read('docker-compose.yml').split('\n');
  const start = lines.findIndex((l) => /^volumes:\s*$/.test(l));
  expect(start).toBeGreaterThan(-1);
  const names = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = line.match(/^ {2}([A-Za-z0-9_.-]+):/);
    if (m) names.push(m[1]);
  }
  return names;
}

describe('README: Run it at home', () => {
  test('gives the one command and says no account or .env is needed', () => {
    const section = readmeSection('### Run it at home');
    expect(section).toContain('docker compose up');
    expect(section).toMatch(/no account/i);
    expect(section).toContain('.env');
  });

  test('gives the address', () => {
    expect(readmeSection('### Run it at home')).toContain('http://localhost:3000');
  });

  test('names every volume from docker-compose.yml and how to delete them', () => {
    const names = composeVolumeNames();
    expect(names).toEqual(expect.arrayContaining(['db-data', 'storage-data']));
    const section = readmeSection('### Run it at home');
    for (const name of names) {
      expect(section).toContain(name);
    }
    expect(section).toContain('docker compose down -v');
  });

  test('says how to turn each adapter on', () => {
    const section = readmeSection('### Run it at home');
    for (const word of [
      'Supabase cloud',
      'SUPABASE_URL',
      'Sentry',
      'SENTRY_DSN',
      'Resend',
      'RESEND_API_KEY',
      'Upstash',
      'UPSTASH_REDIS_REST_URL',
      'Vercel',
    ]) {
      expect(section).toContain(word);
    }
  });

  test('says AI needs ANTHROPIC_API_KEY and parked OCR jobs resume after a restart', () => {
    const section = readmeSection('### Run it at home');
    expect(section).toContain('ANTHROPIC_API_KEY');
    expect(section).toMatch(/parked OCR jobs/i);
    expect(section).toMatch(/restart/i);
    expect(section).toMatch(/stale/i);
  });

  // 2026-11-21: the gateway publishes on 127.0.0.1 by
  // default and the database password is made on first start.
  test('says the port is on this machine only, and what COSIGN_BIND=0.0.0.0 exposes', () => {
    const section = readmeSection('### Run it at home');
    expect(section).toContain('COSIGN_BIND');
    expect(section).toContain('127.0.0.1');
    expect(section).toContain('0.0.0.0');
    expect(section).toMatch(/plain HTTP/);
    expect(section).toContain('COSIGN_TRUSTED_PROXY_HOPS');
  });

  test('says the database password is made on first start, and what an older install runs once', () => {
    const section = readmeSection('### Run it at home');
    expect(section).toMatch(/database password/i);
    expect(section).toContain('docker compose up -d db');
    expect(section).toContain('scripts/docker/set-db-password.js');
    expect(section).toContain('OLD_DB_PASSWORD');
    expect(fs.existsSync(path.join(root, 'scripts', 'docker', 'set-db-password.js'))).toBe(true);
  });

  // 2026-11-21: the browser asks the server who is an owner (GET
  // /api/admin/me), so the admin made at /setup gets Owner Usage at home, and
  // an invitation that could not be mailed gives the owner a link to copy.
  test('says how the owner adds a person at home and copies the invite link, and no longer calls the owner page closed', () => {
    const section = readmeSection('### Run it at home');
    expect(section).toContain('Owner Usage');
    expect(section).toContain('/api/admin/me');
    expect(section).toMatch(/invite link/i);
    expect(section).toMatch(/Copy button/);
    expect(section).not.toMatch(/closed to everyone/i);
    expect(section).not.toMatch(/browser's owner list/i);
    expect(read('pages/api/admin/users.js')).toContain('inviteLink');
    expect(read('pages/enterprise/owner.js')).toContain('handleCopyLink');
  });

  // 2026-11-21: the auth service's addresses follow COSIGN_SITE_URL (default
  // http://localhost:<COSIGN_PORT>), so an invite link opens at the owner's
  // address from any machine that reaches it.
  test('names COSIGN_SITE_URL where it opens the app to other machines, and says where the invite link opens with and without it', () => {
    const section = readmeSection('### Run it at home');
    const bullet = (title) => {
      const start = section.indexOf(`- **${title}`);
      expect([title, start]).not.toEqual([title, -1]);
      const end = section.indexOf(' - **', start + 1);
      return end === -1 ? section.slice(start) : section.slice(start, end);
    };

    const address = bullet('Address:');
    for (const word of ['COSIGN_SITE_URL', 'COSIGN_BIND', 'COSIGN_TRUSTED_PROXY_HOPS', 'NEXT_PUBLIC_APP_URL', '/setup']) {
      expect([word, address.includes(word)]).toEqual([word, true]);
    }
    expect(address).toMatch(/wins over/);

    const invite = bullet('What the invite link does.');
    expect(invite).toContain('COSIGN_SITE_URL');
    expect(invite).toContain('API_EXTERNAL_URL');
    expect(invite).toContain('GOTRUE_URI_ALLOW_LIST');
    expect(invite).toContain('http://localhost:3000/auth/v1');
    expect(invite).toMatch(/any machine that can reach it/);
    // 2026-11-21: the sign-in page asks the invited person to choose a
    // password; the README says so, that it is untried on a real stack, and
    // the gap that stays (no new link for an account that already exists).
    expect(invite).not.toMatch(/Nothing on that path asks them to choose a password/);
    expect(invite).toMatch(/asks them to choose a password/);
    expect(invite).toContain('components/enterprise/InvitePasswordForm.js');
    expect(invite).toMatch(/no new link/);
    // 2026-11-21: the end-to-end job now runs the invite on the Docker stack;
    // the README names what it runs, and where (mail off, no
    // COSIGN_SITE_URL, a browser on the same machine), no longer 'untried'.
    expect(invite).not.toMatch(/not yet tried on a real stack/);
    expect(invite).toContain('tests/e2e/inviteFlow.e2e.js');
    expect(invite).toMatch(/runs this on the Docker stack with mail off and `COSIGN_SITE_URL` not set, in a browser on the same machine/);
    expect(invite).toMatch(/sign in with that password with no form/);
    expect(invite).toMatch(/added again, gets no link/);
    expect(invite).toContain('GOTRUE_MAILER_URLPATHS_');
    expect(read('tests/e2e/mainFlow.e2e.js')).toContain('inviteSteps');
    // 2026-11-21: the step also follows a mark on the account, which the
    // session carries, so it is no longer kept only in one browser.
    expect(invite).toMatch(/send them back to it in any browser where they are signed in/);
    expect(invite).not.toMatch(/send them back to it in that browser/);
    expect(read('pages/enterprise/login.js')).toContain('InvitePasswordForm');
    expect(invite).not.toMatch(/as the stack ships it opens only in a browser on this machine/);

    const docker = readmeSection('### Deployment');
    expect(docker).toContain('COSIGN_SITE_URL');
  });

  // 2026-11-21: what an Admin may do, as the code gates it and the end-to-end
  // run shows (tests/e2e/adminRole.e2e.js).
  test('says what an Admin may do beyond a Member, and that neither role is an owner', () => {
    const section = readmeSection('### Run it at home');
    const start = section.indexOf('- **Member or Admin.**');
    expect(start).toBeGreaterThan(-1);
    const bullet = section.slice(start, section.indexOf(' - **', start + 1));
    expect(bullet).toContain('/api/account/update');
    expect(bullet).toContain('/api/enterprise/org-settings');
    expect(bullet).toMatch(/a Member is refused both/);
    expect(bullet).toMatch(/Neither role makes someone an owner/);
    expect(bullet).toMatch(/an Admin gets no Owner Usage/);
    expect(read('pages/api/account/update.js')).toContain("role !== 'admin' && role !== 'owner'");
    expect(read('pages/api/enterprise/org-settings.js')).toContain("['admin', 'owner'].includes(role)");
    expect(read('pages/api/admin/users.js')).toContain('isOwnerEmail(user.email, getServerOwnerEmails())');
    expect(read('tests/e2e/adminRole.e2e.js')).toContain('adminSteps');
  });

  test('the Status section points to running it at home', () => {
    const status = readmeSection('### Status');
    expect(status).toContain('docker compose up');
    expect(status).toContain('Run it at home');
  });
});
