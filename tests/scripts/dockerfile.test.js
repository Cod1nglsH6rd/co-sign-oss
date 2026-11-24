// Issue co-sign-295: the app's Docker image. A multi-stage build on a
// node:20 slim image (npm ci, npm run build), then a runtime stage that runs
// as a non-root user on 0.0.0.0:3000. docker/app-entrypoint.sh reads the
// keys from /keys/supabase.env at start, never prints them, and runs
// node server.js. .dockerignore keeps secrets, dependencies, build output and
// tests out of the build context.
//
// next.config.js (output: 'standalone') is protected and changed by a person
// after the merge, so it is not tested here.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// A missing file reads as '' so each test fails on its assertion.
function read(rel) {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

// Instruction lines without comments or blanks.
function lines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

// The lines from the last FROM to the end: the stage the container runs.
function runtimeStage(text) {
  const all = lines(text);
  let last = -1;
  all.forEach((line, i) => {
    if (/^FROM\s/i.test(line)) last = i;
  });
  return last === -1 ? [] : all.slice(last);
}

describe('Dockerfile (co-sign-295)', () => {
  it('is multi-stage on a node:20 slim image', () => {
    const froms = lines(read('Dockerfile')).filter((line) => /^FROM\s/i.test(line));
    expect(froms.length).toBeGreaterThanOrEqual(2);
    for (const from of froms) {
      expect(from).toMatch(/^FROM\s+node:20[\w.-]*slim\b/i);
    }
  });

  it('installs with npm ci and builds with npm run build', () => {
    const runs = lines(read('Dockerfile')).filter((line) => /^RUN\s/i.test(line));
    expect(runs.some((line) => /\bnpm ci\b/.test(line))).toBe(true);
    expect(runs.some((line) => /\bnpm run build\b/.test(line))).toBe(true);
  });

  it('runs the runtime stage as a user that is not root', () => {
    const users = runtimeStage(read('Dockerfile')).filter((line) => /^USER\s/i.test(line));
    expect(users.length).toBeGreaterThan(0);
    const user = users[users.length - 1].split(/\s+/)[1].split(':')[0];
    expect(user).not.toBe('');
    expect(user).not.toBe('root');
    expect(user).not.toBe('0');
  });

  it('listens on 0.0.0.0 port 3000 in the runtime stage', () => {
    const env = runtimeStage(read('Dockerfile')).filter((line) => /^ENV\s/i.test(line)).join('\n');
    expect(env).toMatch(/\bHOSTNAME[= ]"?0\.0\.0\.0"?/);
    expect(env).toMatch(/\bPORT[= ]"?3000"?/);
  });
});

describe('.dockerignore (co-sign-295)', () => {
  const entries = () => lines(read('.dockerignore')).map((line) => line.replace(/^\/+|\/+$/g, ''));

  it('lists .env*', () => {
    expect(entries()).toContain('.env*');
  });

  it('leaves out node_modules, .next and tests', () => {
    expect(entries()).toEqual(expect.arrayContaining(['node_modules', '.next', 'tests']));
  });
});

describe('docker/app-entrypoint.sh (co-sign-295)', () => {
  const script = () => read('docker/app-entrypoint.sh');
  const KEYS = /JWT_SECRET|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY/;

  it('sources /keys/supabase.env only when it is present', () => {
    const text = script();
    expect(text).toMatch(/\[\s+-[fr]\s+"?\/keys\/supabase\.env"?\s+\]/);
    expect(text).toMatch(/(^|\s)(\.|source)\s+"?\/keys\/supabase\.env"?/m);
  });

  it('exports SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY', () => {
    const exported = lines(script()).filter((line) => /^export\s/.test(line)).join('\n');
    expect(exported).toMatch(/\bSUPABASE_ANON_KEY\b/);
    expect(exported).toMatch(/\bSUPABASE_SERVICE_ROLE_KEY\b/);
  });

  it('never echoes a key variable or traces commands', () => {
    const body = lines(script());
    expect(body.length).toBeGreaterThan(0);
    const printing = body.filter((line) => /\b(echo|printf)\b/.test(line) && KEYS.test(line));
    expect(printing).toEqual([]);
    expect(body.filter((line) => /^set\s+-\w*x/.test(line))).toEqual([]);
    expect(body.filter((line) => /^(env|printenv)\b/.test(line))).toEqual([]);
  });

  it('ends by running node server.js', () => {
    const body = lines(script());
    expect(body[body.length - 1]).toMatch(/^exec\s+node\s+server\.js\b/);
  });
});
