const fs = require('fs');
const path = require('path');

// Issues co-sign-294 and co-sign-295 (protected files done by hand): the
// migration runner has an npm script and its `pg` driver is a dependency in
// package.json and package-lock.json, and next.config.js builds the
// standalone server the Docker image runs.

const ROOT = path.join(__dirname, '..', '..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));

function loadConfig() {
  let config;
  const saved = { SENTRY_DSN: process.env.SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN };
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  try {
    jest.isolateModules(() => {
      config = require('../../next.config.js');
    });
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
  return config;
}

describe('home hosting protected files', () => {
  it('next.config.js sets output: standalone', () => {
    expect(loadConfig().output).toBe('standalone');
  });

  it('npm run db:migrate runs the migration runner, which exists', () => {
    expect(readJson('package.json').scripts['db:migrate']).toBe('node scripts/db/migrate.js');
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'db', 'migrate.js'))).toBe(true);
  });

  it('pg, which the runner requires, is a dependency in package.json and the lock', () => {
    const runner = fs.readFileSync(path.join(ROOT, 'scripts', 'db', 'migrate.js'), 'utf8');
    expect(runner).toMatch(/require\(\s*['"]pg['"]\s*\)/);
    expect(readJson('package.json').dependencies.pg).toBeDefined();
    const lock = readJson('package-lock.json');
    expect(lock.packages[''].dependencies.pg).toBe(readJson('package.json').dependencies.pg);
    expect(lock.packages['node_modules/pg'].version).toMatch(/^8\./);
  });
});
