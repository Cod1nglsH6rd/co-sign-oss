// Issue co-sign-418: CI runs the end-to-end test with no repository
// settings. Checks the e2e job in .github/workflows/ci.yml, that the quality
// job is as it was, and that the README's CI line names the job.
// 2026-11-20: where each job runs comes from the repository
// variables CI_RUNS_ON and CI_E2E_RUNS_ON, and pull requests run e2e only when
// they touch more than documentation and unit tests (the changes job).
// Later the same day: on a self-hosted runner (no sudo, rootless Docker) e2e
// runs the test in the Playwright image inside the gateway's network
// namespace; GitHub's runners keep their steps.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const COMPOSE = 'docker compose -f docker-compose.yml -f tests/e2e/compose.e2e.yml';

// The text of one job: from its `  name:` line to the next job or the end.
function jobText(name) {
  const lines = WORKFLOW.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end])) end += 1;
  // Comments just above the next job belong to it.
  while (end > start + 1 && /^ {2}#/.test(lines[end - 1])) end -= 1;
  return lines.slice(start, end).join('\n').trimEnd();
}

// Each step as { name, if, run }.
function steps(job) {
  return job.split(/\n\s{6}- name: /).slice(1).map((chunk) => {
    const [name, ...rest] = chunk.split('\n');
    const body = rest.join('\n');
    const cond = /\n?\s+if: (.+)/.exec(`\n${body}`);
    const run = /\s+run: \|?\s*([\s\S]*)$/.exec(body);
    return { name: name.trim(), if: cond ? cond[1].trim() : null, run: run ? run[1].replace(/\s*\\\n\s*/g, ' ').trim() : '' };
  });
}

const QUALITY = `  quality:
    runs-on: \${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Test coverage
        run: npm run test:coverage -- --runInBand

      - name: Build
        run: npm run build`;

describe('CI e2e job (co-sign-418)', () => {
  const e2e = jobText('e2e');

  it('has an e2e job with a 30 minute limit', () => {
    expect(e2e).not.toBeNull();
    expect(e2e).toMatch(/\n {4}timeout-minutes: 30\n/);
  });

  it('runs on pull requests and on pushes to main', () => {
    expect(WORKFLOW).toMatch(/\non:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n/);
  });

  it('installs, gets Chromium, brings the stack up, then runs the test', () => {
    const runs = steps(e2e).map((s) => s.run);
    const order = [
      'npm ci',
      'npx playwright install --with-deps chromium',
      `${COMPOSE} up -d --build`,
      'node tests/e2e/mainFlow.e2e.js',
    ].map((command) => runs.findIndex((run) => run === command || run.includes(command)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('limits each Chromium install try and tries again, so a stalled apt mirror cannot use up the job', () => {
    const install = steps(e2e).find((s) => s.run.includes('npx playwright install --with-deps chromium'));
    expect(install).toBeDefined();
    expect(install.run).toMatch(/timeout 240 npx playwright install --with-deps chromium/);
    expect(install.run).toMatch(/for attempt in 1 2 3/);
    expect(e2e).toMatch(/- name: Install Chromium\n {8}if: runner.environment != 'self-hosted'\n {8}timeout-minutes: 14\n/);
  });

  it('prints the stack logs on failure, with the setup code hidden', () => {
    const logs = steps(e2e).find((s) => s.run.startsWith(`${COMPOSE} logs`));
    expect(logs).toBeDefined();
    expect(logs.if).toBe('failure()');
    expect(logs.run).toContain("sed -E 's/Setup code: [0-9a-f]{32}/Setup code: [hidden]/g'");
  });

  it('always takes the stack down with its volumes', () => {
    const all = steps(e2e);
    const down = all[all.length - 1];
    expect(down.run).toBe(`${COMPOSE} down -v`);
    expect(down.if).toBe('always()');
  });

  it('never mentions secrets', () => {
    expect(WORKFLOW).not.toMatch(/secrets/i);
  });

  it('leaves the quality job as it was', () => {
    expect(jobText('quality')).toBe(QUALITY);
  });

  it("is named on the README's CI line", () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const line = readme.split('\n').find((l) => l.startsWith('- **CI:**'));
    expect(line).toContain('`e2e`');
    expect(line).toContain('tests/e2e/mainFlow.e2e.js');
  });
});

describe('where CI runs, and when e2e runs (2026-11-20)', () => {
  const e2e = jobText('e2e');
  const changes = jobText('changes');

  it('quality and the changes job follow CI_RUNS_ON, GitHub-hosted ubuntu-latest when it is unset', () => {
    const line = `runs-on: \${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}`;
    expect(jobText('quality')).toContain(line);
    expect(changes).toContain(line);
  });

  it('e2e follows CI_E2E_RUNS_ON, ubuntu-24.04 when it is unset', () => {
    expect(e2e).toContain(`runs-on: \${{ fromJSON(vars.CI_E2E_RUNS_ON || '"ubuntu-24.04"') }}`);
  });

  it('skips e2e while CI_RUNS_ON is set and CI_E2E_RUNS_ON is not', () => {
    const cond = /\n {4}if: \$\{\{ (.+) \}\}\n/.exec(e2e);
    expect(cond).not.toBeNull();
    expect(cond[1]).toContain("(vars.CI_E2E_RUNS_ON != '' || vars.CI_RUNS_ON == '')");
    expect(cond[1]).toContain('!cancelled()');
  });

  it('runs e2e on pushes to main, and on pull requests only when the changes job says so', () => {
    expect(e2e).toMatch(/\n {4}needs: changes\n/);
    expect(e2e).toContain("(github.event_name != 'pull_request' || needs.changes.outputs.e2e == 'true')");
    expect(changes).toContain("github.event_name == 'pull_request'");
  });

  it('lists a rename as both paths, so moving a file out of tests/ or docs/ still runs e2e', () => {
    expect(changes).toContain('git diff --no-renames --name-only HEAD^1 HEAD');
  });

  // Runs the changes job's own script with a stand-in for git.
  function needsE2e(files, gitFails = false) {
    const step = steps(changes).find((s) => s.name === 'Files changed');
    expect(step).toBeDefined();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-changes-'));
    const out = path.join(dir, 'out');
    fs.writeFileSync(out, '');
    const stub = gitFails ? 'git() { return 1; }' : 'git() { printf "%s\\n" "$FILES"; }';
    try {
      execFileSync('bash', ['-c', `${stub}\n${step.run}`], {
        env: { ...process.env, FILES: files.join('\n'), GITHUB_OUTPUT: out },
        stdio: 'pipe',
      });
      return fs.readFileSync(out, 'utf8').trim();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('skips e2e for documentation or unit tests only', () => {
    expect(needsE2e(['README.md', 'docs/GO-LIVE-CHECKLIST.md', 'LICENSE'])).toBe('e2e=false');
    expect(needsE2e(['tests/lib/setupLock.needed.test.js', 'jest.config.js', 'lib/README.md'])).toBe('e2e=false');
  });

  it('runs e2e for the app, the database, the stack, the end-to-end test or the workflow', () => {
    for (const f of ['pages/index.js', 'lib/sessions.js', 'supabase/migrations/1.sql', 'Dockerfile',
      'docker-compose.yml', 'package-lock.json', 'tests/e2e/mainFlow.e2e.js', '.github/workflows/ci.yml']) {
      expect(needsE2e(['README.md', f])).toBe('e2e=true');
    }
  });

  it('runs e2e when the changed files cannot be listed', () => {
    expect(needsE2e([], true)).toBe('e2e=true');
    expect(needsE2e([])).toBe('e2e=true');
  });
});

describe('e2e on a self-hosted runner, GitHub\'s runners unchanged (2026-11-20)', () => {
  const e2e = jobText('e2e');
  const all = steps(e2e);
  const step = (name) => all.find((s) => s.name === name);
  const HOSTED = "runner.environment != 'self-hosted'";
  const SELF = "runner.environment == 'self-hosted'";
  const SELF_FILES = `${COMPOSE} -f tests/e2e/compose.selfhosted.yml`;

  it("keeps GitHub's runners on their own steps, unchanged", () => {
    expect(step('Install Chromium').if).toBe(HOSTED);
    expect(e2e).toMatch(/- name: Cache the Playwright browser\n {8}if: runner.environment != 'self-hosted'\n {8}uses: actions\/cache@v4\n/);
    // A step's text runs to the next step, so the next step's comments are left out here.
    const command = (s) => ({ ...s, run: s.run.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').trim() });
    expect(command(step('Start the stack'))).toEqual({ name: 'Start the stack', if: HOSTED, run: `${COMPOSE} up -d --build` });
    expect(command(step('End-to-end test'))).toEqual({ name: 'End-to-end test', if: HOSTED, run: 'node tests/e2e/mainFlow.e2e.js' });
  });

  it('runs every self-hosted step only on a self-hosted runner', () => {
    const own = all.filter((s) => /self-hosted/.test(s.name));
    expect(own.map((s) => s.name)).toEqual([
      'Watch memory (self-hosted)',
      'Build the test container (self-hosted)',
      'Start the stack (self-hosted, no published port)',
      'End-to-end test (self-hosted, in the Playwright container)',
      'Start the stack again at the site address (self-hosted)',
      'Second phase at the site address (self-hosted, a browser on its own network namespace)',
      'Memory (self-hosted)',
      "Remove the test container and the stack's images (self-hosted)",
    ]);
    for (const s of own) expect([SELF, `always() && ${SELF}`]).toContain(s.if);
  });

  it('gives each run its own Compose project, since a self-hosted runner keeps Docker state', () => {
    expect(e2e).toMatch(/\n {4}env:\n {6}COMPOSE_PROJECT_NAME: cosign-e2e-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\n/);
  });

  it("builds the test container from the Playwright image of the lock file's version", () => {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    const version = lock.packages['node_modules/playwright'].version;
    const dockerfile = fs.readFileSync(path.join(ROOT, 'tests', 'e2e', 'runner.Dockerfile'), 'utf8');
    const from = dockerfile.split('\n').filter((l) => l.startsWith('FROM '));
    expect(from[from.length - 1]).toBe(`FROM mcr.microsoft.com/playwright:v${version}-noble`);
    expect(step('Build the test container (self-hosted)').run).toContain('docker build -q -t "$image" - < tests/e2e/runner.Dockerfile');
  });

  it('publishes no port on the self-hosted machine', () => {
    const override = fs.readFileSync(path.join(ROOT, 'tests', 'e2e', 'compose.selfhosted.yml'), 'utf8');
    expect(override).toMatch(/\nservices:\n {2}gateway:\n {4}ports: !reset \[\]\n/);
    expect(step('Start the stack (self-hosted, no published port)').run).toBe(`${SELF_FILES} up -d --build`);
  });

  it("runs the test in the gateway's network namespace with no COSIGN_URL, so the expired-link check runs", () => {
    const run = step('End-to-end test (self-hosted, in the Playwright container)').run;
    expect(run).toContain('docker run --rm --init --name "$COMPOSE_PROJECT_NAME-test"');
    expect(run).toContain('--network "container:$gateway"');
    expect(run).toContain('-v "$sock:/var/run/docker.sock" -e DOCKER_HOST=unix:///var/run/docker.sock');
    expect(run).toContain('-e COMPOSE_PROJECT_NAME');
    expect(run).toMatch(/"\$E2E_IMAGE" node tests\/e2e\/mainFlow\.e2e\.js$/);
    expect(WORKFLOW).not.toContain('COSIGN_URL=');
    expect(WORKFLOW).not.toMatch(/-e COSIGN_URL|^\s+COSIGN_URL:/m);
  });

  it('never prints the setup code: the only log dump is the hidden one, and the code is never passed in', () => {
    const dumps = all.filter((s) => /docker (compose .*)?logs\b/.test(s.run));
    expect(dumps.map((s) => s.name)).toEqual(['Stack logs (setup code hidden)']);
    expect(WORKFLOW).not.toContain('COSIGN_SETUP_CODE');
  });

  it('removes the test container, the stack, its volumes and its built images, then takes the stack down as always', () => {
    const names = all.map((s) => s.name);
    const clean = step("Remove the test container and the stack's images (self-hosted)");
    expect(clean.if).toBe(`always() && ${SELF}`);
    expect(clean.run).toContain('docker rm -f "$COMPOSE_PROJECT_NAME-test"');
    expect(clean.run).toContain(`${SELF_FILES} down -v --rmi local`);
    expect(names.indexOf(clean.name)).toBe(names.length - 2);
    expect(all[all.length - 1]).toEqual({ name: 'Stop the stack', if: 'always()', run: `${COMPOSE} down -v` });
  });
});

// 2026-11-21: a second phase on the same database, the stack brought up again
// with COSIGN_SITE_URL set to an address that is not localhost, and the test
// (tests/e2e/siteAddress.e2e.js) in a browser whose localhost is not the app.
describe('e2e second phase: the site address, from another machine (2026-11-21)', () => {
  const e2e = jobText('e2e');
  const all = steps(e2e);
  const names = all.map((s) => s.name);
  // A step's text runs to the next step, so the next step's comments are left out here.
  const step = (name) => {
    const found = all.find((s) => s.name === name);
    return found && { ...found, run: found.run.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').trim() };
  };
  const HOSTED = "runner.environment != 'self-hosted'";
  const SELF = "runner.environment == 'self-hosted'";
  const SITE_FILES = `${COMPOSE} -f tests/e2e/compose.selfhosted.yml -f tests/e2e/compose.site.yml`;
  const firstHosted = 'End-to-end test';
  const firstSelf = 'End-to-end test (self-hosted, in the Playwright container)';
  const againHosted = 'Start the stack again at the site address';
  const againSelf = 'Start the stack again at the site address (self-hosted)';
  const secondHosted = 'Second phase at the site address';
  const secondSelf = 'Second phase at the site address (self-hosted, a browser on its own network namespace)';

  it('runs the second phase on both paths, each after its first phase and its stack brought up again', () => {
    for (const [first, again, second, cond] of [[firstHosted, againHosted, secondHosted, HOSTED], [firstSelf, againSelf, secondSelf, SELF]]) {
      expect([again, step(again) && step(again).if]).toEqual([again, cond]);
      expect([second, step(second) && step(second).if]).toEqual([second, cond]);
      expect(names.indexOf(first)).toBeLessThan(names.indexOf(again));
      expect(names.indexOf(again)).toBeLessThan(names.indexOf(second));
    }
    expect(step(secondHosted).run).toBe('node tests/e2e/siteAddress.e2e.js');
    expect(step(secondSelf).run).toMatch(/"\$E2E_IMAGE" node tests\/e2e\/siteAddress\.e2e\.js$/);
  });

  it('sets the site address to one that is not localhost, on the same stack and database (no down, no --build)', () => {
    const hosted = step(againHosted).run;
    expect(hosted).toContain("ip=$(ip -4 route get 1.1.1.1 | sed -n 's/.* src \\([0-9.]*\\).*/\\1/p')");
    expect(hosted).toContain("case \"$ip\" in '' | 127.*)");
    expect(hosted).toContain(`COSIGN_BIND="$ip" COSIGN_SITE_URL="http://$ip:3000" ${COMPOSE} up -d`);
    expect(hosted).toContain('echo "COSIGN_SITE_URL=http://$ip:3000" >> "$GITHUB_ENV"');

    const self = step(againSelf).run;
    expect(self).toContain('site=http://cosign.test:3000');
    expect(self).toContain(`COSIGN_SITE_URL="$site" ${SITE_FILES} up -d`);
    expect(self).toContain('echo "COSIGN_SITE_URL=$site" >> "$GITHUB_ENV"');
    for (const run of [hosted, self]) {
      expect(run).not.toMatch(/\bdown\b|--build|-v\b/);
    }
    const site = fs.readFileSync(path.join(ROOT, 'tests', 'e2e', 'compose.site.yml'), 'utf8');
    expect(site).toMatch(/\nservices:\n {2}gateway:\n {4}networks:\n {6}default:\n {8}aliases:\n {10}- cosign\.test\n/);
    expect(site).not.toMatch(/ports/);
  });

  it('never sets the site address before or during the first phase', () => {
    const before = all.slice(0, names.indexOf(againHosted));
    for (const s of before) expect([s.name, /COSIGN_SITE_URL|COSIGN_BIND/.test(s.run)]).toEqual([s.name, false]);
    expect(e2e.split(`- name: ${againHosted}\n`)[0]).not.toMatch(/COSIGN_SITE_URL|COSIGN_BIND/);
  });

  it("runs the self-hosted browser in a container of its own on the stack's network, not in the gateway's namespace, with no Docker socket", () => {
    const run = step(secondSelf).run;
    expect(run).toContain('net="${COMPOSE_PROJECT_NAME}_default"');
    expect(run).toContain('docker run --rm --init --name "$COMPOSE_PROJECT_NAME-site"');
    expect(run).toContain('--network "$net"');
    expect(run).not.toContain('container:');
    expect(run).not.toMatch(/docker\.sock|DOCKER_HOST/);
    expect(run).toContain('-e COSIGN_SITE_URL');
    expect(run).toContain('-v "$E2E_STATE:$E2E_STATE" -e COSIGN_E2E_HANDOFF');
  });

  it('hands the first phase\'s data to the second in a folder only the runner user opens, on both paths', () => {
    const folder = step("Folder for the second phase's handoff");
    expect(folder.if).toBeNull();
    expect(folder.run).toContain('state="$RUNNER_TEMP/e2e-state-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"');
    expect(folder.run).toContain('mkdir -m 700 "$state"');
    expect(folder.run).toContain('echo "COSIGN_E2E_HANDOFF=$state/handoff.json" >> "$GITHUB_ENV"');
    expect(names.indexOf(folder.name)).toBeLessThan(names.indexOf(firstHosted));
    expect(names.indexOf(folder.name)).toBeLessThan(names.indexOf(firstSelf));
    expect(step(firstSelf).run).toContain('-v "$E2E_STATE:$E2E_STATE" -e COSIGN_E2E_HANDOFF');
    const main = fs.readFileSync(path.join(ROOT, 'tests', 'e2e', 'mainFlow.e2e.js'), 'utf8');
    expect(main).toContain('writeHandoff(env.COSIGN_E2E_HANDOFF, handoffOf(ctx))');
    const helpers = fs.readFileSync(path.join(ROOT, 'tests', 'e2e', 'helpers.js'), 'utf8');
    expect(helpers).toContain("{ mode: 0o600, flag: 'wx' }");
    expect(helpers).toContain('fs.unlinkSync(file);');
  });

  // The first failing run of the second phase showed the database's first
  // start logging the statement that sets its password; the dump hides it.
  it("hides the database password the stack logs on its first start, and the setup code, in the failure dump", () => {
    const logs = all.find((s) => s.name === 'Stack logs (setup code hidden)');
    const filters = logs.run.split('|').slice(1).join('|');
    const sample = [
      "db-1 | ALTER USER supabase_admin WITH PASSWORD 'abc123def456';",
      "db-1 | alter user authenticator with password 'Zz9-_x';",
      'app-1 | Setup code: 0123456789abcdef0123456789abcdef',
      'auth-1 | {"msg":"Login","login_method":"password"}',
    ].join('\n');
    const out = execFileSync('bash', ['-c', `printf '%s\\n' "$SAMPLE" | ${filters}`], { env: { ...process.env, SAMPLE: sample }, encoding: 'utf8' });
    expect(out).not.toMatch(/abc123def456|Zz9-_x|0123456789abcdef0123456789abcdef/);
    expect(out).toContain("WITH PASSWORD '[hidden]';");
    expect(out).toContain("with password '[hidden]';");
    expect(out).toContain('Setup code: [hidden]');
    expect(out).toContain('"login_method":"password"');
  });

  it('always removes the handoff folder, both test containers, and every container, volume and network of the run', () => {
    const folder = step("Remove the second phase's handoff folder");
    expect(folder.if).toBe('always()');
    expect(folder.run).toContain('rm -rf -- "$E2E_STATE"');
    expect(folder.run).toContain("find \"$RUNNER_TEMP\" -maxdepth 1 -name 'e2e-state-*' -print");
    const clean = step("Remove the test container and the stack's images (self-hosted)");
    expect(clean.if).toBe(`always() && ${SELF}`);
    expect(clean.run).toContain('docker rm -f "$COMPOSE_PROJECT_NAME-test" "$COMPOSE_PROJECT_NAME-site"');
    expect(clean.run).toContain('docker ps -aq --filter "$project"; docker ps -aq --filter "name=^$COMPOSE_PROJECT_NAME-"; docker volume ls -q --filter "$project"; docker network ls -q --filter "$project"');
    expect(clean.run).toMatch(/\[ -z "\$left" \] \|\| \{ .*exit 1; \}/);
    expect(names.indexOf(folder.name)).toBeLessThan(names.indexOf(clean.name));
  });

  it('keeps each new step inside the job, with its own limit', () => {
    for (const name of [againHosted, againSelf]) expect(e2e).toContain(`- name: ${name}\n        if: ${name === againSelf ? SELF : HOSTED}\n        timeout-minutes: 10\n`);
    for (const name of [secondHosted, secondSelf]) expect(e2e).toContain(`- name: ${name}\n        if: ${name === secondSelf ? SELF : HOSTED}\n        timeout-minutes: 15\n`);
  });
});

describe('the end-to-end file stays out of npm test', () => {
  it('jest only matches *.test.js under tests/ and __tests__ folders', () => {
    const config = fs.readFileSync(path.join(ROOT, 'jest.config.js'), 'utf8');
    expect(config).toContain("'<rootDir>/tests/**/*.test.js'");
    expect('tests/e2e/mainFlow.e2e.js').not.toMatch(/\.test\.js$/);
    expect('tests/e2e/mainFlow.e2e.js').not.toMatch(/__tests__/);
  });
});
