/**
 * Retention at home needs a scheduled call (release review T16, 2026-11-21).
 * The README said retention "runs daily", but only vercel.json schedules
 * /api/cron/retention; in the Docker stack nothing calls it, so completed
 * signings were kept for ever. The README now says retention runs only where
 * something calls the route with CRON_SECRET and gives a host cron line and a
 * systemd timer for the Docker stack; .env.example's CRON_SECRET line says the
 * same.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function flat(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// Body after the first line starting with `heading`, up to the next heading of
// level `maxLevel` or higher.
function part(lines, heading, maxLevel) {
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((l) => new RegExp(`^#{1,${maxLevel}} `).test(l));
  return next === -1 ? rest : rest.slice(0, next);
}

function retentionPart() {
  const home = part(read('README.md').split('\n'), '### Run it at home', 3);
  expect(home).not.toBeNull();
  const retention = part(home, '#### Retention', 4);
  expect(retention).not.toBeNull();
  return retention.join('\n');
}

describe("README: Run it at home, 'Retention'", () => {
  test('says retention runs only where something calls the route with CRON_SECRET', () => {
    const text = flat(retentionPart());
    expect(text).toContain('/api/cron/retention');
    expect(text).toContain('CRON_SECRET');
    expect(text).toMatch(/runs only where something calls `\/api\/cron\/retention`/);
    expect(text).toMatch(/nothing in the Docker stack calls it/i);
  });

  test('says how CRON_SECRET reaches the app service', () => {
    const text = flat(retentionPart());
    expect(text).toContain('docker-compose.override.yml');
    expect(text).toMatch(/services: app: environment:/);
  });

  test('keeps the secret in a header file, never on a command line', () => {
    const text = retentionPart();
    expect(text).toContain('Authorization: Bearer');
    expect(text).toContain('/etc/cosign/retention-header');
    expect(text).not.toMatch(/\$\(cat /);
  });

  test('gives a host cron line that calls the route with that header file', () => {
    const cron = retentionPart()
      .split('\n')
      .find((l) => /^\s*\d+ \d+ \* \* \* /.test(l));
    expect(cron).toBeDefined();
    expect(cron).toContain('/api/cron/retention');
    expect(cron).toContain('-H @/etc/cosign/retention-header');
  });

  test('gives a systemd service and timer', () => {
    const text = retentionPart();
    expect(text).toContain('[Service]');
    expect(text).toMatch(/ExecStart=.*\/api\/cron\/retention/);
    expect(text).toContain('[Timer]');
    expect(text).toMatch(/OnCalendar=/);
    expect(text).toContain('systemctl enable --now');
  });

  test('the route accepts the secret as a Bearer token, and answers 503 without one', () => {
    const route = read('pages/api/cron/retention.js');
    expect(route).toContain('process.env.CRON_SECRET');
    expect(route).toContain("replace('Bearer ', '')");
    expect(route).toContain('503');
  });

  test('no README line says retention runs daily on its own', () => {
    const lines = read('README.md').split('\n').filter((l) => /retention/i.test(l) && /runs daily/i.test(l));
    expect(lines).toEqual([]);
  });
});

describe(".env.example: CRON_SECRET's line", () => {
  test('says retention runs only where something calls the route', () => {
    const lines = read('.env.example').split('\n');
    const at = lines.findIndex((l) => /^CRON_SECRET=/.test(l));
    expect(at).toBeGreaterThan(0);
    const comment = lines[at - 1];
    expect(comment).toMatch(/^# (required|optional) · \w+ · /);
    expect(comment).toContain('/api/cron/retention');
    expect(comment).toMatch(/only where something calls/);
    expect(comment).toMatch(/Docker stack/);
  });
});
